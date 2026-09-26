"""
Recent Pump Filter — CRITICAL.
The scanner must NOT chase coins that already exploded.

Classifies current expansion state:
- NORMAL: quiet, no recent expansion
- PRE-BREAKOUT: building pressure
- BREAKOUT: just broke out
- EXTENDED: already pumped
- FAILED_BREAKOUT: broke and failed

Score: 0-10 (higher = less recently pumped = better pre-pump candidate)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import cfg
from app.models.candidate import RecentPumpResult, Status


def _pct_change(a: float, b: float) -> float:
    if a <= 0:
        return 0.0
    return (b - a) / a * 100


def analyze_recent_pump(df: pd.DataFrame) -> RecentPumpResult:
    """
    Analyze how much a coin has already moved.
    Uses CLOSED candles only.
    df = closed 15m candles.
    """
    result = RecentPumpResult()

    if df is None or len(df) < 5:
        result.score = 10.0  # Unknown = treat as not pumped
        return result

    closes = df["close"].values
    highs = df["high"].values

    current = closes[-1]

    # ── Recent price changes ─────────────────────────────────────────────
    def close_n_ago(n: int) -> float:
        if len(closes) > n:
            return float(closes[-(n + 1)])
        return current

    result.change_15m = _pct_change(close_n_ago(1), current)
    result.change_30m = _pct_change(close_n_ago(2), current)
    result.change_45m = _pct_change(close_n_ago(3), current)
    result.change_1h = _pct_change(close_n_ago(4), current)
    result.change_3h = _pct_change(close_n_ago(12), current)

    # ── Largest single 15m candle in recent history ──────────────────────
    if len(closes) >= 2:
        candle_moves = [abs(_pct_change(closes[i], closes[i + 1])) for i in range(-min(12, len(closes) - 1), -1)]
        result.largest_15m_candle = float(max(candle_moves)) if candle_moves else 0.0
    else:
        result.largest_15m_candle = abs(result.change_15m)

    # Largest 3-candle consecutive move in recent 12 candles
    if len(closes) >= 5:
        three_candle_moves = []
        window = min(12, len(closes) - 1)
        for i in range(-window, -2):
            if abs(i + 3) <= len(closes):
                mv = _pct_change(closes[i], closes[i + 3] if i + 3 < 0 else current)
                three_candle_moves.append(abs(mv))
        result.largest_3_candle_move = float(max(three_candle_moves)) if three_candle_moves else 0.0

    # ── Thresholds from config ────────────────────────────────────────────
    extended_15m = float(cfg("recent_pump_filter", "extended_15m_pct", default=10.0))
    extended_total = float(cfg("recent_pump_filter", "extended_total_pct", default=15.0))
    heavy_extended = float(cfg("recent_pump_filter", "heavy_extended_pct", default=20.0))

    # ── Classify ─────────────────────────────────────────────────────────
    # Single candle explosion
    if result.largest_15m_candle >= extended_15m:
        result.is_extended = True

    # Large total move
    if abs(result.change_1h) >= extended_total or abs(result.change_3h) >= extended_total:
        result.is_extended = True

    # Heavy extension — do not rank as pre-pump
    if abs(result.change_1h) >= heavy_extended or result.largest_3_candle_move >= heavy_extended:
        result.is_heavy_extended = True
        result.is_extended = True

    # Candles since last large expansion
    cooldown = int(cfg("recent_pump_filter", "cooldown_candles", default=8))
    large_candle_indices = [
        i for i in range(-min(20, len(closes) - 1), -1)
        if abs(_pct_change(closes[i], closes[i + 1])) >= extended_15m * 0.7
    ]
    if large_candle_indices:
        result.candles_since_expansion = abs(large_candle_indices[-1])
    else:
        result.candles_since_expansion = 999

    # ── Score 0-10 ───────────────────────────────────────────────────────
    # Higher score = LESS recently pumped = BETTER pre-pump candidate
    if result.is_heavy_extended:
        result.score = 0.0
    elif result.is_extended:
        # Allow recovery after cooldown
        recovery = min(result.candles_since_expansion / cooldown, 1.0)
        result.score = recovery * 4.0  # Max 4 after cooldown from extended
    else:
        # Normal: score based on how quiet the coin has been
        max_recent_move = max(
            abs(result.change_15m),
            abs(result.change_30m),
            abs(result.change_1h) / 4,  # 1h move scaled
        )

        if max_recent_move < 1.0:
            result.score = 10.0   # Very quiet — excellent pre-pump candidate
        elif max_recent_move < 2.0:
            result.score = 9.0
        elif max_recent_move < 3.0:
            result.score = 8.0
        elif max_recent_move < 5.0:
            result.score = 7.0
        elif max_recent_move < 7.0:
            result.score = 5.0
        else:
            result.score = 3.0

    return result
