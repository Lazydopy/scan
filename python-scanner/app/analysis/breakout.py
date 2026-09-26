"""
Breakout Engine.
Classifies breakout status and detects false breakouts.

Status: PRE_BREAKOUT | BREAKOUT | BREAKOUT_CONFIRMED | EXTENDED | FAILED | WATCH
Score: 0-15
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.models.candidate import BreakoutResult, Status


def analyze_breakout(
    df_15m: pd.DataFrame,
    df_5m: pd.DataFrame,
    resistance_level: float,
    recent_pump_is_extended: bool,
) -> BreakoutResult:
    """
    Determine breakout status from CLOSED candles.
    A real breakout requires a 15m CLOSE above resistance.
    Wicks above don't count.
    """
    result = BreakoutResult()

    if df_15m is None or df_15m.empty or resistance_level <= 0:
        result.status = Status.WATCH
        result.score = 5.0
        return result

    closes_15m = df_15m["close"].values
    highs_15m = df_15m["high"].values
    lows_15m = df_15m["low"].values
    volumes_15m = df_15m["volume"].values

    current_close = float(closes_15m[-1])
    current_high = float(highs_15m[-1])
    current_low = float(lows_15m[-1])
    current_volume = float(volumes_15m[-1])

    prev_close = float(closes_15m[-2]) if len(closes_15m) >= 2 else current_close
    prev_volume = float(volumes_15m[-2]) if len(volumes_15m) >= 2 else current_volume

    result.breakout_level = resistance_level

    # Distance to breakout
    if current_close > 0:
        result.distance_to_breakout_pct = (
            (resistance_level - current_close) / current_close * 100
        )

    # ── Upper Wick Analysis ───────────────────────────────────────────────
    candle_range = current_high - current_low
    if candle_range > 0:
        upper_wick = current_high - max(current_close, float(df_15m["open"].values[-1]))
        result.upper_wick_ratio = upper_wick / candle_range
    else:
        result.upper_wick_ratio = 0.0

    # ── False Breakout Detection ──────────────────────────────────────────
    # Wick above resistance but close below = false breakout
    wick_above_resistance = current_high > resistance_level * 1.001
    close_below_resistance = current_close < resistance_level

    if wick_above_resistance and close_below_resistance and result.upper_wick_ratio > 0.4:
        result.is_false_breakout = True

    # ── Status Classification ─────────────────────────────────────────────
    if recent_pump_is_extended:
        result.status = Status.EXTENDED
        result.score = 2.0
        return result

    # Confirmed breakout: last 2 closes above resistance
    if (len(closes_15m) >= 2 and
            closes_15m[-1] > resistance_level * 1.001 and
            closes_15m[-2] > resistance_level * 1.001):
        if result.is_false_breakout:
            result.status = Status.FAILED
            result.score = 1.0
        else:
            # Check volume confirmation
            median_vol = float(np.median(volumes_15m[-10:-1])) if len(volumes_15m) >= 10 else prev_volume
            vol_confirms = current_volume > median_vol * 1.3
            result.status = Status.BREAKOUT_CONFIRMED if vol_confirms else Status.BREAKOUT
            result.score = 13.0 if vol_confirms else 11.0
        return result

    # Single close breakout
    if current_close > resistance_level * 1.001:
        if result.is_false_breakout:
            result.status = Status.FAILED
            result.score = 1.0
        else:
            result.status = Status.BREAKOUT
            result.score = 10.0
        return result

    # Pre-breakout: price approaching resistance
    if result.distance_to_breakout_pct is not None:
        dist = result.distance_to_breakout_pct
        if dist < 0:
            # Already above resistance
            result.status = Status.BREAKOUT
            result.score = 10.0
        elif dist < 1.0:
            # Very close
            result.status = Status.PRE_BREAKOUT
            result.score = 14.0
        elif dist < 2.0:
            result.status = Status.PRE_BREAKOUT
            result.score = 12.0
        elif dist < 3.5:
            result.status = Status.PRE_BREAKOUT
            result.score = 10.0
        elif dist < 5.0:
            result.status = Status.WATCH
            result.score = 7.0
        else:
            result.status = Status.WATCH
            result.score = 4.0
    else:
        result.status = Status.WATCH
        result.score = 5.0

    # Penalize false breakout regardless
    if result.is_false_breakout:
        result.score = max(0.0, result.score - 6.0)
        result.status = Status.FAILED

    return result
