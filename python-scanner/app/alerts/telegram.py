"""
Telegram Alert Engine.
- Sends formatted alerts for new and updated candidates
- De-duplicates: same symbol not alerted more than once per N minutes
- Score change alerts: re-alerts if score changes significantly
- Sends WATCH and HIGH CONVICTION separately
- Never fabricates prices or levels
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import httpx

from app.config import (
    cfg,
    get_telegram_chat_id,
    get_telegram_token,
    telegram_enabled,
)
from app.models.candidate import Candidate, Status

logger = logging.getLogger(__name__)

# Dedup store: {symbol: (last_sent_ts, last_sent_score)}
_alert_dedup: dict[str, tuple[float, float]] = {}


def _should_alert(candidate: Candidate) -> bool:
    """Return True if this candidate should fire an alert now."""
    if not telegram_enabled():
        return False

    sym = candidate.symbol
    score = candidate.setup_score
    status = candidate.status

    # Extended / failed / avoid → no alert
    if status in (Status.EXTENDED, Status.FAILED, Status.AVOID, Status.WEAK):
        return False

    min_score = float(cfg("alerts", "min_setup_score", default=70))
    min_watch = float(cfg("alerts", "min_watch_score", default=55))
    send_watch = bool(cfg("alerts", "send_watch_alerts", default=True))

    if status == Status.WATCH:
        if not send_watch or score < min_watch:
            return False
    elif score < min_score:
        return False

    dedup_window = float(cfg("alerts", "dedup_window_minutes", default=15)) * 60
    score_change_threshold = float(cfg("alerts", "score_change_threshold", default=8))

    last_ts, last_score = _alert_dedup.get(sym, (0.0, 0.0))
    now = time.time()

    # Within dedup window?
    if now - last_ts < dedup_window:
        # Only re-alert if score changed significantly
        if abs(score - last_score) < score_change_threshold:
            return False

    return True


def _format_message(candidate: Candidate) -> str:
    """Format a rich Telegram message for a candidate."""
    c = candidate
    sym_link = f"https://www.binance.com/en/futures/{c.symbol.replace('USDT', '_USDT')}"

    oi_str = ""
    if c.oi.is_available and c.oi.oi_change_1h is not None:
        sign = "+" if c.oi.oi_change_1h >= 0 else ""
        oi_str = f"  📊 OI 1h: {sign}{c.oi.oi_change_1h:.2f}%\n"

    funding_str = ""
    if c.funding.is_available and c.funding.rate is not None:
        funding_str = f"  💸 Funding: {c.funding.rate * 100:.4f}%\n"

    reasons_str = ""
    if c.reasons:
        reasons_str = "\n" + "\n".join(f"  • {r}" for r in c.reasons[:5])

    candle_note = " ⚠️ Unfinished candle" if c.candle_status.value == "UNFINISHED" else ""

    msg = (
        f"<b>{c.alert_label}</b>\n"
        f"<b>{c.symbol}</b> @ ${c.price:,.6g}{candle_note}\n"
        f"\n"
        f"  🏆 Setup Score: <b>{c.setup_score:.0f}/100</b>\n"
        f"  ⚡ Pump Score: <b>{c.pump_score:.0f}/100</b>\n"
        f"  📈 Status: {c.status.value}\n"
        f"\n"
        f"  📉 15m: {c.recent_pump.change_15m:+.2f}%\n"
        f"  📉 1h:  {c.recent_pump.change_1h:+.2f}%\n"
        f"  📉 3h:  {c.recent_pump.change_3h:+.2f}%\n"
        f"\n"
        f"  🔒 Compression: {c.compression.compression_range_pct:.2f}%\n"
        f"  📊 Volume x10: {c.volume.volume_ratio_10:.1f}x | x20: {c.volume.volume_ratio_20:.1f}x\n"
        f"{oi_str}"
        f"{funding_str}"
        f"\n"
        f"  🎯 Entry (breakout): ${c.levels.breakout_level:,.6g}\n"
        f"  ✅ Target 1: ${c.levels.target1:,.6g}\n"
        f"  🚀 Target 2: ${c.levels.target2:,.6g}\n"
        f"  🛑 Invalidation: ${c.levels.invalidation:,.6g}\n"
        f"\n"
        f"  🌐 BTC: {c.btc_regime.value}\n"
        f"{reasons_str}\n"
        f"\n"
        f'  <a href="{sym_link}">Open on Binance ↗</a>'
    )
    return msg


async def send_alert(candidate: Candidate) -> bool:
    """
    Send a Telegram alert for a candidate.
    Returns True if sent successfully.
    """
    if not _should_alert(candidate):
        return False

    token = get_telegram_token()
    chat_id = get_telegram_chat_id()
    if not token or not chat_id:
        logger.debug("Telegram not configured — skipping alert")
        return False

    msg = _format_message(candidate)
    url = f"https://api.telegram.org/bot{token}/sendMessage"

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.post(url, json={
                "chat_id": chat_id,
                "text": msg,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            })
            resp.raise_for_status()

        _alert_dedup[candidate.symbol] = (time.time(), candidate.setup_score)
        logger.info("Telegram alert sent for %s (score=%.0f)", candidate.symbol, candidate.setup_score)
        return True

    except Exception as e:
        logger.warning("Telegram send failed for %s: %s", candidate.symbol, e)
        return False


async def send_scan_summary(candidates: list[Candidate], btc_regime: str) -> bool:
    """
    Send a summary of top candidates after each scan.
    Only sent if at least one candidate qualifies.
    """
    token = get_telegram_token()
    chat_id = get_telegram_chat_id()
    if not token or not chat_id:
        return False

    top = [c for c in candidates if c.setup_score >= float(cfg("alerts", "min_setup_score", default=70))]
    if not top:
        return False

    lines = [f"<b>🔍 Pre-Pump Scanner — Top {len(top)} Setups</b>"]
    lines.append(f"🌐 BTC: {btc_regime}\n")

    for i, c in enumerate(top[:8], 1):
        lines.append(
            f"{i}. <b>{c.symbol}</b> — {c.alert_label} | Score: {c.setup_score:.0f} | "
            f"Vol: {c.volume.volume_ratio_10:.1f}x | {c.recent_pump.change_1h:+.1f}% 1h"
        )

    msg = "\n".join(lines)

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": msg,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
            resp.raise_for_status()
        logger.info("Scan summary sent to Telegram")
        return True
    except Exception as e:
        logger.warning("Telegram summary failed: %s", e)
        return False
