"""
1h Trend Analysis.
Used to score the directional context.
Score: 0-5
"""
from __future__ import annotations

import pandas as pd
import numpy as np

from app.models.candidate import StructureResult


def _ema(series: pd.Series, n: int) -> pd.Series:
    return series.ewm(span=n, adjust=False).mean()


def score_trend_1h(df_1h: pd.DataFrame) -> float:
    """
    Return a 0-5 score for 1h trend context.
    Closed candles only.
    """
    if df_1h is None or len(df_1h) < 10:
        return 2.5  # Neutral

    closes = df_1h["close"]
    highs = df_1h["high"].values
    lows = df_1h["low"].values

    ema20 = _ema(closes, 20)
    ema50 = _ema(closes, 50)

    current = float(closes.iloc[-1])
    ema20_val = float(ema20.iloc[-1])
    ema50_val = float(ema50.iloc[-1])

    score = 0.0

    # Price above EMA20
    if current > ema20_val:
        score += 2.0

    # EMA20 above EMA50
    if ema20_val > ema50_val:
        score += 1.5

    # Higher lows on 1h in last 10 candles
    recent_lows = lows[-10:]
    if len(recent_lows) >= 4 and recent_lows[-1] > recent_lows[-4]:
        score += 1.0

    # Slope of EMA20
    if len(ema20) >= 5:
        slope = (float(ema20.iloc[-1]) - float(ema20.iloc[-5])) / float(ema20.iloc[-5]) * 100
        if slope > 0.5:
            score += 0.5

    return min(5.0, score)
