# corti-soul

把 [Cortico](https://github.com/Pal-AI-Lab/Cortico) 从"能跑"收拾成"能天天挂着用"的一组补丁、守护脚本和一个桌面启动器。

本仓库**不含** Cortico 本体、SnowLuma 本体或任何第三方二进制，只放我们自己在它们之上写的东西。

---

## 这套东西解决什么问题

原版 Cortico 接 QQ 走 OneBot v11，能跑，但挂久了会碰到几个具体的坑。这些坑都在下面这条链路的某一环上：

```
桌面启动器（托盘常驻）
   └─ SnowLuma ──注入──> QQ 客户端
   └─ Cortico  ──正向 WS──> SnowLuma:3001   # QQ 消息通道
   └─ upstream-guard                        # 上游配额守护
```

### 1. 补丁（`patches/`）

打在 **Cortico 扩展源码** 上，因为这些问题在扩展里。

| 补丁 | 解决的问题 | 根因 |
|---|---|---|
| `patch-hide-console.mjs` | 启动后弹出一个残留的命令行窗口 | `bin/cortico.mjs` 的 `fork()` 没传 `windowsHide`，Node 默认 `false`，Windows 就给 tsx 孙进程新分配了控制台。父进程的 `CREATE_NO_WINDOW` 管不到孙进程。 |
| `patch-gaming-capture.mjs` | 「在玩什么」抓不到游戏画面 | 扩展用 `PrintWindow(h, dc, 2)` 抓窗口，对 GPU / DirectX 窗口返回 `false`。补丁加 `BitBlt` 抓屏回退。**限制：游戏必须在前台可见。** |
| `patch-gaming-match.mjs` | 「文件资源管理器」被识别成「守望先锋」 | 别名匹配是**子串**判定，别名 `OW` 命中了 `"do**w**nload"`。改成 ASCII 别名走词边界正则，并跳过系统进程。 |
| `patch-qqbot-bugs.mjs` | 刚聊完又被"主动开口"轰炸 | 主动说话的冷却只看 `lastEmitAt`，而它**只在主动发言时更新**；正常 `qq_send` 不通知调度器，于是刚回复完仍被判定"很久没说话"。 |
| `patch-qqbot-bugs2.mjs` | QQ 里冒出 `{"tool_calls":…}` / `<tool_call>…` 原始文本 | 模型偶尔把工具调用当正文吐出来，发送路径没做清洗。补丁加了 JSON / XML 两种形态的清洗（解析不出结构就原样放行，避免误伤正常文本）。 |

### 2. 上游配额守护（`guard/`）

Cortico **没有**原生的模型 fallback：`activeProvider` 是单值，`loop.ts` 的 `DEFAULT_RESUBMIT` 只重试同一个端点。

而免费池的限流有个反直觉的性质（读 `dsh-our-free-model` 源码得出）：

- 配额是**按会话**算的，不是按模型 —— `sessionForConversation()` 只从 `sessionId` 派生上游会话 id，**与模型名无关**。所以「换个免费模型」换不掉限流。
- 那条车道的 429 带**递增的 retry-after**，两次自动重试会让同一轮"付费三次、还来得更晚"。

`upstream-guard.mjs` 因此换的是**上游**而不是模型：常驻免费池，探测到不可用就通过控制台 API 切到渠道网关，恢复了再切回。它只做「探测 + 切 `activeProvider`」，不代理请求，本身不消耗 token。

### 3. 桌面启动器（`launcher/`）

一个托盘常驻的 GUI（Python + pywebview + WebView2），把上面这些按序拉起来并显示健康状态。**窗口是可选的前台**：关掉它，后台服务照常跑。

---

## 依赖与密钥

### 组件（需自行安装，均不在本仓库内）

| 组件 | 说明 |
|---|---|
| Node.js | ≥ 22 |
| QQ NT 客户端 | Windows |
| [SnowLuma](https://github.com/SnowLuma/SnowLuma) | OneBot v11 实现，负责注入 QQ |
| [Cortico](https://github.com/Pal-AI-Lab/Cortico) | 人格本体，`pnpm install` 后可用 |
| [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) | 本地免费模型转发口，默认 `127.0.0.1:18899` |
| WebView2 运行时 | Win10/11 通常已内置 |
| Python 3.12 | 只在**构建**启动器时用，运行已打包的 exe 不需要 |

### 环境变量

**本仓库不含任何密钥或账号 id。** 运行期需要的值一律走环境变量或 gitignore 掉的本地配置：

| 变量 | 用途 | 缺失时 |
|---|---|---|
| `ONEBOT_TOKEN` | OneBot HTTP/WS 的 access token，守护进程发 QQ 通知用 | 留空则通知直接跳过，不影响切换功能 |
| `NOTIFY_QQ` | 通知发给哪个 QQ 号 | 同上 |
| `CORTICO_ROOT` | Cortico 检出路径 | 默认取本仓库的兄弟目录 `../cortico-qq` |
| `STACK_ROOT` | 栈根（放 SnowLuma 等组件的目录） | `start-ai.ps1` 默认上溯两级 |
| `GUARD_CONFIG` | 守护配置文件路径 | 默认 `guard/upstream-guard.json` |
| `GUARD_STATE` | 守护状态文件路径 | 默认 `guard/upstream-guard-state.json` |
| `DEPLOY_NAME` | Cortico 部署实例名 | 默认 `mybot` |

> 注意：真实的 `guard/upstream-guard.json` 含本地 QQ 号与 OneBot token，**已被 `.gitignore` 排除**。想手写就照 `guard/upstream-guard.example.json` 复制一份；若文件不存在，守护进程会按 `DEFAULTS` 自动生成，但这种情况下 `notify.accessToken` / `notify.toUser` 取自上面的环境变量，不设就是空的（通知跳过，不影响切换）。

---

## 目录布局

本仓库假设自己**和 `cortico-qq` 同级**（都放在栈根下）：

```
<栈根>/
├─ SnowLuma/                    # 第三方，自行安装
├─ cortico-qq/                  # Cortico 检出（需自行 clone + pnpm install）
├─ corti-soul/                  # ← 本仓库
│   ├─ patches/                 # 5 个补丁脚本（幂等，可重复运行）
│   ├─ guard/                   # 上游配额守护 + 它的配置/状态文件
│   ├─ launcher/                # 桌面启动器源码与构建工作区
│   │   ├─ app.py coreclr_env.py corti-soul启动器.spec brand/ ui/
│   │   └─ dist/corti-soul启动器/   # 打包产物（不入库）
│   ├─ scripts/                 # start-ai.ps1
│   ├─ tools/                   # 建仓/推送等一次性工具（token 不入库）
│   └─ legacy/                  # 被取代的旧实现（C# 启动器、未脱敏原版脚本；不入库）
└─ 启动AI.bat                   # 双击入口
```

布局不是这个形状就往 `CORTICO_ROOT` / `STACK_ROOT` 里写实际路径。

> `cortico-qq/node_modules` 里大量 `.pnpm` 条目是**绝对路径符号链接**（本机实测 4.6 万个）。所以它必须待在原地；要整体搬家得先删 `node_modules` 再 `pnpm install`。

---

## 用法

### 打补丁

每个补丁都是**幂等**的：有 `.orig` 备份就先还原再重打，扩展升级后可以再跑一遍。回滚就是把同目录的 `.orig` 覆盖回去。

```bash
node patches/patch-hide-console.mjs
node patches/patch-gaming-capture.mjs
node patches/patch-gaming-match.mjs
node patches/patch-qqbot-bugs.mjs
node patches/patch-qqbot-bugs2.mjs   # 依赖前一个的产物，顺序别换
```

> `patch-qqbot-bugs2` 建立在 `patch-qqbot-bugs` 之上，必须先跑前者。

### 跑守护

```bash
node guard/upstream-guard.mjs
```

首次运行会在 `guard/` 下生成 `upstream-guard.json`。里面的 `primary` / `fallback` 填你**自己** Cortico 里的端点名。

### 起启动器

```powershell
cd launcher
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install pywebview pyinstaller pillow
.\.venv\Scripts\python.exe app.py                     # 开发
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean "corti-soul启动器.spec"   # 打包
```

产物在 `launcher\dist\corti-soul启动器\`，双击其中的 `corti-soul启动器.exe` 即可（托盘常驻，关窗不退出）。

> 用 `python -m PyInstaller` 而不是 `.venv\Scripts\pyinstaller.exe`：本机实测后者会以 exit 1 静默失败，前者正常。

> `pywebview` 需要构建期补丁才能在 CoreCLR 上工作，见 `launcher/README.md`。

---

## 已知注意事项

- **`patch-gaming-capture` 抓的是屏幕像素**，游戏必须在前台可见；被遮挡时抓到的是遮挡物。这是 `PrintWindow` 对 DirectX 窗口失效后的权宜之计。
- **改人格是改 `CONSTITUTION.md`**，不是改本仓库。人格由 Cortico 的 bot 包提供，每次会话启动时加载。
- **守护配置在启动时一次读入**，改了 `guard/upstream-guard.json` 要重启守护。
- 各脚本里的**中文注释**和 `.ps1` 的 **UTF-8 BOM** 是有意保留的：Windows PowerShell 5.1 在无 BOM 时按 GBK 解析，会报 `Unexpected token '}'`。

## 许可

私有项目，未附许可。
