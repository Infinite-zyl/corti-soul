# corti-soul 启动器

把人格唤起来

SnowLuma、OneBot WS、Cortico 和免费池守护的卡片按钮会在「停止」与「启动」间切换；操作中显示黄色进度状态，确认端口/进程状态变化后才切换按钮。DSH 和 QQ 只显示状态。OneBot WS 由 SnowLuma 承载，操作任一方时会联动另一方。标题栏的「⤓」只收起到托盘并保持服务运行；「✕」和「退出并停止托管服务」会停止 SnowLuma、OneBot WS、Cortico 控制台和免费池守护后退出。

## Run (development)

```powershell
.\.venv\Scripts\python.exe app.py
```

## Build the .exe

```powershell
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean "corti-soul启动器.spec"
```

Output: `dist\corti-soul启动器\corti-soul启动器.exe`

> 打包前先关掉正在运行的启动器，否则 PyInstaller 无法覆盖被占用的 `dist` 产物，会静默失败或只产出部分文件。

> 用 `python -m PyInstaller` 而不是 `.venv\Scripts\pyinstaller.exe`：后者会以 exit 1 静默失败（无输出）。

## Where things live

| Path | Purpose |
|---|---|
| `app.py` | Python host: window + the `Api` class exposed to JS |
| `ui/index.html` | The entire look — restyle freely |
| `brand/icon.ico` | Icon, in 7 sizes (16-256px) |
| `brand/brand.json` | Name, tagline, palette, version |
| `brand/version_info.txt` | What Explorer/Task Manager display |
| `coreclr_env.py` | Makes pywebview work on modern .NET |

> Rebrand anytime: `python <skill>/scripts/make_icon.py "corti-soul启动器" --glyph CS --out brand --preview`
