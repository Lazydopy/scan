"""
Market Structure Analysis.
Detects swing highs, swing lows, support, resistance.
All levels must come from actual Binance candle data.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import cfg
from app.models.candidate import ResistanceResult, StructureResult


def _find_swing_lows(lows: np.ndarray, window: int = 3) -> list[tuple[int, float]]:
    """Return (index, value) of swing lows."""
    result = []
    for i in range(window, len(lows) - window):
        val = lows[i]
        if all(val <= lows[i - j] for j in range(1, window + 1)) and \
           all(val <= lows[i + j] for j in range(1, window + 1)):
            result.append((i, val))
    return result


def _find_swing_highs(highs: np.ndarray, window: int = 3) -> list[tuple[int, float]]:
    """Return (index, value) of swing highs."""
    result = []
    for i in range(window, len(highs) - window):
        val = highs[i]
        if all(val >= highs[i - j] for j in range(1, window + 1)) and \
           all(val >= highs[i + j] for j in range(1, window + 1)):
            result.append((i, val))
    return result


def _cluster_levels(levels: list[float], tolerance_pct: float = 0.5) -> list[float]:
    """Group nearby price levels into clusters, return cluster medians."""
    if not levels:
        return []
    levels_sorted = sorted(levels)
    clusters: list[list[float]] = []
    current_cluster = [levels_sorted[0]]
    for lv in levels_sorted[1:]:
        ref = current_cluster[-1]
        if ref > 0 and abs(lv - ref) / ref * 100 <= tolerance_pct:
            current_cluster.append(lv)
        else:
            clusters.append(current_cluster)
            current_cluster = [lv]
    clusters.append(current_cluster)
    return [float(np.median(c)) for c in clusters]


def analyze_structure(df: pd.DataFrame) -> StructureResult:
    """
    Identify swing points, support, and invalidation.
    Uses closed candles only.
    """
    result = StructureResult()
    if df is None or len(df) < 10:
        return result

    highs = df["high"].values
    lows = df["low"].values
    closes = df["close"].values

    swing_low_pts = _find_swing_lows(lows, window=2)
    swing_high_pts = _find_swing_highs(highs, window=2)

    result.swing_lows = [v for _, v in swing_low_pts]
    result.swing_highs = [v for _, v in swing_high_pts]

    # ── Higher / Lower Lows ──────────────────────────────────────────────
    if len(result.swing_lows) >= 2:
        recent_lows = result.swing_lows[-4:]  # last 4 swing lows
        diffs = [recent_lows[i + 1] - recent_lows[i] for i in range(len(recent_lows) - 1)]
        rising = sum(1 for d in diffs if d > 0)
        falling = sum(1 for d in diffs if d < 0)
        if rising > falling:
            result.higher_lows = True
        elif falling > rising:
            result.lower_lows = True
        else:
            result.flat_lows = True
    elif len(result.swing_lows) == 0:
        result.flat_lows = True

    # ── Higher / Lower Highs ─────────────────────────────────────────────
    if len(result.swing_highs) >= 2:
        recent_highs = result.swing_highs[-4:]
        diffs = [recent_highs[i + 1] - recent_highs[i] for i in range(len(recent_highs) - 1)]
        rising = sum(1 for d in diffs if d > 0)
        falling = sum(1 for d in diffs if d < 0)
        if rising > falling:
            result.higher_highs = True
        else:
            result.lower_highs = True

    # ── Support Levels ───────────────────────────────────────────────────
    if result.swing_lows:
        clustered_supports = _cluster_levels(result.swing_lows[-6:])
        if clustered_supports:
            result.local_support = clustered_supports[-1]
            result.secondary_support = clustered_supports[-2] if len(clustered_supports) >= 2 else clustered_supports[-1]
            # Invalidation = below the lowest recent swing low
            result.invalidation = min(result.swing_lows[-3:]) * 0.995  # 0.5% below
    else:
        # Fallback: use recent lowest close
        result.local_support = float(closes[-5:].min())
        result.secondary_support = float(closes[-10:].min())
        result.invalidation = result.local_support * 0.99

    return result


def analyze_resistance(df: pd.DataFrame, current_price: float) -> ResistanceResult:
    """
    Detect local resistance from swing highs and clustering.
    Uses the resistance_window from config.
    """
    result = ResistanceResult()
    if df is None or len(df) < 10:
        return result

    window = int(cfg("candles", "resistance_window", default=40))
    recent = df.tail(window)
    highs = recent["high"].values

    swing_high_pts = _find_swing_highs(highs, window=2)
    if not swing_high_pts:
        # Fallback to rolling max of last 20 candles
        result.level = float(highs[-20:].max())
        result.breakout_level = result.level
        if current_price > 0:
            result.distance_pct = (result.level - current_price) / current_price * 100
        return result

    swing_high_values = [v for _, v in swing_high_pts]

    # Only consider highs ABOVE current price (they are resistance)
    above_price = [h for h in swing_high_values if h >= current_price * 0.997]
    if not above_price:
        # Price has broken through — find nearest high above
        result.level = float(max(swing_high_values))
        result.breakout_level = result.level
        if current_price > 0:
            result.distance_pct = (result.level - current_price) / current_price * 100
        return result

    # Cluster the nearby resistance levels
    clustered = _cluster_levels(above_price)
    # Find nearest cluster above current price
    above_clusters = [c for c in clustered if c > current_price * 0.997]
    if not above_clusters:
        above_clusters = clustered

    nearest_resistance = min(above_clusters)
    result.level = nearest_resistance
    result.breakout_level = nearest_resistance * 1.001  # 0.1% above for confirmed break

    if current_price > 0:
        result.distance_pct = (nearest_resistance - current_price) / current_price * 100

    # Count how many candle highs have tested this level (within 0.5%)
    tolerance = nearest_resistance * 0.005
    result.tests = int(sum(1 for h in highs if abs(h - nearest_resistance) < tolerance))

    # Candles since last test
    tests_indices = [i for i, h in enumerate(highs) if abs(h - nearest_resistance) < tolerance]
    if tests_indices:
        result.candles_since_last_test = len(highs) - 1 - tests_indices[-1]

    result.is_well_defined = result.tests >= 2 and result.distance_pct < 5.0

    return result
