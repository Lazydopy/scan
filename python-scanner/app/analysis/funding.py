"""
Funding Rate Analysis.
Funding is a SUPPORTING signal only — never triggers an alert alone.
Marks FUNDING_UNAVAILABLE rather than inventing data.

Score: 0-5
"""
from __future__ import annotations

from typing import Optional

from app.models.candidate import FundingResult


def analyze_funding(funding_rate: Optional[float]) -> FundingResult:
    """
    Analyze funding rate.
    funding_rate: raw rate as decimal (e.g. 0.0001 = 0.01%)

    Interpretation:
    - Negative funding + price strength = potential squeeze setup
    - Moderately positive = neutral / slightly cautionary
    - Extremely positive during vertical move = crowded long risk
    """
    result = FundingResult()

    if funding_rate is None:
        result.is_available = False
        result.interpretation = "FUNDING_UNAVAILABLE"
        result.score = 2.5  # Neutral score when unavailable
        return result

    result.is_available = True
    result.rate = funding_rate

    pct = funding_rate * 100  # e.g. 0.01%

    # ── Interpretation ────────────────────────────────────────────────────
    if pct < -0.05:
        result.interpretation = "NEGATIVE_SQUEEZE_SETUP"
    elif -0.05 <= pct < 0.0:
        result.interpretation = "SLIGHTLY_NEGATIVE"
    elif 0.0 <= pct <= 0.02:
        result.interpretation = "NEUTRAL"
    elif 0.02 < pct <= 0.05:
        result.interpretation = "MODERATELY_POSITIVE"
    elif 0.05 < pct <= 0.10:
        result.interpretation = "HIGH_POSITIVE_CAUTION"
    else:
        result.interpretation = "EXTREMELY_HIGH_CROWDED_RISK"

    # ── Score 0-5 ─────────────────────────────────────────────────────────
    # Best for pre-pump: negative or very slightly positive (possible squeeze)
    if pct < -0.05:
        score = 5.0    # Negative funding = strong squeeze candidate
    elif pct < 0.0:
        score = 4.5
    elif pct <= 0.01:
        score = 4.0    # Neutral
    elif pct <= 0.02:
        score = 3.5
    elif pct <= 0.05:
        score = 2.5    # Slightly elevated
    elif pct <= 0.10:
        score = 1.5    # Caution
    else:
        score = 0.5    # Very high = crowded, avoid as pre-pump

    result.score = score
    return result
