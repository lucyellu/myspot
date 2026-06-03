@echo off
REM One-shot reindex of suno_library/ + assets/ into data/myspot.db
cd /d "%~dp0"
"C:\Users\lucyl\AppData\Local\Programs\Python\Python311\python.exe" -m backend.library
