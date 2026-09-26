"""Tests for the volume engine."""
from __future__ import annotations

import pandas as pd
import pytest

from app.analysis.volume import analyze_volume
from tests.conftest import make_high_volume_candles, make_compressed_candles, make_declining_candles


class TestVolume:
    def test_volume_spike_detected(self):
        """Last candle with 4× volume should show high ratio."""
        df = make_high_volume_candles(60)
        result = analyze_volume(df)
        assert result.volume_ratio_10 > 1.5, f"Expected high ratio, got {result.volume_ratio_10}"
        assert result.is_expanding, "Expected is_expanding=True"

    def test_score_range(self):
        """Score must be 0-15."""
        for factory in [make_high_volume_candles, make_compressed_candles, make_declining_candles]:
            df = factory(60)
            result = analyze_volume(df)
            assert 0.0 <= result.score <= 15.0, f"Score out of range: {result.score}"

    def test_empty_df(self):
        """Empty df should not raise."""
        result = analyze_volume(pd.DataFrame())
        assert result.score == 0.0
        assert result.volume_ratio_10 == 1.0

    def test_high_volume_scores_higher(self):
        """High volume candle should score higher than normal."""
        high_vol = analyze_volume(make_high_volume_candles(60))
        normal = analyze_volume(make_compressed_candles(60))
        assert high_vol.score >= normal.score, \
            f"High volume score {high_vol.score} should be >= normal {normal.score}"

    def test_volume_trend_classification(self):
        """Volume trend should be RISING | FLAT | DECLINING."""
        df = make_high_volume_candles(60)
        result = analyze_volume(df)
        assert result.volume_trend in ("RISING", "FLAT", "DECLINING")

    def test_median_calculation(self):
        """Medians must be positive."""
        df = make_compressed_candles(60)
        result = analyze_volume(df)
        assert result.median_10 > 0
        assert result.median_20 > 0

    def test_ratios_are_sensible(self):
        """Volume ratios should be positive."""
        df = make_compressed_candles(60)
        result = analyze_volume(df)
        assert result.volume_ratio_10 > 0
        assert result.volume_ratio_20 > 0
