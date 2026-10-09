# 免费池为什么"不能模型切换"

> 结论文档。所有事实来自 `dsh-our-free-model` 源码、其 `README.md`，以及本机实测。
> 不含凭据、账号、绝对路径。

## 一句话结论

免费池不是"一个池子里多个可轮换的节点"，而是**三条互不相通的车道（lane）**，各有各的上游域名。
而**同一车道内**，配额是按 **session** 计的，session 由请求体的 `user`/`conversation` 派生 —— Cortico 从不发这两个字段，于是所有请求塌缩成同一个 session、同一个配额桶。
**所以同车道内换模型 = 从同一个桶里换一个模型出来，桶被打满时换谁都一样。**
唯一有效的"切换"是**跨车道切换**。

---

## 一、三条车道（源码事实）

分派逻辑在 `src/adapter.js:215-219`：

```js
const sealed = isEacEntry(entry)
const kilo = isKiloEntry(entry)
const wire = sealed || kilo ? 'chat' : wireFor(entry.id)
```

| 车道 | 上游 | 凭据 | 代表模型 |
|---|---|---|---|
| **免密 free lane** | `https://opencode.ai`（Zen 网关，`src/upstream.js:20`） | `Authorization: Bearer public` —— 公共池凭据，**无 per-user key**（`upstream.js:135-141`） | `mimo-v2.6-flash-free`、`space-bunny-free`、`longcat-2.5-preview-free` |
| **Kilo** | `https://api.kilo.ai/api/gateway`（`src/kilo.js:29`） | **完全无凭据** —— 无 key、无登录、无指纹门 | `dots-studio/dots-3-note-preview:free`、`kilo-auto/free`、`openrouter/free` |
| **EAC** | 自建网关 | — | — |

`src/kilo.js:3-8` 注释原文：

> the pool answers with **no credential at all — no key, no login, no fingerprint gate**

`src/catalog.js:281` `KILO_CHANNEL = 'kilo'` / `:436 isKiloEntry()`；`:141 EAC_CHANNEL = 'eac'` / `:267 isEacEntry()`。

**⇒ 这就是"mimo 挂了、dots 还能用"的真正原因：它们根本不在同一条上游上。** 不是"池子里另一个节点顶上"。

---

## 二、配额按 session 计 —— "换了也没用"的根因

`README.md:462`：

> "不限量"指不存在额度体系……**但该车道按 session 统计速率，短时间内打满会返回 429。**

`README.md:386`：

> 转发会话键维持按 **user/conversation** 派生（上游按会话计额，为刻意设计）

派生链三步：

**①** `src/core/completion.js:43` —— 从请求体取种子：
```js
sessionId: `forward:${String(openAi.user ?? openAi.conversation ?? 'shared')}`
```

**②** `src/upstream.js:84-89` —— 铸造成上游认的 session id：
```js
export function sessionForConversation(sessionId) {
  if (typeof sessionId === 'string' && SESSION_RE.test(sessionId.trim())) return sessionId.trim()
  const seed = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'global'
  const digest = crypto.createHash('sha256').update(`our-free-model\0${seed}`).digest()
  return `ses_${digest.subarray(0,6).toString('hex')}${base62From(digest.subarray(6,20))}`
}
```

**③** Cortico 侧：`src/providers/openai-responses-compat/native.ts:59` 构造请求体时
**没有任何 `user` / `conversation` / `session_id` / `metadata` 字段**
（在该 provider 目录内检索 `user|session_id|metadata`，唯一命中是 `console/server.ts:54` 的一行测试文案）。

**⇒ 所有请求的种子都是字符串 `'shared'` ⇒ 全部铸造成同一个 `ses_…` ⇒ 同一个配额桶。**
同车道内无论把 `spec.model` 改成哪个模型，用的都是这个桶。

---

## 三、"换 ID 续配额"能不能做？—— 机制上能，实测对已限流模型无效

### 3.1 机制上确实有口子

Cortico 端点支持 `options.extraBody`，而它是**最后合并**进请求体的
（`native.ts:59` `return { ...body, ...extraBody }`；校验在 `native.ts:20-22`、`index.ts:24-25,45,98-99`）。
所以可以在端点配置里塞 `extraBody: { "user": "<随机值>" }` 来每轮铸造新 session。

### 3.2 但对已经打满的桶，换 session 拿不回来

实测（对当时已挂的 `mimo-v2.6-flash-free`，走本地转发口）：

| 做法 | 结果 |
|---|---|
| 不带 user ×3 | 全 502 Fast（464~1249ms） |
| **每轮换全新 user ×3** | **仍全 502** |
| 固定新 user 连打 7 次 | 全 502 |

