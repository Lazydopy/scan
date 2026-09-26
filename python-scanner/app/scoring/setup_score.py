"""
Setup Score Engine — 0 to 100.
Measures how ideal the PRE-PUMP SETUP conditions are.
This is the primary score for ranking candidates.

Components (100 points total):
  compression         (15)
  volume              (15)
  breakout_structure  (15)
  oi_behavior         (20)
  price_oi_divergence (10)
  funding             ( 5)
  liquidity           ( 5)
  trend_1h            ( 5)
  distance_from_pump  (10)
                     ----
  Total               100
"""
from __future__ import annotations

from app.models.candidate import (
    BTCRegime,
    Candidate,
    ScoreBreakdown,
    Status,
)
from app.analysis.btc_filter import btc_confidence_multiplier


def calculate_setup_score(
    candidate: Candidate,
    liquidity_score: float = 0.0,
    trend_score: float = 0.0,
) -> tuple[float, ScoreBreakdown]:
    """
    Calculate SETUP_SCORE using all analysis results.
    Returns (score_0_to_100, breakdown).
    Uses ONLY actual analysis data — never fabricates.

    Args:
        candidate: Fully analyzed Candidate object.
        liquidity_score: Pre-computed liquidity score (0-5).
        trend_score: Pre-computed 1h trend score (0-5).
    """
    sb = ScoreBreakdown()

    # 1. Compression (0-15) — direct from compression engine
    sb.compression = min(15.0, candidate.compression.score)

    # 2. Volume (0-15) — direct
    sb.volume = min(15.0, candidate.volume.score)

    # 3. Breakout Structure (0-15)
    # Combines breakout engine score with structure quality
    sb.breakout_structure = min(15.0, candidate.breakout.score)

    # 4. OI Behavior (0-20) — direct
    sb.oi_behavior = min(20.0, candidate.oi.score)

    # 5. Price/OI Divergence (0-10)
    # This specifically looks for price-flat-OI-rising signature
    signal = candidate.oi.price_oi_signal  # -1 to +1
    sb.price_oi_divergence = min(10.0, max(0.0, (signal + 1.0) / 2.0 * 10.0))

    # 6. Funding (0-5) — direct
    sb.funding = min(5.0, candidate.funding.score)

    # 7. Liquidity (0-5) — passed in as arg
    sb.liquidity = min(5.0, liquidity_score)

    # 8. 1h Trend (0-5) — passed in as arg
    sb.trend_1h = min(5.0, trend_score)

    # 9. Distance from Pump (0-10) — from recent_pump engine
    sb.distance_from_pump = min(10.0, candidate.recent_pump.score)

    # Raw total
    raw_total = sb.total

    # ── BTC Regime Multiplier ─────────────────────────────────────────────
    btc_mult = btc_confidence_multiplier(candidate.btc_regime)
    adjusted = raw_total * btc_mult

    # ── Hard Deductions ───────────────────────────────────────────────────
    # Extended symbols should score very low regardless
    if candidate.recent_pump.is_heavy_extended:
        adjusted *= 0.3

    elif candidate.recent_pump.is_extended:
        adjusted *= 0.5

    # False breakout penalty
    if candidate.breakout.is_false_breakout:
        adjusted *= 0.85

    # BTC BEARISH hard cap at 60
    if candidate.btc_regime == BTCRegime.BEARISH:
        adjusted = min(adjusted, 60.0)

    final = min(100.0, max(0.0, adjusted))
    return round(final, 1), sb


def classify_status(setup_score: float, candidate: Candidate) -> Status:
    """Map setup score + analysis state to Status enum."""
    if candidate.recent_pump.is_heavy_extended:
        return Status.EXTENDED

    if candidate.recent_pump.is_extended:
        return Status.EXTENDED

    if candidate.breakout.is_false_breakout:
        return Status.FAILED

    if candidate.breakout.status in (Status.BREAKOUT_CONFIRMED, Status.BREAKOUT):
        return candidate.breakout.status

    if setup_score >= 80:
        return Status.PRE_BREAKOUT

    if setup_score >= 65:
        return Status.WATCH

    if setup_score >= 40:
        return Status.WEAK

    return Status.AVOID


def classify_alert_label(setup_score: float, status: Status) -> str:
    """Human-readable alert label for Telegram / frontend."""
    if status == Status.EXTENDED:
        return "🔴 EXTENDED"
    if status == Status.FAILED:
        return "❌ FAILED BREAKOUT"
    if status == Status.BREAKOUT_CONFIRMED:
        return "🚀 BREAKOUT CONFIRMED"
    if status == Status.BREAKOUT:
        return "⚡ BREAKOUT"
    if status == Status.PRE_BREAKOUT:
        if setup_score >= 85:
            return "🔥 HIGH CONVICTION PRE-BREAKOUT"
        return "🟠 PRE-BREAKOUT SETUP"
    if status == Status.WATCH:
        return "🟡 WATCH"
    if status == Status.WEAK:
        return "⚪ WEAK"
    return "⚪ AVOID"


def build_reasons(candidate: Candidate) -> list[str]:
    """
    Generate human-readable reasons explaining the score.
    Transparent, auditable — explains every significant factor.
    """
    reasons = []
    c = candidate.compression
    v = candidate.volume
    oi = candidate.oi
    f = candidate.funding
    bp = candidate.breakout
    rp = candidate.recent_pump

    if c.is_compressed:
        reasons.append(
            f"🔒 Price compressed {c.compression_range_pct:.1f}% over {c.candles_in_range} candles"
        )
    if c.higher_lows:
        reasons.append("📈 Higher lows — buyers stepping in at higher prices")
    if c.resistance_tests >= 2:
        reasons.append(f"🔁 Resistance tested {c.resistance_tests}x — coiling under key level")

    if v.volume_ratio_10 >= 1.5:
        reasons.append(f"📊 Volume {v.volume_ratio_10:.1f}x above 10-period median")
    if v.volume_trend == "RISING":
        reasons.append("🔺 Volume trend rising — accumulation signal")

    if oi.is_available:
        from app.models.candidate import OIClassification
        if oi.classification == OIClassification.PRICE_FLAT_OI_UP:
            reasons.append(f"🧨 OI rising while price flat — strong accumulation signal (+{oi.oi_change_1h:.1f}% 1h OI)")
        elif oi.classification == OIClassification.PRICE_UP_OI_DOWN:
            reasons.append("⚡ OI declining on price rise — short squeeze potential")
        elif oi.classification == OIClassification.PRICE_UP_OI_UP:
            reasons.append(f"📈 Fresh positions being opened into strength (+{oi.oi_change_1h:.1f}% OI)")

    if f.is_available and f.rate is not None:
        if f.rate < 0:
            reasons.append(f"💰 Negative funding ({f.rate*100:.4f}%) — shorts paying longs")
        elif f.interpretation == "NEUTRAL":
            reasons.append("✅ Funding rate neutral — no crowding")

    if bp.status == Status.PRE_BREAKOUT:
        reasons.append(
            f"🎯 {bp.distance_to_breakout_pct:.1f}% below breakout level"
        )
    elif bp.status in (Status.BREAKOUT, Status.BREAKOUT_CONFIRMED):
        reasons.append("🚀 Breakout in progress — volume confirmation required")

    if rp.is_extended:
        reasons.append(f"⚠️ Already extended {rp.change_1h:.1f}% in 1h — caution")

    if candidate.btc_regime.value == "BEARISH":
        reasons.append("⚠️ BTC bearish — confidence reduced")

    return reasons
