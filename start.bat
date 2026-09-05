@echo off
title myspot
cd /d "%~dp0"

set "MYSPOT_HOST=0.0.0.0"
set "MYSPOT_PORT=7777"
set "MYSPOT_ROUTE=%~1"
if "%MYSPOT_ROUTE%"=="" set "MYSPOT_ROUTE=#/"

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress); if ($ip) { $ip } else { 'YOUR-PC-IP' }"`) do set "MYSPOT_LAN_IP=%%I"

REM If myspot is already running, just open the browser instead of failing to
REM bind the port (a second launch otherwise errors and looks like "won't start").
netstat -ano | findstr /r /c:"127.0.0.1:7777 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo.
  echo  myspot is already running on http://127.0.0.1:7777 - opening the browser...
  start "" http://127.0.0.1:7777/
  timeout /t 2 /nobreak >nul
  exit /b 0
)

echo.
echo  =========================================
echo   myspot - http://127.0.0.1:%MYSPOT_PORT%/%MYSPOT_ROUTE%
echo  =========================================
echo.
echo  Phone / LAN: http://%MYSPOT_LAN_IP%:%MYSPOT_PORT%/%MYSPOT_ROUTE%
echo  Open the LAN URL on your phone while it is on the same Wi-Fi/network.
echo.
echo  Launching browser in 3 seconds...
echo  Close this window to stop the server.
echo.
echo  If the phone cannot connect, allow Python on Private networks in Windows Firewall.
echo.

REM Open the browser shortly after uvicorn starts
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://127.0.0.1:%MYSPOT_PORT%/%MYSPOT_ROUTE%"

REM Prefer the pinned Python 3.11; fall back to whatever `python` resolves to.
set "PYCMD=python"
py -3.11 --version >nul 2>&1 && set "PYCMD=py -3.11"
if exist venv\Scripts\activate.bat call venv\Scripts\activate.bat
%PYCMD% -m backend.app
if errorlevel 1 (
  echo.
  echo  Server exited with an error.
  echo  If it mentions the port is already in use, close the other myspot
  echo  window first, then try again. Press any key to close...
  pause >nul
)
