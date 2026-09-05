@echo off
title myspot - Sync to Oracle Cloud
cd /d "%~dp0"

python tools\sync_oracle.py %*

echo.
pause
