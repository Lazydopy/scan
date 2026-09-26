"""
Shared test fixtures — synthetic candle data generators.
All tests use synthetic data, never real Binance calls.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from datetime import datetime, timezone


def _make_candles(
    n: int = 60,
    base_price: float = 1.0,
    trend: float = 0.0,
    noise: float = 0.005,
    volume_base: float = 100_000.0,
    volume_noise: float = 0.3,
    seed: int = 42,
) -> pd.DataFrame:
    """
    Generate synthetic OHLCV candles.
    trend: drift per candle in decimal (0.001 = 0.1% per candle)
    noise: random spread around open
    """
    rng = np.random.default_rng(seed)
    closes = [base_price]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1 + trend + rng.normal(0, noise)))

    rows = []
    for i, close in enumerate(closes):
        o = close * (1 + rng.normal(0, noise * 0.5))
        h = max(o, close) * (1 + abs(rng.normal(0, noise)))
        l = min(o, close) * (1 - abs(rng.normal(0, noise)))
        v = volume_base * (1 + rng.normal(0, volume_noise))
        v = max(v, 100.0)
        ts = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000) + i * 900_000
        rows.append({
            "open_time": pd.Timestamp(ts, unit="ms", tz="UTC"),
            "open": o, "high": h, "low": l, "close": close, "volume": v,
            "close_time": pd.Timestamp(ts + 899_999, unit="ms", tz="UTC"),
            "quote_volume": v * close,
            "trades": 1000,
            "is_closed": True,
        })

    return pd.DataFrame(rows)


def make_compressed_candles(n: int = 60, base: float = 1.0) -> pd.DataFrame:
    """Candles in a tight range — compression should be detected."""
    return _make_candles(n, base, trend=0.0, noise=0.002, seed=1)


def make_trending_candles(n: int = 60, base: float = 1.0) -> pd.DataFrame:
    """Steadily trending up candles."""
    return _make_candles(n, base, trend=0.003, noise=0.005, seed=2)


def make_pumped_candles(n: int = 60, base: float = 1.0) -> pd.DataFrame:
    """Candles with a large recent pump on the last few."""
    df = _make_candles(n, base, trend=0.0, noise=0.003, seed=3)
    # Inject a big pump on last 3 candles
    for i in range(-3, 0):
        df.loc[df.index[i], "close"] *= 1.15
        df.loc[df.index[i], "high"] *= 1.16
        df.loc[df.index[i], "volume"] *= 5.0
    return df


def make_high_volume_candles(n: int = 60, base: float = 1.0) -> pd.DataFrame:
    """Candles with a big recent volume spike on last candle."""
    df = _make_candles(n, base, trend=0.0, noise=0.003, seed=4)
    df.loc[df.index[-1], "volume"] *= 4.0
    return df


def make_declining_candles(n: int = 60, base: float = 1.0) -> pd.DataFrame:
    """Downtrending candles."""
    return _make_candles(n, base, trend=-0.003, noise=0.005, seed=5)


@pytest.fixture
def compressed_df():
    return make_compressed_candles(60)


@pytest.fixture
def pumped_df():
    return make_pumped_candles(60)


@pytest.fixture
def high_volume_df():
    return make_high_volume_candles(60)


@pytest.fixture
def trending_df():
    return make_trending_candles(60)


@pytest.fixture
def declining_df():
    return make_declining_candles(60)
