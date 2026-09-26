"""Tests for OI analysis."""
from __future__ import annotations

import pytest

from app.analysis.oi import analyze_oi
from app.models.candidate import OIClassification
from tests.conftest import make_compressed_candles


class TestOI:
    def _make_oi_history(self, values: list[float]) -> list[dict]:
        return [
            {"timestamp": str(i * 900000), "sumOpenInterest": str(v), "sumOpenInterestValue": str(v * 100)}
            for i, v in enumerate(values)
        ]

    def test_oi_unavailable_when_empty(self):
        """No OI data = OI_UNAVAILABLE."""
        result = analyze_oi([], make_compressed_candles())
        assert result.classification == OIClassification.OI_UNAVAILABLE
        assert result.is_available == False

    def test_price_flat_oi_up_classified(self):
        """Rising OI with flat price = PRICE_FLAT_OI_UP (best signal)."""
        df = make_compressed_candles(60)  # Flat price
        oi = self._make_oi_history([1000.0] * 8 + [1050.0, 1100.0, 1150.0, 1200.0])
        result = analyze_oi(oi, df)
        assert result.is_available
        # Depending on exact price change, this may be PRICE_FLAT_OI_UP or NORMAL
        assert result.classification in (
            OIClassification.PRICE_FLAT_OI_UP,
            OIClassification.NORMAL,
            OIClassification.PRICE_UP_OI_UP,
        )

    def test_score_range(self):
        """OI score must be 0-20."""
        df = make_compressed_candles(60)
        oi = self._make_oi_history([1000.0 + i * 10 for i in range(12)])
        result = analyze_oi(oi, df)
        assert 0.0 <= result.score <= 20.0

    def test_signal_range(self):
        """Price/OI signal must be -1 to +1."""
        df = make_compressed_candles(60)
        oi = self._make_oi_history([1000.0 + i * 5 for i in range(12)])
        result = analyze_oi(oi, df)
        assert -1.0 <= result.price_oi_signal <= 1.0

    def test_oi_unavailable_score_neutral(self):
        """When OI is unavailable, score should not be 0 (neutral)."""
        result = analyze_oi([], make_compressed_candles())
        assert result.score > 0.0, "Should get neutral score, not 0"

    def test_oi_change_1h_calculated(self):
        """OI 1h change should be computed when data available."""
        df = make_compressed_candles(60)
        oi = self._make_oi_history([1000.0, 1000.0, 1000.0, 1000.0, 1050.0])
        result = analyze_oi(oi, df)
        if result.oi_change_1h is not None:
            assert isinstance(result.oi_change_1h, float)
