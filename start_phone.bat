@echo off
title myspot phone
cd /d "%~dp0"

set "MYSPOT_HOST=0.0.0.0"
set "MYSPOT_PORT=7777"

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress); if ($ip) { $ip } else { 'YOUR-PC-IP' }"`) do set "MYSPOT_LAN_IP=%%I"

echo.
echo  =========================================
echo   myspot phone - http://%MYSPOT_LAN_IP%:%MYSPOT_PORT%
echo  =========================================
echo.
echo  Open that address on your phone while it is on the same Wi-Fi/network.
echo  Local PC URL: http://127.0.0.1:%MYSPOT_PORT%
echo  Close this window to stop the server.
echo.
echo  If the phone cannot connect, allow Python on Private networks in Windows Firewall.
echo.

start "" /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://127.0.0.1:%MYSPOT_PORT%/"

"C:\Users\lucyl\AppData\Local\Programs\Python\Python311\python.exe" -m backend.app
if errorlevel 1 (
  echo.
  echo  Server exited with an error. Press any key to close...
  pause >nul
)
