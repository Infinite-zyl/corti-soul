@echo off
chcp 65001 >nul
"%~dp0launcher\.venv\Scripts\python.exe" "%~dp0tools\cortico-runtime.py" select "%~dp0..\cortico-qq"
if errorlevel 1 (
  echo 未切换，请先处理上面的提示。
  pause
  exit /b 1
)
echo.
echo 请使用 2.10.0 启动器启动。新版数据保留，本操作不会覆盖任何记忆或存档。
pause
