# 给 QQ Bot 接上 OwVoice 语音合成 —— 落地方案

> 状态：**方案待审阅，尚未执行任何安装动作。**
> 目标声音：**朱诺**（Juno）。
> 基线：corti-soul v2.1.0（提交 `802fbf5`）。
>
> 路径约定：本文用 `<STACK_ROOT>` 指代容器根（即 `cortico-qq` / `SnowLuma` / `corti-soul` 的父目录）、`<Python310>` 指代 Python 3.10 的安装目录，避免写入本机绝对路径。

---

## 1. 为什么是 OwVoice

OwVoice 是守望先锋角色的本地语音合成工具，底层就是 **GPT-SoVITS**——目前中文少样本音色克隆里效果和社区规模都最好的方案之一。它把这个流程包成了一个带模型库、模型热切换、磁盘缓存的图形程序。

对我们来说它的价值在于：

- **纯本地推理**，不联网、不按次计费，语音不走第三方
- 有**官方后端 API**（`backend/server.py`），可以完全绕开图形界面当服务跑
- 有**模型注册表**，以后想换成别的角色只是换一个目录
- 自带 `scripts\start_gpt_sovits.ps1` 和 `scripts\launch_backend.py`，**不需要 OwVoice.exe 也能起服务**（这点很关键，见 §4）

许可：源码 MIT。**但发布包不含任何角色模型**——朱诺的模型得另外拿（见 §6）。

---

## 2. 架构：三个端口

```
QQ 消息
   │
   ▼
┌──────────────────────────┐
│ cortico qqbot 扩展       │
│  VoiceClient.sendVoice() │
└──────────┬───────────────┘
           │ POST /tts  {"text","voice","format":"wav"}
           ▼
┌──────────────────────────┐
│ 适配层  :7799            │  ← 我们自己写的，约 60 行 Node
│  /tts → /api/synthesize  │
└──────────┬───────────────┘
           │ POST /api/synthesize  {"voice_id","text","speed"}
           ▼
┌──────────────────────────┐
│ OwVoice 后端  :8765      │  模型注册表 / 缓存 / 热切换
└──────────┬───────────────┘
           │ POST /  (refer_wav_path, prompt_text, ...)
           ▼
┌──────────────────────────┐
│ GPT-SoVITS 引擎  :9880    │  权重在启动参数里定死
└──────────────────────────┘
```

端口都空闲（实测 7799 / 8765 / 9880 全未占用）。

**8765 为什么不能直接当 `/tts` 用**：它的合成端点是 `POST /api/synthesize`（`backend/server.py:574`），请求体要 `{"voice_id", "text", "speed", ...}`；而 qqbot 的 `voice.ts:31` 固定发 `POST <serviceUrl>/tts`、body `{"text", "voice", "format"}`。**返回体形状是一样的（都是裸 `audio/wav`）**，差的只是路径和那一个字段名（`voice` → `voice_id`）。所以垫一层薄适配就够，两边源码都不用动。

> 顺带排除的方案：GPT-SoVITS 自带的 `api_v2.py` **原生就有 `POST /tts`**（`:511`）。但它的 `TTS_Request` 要求每次请求都带 `ref_audio_path` / `prompt_text` / `prompt_lang`，而 qqbot 只会发 `text`；而且走它就得自己去 `tts_infer.yaml` 里配权重，丢掉 OwVoice 的模型库和缓存。**不划算，不用。**

---

## 3. 适配层设计

一个无依赖的 Node 服务，跟现有工具链（`guard/`、`patches/`）保持一致。放 `corti-soul/voice/tts-adapter.mjs`。

对外：

```
POST /tts      {"text": "...", "voice": "...", "format": "wav"}
  → 200  audio/wav（裸字节）
  → 502  引擎未就绪 / 合成失败，返回 JSON 说明

GET  /health   → {"ok":true,"engine":true,"voice":"juno","backend":"http://127.0.0.1:8765"}
```

配置走同目录的 `tts-adapter.json`（照 `guard/upstream-guard.example.json` 的惯例给一份 example）：

```json
{
  "port": 7799,
  "backend": "http://127.0.0.1:8765",
  "defaultVoiceId": "juno",
  "voiceMap": { "": "juno" },
  "speed": 1.0,
  "sampleSteps": 16,
  "timeoutMs": 180000
}
```

几个要点：

