@echo off
chcp 65001 >nul
"%~dp0launcher\.venv\Scripts\python.exe" "%~dp0tools\cortico-runtime.py" select "%~dp0runtimes\cortico-0.2.1"
if errorlevel 1 (
  echo 未切换，请先处理上面的提示。
  pause
  exit /b 1
)
echo.
echo 请使用 2.10.0 启动器启动。本操作不会启动任何进程。
pause
