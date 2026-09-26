"""
Open Interest Analysis Engine.
Analyzes OI changes and classifies price/OI relationship.
Marks OI_UNAVAILABLE rather than inventing data.

Score: 0-20
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from app.models.candidate import OIClassification, OIResult


def _pct_change(a: float, b: float) -> Optional[float]:
    """% change from a to b."""
    if a is None or b is None or a == 0:
        return None
    return ((b - a) / a) * 100


def analyze_oi(
    oi_history: list[dict],
    klines_15m: pd.DataFrame,
) -> OIResult:
    """
    Analyze open interest from Binance futures OI history.
    oi_history: list of {'timestamp', 'sumOpenInterest', 'sumOpenInterestValue'}

    Does NOT invent OI. If unavailable, marks OI_UNAVAILABLE.
    """
    result = OIResult()

    if not oi_history or len(oi_history) < 2:
        result.classification = OIClassification.OI_UNAVAILABLE
        result.is_available = False
        return result

    result.is_available = True

    # Parse OI values
    oi_values = []
    for entry in oi_history:
        try:
            oi_values.append(float(entry.get("sumOpenInterest", 0) or 0))
        except (ValueError, TypeError):
            continue

    if len(oi_values) < 2:
        result.classification = OIClassification.OI_UNAVAILABLE
        return result

    oi_current = oi_values[-1]
    result.oi_current = oi_current

    # OI changes at different windows (periods = 15m intervals)
    def _oi_change_n(n: int) -> Optional[float]:
        if len(oi_values) >= n + 1:
            return _pct_change(oi_values[-(n + 1)], oi_values[-1])
        return None

    result.oi_change_5m = _oi_change_n(1)   # ~1 period back (15m OI history period)
    result.oi_change_15m = _oi_change_n(1)  # same if period="15m"
    result.oi_change_30m = _oi_change_n(2)
    result.oi_change_1h = _oi_change_n(4)

    # ── Price / OI Classification ────────────────────────────────────────
    # Use the last 4 closed 15m candles vs OI for context
    if klines_15m is not None and not klines_15m.empty and len(klines_15m) >= 4:
        price_change_recent = _pct_change(
            float(klines_15m["close"].iloc[-5]),
            float(klines_15m["close"].iloc[-1])
        ) or 0.0
    else:
        price_change_recent = 0.0

    oi_change_recent = result.oi_change_1h if result.oi_change_1h is not None else 0.0

    PRICE_THRESH = 0.5   # % to be considered "up/down"
    OI_THRESH = 0.5      # % to be considered "rising/flat"

    price_up = price_change_recent > PRICE_THRESH
    price_down = price_change_recent < -PRICE_THRESH
    price_flat = not price_up and not price_down
    oi_up = oi_change_recent > OI_THRESH
    oi_flat = abs(oi_change_recent) <= OI_THRESH

    if price_up and oi_up:
        result.classification = OIClassification.PRICE_UP_OI_UP
    elif price_up and oi_change_recent < -OI_THRESH:
        result.classification = OIClassification.PRICE_UP_OI_DOWN
    elif price_flat and oi_up:
        result.classification = OIClassification.PRICE_FLAT_OI_UP
    elif price_down and oi_up:
        result.classification = OIClassification.PRICE_DOWN_OI_UP
    elif price_up and oi_flat:
        result.classification = OIClassification.PRICE_UP_OI_FLAT
    else:
        result.classification = OIClassification.NORMAL

    # ── Price / OI Signal (-1 to +1) ─────────────────────────────────────
    # Normalize: price compression + OI rising = very positive signal
    # Price vertical + OI declining = caution (short covering, not fresh longs)
    signal = 0.0

    if result.classification == OIClassification.PRICE_FLAT_OI_UP:
        # Best: accumulation during compression
        signal = 0.8
    elif result.classification == OIClassification.PRICE_UP_OI_UP:
        # New positioning — bullish but crowding risk
        signal = 0.5
    elif result.classification == OIClassification.PRICE_UP_OI_DOWN:
        # Short covering — can be powerful but limited duration
        signal = 0.3
    elif result.classification == OIClassification.PRICE_UP_OI_FLAT:
        # Spot-driven — moderate
        signal = 0.2
    elif result.classification == OIClassification.PRICE_DOWN_OI_UP:
        # Short accumulation — danger
        signal = -0.4
    elif result.classification == OIClassification.NORMAL:
        signal = 0.0

    result.price_oi_signal = signal

    # ── Score 0-20 ───────────────────────────────────────────────────────
    score = 0.0

    # Classification score (0-12)
    classification_scores = {
        OIClassification.PRICE_FLAT_OI_UP: 12.0,    # Best pre-pump OI signature
        OIClassification.PRICE_UP_OI_UP: 9.0,
        OIClassification.PRICE_UP_OI_DOWN: 7.0,
        OIClassification.PRICE_UP_OI_FLAT: 6.0,
        OIClassification.NORMAL: 5.0,
        OIClassification.PRICE_DOWN_OI_UP: 2.0,
        OIClassification.OI_UNAVAILABLE: 5.0,        # Neutral when unavailable
    }
    score += classification_scores.get(result.classification, 5.0)

    # OI change magnitude (0-8): rising OI during compression is bullish
    if result.oi_change_1h is not None:
        oi_ch = result.oi_change_1h
        if oi_ch > 5.0:
            score += 8.0
        elif oi_ch > 3.0:
            score += 6.0
        elif oi_ch > 1.5:
            score += 4.0
        elif oi_ch > 0.5:
            score += 2.0
    else:
        score += 4.0  # Neutral when unavailable

    result.score = min(20.0, score)
    return result
