@echo off
title myspot (public)
cd /d "%~dp0"

echo.
echo  =========================================
echo   myspot (public) - http://127.0.0.1:7777
echo   Cloudflare tunnel will print public URL
echo  =========================================
echo.
echo  Starting backend and Cloudflare tunnel...
echo  Close this window to stop both.
echo.

REM Start cloudflared quick tunnel in a separate window
start "myspot cloudflared" cloudflared tunnel --url http://127.0.0.1:7777

REM Open local browser after backend starts
start "" /b cmd /c "timeout /t 4 /nobreak >nul && start "" http://127.0.0.1:7777/"

py -3.11 -m backend.app
if errorlevel 1 (
  echo.
  echo  Server exited with an error. Press any key to close...
  pause >nul
)
