@echo off
title Pump Scanner - Local Worker Daemon
cls
echo ========================================================
echo   PUMP SCANNER - LOCAL WORKER DAEMON
echo ========================================================
echo   - Executes scans via your residential ISP IP
echo   - Zero Binance 451/403 VPN/datacenter blocks
echo   - Uploads fresh signals directly to Supabase
echo   - Auto-prunes old data (keeps database under 50 rows)
echo   - Vercel site displays signals instantly (0 quota burn)
echo ========================================================
echo.
npm run worker
pause
