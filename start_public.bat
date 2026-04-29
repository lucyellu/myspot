@echo off
REM ─── myspot public launcher ─────────────────────────────────────────────
REM Opens TWO windows:
REM   1. backend  (uvicorn on 127.0.0.1:7777)
REM   2. tunnel   (Cloudflare Quick Tunnel — gives a *.trycloudflare.com URL)
REM Then you visit:
REM   https://myspot-web.netlify.app/?api=<that-trycloudflare-url>
REM
REM Close either window to stop that half. Close both to fully stop.
REM ──────────────────────────────────────────────────────────────────────────

cd /d "%~dp0"

REM Pick a free port: kill anything stuck on 7777 from a previous session.
netstat -aon | findstr ":7777" | findstr LISTENING > "%TEMP%\myspot_port.txt" 2>nul
for /f "tokens=5" %%P in ('type "%TEMP%\myspot_port.txt"') do (
  echo  Stopping previous backend on port 7777 PID %%P...
  taskkill /F /PID %%P >nul 2>&1
)
del "%TEMP%\myspot_port.txt" >nul 2>&1

echo.
echo  =========================================
echo   myspot public launcher
echo  =========================================
echo.
echo  1. Backend window — uvicorn at http://127.0.0.1:7777
echo  2. Tunnel window  — public *.trycloudflare.com URL
echo.
echo  Watch the tunnel window for a URL like:
echo    https://random-words.trycloudflare.com
echo  Then open:
echo    https://myspot-web.netlify.app/?api=^<that URL^>
echo.

REM Backend (green prompt so it's easy to spot)
start "myspot backend" cmd /k "title myspot backend && color 0a && cd /d %~dp0 && python -m backend.app"

REM Give the backend a moment to bind the port before the tunnel tries to forward
timeout /t 2 /nobreak >nul

REM Tunnel (yellow prompt). Reads cloudflared from PATH (.msi install) — if
REM it's not on PATH, change "cloudflared" to the full path of your .exe.
start "myspot tunnel" cmd /k "title myspot tunnel && color 0e && echo. && echo Tunnel URL appears below in a few seconds: && echo. && cloudflared tunnel --url http://127.0.0.1:7777"

echo.
echo  Two windows opened. Close them to stop. Closing this window is fine.
echo.
timeout /t 4 /nobreak >nul
exit
