@echo off
title myspot
cd /d "%~dp0"
git checkout dev >nul 2>&1

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
echo   myspot (dev) - http://127.0.0.1:7777
echo  =========================================
echo.
echo  Launching browser in 3 seconds...
echo  Close this window to stop the server.
echo.

REM Open the browser shortly after uvicorn starts
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://127.0.0.1:7777/"

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
