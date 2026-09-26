"""
Liquidity filter and liquidity score.
Score: 0-5
"""
from __future__ import annotations

from typing import Optional

from app.config import cfg
from app.models.candidate import Risk


def score_liquidity(quote_volume_24h: Optional[float]) -> float:
    """
    Returns a liquidity score 0-5.
    Higher volume = higher score.
    """
    if quote_volume_24h is None or quote_volume_24h <= 0:
        return 0.0

    min_vol = float(cfg("liquidity", "min_futures_volume_usdt", default=3_000_000))

    ratio = quote_volume_24h / min_vol

    if ratio >= 50:
        return 5.0
    elif ratio >= 20:
        return 4.5
    elif ratio >= 10:
        return 4.0
    elif ratio >= 5:
        return 3.5
    elif ratio >= 2:
        return 3.0
    elif ratio >= 1:
        return 2.0
    else:
        return 1.0


def assess_liquidity_risk(quote_volume_24h: Optional[float]) -> Risk:
    """Classify liquidity risk."""
    if quote_volume_24h is None:
        return Risk.HIGH

    min_vol = float(cfg("liquidity", "min_futures_volume_usdt", default=3_000_000))
    ratio = quote_volume_24h / min_vol

    if ratio >= 10:
        return Risk.LOW
    elif ratio >= 3:
        return Risk.MEDIUM
    else:
        return Risk.HIGH
