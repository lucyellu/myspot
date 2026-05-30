@echo off
title myspot (public)
cd /d "%~dp0"

echo.
echo  =========================================
echo   myspot (public) - Netlify + Cloudflare
echo  =========================================
echo.
echo  Starting backend, opening a Cloudflare tunnel,
echo  then launching the Netlify UI with ?api= set.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start_public_netlify.ps1"
if errorlevel 1 (
  echo.
  echo  Public launcher exited with an error. Press any key to close...
  pause >nul
)
