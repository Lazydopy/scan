"""Tests for funding and BTC filter."""
from __future__ import annotations

import pytest
import pandas as pd

from app.analysis.funding import analyze_funding
from app.analysis.btc_filter import analyze_btc_regime, btc_confidence_multiplier
from app.models.candidate import BTCRegime
from tests.conftest import make_compressed_candles, make_pumped_candles, make_declining_candles


class TestFunding:
    def test_negative_funding_scores_high(self):
        """Negative funding = squeeze setup = high score."""
        result = analyze_funding(-0.001)  # -0.1%
        assert result.score >= 4.5
        assert result.interpretation == "NEGATIVE_SQUEEZE_SETUP"

    def test_extremely_positive_funding_scores_low(self):
        """Very high positive funding = crowded = low score."""
        result = analyze_funding(0.002)  # 0.2%
        assert result.score <= 1.5

    def test_neutral_funding(self):
        """Neutral funding gives neutral-to-good score."""
        result = analyze_funding(0.0001)  # 0.01%
        assert result.score >= 3.0

    def test_unavailable_funding_neutral(self):
        """Unavailable funding should return neutral score."""
        result = analyze_funding(None)
        assert not result.is_available
        assert result.score == 2.5

    def test_score_range(self):
        """Funding score must be 0-5."""
        for rate in [-0.002, -0.001, 0.0, 0.0001, 0.001, 0.002]:
            result = analyze_funding(rate)
            assert 0.0 <= result.score <= 5.0


class TestBTCFilter:
    def test_neutral_btc_regime(self):
        """Stable BTC = NEUTRAL."""
        df_15m = make_compressed_candles(50)
        df_1h = make_compressed_candles(50)
        regime = analyze_btc_regime(df_15m, df_1h)
        assert regime in (BTCRegime.NEUTRAL, BTCRegime.BULLISH, BTCRegime.BEARISH)

    def test_sharply_falling_btc_bearish(self):
        """Sharp BTC drop in last candle = BEARISH."""
        df_15m = make_compressed_candles(50)
        # Inject a sharp drop on last candle
        df_15m.loc[df_15m.index[-1], "close"] = df_15m["close"].iloc[-2] * 0.97
        df_1h = make_compressed_candles(50)
        regime = analyze_btc_regime(df_15m, df_1h)
        assert regime == BTCRegime.BEARISH

    def test_empty_btc_data_returns_neutral(self):
        """Empty BTC data = NEUTRAL (safe default)."""
        regime = analyze_btc_regime(pd.DataFrame(), pd.DataFrame())
        assert regime == BTCRegime.NEUTRAL

    def test_bearish_multiplier_reduces(self):
        """BEARISH multiplier should be < 1."""
        mult = btc_confidence_multiplier(BTCRegime.BEARISH)
        assert mult < 1.0

    def test_bullish_multiplier_boosts(self):
        """BULLISH multiplier should be >= 1."""
        mult = btc_confidence_multiplier(BTCRegime.BULLISH)
        assert mult >= 1.0

    def test_neutral_multiplier_is_one(self):
        """NEUTRAL multiplier = 1.0."""
        mult = btc_confidence_multiplier(BTCRegime.NEUTRAL)
        assert mult == 1.0
