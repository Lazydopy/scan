@echo off
echo ============================================
echo  Python Scanner — FastAPI Server
echo ============================================

cd /d "%~dp0\python-scanner"

if not exist ".venv" (
    echo [SETUP] Creating virtual environment...
    python -m venv .venv
    .venv\Scripts\pip install -r requirements.txt
)

call .venv\Scripts\activate.bat
python scripts\scanner.py serve

pause
