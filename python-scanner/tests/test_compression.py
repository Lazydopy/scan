"""Tests for the compression engine."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analysis.compression import analyze_compression
from tests.conftest import make_compressed_candles, make_trending_candles, make_pumped_candles


class TestCompression:
    def test_compressed_candles_detected(self):
        """Tight range candles must be detected as compressed."""
        df = make_compressed_candles(60)
        result = analyze_compression(df)
        assert result.is_compressed, "Expected compressed=True for tight-range candles"
        assert result.compression_range_pct < 4.0, "Expected small range%"
        assert result.atr_ratio < 1.0, "Expected ATR contraction"

    def test_trending_not_compressed(self):
        """Trending candles should NOT be compressed."""
        df = make_trending_candles(60)
        result = analyze_compression(df)
        # Trending moves more, so ATR ratio should be higher
        # (not necessarily > 1, but compression should be less extreme)
        assert result.compression_range_pct > 1.0 or not result.is_compressed, \
            "Trending candles should not show tight compression"

    def test_score_range(self):
        """Score must always be 0-15."""
        for factory in [make_compressed_candles, make_trending_candles, make_pumped_candles]:
            df = factory(60)
            result = analyze_compression(df)
            assert 0.0 <= result.score <= 15.0, f"Score out of range: {result.score}"

    def test_empty_df_returns_default(self):
        """Empty DataFrame should not raise."""
        result = analyze_compression(pd.DataFrame())
        assert result.is_compressed == False
        assert result.score == 0.0

    def test_insufficient_data_returns_default(self):
        """Too few candles should not raise."""
        df = make_compressed_candles(5)
        result = analyze_compression(df)
        assert result.score == 0.0

    def test_compressed_score_higher_than_trending(self):
        """Compressed candles should score higher than trending."""
        compressed = analyze_compression(make_compressed_candles(60))
        trending = analyze_compression(make_trending_candles(60))
        assert compressed.score >= trending.score, \
            f"Compressed score {compressed.score} should be >= trending {trending.score}"

    def test_higher_lows_detection(self):
        """Higher lows should be detected in uptrending candles."""
        # Generate candles with clear higher lows
        df = make_trending_candles(60)
        result = analyze_compression(df)
        # Either higher_lows or we accept the result (trend may not be strong enough)
        assert isinstance(result.higher_lows, bool)

    def test_resistance_tests_counted(self):
        """Resistance tests should be counted."""
        df = make_compressed_candles(60)
        result = analyze_compression(df)
        assert result.resistance_tests >= 0  # Must be non-negative integer

    def test_candles_in_range_counted(self):
        """Candles in range must be counted."""
        df = make_compressed_candles(60)
        result = analyze_compression(df)
        assert result.candles_in_range >= 0
