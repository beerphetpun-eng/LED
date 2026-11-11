@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
node.exe "%~dp0launch.mjs" %*
if errorlevel 1 pause
