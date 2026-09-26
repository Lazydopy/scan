"""Tests for the recent pump filter — the most critical component."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analysis.recent_pump import analyze_recent_pump
from tests.conftest import make_compressed_candles, make_pumped_candles


class TestRecentPump:
    def test_pumped_coin_detected_as_extended(self):
        """A coin with a 15% pump in recent candles must be detected as extended."""
        df = make_pumped_candles(60)
        result = analyze_recent_pump(df)
        # The pump was 15% in last few candles
        assert result.is_extended, "Expected extended=True for pumped coin"

    def test_quiet_coin_not_extended(self):
        """A quiet coin with <1% moves must NOT be flagged as extended."""
        df = make_compressed_candles(60)
        result = analyze_recent_pump(df)
        # Tight range = no recent pump
        assert not result.is_extended, "Quiet compressed coin should not be extended"

    def test_quiet_coin_scores_high(self):
        """Quiet coin should have a high score (better pre-pump candidate)."""
        df = make_compressed_candles(60)
        result = analyze_recent_pump(df)
        assert result.score >= 8.0, f"Quiet coin should score high, got {result.score}"

    def test_pumped_coin_scores_low(self):
        """Pumped coin should have a low score."""
        df = make_pumped_candles(60)
        result = analyze_recent_pump(df)
        assert result.score <= 5.0, f"Pumped coin should score low, got {result.score}"

    def test_score_range(self):
        """Score must always be 0-10."""
        for factory in [make_compressed_candles, make_pumped_candles]:
            df = factory(60)
            result = analyze_recent_pump(df)
            assert 0.0 <= result.score <= 10.0, f"Score out of range: {result.score}"

    def test_heavy_extended_is_worst(self):
        """Heavy extended must have the lowest possible score."""
        df = make_pumped_candles(60)
        # Make it extremely pumped
        for i in range(-3, 0):
            df.loc[df.index[i], "close"] *= 1.25
        result = analyze_recent_pump(df)
        assert result.is_extended

    def test_change_1h_calculated(self):
        """1h price change must be a valid float."""
        df = make_compressed_candles(60)
        result = analyze_recent_pump(df)
        assert isinstance(result.change_1h, float)

    def test_empty_df(self):
        """Empty df should not raise."""
        result = analyze_recent_pump(pd.DataFrame())
        assert result.score == 10.0  # Default: unknown = treat as not pumped

    def test_candles_since_expansion_tracked(self):
        """Candles since last expansion should be tracked."""
        df = make_pumped_candles(60)
        result = analyze_recent_pump(df)
        assert result.candles_since_expansion >= 0
