"""Tests for the database layer."""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
from datetime import datetime, timezone

import pytest
import pytest_asyncio

from app.storage.database import Database
from app.models.candidate import Candidate, CandleStatus, BTCRegime, Status, Risk


def _make_candidate(symbol: str = "TESTUSDT", score: float = 75.0) -> Candidate:
    c = Candidate()
    c.symbol = symbol
    c.price = 1.5
    c.setup_score = score
    c.pump_score = 60.0
    c.status = Status.PRE_BREAKOUT
    c.btc_regime = BTCRegime.NEUTRAL
    c.candle_status = CandleStatus.CLOSED
    c.risk = Risk.MEDIUM
    c.alert_label = "🟠 PRE-BREAKOUT SETUP"
    return c


@pytest.fixture
def temp_db(tmp_path):
    """Create a temporary database for testing."""
    db_path = tmp_path / "test_scanner.db"

    class TempDB(Database):
        def __init__(self):
            self._path = db_path

    return TempDB()


class TestDatabase:
    def test_init_creates_schema(self, temp_db):
        """Database init should create tables without error."""
        asyncio.run(temp_db.init())
        assert temp_db._path.exists()

    def test_save_and_retrieve_scan(self, temp_db):
        """Save a scan run and retrieve it."""
        async def _run():
            await temp_db.init()
            candidates = [_make_candidate("AAVEUSDT", 80.0), _make_candidate("SHIBUSDT", 72.0)]
            run_id = await temp_db.save_scan_run(
                scan_timestamp=datetime.now(timezone.utc),
                btc_regime="NEUTRAL",
                mode="fast",
                total_symbols=100,
                scan_duration_seconds=45.0,
                candidates=candidates,
            )
            assert isinstance(run_id, int)

            latest = await temp_db.get_latest_scan()
            assert latest is not None
            assert latest["btc_regime"] == "NEUTRAL"
            assert len(latest["candidates"]) == 2
            syms = [c["symbol"] for c in latest["candidates"]]
            assert "AAVEUSDT" in syms
            assert "SHIBUSDT" in syms

        asyncio.run(_run())

    def test_candidates_sorted_by_score(self, temp_db):
        """Candidates must be returned sorted by setup_score descending."""
        async def _run():
            await temp_db.init()
            candidates = [
                _make_candidate("LOW", 50.0),
                _make_candidate("HIGH", 90.0),
                _make_candidate("MID", 70.0),
            ]
            await temp_db.save_scan_run(
                scan_timestamp=datetime.now(timezone.utc),
                btc_regime="NEUTRAL",
                mode="fast",
                total_symbols=100,
                scan_duration_seconds=30.0,
                candidates=candidates,
            )
            latest = await temp_db.get_latest_scan()
            scores = [c["setup_score"] for c in latest["candidates"]]
            assert scores == sorted(scores, reverse=True), "Candidates not sorted by score"

        asyncio.run(_run())

    def test_empty_db_returns_none(self, temp_db):
        """get_latest_scan on empty DB should return None."""
        async def _run():
            await temp_db.init()
            result = await temp_db.get_latest_scan()
            assert result is None

        asyncio.run(_run())

    def test_stats_returned(self, temp_db):
        """Stats should return a dict with expected keys."""
        async def _run():
            await temp_db.init()
            stats = await temp_db.get_stats()
            assert "scan_runs" in stats
            assert "scan_results" in stats
            assert "db_size_bytes" in stats

        asyncio.run(_run())

    def test_symbol_history(self, temp_db):
        """Symbol history should return records for that symbol."""
        async def _run():
            await temp_db.init()
            candidates = [_make_candidate("AAVEUSDT", 75.0)]
            await temp_db.save_scan_run(
                scan_timestamp=datetime.now(timezone.utc),
                btc_regime="NEUTRAL",
                mode="fast",
                total_symbols=50,
                scan_duration_seconds=20.0,
                candidates=candidates,
            )
            history = await temp_db.get_symbol_history("AAVEUSDT")
            assert len(history) >= 1
            assert history[0]["symbol"] == "AAVEUSDT"

        asyncio.run(_run())

    def test_cascade_delete_on_prune(self, temp_db):
        """Pruning scan_runs should cascade-delete scan_results."""
        async def _run():
            await temp_db.init()
            # Insert old scan
            import aiosqlite
            async with aiosqlite.connect(temp_db._path) as db:
                await db.execute("PRAGMA foreign_keys=ON;")
                cursor = await db.execute(
                    "INSERT INTO scan_runs (scan_timestamp, btc_regime, mode, total_symbols, scan_duration_seconds, candidate_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("2020-01-01T00:00:00", "NEUTRAL", "fast", 50, 30.0, 1, "2020-01-01T00:00:00"),
                )
                old_run_id = cursor.lastrowid
                await db.execute(
                    "INSERT INTO scan_results (scan_run_id, symbol, setup_score, pump_score, status, alert_label, price, candle_status, btc_regime, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (old_run_id, "TEST", 50.0, 40.0, "WATCH", "🟡 WATCH", 1.0, "CLOSED", "NEUTRAL", "{}"),
                )
                await db.commit()

            # Prune should delete the old run
            await temp_db.prune()

            async with aiosqlite.connect(temp_db._path) as db:
                await db.execute("PRAGMA foreign_keys=ON;")
                cursor = await db.execute("SELECT COUNT(*) FROM scan_results WHERE scan_run_id = ?", (old_run_id,))
                count = (await cursor.fetchone())[0]
                assert count == 0, "Cascade delete should have removed old results"

        asyncio.run(_run())
