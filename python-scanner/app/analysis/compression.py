"""
Price Compression Engine.
Analyzes CLOSED candles only to detect compression structures.

Calculates:
- compression range %
- ATR and ATR ratio (recent vs historical)
- standard deviation of closes
- candle body size
- candles inside narrow range
- higher lows / lower lows
- repeated resistance tests

Score: 0-15
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import cfg
from app.models.candidate import CompressionResult


def _calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """True Range and ATR. Uses closed candles only."""
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(window=period, min_periods=1).mean()


def analyze_compression(df: pd.DataFrame) -> CompressionResult:
    """
    Analyze price compression using CLOSED candles only.
    df should already be filtered to closed candles.
    """
    result = CompressionResult()

    if df is None or len(df) < 8:
        return result

    window = int(cfg("candles", "compression_window", default=14))
    recent = df.tail(window).copy()

    if len(recent) < 6:
        return result

    highs = recent["high"].values
    lows = recent["low"].values
    closes = recent["close"].values
    opens = recent["open"].values

    highest_high = highs.max()
    lowest_low = lows.min()

    # ── Compression Range ────────────────────────────────────────────────
    if lowest_low > 0:
        compression_range_pct = ((highest_high - lowest_low) / lowest_low) * 100
    else:
        compression_range_pct = 999.0
    result.compression_range_pct = compression_range_pct

    tight_range_threshold = float(cfg("compression", "tight_range_pct", default=3.0))

    # ── ATR Ratio ────────────────────────────────────────────────────────
    atr_series = _calculate_atr(df)
    if len(atr_series) >= window + 5:
        recent_atr = float(atr_series.iloc[-window:].mean())
        historical_atr = float(atr_series.iloc[-(window * 2):-window].mean())
        if historical_atr > 0:
            atr_ratio = recent_atr / historical_atr
        else:
            atr_ratio = 1.0
    else:
        recent_atr = float(atr_series.iloc[-window:].mean()) if len(atr_series) >= window else float(atr_series.mean())
        historical_atr = recent_atr
        atr_ratio = 1.0

    result.atr_ratio = atr_ratio
    if closes[-1] > 0:
        result.normalized_atr = recent_atr / closes[-1] * 100
    atr_threshold = float(cfg("compression", "atr_ratio_threshold", default=0.7))

    # ── Candles in Narrow Range ──────────────────────────────────────────
    mid = (highest_high + lowest_low) / 2
    narrow_band = (highest_high - lowest_low) * 0.6
    candles_in_range = int(
        sum(1 for h, l in zip(highs, lows)
            if abs((h + l) / 2 - mid) < narrow_band / 2)
    )
    result.candles_in_range = candles_in_range
    min_candles_in_range = int(cfg("compression", "min_candles_in_range", default=6))

    # ── Higher Lows Detection ────────────────────────────────────────────
    # Look at last 5 swing lows
    swing_lows = []
    for i in range(1, len(lows) - 1):
        if lows[i] < lows[i - 1] and lows[i] < lows[i + 1]:
            swing_lows.append(lows[i])

    if len(swing_lows) >= 2:
        # Check if lows are trending up
        diffs = [swing_lows[i + 1] - swing_lows[i] for i in range(len(swing_lows) - 1)]
        rising_count = sum(1 for d in diffs if d > 0)
        falling_count = sum(1 for d in diffs if d < 0)
        if rising_count > falling_count:
            result.higher_lows = True
        elif falling_count > rising_count:
            result.lower_lows = True

    # ── Higher Highs ─────────────────────────────────────────────────────
    swing_highs = []
    for i in range(1, len(highs) - 1):
        if highs[i] > highs[i - 1] and highs[i] > highs[i + 1]:
            swing_highs.append(highs[i])
    if len(swing_highs) >= 2:
        if swing_highs[-1] > swing_highs[0]:
            result.higher_highs = True

    # ── Resistance Tests ─────────────────────────────────────────────────
    if len(swing_highs) >= 1:
        resistance_cluster = np.median(swing_highs[-3:]) if len(swing_highs) >= 3 else swing_highs[-1]
        tolerance = resistance_cluster * 0.005  # 0.5% tolerance
        tests = sum(1 for h in highs if abs(h - resistance_cluster) < tolerance)
        result.resistance_tests = tests

    # ── Is Compressed? ───────────────────────────────────────────────────
    is_compressed = (
        compression_range_pct <= tight_range_threshold
        and atr_ratio <= atr_threshold
        and candles_in_range >= min_candles_in_range
    )
    result.is_compressed = is_compressed

    # ── Score 0-15 ───────────────────────────────────────────────────────
    score = 0.0

    # Range compression (0-5)
    if compression_range_pct < 1.0:
        score += 5.0
    elif compression_range_pct < 2.0:
        score += 4.0
    elif compression_range_pct < 3.0:
        score += 3.0
    elif compression_range_pct < 4.0:
        score += 2.0
    elif compression_range_pct < 6.0:
        score += 1.0

    # ATR contraction (0-4)
    if atr_ratio < 0.5:
        score += 4.0
    elif atr_ratio < 0.65:
        score += 3.0
    elif atr_ratio < 0.75:
        score += 2.0
    elif atr_ratio < 0.85:
        score += 1.0

    # Candles in range (0-2)
    if candles_in_range >= 8:
        score += 2.0
    elif candles_in_range >= 6:
        score += 1.0

    # Higher lows (0-2)
    if result.higher_lows:
        score += 2.0

    # Resistance tests (0-2)
    if result.resistance_tests >= 3:
        score += 2.0
    elif result.resistance_tests >= 2:
        score += 1.0

    result.score = min(15.0, score)
    return result