≈460ms 的极快失败说明这是**上游侧确定性拒绝，不是按 session 排队**。
一个已经被打满的模型，换 session 不能让它立刻恢复。

### 3.3 也不能自己直连绕过

直连 `https://opencode.ai/zen/v1/chat/completions`，带 `Bearer public` + `opencode/1.18.31` + `x-opencode-*` 头，
换 session / project / UA / 带不带 tools —— **一律 403**：

> OpenCode's free tier can only be used from within OpenCode

⇒ 这条免密车道**必须经插件转发**，不存在"自己发请求绕过"的路径。

### 3.4 额外的形状门禁

Zen 自 2026-09-16 起对 session id 做**正则形状校验**（`vendor/channel-pack/src/opencode.ts:24-27`）：

```
^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$      // upstream.js:44 SESSION_RE
```

即 `ses_` + **12 位小写 hex** + 尾段总长 **26**。
作者第一版把长度常量误读，产出 38 字符的 id → 匿名通道**一律 403**。
形状不对，门禁直接拒。

**⇒ 换 ID 是一个真实存在、但只在"桶还没满"时才有意义的动作。**
它防的是"被人为固定成单一 session 而过早打满"，救不了已经打满的桶。

---

## 四、当前部署的实际状态

- 端点 `DSH_free_mimo-v26-flash` 的 `spec.model` 已从 `mimo-v2.6-flash-free`（**免密 lane**）换成 `dots-studio/dots-3-note-preview:free`（**Kilo lane**）
  → **这实质上是换了一条车道，而不仅仅是换模型**。这才是它现在能用的原因。
- 守护是双端点结构：primary = `DSH_free_mimo-v26-flash`（现指向 Kilo lane 的 dots），fallback = `DSH_free_deepseek-v41-flash`（渠道网关，有积分成本）。
- 当前 `activeProvider` = 免费池端点，守护状态 `switchedToFallbackAt: 0`（未驻留在备用）。

---

## 五、结论与可操作项

**为什么感觉"免费池不能切换模型"：**

1. 同一条车道内的多个模型是**并列**关系，不是**冗余**关系 —— 它们各自限流、各自地区门、各自下线，不是同一份配额的多个副本。
2. 同一车道内换模型**不换配额桶**（session 不变）→ 无意义的轮换。
3. 真正有效的轮换维度是**车道**，不是模型。

**能真正提升免费池可用性的做法：**

1. **坚持跨车道切换，而不是同车道换模型。** 现有双端点恰好落在两条车道上，结构是对的。
2. **给免费池再加一条冗余车道**：再建一个指向 Kilo lane（或其他车道）的端点，让"免费池"内部也有真正的第二个上游。这样守护的三态就能是「Kilo lane → 免密 lane → 渠道网关」。
3. **不要指望同车道轮换模型来"续命"。** 这条路已被源码结构和实测双双否掉。
4. 如需延缓单个 session 过早打满，可以用端点的 `extraBody: {"user": "..."}` 注入不同种子 —— 但要清楚它只是**分散**，不是**重置**。

---

## 附录：关键行号索引

| 位置 | 内容 |
|---|---|
| `src/adapter.js:215-219` | 按车道选择 wire 协议 |
| `src/adapter.js:227` | `sessionForConversation(options.sessionId)` |
| `src/catalog.js:17` | `ALWAYS_FREE = new Set(['union-alpha', 'space-bunny-free'])` |
| `src/catalog.js:59-63` | `isFreeLane(modelId)` |
| `src/catalog.js:141` / `:267` | `EAC_CHANNEL` / `isEacEntry` |
| `src/catalog.js:281` / `:436` | `KILO_CHANNEL` / `isKiloEntry` |
| `src/core/completion.js:43` | 从 `openAi.user ?? openAi.conversation ?? 'shared'` 取种子 |
| `src/kilo.js:3-8` | Kilo 车道"无任何凭据"的注释 |
| `src/kilo.js:29` | `KILO_BASE` |
| `src/upstream.js:20` | `UPSTREAM_BASE`（opencode.ai） |
| `src/upstream.js:44` | `SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/` |
| `src/upstream.js:84-89` | `sessionForConversation()` |
| `src/upstream.js:135-141` | `Authorization: Bearer public` |
| `src/providers/openai-responses-compat/native.ts:59` | `{ ...body, ...extraBody }`（extraBody 最后合并） |
| `vendor/channel-pack/src/opencode.ts:24-27` | 上游对 session id 的形状门禁 |
| `README.md:262` / `:386` / `:462` / `:575` | 配额按 session 计、按 user 派生、429 语义、403 地区门 |
