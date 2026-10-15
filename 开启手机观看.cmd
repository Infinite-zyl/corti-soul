@echo off
cd /d "%~dp0"
"%~dp0launcher\.venv\Scripts\python.exe" "%~dp0addons\minecraft-mobile-viewer\viewer.py" start
if errorlevel 1 pause
