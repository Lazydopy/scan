"""
FastAPI Application.
Provides REST endpoints for the Vercel Next.js frontend to consume.
Also provides a webhook for cron-job.org to trigger scans.

Endpoints:
  GET  /                       — Health check
  GET  /api/scan               — Latest scan results (from DB)
  GET  /api/scan/history       — List of recent scan runs
  POST /api/scan/trigger       — Trigger a manual scan (webhook)
  GET  /api/symbol/{symbol}    — Single symbol detail
  GET  /api/symbol/{symbol}/history — Symbol score history
  GET  /api/btc-status         — BTC regime
  GET  /api/stats              — DB stats and scanner status
  GET  /api/health             — Detailed health
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import cfg, get_webhook_secret
from app.scanner import run_scan
from app.storage.database import get_db
from app.alerts.telegram import send_alert, send_scan_summary

logger = logging.getLogger(__name__)

# Track the last scan time and trigger count
_scan_state: dict[str, Any] = {
    "last_scan_at": None,
    "last_scan_duration": None,
    "scan_count": 0,
    "is_scanning": False,
}


async def _do_scan_and_save(mode: str = "fast") -> None:
    """Run a scan, save to DB, and send Telegram alerts."""
    if _scan_state["is_scanning"]:
        logger.warning("Scan already in progress — skipping duplicate trigger")
        return

    _scan_state["is_scanning"] = True
    try:
        result = await run_scan(mode=mode)
        db = await get_db()
        await db.save_scan_run(
            scan_timestamp=result.scan_timestamp,
            btc_regime=result.btc_regime.value,
            mode=result.mode,
            total_symbols=result.total_symbols,
            scan_duration_seconds=result.scan_duration_seconds,
            candidates=result.candidates,
        )

        # Send alerts
        for candidate in result.candidates:
            await send_alert(candidate)

        # Send summary if any qualify
        await send_scan_summary(result.candidates, result.btc_regime.value)

        _scan_state["last_scan_at"] = result.scan_timestamp.isoformat()
        _scan_state["last_scan_duration"] = result.scan_duration_seconds
        _scan_state["scan_count"] += 1

    except Exception as e:
        logger.error("Scan failed: %s", e, exc_info=True)
    finally:
        _scan_state["is_scanning"] = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # Initialize DB on startup
    db = await get_db()
    logger.info("Database ready")

    # Optionally run an initial scan on startup
    yield

    logger.info("Shutting down")


app = FastAPI(
    title="Binance Pre-Pump Scanner API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allows the Vercel frontend to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to your domain in production
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _verify_webhook_secret(request: Request) -> bool:
    """Verify the webhook secret header."""
    secret = get_webhook_secret()
    if not secret or secret == "your-secret-here":
        return True  # No auth configured — allow all (local dev)

    provided = request.headers.get("X-Webhook-Secret", "")
    return hmac.compare_digest(provided, secret)


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "Binance Pre-Pump Scanner",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/health")
async def health():
    db = await get_db()
    stats = await db.get_stats()
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "is_scanning": _scan_state["is_scanning"],
        "last_scan_at": _scan_state["last_scan_at"],
        "last_scan_duration_seconds": _scan_state["last_scan_duration"],
        "total_scans": _scan_state["scan_count"],
        "database": stats,
    }


@app.get("/api/scan")
async def get_latest_scan():
    """
    Return the latest scan results from the database.
    Used by the Vercel frontend — sub-millisecond response.
    """
    db = await get_db()
    scan = await db.get_latest_scan()
    if not scan:
        raise HTTPException(status_code=404, detail="No scan results yet. Trigger a scan first.")
    return scan


@app.get("/api/scan/history")
async def get_scan_history(limit: int = 20):
    """Return recent scan run summaries."""
    db = await get_db()
    history = await db.get_scan_history(limit=min(limit, 100))
    return {"history": history, "count": len(history)}


@app.post("/api/scan/trigger")
async def trigger_scan(
    request: Request,
    background_tasks: BackgroundTasks,
    mode: str = "fast",
):
    """
    Trigger a scan manually. Called by cron-job.org every 15 minutes.
    Protected by WEBHOOK_SECRET header.
    """
    if not _verify_webhook_secret(request):
        raise HTTPException(status_code=401, detail="Unauthorized — invalid webhook secret")

    if mode not in ("fast", "deep", "next-pump"):
        raise HTTPException(status_code=400, detail="mode must be fast | deep | next-pump")

    if _scan_state["is_scanning"]:
        return JSONResponse(
            status_code=202,
            content={"message": "Scan already in progress", "is_scanning": True},
        )

    # Run scan in background so webhook returns immediately
    background_tasks.add_task(_do_scan_and_save, mode)

    return {
        "message": f"Scan triggered (mode={mode})",
        "is_scanning": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/btc-status")
async def get_btc_status():
    """Return latest BTC regime from the most recent scan."""
    db = await get_db()
    scan = await db.get_latest_scan()
    if not scan:
        return {"btc_regime": "UNKNOWN", "last_scan_at": None}
    return {
        "btc_regime": scan.get("btc_regime", "UNKNOWN"),
        "last_scan_at": scan.get("scan_timestamp"),
        "mode": scan.get("mode"),
    }


@app.get("/api/symbol/{symbol}")
async def get_symbol(symbol: str):
    """Return detailed data for a specific symbol."""
    symbol = symbol.upper()
    db = await get_db()
    scan = await db.get_latest_scan()
    if not scan:
        raise HTTPException(status_code=404, detail="No scan data available")

    candidates = scan.get("candidates", [])
    match = next((c for c in candidates if c.get("symbol") == symbol), None)
    if not match:
        raise HTTPException(
            status_code=404,
            detail=f"{symbol} not found in latest scan. It may not have passed the filter.",
        )
    return match


@app.get("/api/symbol/{symbol}/history")
async def get_symbol_history(symbol: str, limit: int = 50):
    """Return historical scores for a symbol."""
    symbol = symbol.upper()
    db = await get_db()
    history = await db.get_symbol_history(symbol, limit=min(limit, 200))
    return {"symbol": symbol, "history": history, "count": len(history)}


@app.get("/api/stats")
async def get_stats():
    """Scanner and database statistics."""
    db = await get_db()
    stats = await db.get_stats()
    return {
        "scanner": {
            "is_scanning": _scan_state["is_scanning"],
            "last_scan_at": _scan_state["last_scan_at"],
            "last_scan_duration_seconds": _scan_state["last_scan_duration"],
            "total_scans": _scan_state["scan_count"],
        },
        "database": stats,
    }
