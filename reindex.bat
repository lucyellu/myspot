@echo off
REM One-shot reindex of suno_library/ + assets/ into data/myspot.db
cd /d "%~dp0"
python -m backend.library
