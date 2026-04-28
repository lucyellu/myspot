@echo off
title myspot
cd /d "%~dp0"

echo.
echo  =========================================
echo   myspot - http://127.0.0.1:7777
echo  =========================================
echo.
echo  Launching browser in 3 seconds...
echo  Close this window to stop the server.
echo.

REM Open the browser shortly after uvicorn starts
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://127.0.0.1:7777/"

python -m backend.app
if errorlevel 1 (
  echo.
  echo  Server exited with an error. Press any key to close...
  pause >nul
)
