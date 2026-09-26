"""
Pump Score Engine — 0 to 100.
Distinct from SETUP_SCORE.
Measures how well the coin is positioned to make an explosive move SPECIFICALLY
in the next 15 minutes.

Factors:
- Volume surge on the CURRENT (unfinished) 15m candle relative to prior closed candles
- OI spike in the last 15 minutes
- Price approaching or just touching breakout level
- Compression releasing
- Momentum on the 5m confirming timeframe
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from app.models.candidate import (
    BTCRegime,
    CandleStatus,
    Candidate,
)


def calculate_pump_score(
    candidate: Candidate,
    current_candle: Optional[pd.Series],
    df_5m: pd.DataFrame,
) -> float:
    """
    Calculate PUMP_SCORE 0-100.
    Uses the current UNFINISHED 15m candle for volume surge detection
    (correctly labeled as such), and CLOSED 5m candles for confirmation.
    """
    score = 0.0

    # ── Current 15m candle volume vs historical median ────────────────────
    # This legitimately uses the OPEN candle volume — it's labeled explicitly
    if current_candle is not None:
        live_volume = float(current_candle.get("volume", 0) or 0)
        median_hist = candidate.volume.median_20
        if median_hist > 0:
            live_ratio = live_volume / median_hist

            # Time-adjusted: normalize by fraction of candle elapsed
            # We assume 15m = 900s. If we're at t=300s (1/3 of candle),
            # the annualized ratio is live_ratio * 3.
            # We conservatively use the raw ratio (not projected) to avoid hype.
            if live_ratio >= 4.0:
                score += 30.0
            elif live_ratio >= 3.0:
                score += 25.0
            elif live_ratio >= 2.0:
                score += 20.0
            elif live_ratio >= 1.5:
                score += 15.0
            elif live_ratio >= 1.0:
                score += 8.0
        else:
            score += 5.0
    else:
        # No unfinished candle — use last closed
        ratio = candidate.volume.volume_ratio_10
        if ratio >= 2.0:
            score += 15.0
        elif ratio >= 1.5:
            score += 10.0
        else:
            score += 5.0

    # ── OI spike in last 15m ─────────────────────────────────────────────
    oi_change_15m = candidate.oi.oi_change_15m
    if oi_change_15m is not None:
        if oi_change_15m > 3.0:
            score += 20.0
        elif oi_change_15m > 1.5:
            score += 15.0
        elif oi_change_15m > 0.5:
            score += 10.0
        elif oi_change_15m > 0:
            score += 5.0
    else:
        score += 5.0  # Neutral

    # ── Distance to breakout level ────────────────────────────────────────
    dist = candidate.resistance.distance_pct
    if dist is not None:
        if 0 < dist < 0.3:
            score += 20.0   # Kissing resistance
        elif 0 < dist < 0.7:
            score += 17.0
        elif 0 < dist < 1.5:
            score += 12.0
        elif 0 < dist < 3.0:
            score += 8.0
        elif dist <= 0:
            score += 15.0   # Already above — momentum play

    # ── Compression releasing ─────────────────────────────────────────────
    c = candidate.compression
    if c.is_compressed and c.atr_ratio < 0.5:
        score += 10.0
    elif c.is_compressed:
        score += 7.0
    elif c.atr_ratio < 0.7:
        score += 3.0

    # ── 5m momentum confirmation (CLOSED 5m candles) ─────────────────────
    if df_5m is not None and not df_5m.empty and len(df_5m) >= 4:
        closes_5m = df_5m["close"].values
        volumes_5m = df_5m["volume"].values

        # Is 5m closing above recent range?
        recent_5m_high = float(np.max(closes_5m[-5:-1]))
        if closes_5m[-1] > recent_5m_high:
            score += 10.0
        elif closes_5m[-1] > np.median(closes_5m[-5:-1]):
            score += 5.0

        # 5m volume spike
        vol_5m_ratio = float(volumes_5m[-1]) / float(np.median(volumes_5m[-6:-1])) if np.median(volumes_5m[-6:-1]) > 0 else 1.0
        if vol_5m_ratio >= 2.5:
            score += 10.0
        elif vol_5m_ratio >= 1.8:
            score += 7.0
        elif vol_5m_ratio >= 1.3:
            score += 4.0

    # ── BTC filter ────────────────────────────────────────────────────────
    if candidate.btc_regime == BTCRegime.BEARISH:
        score *= 0.75
    elif candidate.btc_regime == BTCRegime.BULLISH:
        score *= 1.05

    # ── Recent pump penalty ───────────────────────────────────────────────
    if candidate.recent_pump.is_heavy_extended:
        score *= 0.2
    elif candidate.recent_pump.is_extended:
        score *= 0.5

    return min(100.0, max(0.0, round(score, 1)))
