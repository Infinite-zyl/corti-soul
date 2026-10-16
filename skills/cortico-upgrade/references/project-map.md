# 项目入口与 0.2 迁移经验

仅在确定位置或适配具体模块时读取。以下为 2026-10-16 的已验证布局和历史事实，未来调用必须重新核实；不是“始终升级到 0.2.1”的指令。

## 定位与复用

当时仓库为 `D:/张屹霖/AI_AGENT_SOTWARE/corti-soul`，同级 `cortico-qq` 是保留的旧框架。优先从当前工作区定位仓库，不把绝对路径当作通用要求。

| 文件/目录（相对自有仓库） | 用途与限制 |
| --- | --- |
| runtime-selection.json | 私有运行目录选择；缺省才回落到同级 cortico-qq。不能因文件损坏而悄悄选另一部署。 |
| launcher/runtime_paths.py | Python 侧目录解析；启动器和观看服务共用。 |
| tools/cortico-runtime.py | status/select/snapshot；执行前阅读实现。现有 snapshot 只支持当时的 0.2 候选，备份目录固定为 backups/cortico-0.2-migration、部署按 mybot 处理；下次须先改成唯一备份位置并补测试，不能覆盖旧备份或直接当通用迁移器。 |
| launcher/game_controls.py | 三类 MC 进程的面板 API；按目标 package.json 选路，不在失败后跨 API 重放启动/停止。 |
| launcher/app.py、scripts/start-ai.ps1、guard/upstream-guard.mjs | GUI、脚本、守卫三条入口，均须检查当前目录选择和版本兼容。 |
| addons/minecraft-mobile-viewer/viewer.py | 从选用部署读取观察者配置；只控制自有观看进程，不因升级采集桌面或开启游戏/模型。 |
| patches/apply-cortico-0.2.mjs | 仅接受 0.2.1；默认/--check 预检，--apply 写入，reverse check 判断是否完整安装。 |
| patches/cortico-0.2.1-custom.patch | 对官方 0.2.1 的自有差异，包含迁移后的 MC 与上下文面板。Git attributes 固定 patch 的 LF。不能套到未来版本。 |
| addons/minecraft-home/tests/*.mts | CORTICO_ROOT 指向候选后，回放床/夜间、保护、门、设施复用、地表路线和起点恢复；先检查各测试不会 start 真 bot。 |
| launcher/brand/brand.json、version_info.txt | 与根 VERSION/CHANGELOG 同步；PyInstaller 产物在 launcher/releases/<自有版本>，不覆盖正在使用的 EXE。 |

源模块可同时存在于 addons 中和安装后的框架源码中，必须比较实际运行树。新改动未必已回收到旧分项补丁，不能只读 addons 就断定已备份全部功能。

## 这次实际踩到的迁移边界

- 0.1.8→0.2.1：`console()`→`webUi()`、`Console*`→`WebUi*`、面板目录 console→webui、`/api/console`→`/api/webui`；World/provider/bot 契约版本分别为 6/6/7。
- 原 terminal World 变为 console World。**`src/worlds/console`、ConsoleWorld、ConsoleConfigSection 是新版本合法名称**，不能继续把它们替成 webui。
- 旧扩展兼容层可映射旧类型/模块入口及部分旧面板路由，但只对适用的旧扩展生效；内置 MC 源码补丁和启动器不能假定享受同样兼容。
- 上游同时改了本地/外部服务器连接生命周期。必须将本地重连预算、暂停状态、手动恢复、失败通知去重接入新流程；普通心跳、反复 running 通知或状态轮询不能清空预算。
- MC 工具新增项需补新 describe 摘要；住宅变量要在真实 World、Proxy、模板占位符、运行时取值中一致声明；面板声明、浏览器 bundle 键和代理必须一致。
- 上下文统计新增 `.context-metrics.json` 后，统计交接笔记的测试应筛 `.md`；不要删除统计功能来凑文件数量。
- 最后一次发言回执可防交接后重复发送。正常近期发言若已在保留列表中，不应再次摘出并缩短/移动顺序；只有未保留的最后发言才需独立兜底。
- Windows 中文路径下 Vitest/Vite 动态 file URL 可能保留百分号编码；这次用仅测试配置的已存在路径解码处理，没有修改生产 Core 来迎合测试。
- Windows pnpm 目录中的 junction 可能是绝对路径。复制根 junction 会让新版仍读取旧版；改写硬链接也可能污染旧文件/包缓存。这次长期目录独立安装依赖，第三方扩展保留本地补丁并摆脱旧绝对链接。

## 历史证据与复查方式

2026-10-16 自有提交 `aeeb792c1d632c6d1b5fcaef39d4fb67f2b03d32`：官方 Cortico 0.2.1，自有 2.10.0。保留旧 0.1.8 与 2.9.0 EXE；部署 832 文件校验；最终 5022 通过/2 跳过。**这些是当时结果，下次不能照抄成新验收。**

本机记录：`docs/cortico-0.2-upgrade-review-20261016.md`。该次仅离线验证、构建与切换，没有启动真实 bot 做验收。

常用检查（替换为当次实际路径，读取工具源码后使用）：

```powershell
# 在自有仓库中；只报告当前选择，不启动服务
.\launcher\.venv\Scripts\python.exe tools/cortico-runtime.py status

# 在目标框架目录中；测试使用假模型及隔离服务
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/typescript/bin/tsc -p tsconfig.web.json --noEmit --pretty false
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=dot
```

相关回放与自有测试按改动选择；最终完整测试按仓库要求执行。遇到本机临时端口 EACCES 应辨别执行权限，不能改成真实模型或反复无效重试。构建命令、Node/pnpm 和 Python 路径以当次环境为准。
