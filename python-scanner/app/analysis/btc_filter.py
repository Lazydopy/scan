"""
BTC Market Regime Filter.
Analyzes BTCUSDT to classify market conditions.
Used to reduce confidence in altcoin setups during BTC weakness.
"""
from __future__ import annotations

import pandas as pd
import numpy as np

from app.config import cfg
from app.models.candidate import BTCRegime


def _ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def analyze_btc_regime(
    klines_15m: pd.DataFrame,
    klines_1h: pd.DataFrame,
) -> BTCRegime:
    """
    Classify BTC market regime from CLOSED candles.
    Returns BULLISH, NEUTRAL, or BEARISH.
    """
    if klines_15m is None or klines_15m.empty or len(klines_15m) < 5:
        return BTCRegime.NEUTRAL

    closes_15m = klines_15m["close"]
    highs_15m = klines_15m["high"].values
    lows_15m = klines_15m["low"].values

    # Recent 15m price changes
    current = float(closes_15m.iloc[-1])
    prev_candle = float(closes_15m.iloc[-2]) if len(closes_15m) >= 2 else current
    prev_4 = float(closes_15m.iloc[-5]) if len(closes_15m) >= 5 else current

    change_1candle = (current - prev_candle) / prev_candle * 100 if prev_candle > 0 else 0
    change_4candles = (current - prev_4) / prev_4 * 100 if prev_4 > 0 else 0

    sharp_selloff = float(cfg("btc_filter", "sharp_selloff_pct", default=-1.5))
    bullish_threshold = float(cfg("btc_filter", "bullish_threshold_pct", default=0.5))

    # Sharp selloff on last 15m candle
    if change_1candle <= sharp_selloff:
        return BTCRegime.BEARISH

    # Multi-candle decline
    if change_4candles < -3.0:
        return BTCRegime.BEARISH

    # ── 1h context ───────────────────────────────────────────────────────
    if klines_1h is not None and not klines_1h.empty and len(klines_1h) >= 10:
        closes_1h = klines_1h["close"]
        ema20_1h = float(_ema(closes_1h, 20).iloc[-1])
        current_1h = float(closes_1h.iloc[-1])
        h_highs = klines_1h["high"].values[-10:]
        h_lows = klines_1h["low"].values[-10:]

        # Trend: price above/below EMA20
        above_ema = current_1h > ema20_1h

        # Higher lows on 1h
        lows_trend = h_lows[-1] > h_lows[-5] if len(h_lows) >= 5 else True

        if above_ema and lows_trend and change_4candles > bullish_threshold:
            return BTCRegime.BULLISH

        if not above_ema and change_4candles < 0:
            return BTCRegime.BEARISH

    # Bullish on 15m alone
    if change_4candles > bullish_threshold * 2:
        return BTCRegime.BULLISH

    return BTCRegime.NEUTRAL


def btc_confidence_multiplier(regime: BTCRegime) -> float:
    """
    Multiply candidate scores by this factor based on BTC regime.
    BEARISH: reduce altcoin confidence.
    """
    if not cfg("btc_filter", "reduce_confidence_on_bearish", default=True):
        return 1.0

    return {
        BTCRegime.BULLISH: 1.05,
        BTCRegime.NEUTRAL: 1.0,
        BTCRegime.BEARISH: 0.80,
    }.get(regime, 1.0)
