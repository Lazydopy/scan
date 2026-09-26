@echo off
echo ============================================
echo  Binance Pre-Pump Scanner — Python Worker
echo ============================================

cd /d "%~dp0\python-scanner"

:: Check if .venv exists, create if not
if not exist ".venv" (
    echo [SETUP] Creating virtual environment...
    python -m venv .venv
    echo [SETUP] Installing dependencies...
    .venv\Scripts\pip install -r requirements.txt
    echo.
)

echo [START] Activating virtual environment...
call .venv\Scripts\activate.bat

echo [START] Running continuous scanner daemon...
echo.
python scripts\scanner.py run --mode fast

pause