- **`voice` 缺省时用 `defaultVoiceId`**。qqbot 的 `voice.voice` 配置留空就不发这个字段，所以默认值必须落在适配层，不能指望它传。
- **超时要给足**。CPU 模式下合成一条几十字的语音可能要几十秒，`timeoutMs` 设 180 秒。qqbot 侧 `voice.timeoutMs` 默认 60000 也得跟着调大，否则适配层还没算完它先放弃了。
- **`sample_steps` 降到 16**。GPT-SoVITS 默认 32，是 GPU 上的甜点值；CPU 上砍到 16 能接近翻倍提速，音质损失很小。这个值透传给 `/api/synthesize`。
- 适配层不改 OwVoice 那套 `voice_id`（用它的注册表 id），我们只做名字映射。以后换角色改 `defaultVoiceId` 就行。

---

## 4. 安装计划

### 4.1 位置

`<STACK_ROOT>\OwVoice\`

和 `cortico-qq` / `SnowLuma` 平级，符合容器根「一个项目一个目录」的约定。路径长度约 33 字符，远低于安装器 120 字符的警告线。

### 4.2 三个硬约束

| 约束 | 现状 | 处理 |
|---|---|---|
| 必须 **CPython 3.10.x x64** | 机器上只有 3.12.10 | 装 3.10（见下） |
| 只能 **CPU 模式** | 显卡是 RX 6750 XT，GPU 模式硬要 NVIDIA + 驱动 ≥570 | `-Mode CPU` |
| 磁盘预留 **≥15 GB** | D 盘剩 823.5 GB | 无问题 |

### 4.3 关于 Python 3.10 —— 有个坑

安装器的探测逻辑（`scripts\environment\OwVoice.Environment.psm1:86`）走的是：

```powershell
$command = Get-Command python.exe -ErrorAction SilentlyContinue
```

**它只认 PATH 里第一个 `python.exe`**，拿到之后校验是不是 `3.10 / x64 / CPython`，不是就直接抛错。现在 PATH 里第一个是 3.12，所以**光是装上 3.10 还不够，得让它在 setup 期间排在 PATH 最前面**。

方案：`winget install Python.Python.3.10`（winget 可用，仓库里有 3.10.11），然后**只在跑 setup 的那个进程里**临时前置 PATH，不改系统环境变量：

```powershell
$env:PATH = "<Python310>;<Python310>\Scripts;$env:PATH"
```

装完的 `.venv` 是自包含的，之后跑服务不需要 PATH 里有 3.10。**如果你连这一步都不想动系统**，还有个更干净的选择：用 winget 的 `--location` 装到项目目录下，或者干脆让安装器自己用 `uv` 管——但那要改 `setup_v2.ps1`，我不建议动上游脚本。

> 注：安装器只比对 `major.minor`（`Test-OwVoicePythonCompatible:74-82`），不校验补丁号，所以 3.10.11 和它推荐的 3.10.10 等效。

### 4.4 流程

```powershell
# ① 装 Python 3.10
winget install --id Python.Python.3.10 --exact --accept-package-agreements --accept-source-agreements

# ② 拉发布包（不是源码，源码缺 OwVoice.exe / _internal）
#    OwVoice-v0.2.0.zip  104.2 MB，经代理 127.0.0.1:7897
#    解压到 <STACK_ROOT>\OwVoice

# ③ 配置环境（非交互，CPU 模式）
$env:PATH = "<Python310>;<Python310>\Scripts;$env:PATH"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
cd <STACK_ROOT>\OwVoice
.\scripts\setup_v2.ps1 -Mode CPU
```

**下载量估算**（来自 `environment-spec.json` 和 `resource-lock.json`）：

| 项 | 大小 |
|---|---|
| Python 依赖（torch CPU 等） | ~3.0 GB |
| FFmpeg + G2PW + FastText + NLTK | 797.6 MB |
| GPT-SoVITS 预训练底模 | 2.07 GB |
| **合计** | **~5.9 GB** |

下载走 Python 的 `urllib`，认 `HTTPS_PROXY` 环境变量。HuggingFace 那部分如果被墙，`resource-lock.json` 里有 `hf-mirror.com` 镜像，脚本会自动回退。

**空模型库不阻塞安装**：`setup_v2.ps1:218` 在角色数为 0 时只打一句黄字「尚未导入角色模型；环境安装会正常完成」。所以**可以先装环境，模型晚点再补**——这正是我建议的顺序。

### 4.5 起服务（两个进程）

装好之后绕开 GUI 直接起：

```powershell
# 引擎 9880 —— 需要 data\models\installed-models.json 存在，且取第一个模型
.\scripts\start_gpt_sovits.ps1

