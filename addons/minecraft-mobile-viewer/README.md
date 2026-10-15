# `viewer.py` — Minecraft 观察者局域网观看

电脑运行观察者游戏窗口，独立便携 OBS 通过 WHIP 推送至 MediaMTX，手机浏览器通过仅观看的 WebRTC 网关接收画面。无模型调用，不管理 bot、游戏服务器或观察者进程。

## 使用

2.9.0 起也可从 corti-soul 启动器的「游戏」页开启、关闭观看和打开二维码。手机端登录后可点「关闭观看服务」，二次确认会断开所有观看端，corti、服务器与游戏窗口保持运行；重新开启需要电脑端操作。关闭请求校验同源与本次服务令牌，不开放其他控制能力。

1. 首次安装：用仓库 `launcher/.venv/Scripts/python.exe` 执行本目录 `install.py`，并 `-m pip install -r requirements.txt`。下载版本及 SHA-256 固定在安装脚本，实际下载清单保存于 `.runtime/installed.json`。
2. 管理员执行 `firewall.ps1`，只添加 Private / LocalSubnet 的 TCP 7898、TCP/UDP 8199。家庭网络需由用户确认后设置为专用网络，不自动修改网络类别。
3. 在 MC World 启动观察者，保持非最小化。双击仓库根目录“开启手机观看.cmd”，本机说明页显示二维码、地址和观看密码。
4. 手机连接同一 Wi-Fi，扫码，以 `viewer` 和说明页密码登录，点“开始观看”。第一版静音、仅观看，不传输桌面和麦克风。
5. 双击“关闭手机观看.cmd”结束观看进程树，不结束 Minecraft 或 corti。再次开启会重新识别网卡地址。

## 边界与故障

- LAN HTTP 入口为物理默认网关网卡的 IPv4:7898。密码不写入二维码。仅用于信任的家庭局域网，未配置公网入口或路由映射。
- 说明页 127.0.0.1:7899、MediaMTX WHIP 127.0.0.1:8899、MediaMTX 诊断 API 127.0.0.1:9996 均不向 LAN 开放。手机网关只转发当前视频路径的 WHEP 建连与已知会话删除；额外的 `/watch/stop` 只关闭本视频服务，不转发发布、游戏或控制台管理接口。
- 观察者按部署中 `worlds.minecraft.client` 的账号、游戏目录、窗口标题和进程身份核验；同名多个窗口、最小化或无法核验时停止采集。OBS 精确标题匹配，不退回桌面捕获。
- 720p 30 FPS 约 3 Mbps，等比适配并保留黑边。尝试相应 GPU 的 H.264 编码，不成功时最多回退一次软件编码；不无限重启。OBS 报告捕获成功且流就绪后才允许手机建立连接，但这不保证游戏本身持续渲染。
- 端口占用不终止其他进程；启动错误见 `.runtime/bootstrap.log`，视频服务日志见 `.runtime/service.log`，OBS 日志见 `.runtime/obs/config/obs-studio/logs`。运行目录包含密码，禁止上传。
- 更换 Wi-Fi 后关闭再开启以刷新地址和二维码。电脑休眠、访客 Wi-Fi 的设备隔离、防火墙公共网络配置会影响观看。

## 测试与卸载

`python -m unittest discover -s addons/minecraft-mobile-viewer -p test_viewer.py -v` 覆盖实际 HTTP 认证、只读接口、等待状态、配置隔离与凭据损坏处理。真实手机与游戏画面需现场验收；测试画面不能算游戏验收。

卸载前关闭观看，管理员运行 `firewall.ps1 -Remove`，然后删除本模块的 `.runtime` 与两个快捷入口；无需修改原 OBS 或 Cortico。
