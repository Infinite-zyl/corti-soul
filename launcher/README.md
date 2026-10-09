# corti-soul 启动器

把人格唤起来

## Run (development)

```powershell
.\.venv\Scripts\python.exe app.py
```

## Build the .exe

```powershell
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean "corti-soul启动器.spec"
```

Output: `dist\corti-soul启动器\corti-soul启动器.exe`

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