# 后端 8765
.\scripts\start_backend.ps1
```

注意 `start_gpt_sovits.ps1:19` 是 `Select-Object -First 1`——**只加载注册表里的第一个模型**。所以朱诺必须是注册表里第一个（或者唯一一个）。

实际上 OwVoice 的 `frontend/startup.py:359` 也是同一套逻辑，只是多了 NLTK 资源校验。我们不用它的 GUI，抄它的启动参数即可。

---

## 5. 启动器集成

`corti-soul 启动器` 现在管 6 项。接进来之后变 8 项：

| # | 服务 | 端口 | 说明 |
|---|---|---|---|
| 1 | DSH 模型转发 | 18899 | 大脑入口 |
| 2 | QQ 客户端 | — | QQNT |
| 3 | SnowLuma | 5099 / 3001 | WebUI / OneBot |
| 4 | Cortico 控制台 | 7788 | 人格本体 |
| 5 | 免费池守护 | — | upstream-guard |
| **6** | **OwVoice 引擎** | **9880** | **GPT-SoVITS** |
| **7** | **OwVoice 后端** | **8765** | **模型库** |
| **8** | **TTS 适配层** | **7799** | **/tts ↔ /api/synthesize** |

改动集中在 `corti-soul/launcher/app.py`：

- `list_services()`（`:212`）加三项
- `start_all()` 加三步，顺序必须在 Cortico **之前**（否则 AI 一开口就发语音会失败）
- 引擎冷启动要预热模型，等 9880 的时间给长一点；`frontend/startup.py:398` 用的是 180 秒，我照抄
- 加一个 `voice_enabled()` 探针（打 `:7799/health`），这样 UI 上能标出「没配模型 = 语音不可用」而不是傻等

**这一个改动会让 exe 需要重新打包**（大概 5 分钟）。

还有个体验问题：`corti-soul 启动器` 现在双击后 6 个灯几秒就全绿。加上 OwVoice 之后，第一次启动要多等 **30~60 秒**（模型加载进内存）。UI 上得给个明确的「语音引擎加载中」状态，不然会以为卡死了。这是唯一需要动 UI 的地方。

---

## 6. 卡点：朱诺的模型

**这是整件事唯一的真阻塞。** OwVoice 发布包**不含任何角色模型**，也不提供联网下载（`backend/model_manager.py:50-51` 把 `index_url` 直接 `del` 掉了）。README 明说要去本地模型库导入「有权使用的模型」。

按 `MODEL_PACKAGE_SPEC.md`，一个模型目录长这样：

```
juno/
├─ model.json
├─ GPT_weights/juno.ckpt      ← GPT 权重，.ckpt
├─ SoVITS_weights/juno.pth    ← SoVITS 权重，.pth
└─ reference.wav              ← 参考音频（5~10 秒干净人声）
```

`model.json`：

```json
{
  "id": "juno",
  "name": "朱诺",
  "display_name": "朱诺",
  "locale": "zh-CN",
  "mode": "finetuned",
  "gpt_model": "GPT_weights/juno.ckpt",
  "sovits_model": "SoVITS_weights/juno.pth",
  "reference_audio": "reference.wav",
  "prompt_text": "参考音频对应的文字。",
  "prompt_language": "zh",
  "enabled": true,
  "inference": { "top_k": 15, "top_p": 0.9, "temperature": 0.75, "sample_steps": 16 }
}
```

拿到之后两条路都行：

- **走 GUI**（推荐）：双击 `OwVoice.exe` → 「本地模型库」→ 导入目录。程序会校验 `model.json`、复制到 `data/models/`、写注册表、生成路径。
- **走脚本**：把模型目录放到 `data/models/juno/`，然后跑 `scripts\normalize_local_models.ps1`（注意它要求 `config\voices.local.json` 里有启用角色，否则抛错——这个文件 setup 时会从 example 复制出来，得手填）。

获取渠道：OwVoice 的 **QQ 群 1121380498**（README 指明模型资源在群里）。或者用它的「本地训练」自己训一个——但那需要额外 1.6 GB 训练依赖，且要 GPU，我们这条路走不通。

**我的建议**：先把环境装好（§4.4），同时你去群里拿朱诺的模型包。两边并行，谁都不等谁。

---

## 7. 已知风险

### 7.1 CPU 推理速度（最大的未知数）

GPT-SoVITS 在 GPU 上合成一句话是秒级；**CPU 模式会慢一个数量级**。我估 30 个中文字、`sample_steps: 16` 大概 **10~30 秒**。i5-12490F 是 6 核 12 线程，不算弱，但这是纯串行推理，多核帮不上太多。

影响：QQ 里对方发消息 → AI 想回语音 → 等二三十秒才收到。这个体验好不好，**得实测才知道**。我会在装好后先跑一个基准测试（合成固定文本，计时），再决定 `sample_steps` 和 `maxChars` 怎么配。

如果真的慢到不可接受，几条退路：
- `maxChars` 压到 40 字以内，只发短句
- `sample_steps` 再降到 8
- 加一层「语音缓存/预生成」
- 极端情况下放弃 CPU 路线，考虑 GPU 租用（但那就不是本地了）

### 7.2 内存

机器 15.8 GB。GPT-SoVITS 加载后常驻约 2~4 GB，叠加 QQ + SnowLuma + Cortico + DSH，会比较紧张。如果出现被系统换页导致卡顿，`sample_steps` 和并发都得往下压。

### 7.3 模型许可

守望先锋角色声音的使用权归暴雪。**本地自用没问题，公开发布或商用有法律风险**。我们只是自己机器上跑，但这句得写在文档里。

### 7.4 上游打包缺失

`OwVoice.exe`、`_internal\`、`BUILD_INFO.json`、`release-files-v1.json` 都不在源码仓库里——但我们**跑服务用不到它们**（只影响 GUI 启动和程序内自动更新）。所以用发布包 ZIP 最省事；万一只用源码目录，服务照样能起。

### 7.5 端口

7799 / 8765 / 9880 当前都空闲。但 8765 和 9880 被占用时 OwVoice 安装器**只警告不阻塞**（`setup_v2.ps1:100-101`），起服务时才会真炸。启动器里要检查。

---

## 8. 待你确认的决策点

1. **装不装 Python 3.10 到系统**（winget 默认装到用户目录，会改 PATH）。或者你想装到别处？
2. **OwVoice 放 `<STACK_ROOT>\OwVoice`** 行不行？
3. **朱诺模型从群里拿** —— 还是你已经有别的来源？
4. **适配层放 `corti-soul/voice/`** —— 这样会被 git 跟踪，方便以后换机器复现。或者你希望放在容器根当本地脚本？

你点头之后，第 §4.4 的 `setup_v2.ps1 -Mode CPU` 一跑就是将近 6 GB 下载，那一步我会盯着日志走完。

---

## 附：关键文件与行号索引

供后续排查用。

| 位置 | 说明 |
|---|---|
| `backend/server.py:574` | `POST /api/synthesize`，返回 FileResponse(audio/wav) |
| `backend/server.py:239` | `engine_online()` —— 探测 9880 的 `/control` |
| `backend/server.py:186` | `find_voice()` —— 从注册表找角色 |
| `backend/server.py:140` | `load_voices()` —— **注册表才是唯一角色来源**，`voices.local.json` 已废弃 |
| `backend/server.py:591` | 磁盘缓存 `.cache/synthesis/<key>.wav` |
| `backend/server.py:610` | 转发给 9880，`POST /` 失败回退 `GET /` |
| `frontend/startup.py:359` | `start_gpt_sovits()` —— 9880 的启动参数权威来源 |
| `frontend/startup.py:401` | `start_backend()` —— 8765 启动 + 健康检查 |
| `scripts/start_gpt_sovits.ps1:19` | `Select-Object -First 1`，只加载第一个模型 |
| `scripts/setup_v2.ps1:130` | `Ensure-PythonEnvironment()` —— PATH 第一个 python 的坑 |
| `scripts/setup_v2.ps1:218` | 空模型库只警告，不阻塞 |
| `scripts/environment/OwVoice.Environment.psm1:74` | `Test-OwVoicePythonCompatible()` —— 只比对 major.minor |
| `MODEL_PACKAGE_SPEC.md` | 模型包规范 |
| `cortico-qq/extensions/node_modules/cortico-world-qq-better-alont1/src/voice.ts:31` | qqbot 侧唯一的对外契约：`POST <url>/tts` |
| `cortico-qq/extensions/.../src/world.ts:1418` | `sendVoice()` —— 合不上就退回文字 |
| `cortico-qq/extensions/.../src/world.ts:1548` | 只有 `voice.enabled` 才给 AI 暴露 `voice` 参数 |
| `cortico-qq/deployments/mybot/config.json` | `worlds.qqbot.voice` 配置段 |
