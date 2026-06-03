@echo off
title myspot AI Radio
cd /d "%~dp0"

echo.
echo  =========================================
echo   myspot AI Radio - http://127.0.0.1:7777/#/radio
echo  =========================================
echo.
echo  Launching browser in 3 seconds...
echo  Close this window to stop the server.
echo.

REM Open the radio interface shortly after the backend starts.
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://127.0.0.1:7777/#/radio"

py -3.11 -m backend.app
if errorlevel 1 (
  echo.
  echo  Server exited with an error. Press any key to close...
  pause >nul
)
