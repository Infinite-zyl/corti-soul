# AI启动器

把人格唤起来

## Run (development)

```powershell
.\.venv\Scripts\python.exe app.py
```

## Build the .exe

```powershell
.\.venv\Scripts\pyinstaller.exe --noconfirm --clean AI启动器.spec
```

Output: `dist\AI启动器\AI启动器.exe`

## Where things live

| Path | Purpose |
|---|---|
| `app.py` | Python host: window + the `Api` class exposed to JS |
| `ui/index.html` | The entire look — restyle freely |
| `brand/icon.ico` | Icon, in 7 sizes (16-256px) |
| `brand/brand.json` | Name, tagline, palette, version |
| `brand/version_info.txt` | What Explorer/Task Manager display |
| `coreclr_env.py` | Makes pywebview work on modern .NET |

> Rebrand anytime: `python <skill>/scripts/make_icon.py "AI启动器" --out brand --preview`
