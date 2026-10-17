# corti Observer 1.0.0（corti-soul 2.11.0）

独立客户端模组，目标环境：Minecraft Java 1.20.6、Fabric Loader 0.16.14、Java 21。当前观察者安装有 Iris 1.7.2 / Sodium 0.5.11；兼容注入依据该 Iris jar 实际字节码核对，不能代替实际光影验收。

## 使用

正常重启 Cortico（重新加载 World 源码），再重开观察者客户端（重新加载mod）。使用摄像机账号CortiCam、旁观目标corti；不要把玩家Infinite窗口当成观察者。安装器从当前运行目录配置读取实际账号名和游戏目录。

- 左上显示当前任务、步骤、耗时、最近回执；明确区分执行、身体接管、睡觉、队列空闲、离线和状态更新暂停。没有Core模型状态来源时不显示“正在思考”。
- 下方显示实际生命、饥饿、道具栏及副手；主副手3D物品直接取旁观目标客户端实体的实际装备，空手手臂使用目标皮肤。
- F8切换自定义HUD；F1按游戏习惯隐藏界面和手。显示手持火把不等于动态照明，亮度仍取决于现有光影/模组。
- 只对指定观察者账号在旁观指定玩家时显示；未附身时提示等待，不把观察者自己的空装备冒充她的背包。玩家窗口行为保留。

## 数据边界

World每秒原子写 `<deployment>/data/minecraft-observer-hud.json`，只含有界游戏读数和执行器状态。客户端守护线程每秒只读一次本地文件，不联网、不发命令、不请求模型、不读取QQ或人格笔记。超过5秒未更新或读取损坏时不继续显示旧任务；离线清除装备/生命/位置读数。它是即时展示，不是新的记忆账本。

## 构建、安装与回退

使用Java21、Gradle8.10：`gradle --no-daemon --max-workers=1 build`。首次从官方Fabric/Minecraft/Maven仓库解析依赖；缓存后可加`--offline`。默认单工作线程、构建堆上限1GB，不启动游戏。`build.gradle`固定游戏、Loader和Loom版本。客户端mod的GPL-3.0许可证及SpectatorPlus参考来源见LICENSE/NOTICE.md；独立状态发布器与安装脚本为MIT。

仓库根目录执行：

```text
node patches/patch-minecraft-observer.mjs --check
node patches/patch-minecraft-observer.mjs --apply
launcher\.venv\Scripts\python.exe addons/minecraft-observer/install.py
launcher\.venv\Scripts\python.exe addons/minecraft-observer/install.py --apply
```

补丁只适配Cortico0.2.1并预检锚点，重复安装不叠加。安装器只修改观察者mods目录中本功能自己的jar及`config/corti-observer.json`，备份在仓库`backups/observer-*`；不修改服务器存档、光影或玩家配置。已有同名非本功能jar、坏配置、错误游戏版本即停止。升级Cortico或移动部署后重新适配补丁并运行安装器，更新状态文件路径。

停止观察者后可移走`corti-observer-1.0.0.jar`并恢复本功能配置备份；新装前没有配置时可删除本功能配置。要撤回World发布器，停Cortico后恢复同一源码版本的`world.ts.observer.orig`，或定点移除补丁；保留其他游戏修改。不要把旧备份覆盖到未来上游版本。正常关停World会写离线读数，即使异常退出也有5秒过期保护。
