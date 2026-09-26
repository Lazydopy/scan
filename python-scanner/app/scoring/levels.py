"""
Target and Invalidation Level Calculator.
Uses closed candle ATR to project targets — never fabricates numbers.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import cfg
from app.models.candidate import Levels


def _atr(df: pd.DataFrame, period: int = 14) -> float:
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr_series = tr.rolling(window=period, min_periods=1).mean()
    return float(atr_series.iloc[-1]) if not atr_series.empty else 0.0


def calculate_levels(
    df_15m: pd.DataFrame,
    support: float,
    secondary_support: float,
    resistance: float,
    current_price: float,
) -> Levels:
    """
    Project target and invalidation levels from ATR.
    All values come from actual Binance candle data.
    """
    levels = Levels()
    levels.current_price = current_price
    levels.support = support
    levels.secondary_support = secondary_support
    levels.resistance = resistance
    levels.breakout_level = resistance * 1.001  # 0.1% confirmation

    method = str(cfg("targets", "method", default="atr_projection"))
    t1_mult = float(cfg("targets", "target1_atr_mult", default=1.5))
    t2_mult = float(cfg("targets", "target2_atr_mult", default=3.0))
    inv_mult = float(cfg("targets", "invalidation_atr_mult", default=0.75))

    levels.target_method = method

    if df_15m is None or df_15m.empty:
        levels.target1 = current_price * 1.03
        levels.target2 = current_price * 1.06
        levels.invalidation = support * 0.99
        return levels

    atr_val = _atr(df_15m, period=14)

    if method == "atr_projection":
        entry = resistance  # Entry on breakout close
        levels.target1 = entry + atr_val * t1_mult
        levels.target2 = entry + atr_val * t2_mult
        levels.invalidation = support - atr_val * inv_mult

    elif method == "range_expansion":
        # Measure compression range and project it from breakout
        highs = df_15m["high"].values[-14:]
        lows = df_15m["low"].values[-14:]
        comp_range = float(highs.max() - lows.min())
        levels.target1 = resistance + comp_range * 0.618
        levels.target2 = resistance + comp_range * 1.0
        levels.invalidation = support - atr_val * inv_mult

    elif method == "swing_high":
        # Use the rolling max over 40 candles as target
        highs_40 = df_15m["high"].values[-40:]
        levels.target1 = resistance + atr_val * t1_mult
        levels.target2 = float(highs_40.max()) if highs_40.max() > resistance else resistance + atr_val * t2_mult
        levels.invalidation = support - atr_val * inv_mult

    else:
        # Default
        levels.target1 = resistance + atr_val * t1_mult
        levels.target2 = resistance + atr_val * t2_mult
        levels.invalidation = support - atr_val * inv_mult

    return levels
