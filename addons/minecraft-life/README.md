# 自主生活接续（2.12.0）

本模块记录公开的游戏安排与执行事实，不写Persona记忆，不替模型选择生活目标。支持Cortico 0.2.1；观察者模组1.1.0。没有新增模型、端口、上游探针或固定生活日程。

## 安装与恢复

在其他Minecraft补丁安装完成后执行：

```text
node patches/patch-minecraft-life.mjs
node patches/patch-minecraft-life.mjs --apply
launcher\.venv\Scripts\python.exe addons/minecraft-observer/install.py --apply
```

补丁先预检全部锚点，再修改World、代理和引擎IPC；每份原文件保存在同目录`.life-continuity.orig`。重复安装不叠加。`projects.ts`的新权威来源是本目录`src/projects.ts`，重新安装旧版住宅/自主性补丁后，需要最后再安装本补丁。升级框架必须重新适配，不把旧.orig直接覆盖新版。

正常重启Cortico及观察者后加载；安装不启动bot。MC数据页「生活计划账本」以现有存储展示界面只读列出事项、等待条件、声明与执行回执。计划通过游戏或QQ与她商量调整；现有清除账本功能仍会删除安排，不能当作暂停使用。

首次读取`minecraft-projects.json`时将v1单工程迁移到v2多事项并保留`.v1.bak`。损坏文件或迁移失败不会生成假账本。回退前停Cortico，保存新的v2账本，恢复本轮原源码及v1备份；单独卸载观察者模组可恢复安装备份，不影响存档。恢复源码前检查它仍属于同一版本，不覆盖其他后续修改。

## 工具与状态

`mc_project query`保留旧工程的顶层name/stage/next/status等字段，增加items/currentId/review。`save`不带id仍更新当前事项；新建其他事项需显式新id。只有一项可active，切换前把当前项登记为等待、受阻、休息或完成。取消/完成事项不能重新激活，需新建事项。公开的事项不等同于个人愿望；后者由模型调用原有记忆工具保存。

状态：active、waiting、waiting-user、blocked、resting、done、cancelled。等待/受阻/休息需reason。wait支持task、crop、furnace、time、user；taskId来自实际受理回执；at为实际设施坐标，dimension使用实际维度；dueAt为现实Unix毫秒。作物和炉子登记必须现场加载且类型对应。user需要精确senderKey，如游戏Infinite或QQ的private:597421579，回复只触发重新讨论，不自动授予施工许可。

模型登记的evidence是声明，不是自动核验。World自动关联实际受理任务并保存最近执行回执；任务成功不自动宣布整个工程完成。相同动作刚受阻时拒绝原样重发；换方法，或登记新下一步/新依据后可重试。取消公开计划本身不停止已有动作；停止游戏动作仍使用现有mc_stop并遵守夜间优先。

## 低消耗唤醒

任务结束利用已有回执事件，用户回复通知搭原有消息批次，作物成熟只唤醒登记等待该坐标的事项。炉子到期仅表示该核验了，未加载方块不认定成熟。等待条件每次登记只通知一次；重复保存同条件不会清掉通知标记。

没有明确事件条件且执行队列空闲时，以现实5、15、30分钟复查；一次复查处理完后才开始下一段间隔。连续三次没有实际任务进展停止周期提醒。不能通过重复写同一句计划重置额度；实际受理/完成任务才重置。重启保留退避与通知标记，汇总恢复，不重放旧动作。

主模型运行/退避通过World生命周期钩子传给引擎；宿主的失败统计只查询本地记录。离线、夜间、睡觉、重连暂停、退避、当前渠道已知冷却或预算休眠时停止自主复查；执行中不另起复查。未来额度模块可写部署data/minecraft-budget-sleep.json：`{"paused":true,"until":null}`或将until设为现实到期毫秒；这是自主唤醒的抑制接口，不是免费池预测器，也不会停QQ聊天。读取异常保守暂停，记录仍保留。

HUD每秒读取同一份本地状态：目标、状态/原因、下次复查时间；模型抑制时显示接续暂缓，不声称正在思考。账本查询、显示与扫描不调用模型。

## 验证

`node --experimental-strip-types --test addons/minecraft-life/tests/*.test.mjs addons/minecraft-observer/tests/state.test.mjs`

`node --import ./runtimes/cortico-0.2.1/node_modules/tsx/dist/loader.mjs addons/minecraft-life/tests/world-integration.mts`

集成测试构造假世界，验证实际World/代理接线，不调用start/fork/模型。补丁测试依赖当前运行目录的本轮.orig备份以验证真实安装锚点。类型检查和模组/启动器构建通过不等于实景生活行为验收；用户操作见docs/minecraft-life-continuity-acceptance.md。
