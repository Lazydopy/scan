"""Tests for the scoring engine."""
from __future__ import annotations

import pytest

from app.analysis.compression import analyze_compression
from app.analysis.volume import analyze_volume
from app.analysis.oi import analyze_oi
from app.analysis.funding import analyze_funding
from app.analysis.recent_pump import analyze_recent_pump
from app.analysis.breakout import analyze_breakout
from app.analysis.structure import analyze_resistance, analyze_structure
from app.analysis.trend import score_trend_1h
from app.analysis.liquidity import score_liquidity
from app.models.candidate import Candidate, CandleStatus, BTCRegime, ScoreBreakdown
from app.scoring.setup_score import calculate_setup_score, classify_status, build_reasons
from app.scoring.pump_score import calculate_pump_score
from app.scoring.levels import calculate_levels
from tests.conftest import make_compressed_candles, make_pumped_candles, make_high_volume_candles
import pandas as pd


def _build_candidate_from_df(df: pd.DataFrame) -> Candidate:
    """Build a fully analyzed Candidate from a DataFrame."""
    c = Candidate()
    c.symbol = "TESTUSDT"
    c.price = float(df["close"].iloc[-1])
    c.btc_regime = BTCRegime.NEUTRAL
    c.candle_status = CandleStatus.CLOSED

    c.compression = analyze_compression(df)
    c.volume = analyze_volume(df)
    c.structure = analyze_structure(df)
    c.resistance = analyze_resistance(df, c.price)
    c.oi = analyze_oi([], df)
    c.funding = analyze_funding(None)
    c.recent_pump = analyze_recent_pump(df)
    c.breakout = analyze_breakout(df, pd.DataFrame(), c.resistance.level, c.recent_pump.is_extended)

    c.score_breakdown = ScoreBreakdown()
    c.score_breakdown.liquidity = score_liquidity(10_000_000)
    c.score_breakdown.trend_1h = score_trend_1h(df)

    c.levels = calculate_levels(df, c.structure.local_support, c.structure.secondary_support, c.resistance.level, c.price)

    score, breakdown = calculate_setup_score(
        c,
        liquidity_score=c.score_breakdown.liquidity,
        trend_score=c.score_breakdown.trend_1h,
    )
    c.setup_score = score
    c.score_breakdown = breakdown

    return c


class TestScoring:
    def test_setup_score_range(self):
        """Setup score must always be 0-100."""
        for factory in [make_compressed_candles, make_pumped_candles, make_high_volume_candles]:
            df = factory(60)
            c = _build_candidate_from_df(df)
            assert 0.0 <= c.setup_score <= 100.0, f"Score out of range: {c.setup_score}"

    def test_pump_score_range(self):
        """Pump score must be 0-100."""
        df = make_compressed_candles(60)
        c = _build_candidate_from_df(df)
        pump_score = calculate_pump_score(c, None, pd.DataFrame())
        assert 0.0 <= pump_score <= 100.0

    def test_pumped_coin_penalized(self):
        """Pumped coin should score lower than quiet coin."""
        compressed = _build_candidate_from_df(make_compressed_candles(60))
        pumped = _build_candidate_from_df(make_pumped_candles(60))
        assert compressed.setup_score >= pumped.setup_score, \
            f"Compressed {compressed.setup_score} should be >= pumped {pumped.setup_score}"

    def test_btc_bearish_reduces_score(self):
        """BTC BEARISH should reduce score."""
        df = make_compressed_candles(60)

        c_neutral = _build_candidate_from_df(df)
        c_bearish = _build_candidate_from_df(df)
        c_bearish.btc_regime = BTCRegime.BEARISH

        score_neutral, _ = calculate_setup_score(c_neutral, liquidity_score=4.0, trend_score=3.0)
        score_bearish, _ = calculate_setup_score(c_bearish, liquidity_score=4.0, trend_score=3.0)
        assert score_bearish <= score_neutral, "BTC BEARISH should reduce score"

    def test_reasons_generated(self):
        """Reasons list should be a list of strings."""
        df = make_compressed_candles(60)
        c = _build_candidate_from_df(df)
        reasons = build_reasons(c)
        assert isinstance(reasons, list)
        for r in reasons:
            assert isinstance(r, str)

    def test_score_breakdown_totals_correctly(self):
        """ScoreBreakdown.total should match sum of components."""
        sb = ScoreBreakdown(
            compression=10.0,
            volume=12.0,
            breakout_structure=8.0,
            oi_behavior=15.0,
            price_oi_divergence=7.0,
            funding=4.0,
            liquidity=3.0,
            trend_1h=4.0,
            distance_from_pump=8.0,
        )
        expected = 10+12+8+15+7+4+3+4+8
        assert abs(sb.total - expected) < 0.01

    def test_candidate_to_dict(self):
        """to_dict should return JSON-serializable dict."""
        import json
        df = make_compressed_candles(60)
        c = _build_candidate_from_df(df)
        d = c.to_dict()
        # Must be JSON serializable
        json.dumps(d)  # raises if not serializable
        assert "symbol" in d
        assert "setup_score" in d
        assert "pump_score" in d
        assert "score_breakdown" in d
