@echo off
title Oracle Music Server Status
cd /d "%~dp0"

python tools\oracle_info.py

echo.
pause
