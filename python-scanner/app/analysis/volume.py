"""
Volume Analysis Engine.
Computes volume ratios and trends from CLOSED candles only.
Volume is NEVER evaluated in isolation — context matters.

Score: 0-15
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import cfg
from app.models.candidate import VolumeResult


def analyze_volume(df: pd.DataFrame) -> VolumeResult:
    """
    Analyze volume from CLOSED candles.
    df should already contain only closed candles.
    """
    result = VolumeResult()

    if df is None or len(df) < 5:
        return result

    short_w = int(cfg("candles", "volume_window_short", default=10))
    long_w = int(cfg("candles", "volume_window_long", default=20))

    volumes = df["volume"].values

    # Current closed candle volume
    result.current_volume = float(volumes[-1])

    # Medians and mean
    if len(volumes) >= short_w:
        result.median_10 = float(np.median(volumes[-short_w - 1:-1]))
    else:
        result.median_10 = float(np.median(volumes[:-1])) if len(volumes) > 1 else float(volumes[-1])

    if len(volumes) >= long_w:
        prev_volumes = volumes[-long_w - 1:-1]
    else:
        prev_volumes = volumes[:-1]

    result.median_20 = float(np.median(prev_volumes))
    result.mean_20 = float(np.mean(prev_volumes))

    # Volume ratios
    result.volume_ratio_10 = result.current_volume / result.median_10 if result.median_10 > 0 else 1.0
    result.volume_ratio_20 = result.current_volume / result.median_20 if result.median_20 > 0 else 1.0

    # Volume trend: compare last 3 vs previous 3
    if len(volumes) >= 7:
        recent_avg = np.mean(volumes[-4:-1])
        prev_avg = np.mean(volumes[-7:-4])
        if recent_avg > prev_avg * 1.15:
            result.volume_trend = "RISING"
        elif recent_avg < prev_avg * 0.85:
            result.volume_trend = "DECLINING"
        else:
            result.volume_trend = "FLAT"
    else:
        result.volume_trend = "FLAT"

    result.is_expanding = (
        result.volume_ratio_10 >= 1.5 or result.volume_ratio_20 >= 1.5
    )

    # ── Score 0-15 ───────────────────────────────────────────────────────
    # High volume alone is NOT bullish without context.
    # Score is higher when volume expands WHILE price stays compressed.
    # The interaction with price structure is handled in scoring/pump_score.py
    score = 0.0

    # Volume ratio vs 10-period median (0-7)
    ratio = result.volume_ratio_10
    if ratio >= 3.0:
        score += 7.0
    elif ratio >= 2.5:
        score += 6.0
    elif ratio >= 2.0:
        score += 5.0
    elif ratio >= 1.5:
        score += 4.0
    elif ratio >= 1.2:
        score += 2.5
    elif ratio >= 1.0:
        score += 1.0

    # Volume ratio vs 20-period median (0-5)
    ratio20 = result.volume_ratio_20
    if ratio20 >= 2.5:
        score += 5.0
    elif ratio20 >= 2.0:
        score += 4.0
    elif ratio20 >= 1.5:
        score += 3.0
    elif ratio20 >= 1.2:
        score += 2.0
    elif ratio20 >= 1.0:
        score += 1.0

    # Volume trend (0-3)
    if result.volume_trend == "RISING":
        score += 3.0
    elif result.volume_trend == "FLAT":
        score += 1.0

    result.score = min(15.0, score)
    return result
