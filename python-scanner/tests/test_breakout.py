"""Tests for the breakout engine."""
from __future__ import annotations

import pandas as pd
import pytest

from app.analysis.breakout import analyze_breakout
from app.models.candidate import Status
from tests.conftest import make_compressed_candles, make_pumped_candles


class TestBreakout:
    def test_extended_gives_extended_status(self):
        """If coin is extended, status should be EXTENDED."""
        df = make_pumped_candles(60)
        result = analyze_breakout(df, pd.DataFrame(), resistance_level=1.2, recent_pump_is_extended=True)
        assert result.status == Status.EXTENDED

    def test_approaching_resistance_pre_breakout(self):
        """Price close to resistance = PRE_BREAKOUT."""
        df = make_compressed_candles(60)
        current_price = float(df["close"].iloc[-1])
        resistance = current_price * 1.01  # 1% above = approaching
        result = analyze_breakout(df, pd.DataFrame(), resistance_level=resistance, recent_pump_is_extended=False)
        assert result.status in (Status.PRE_BREAKOUT, Status.WATCH)

    def test_far_from_resistance_is_watch(self):
        """Price far from resistance = WATCH."""
        df = make_compressed_candles(60)
        current_price = float(df["close"].iloc[-1])
        resistance = current_price * 1.1  # 10% above
        result = analyze_breakout(df, pd.DataFrame(), resistance_level=resistance, recent_pump_is_extended=False)
        assert result.status == Status.WATCH

    def test_score_range(self):
        """Breakout score must be 0-15."""
        df = make_compressed_candles(60)
        current_price = float(df["close"].iloc[-1])
        for mult in [1.005, 1.01, 1.05]:
            result = analyze_breakout(df, pd.DataFrame(), resistance_level=current_price * mult, recent_pump_is_extended=False)
            assert 0.0 <= result.score <= 15.0, f"Score out of range: {result.score}"

    def test_empty_df_does_not_crash(self):
        """Empty df should return WATCH without crashing."""
        result = analyze_breakout(pd.DataFrame(), pd.DataFrame(), resistance_level=1.0, recent_pump_is_extended=False)
        assert result.status == Status.WATCH

    def test_breakout_level_set(self):
        """Breakout level should be set from resistance."""
        df = make_compressed_candles(60)
        current_price = float(df["close"].iloc[-1])
        resistance = current_price * 1.02
        result = analyze_breakout(df, pd.DataFrame(), resistance_level=resistance, recent_pump_is_extended=False)
        assert result.breakout_level == resistance
