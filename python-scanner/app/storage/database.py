"""
SQLite Storage Layer.
Stores scan runs and candidate results for:
- Frontend API consumption
- Backtesting and analysis
- Historical alert tracking

Auto-prunes old data to stay within free tier constraints.
Uses aiosqlite for async operations.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import aiosqlite

from app.config import cfg
from app.models.candidate import Candidate

logger = logging.getLogger(__name__)


def _db_path() -> Path:
    db_rel = str(cfg("database", "path", default="data/scanner.db"))
    base = Path(__file__).parent.parent.parent
    path = base / db_rel
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


CREATE_SCAN_RUNS = """
CREATE TABLE IF NOT EXISTS scan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_timestamp TEXT NOT NULL,
    btc_regime TEXT NOT NULL,
    mode TEXT NOT NULL,
    total_symbols INTEGER NOT NULL,
    scan_duration_seconds REAL NOT NULL,
    candidate_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

CREATE_SCAN_RESULTS = """
CREATE TABLE IF NOT EXISTS scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_run_id INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    setup_score REAL NOT NULL,
    pump_score REAL NOT NULL,
    status TEXT NOT NULL,
    alert_label TEXT NOT NULL,
    price REAL NOT NULL,
    candle_status TEXT NOT NULL,
    btc_regime TEXT NOT NULL,
    payload TEXT NOT NULL,   -- full candidate JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

CREATE_ALERT_LOG = """
CREATE TABLE IF NOT EXISTS alert_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    setup_score REAL NOT NULL,
    pump_score REAL NOT NULL,
    status TEXT NOT NULL,
    alert_sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

CREATE_INDICES = [
    "CREATE INDEX IF NOT EXISTS idx_scan_results_run_id ON scan_results(scan_run_id);",
    "CREATE INDEX IF NOT EXISTS idx_scan_results_symbol ON scan_results(symbol);",
    "CREATE INDEX IF NOT EXISTS idx_scan_results_score ON scan_results(setup_score DESC);",
    "CREATE INDEX IF NOT EXISTS idx_alert_log_symbol ON alert_log(symbol);",
]


class Database:
    def __init__(self) -> None:
        self._path = _db_path()

    async def init(self) -> None:
        """Initialize schema."""
        async with aiosqlite.connect(self._path) as db:
            await db.execute("PRAGMA journal_mode=WAL;")
            await db.execute("PRAGMA foreign_keys=ON;")
            await db.execute(CREATE_SCAN_RUNS)
            await db.execute(CREATE_SCAN_RESULTS)
            await db.execute(CREATE_ALERT_LOG)
            for idx in CREATE_INDICES:
                await db.execute(idx)
            await db.commit()
        logger.info("Database initialized at %s", self._path)

    async def save_scan_run(
        self,
        scan_timestamp: datetime,
        btc_regime: str,
        mode: str,
        total_symbols: int,
        scan_duration_seconds: float,
        candidates: list[Candidate],
    ) -> int:
        """Save a complete scan run and its candidates. Returns the run ID."""
        async with aiosqlite.connect(self._path) as db:
            await db.execute("PRAGMA foreign_keys=ON;")

            # Insert scan run
            cursor = await db.execute(
                """
                INSERT INTO scan_runs
                    (scan_timestamp, btc_regime, mode, total_symbols,
                     scan_duration_seconds, candidate_count)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    scan_timestamp.isoformat(),
                    btc_regime,
                    mode,
                    total_symbols,
                    scan_duration_seconds,
                    len(candidates),
                ),
            )
            run_id = cursor.lastrowid

            # Insert candidates
            for c in candidates:
                payload = json.dumps(c.to_dict())
                await db.execute(
                    """
                    INSERT INTO scan_results
                        (scan_run_id, symbol, setup_score, pump_score, status,
                         alert_label, price, candle_status, btc_regime, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        c.symbol,
                        c.setup_score,
                        c.pump_score,
                        c.status.value,
                        c.alert_label,
                        c.price,
                        c.candle_status.value,
                        c.btc_regime.value,
                        payload,
                    ),
                )

            await db.commit()

        logger.info("Saved scan run %d with %d candidates", run_id, len(candidates))
        await self.prune()
        return run_id

    async def get_latest_scan(self) -> Optional[dict]:
        """Return the latest scan run with all its candidates."""
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row

            # Get latest run
            cursor = await db.execute(
                "SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1"
            )
            run = await cursor.fetchone()
            if not run:
                return None

            run_id = run["id"]

            # Get candidates for this run
            cursor = await db.execute(
                """
                SELECT payload FROM scan_results
                WHERE scan_run_id = ?
                ORDER BY setup_score DESC
                """,
                (run_id,),
            )
            rows = await cursor.fetchall()
            candidates = [json.loads(r["payload"]) for r in rows]

            return {
                "scan_timestamp": run["scan_timestamp"],
                "btc_regime": run["btc_regime"],
                "mode": run["mode"],
                "total_symbols_scanned": run["total_symbols"],
                "scan_duration_seconds": run["scan_duration_seconds"],
                "candidates": candidates,
            }

    async def get_scan_history(self, limit: int = 20) -> list[dict]:
        """Return recent scan run summaries (without candidate detail)."""
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT id, scan_timestamp, btc_regime, mode,
                       total_symbols, scan_duration_seconds, candidate_count
                FROM scan_runs
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def get_symbol_history(
        self,
        symbol: str,
        limit: int = 50,
    ) -> list[dict]:
        """Return historical scan results for a single symbol."""
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT sr.symbol, sr.setup_score, sr.pump_score, sr.status,
                       sr.alert_label, sr.price, sr.created_at
                FROM scan_results sr
                JOIN scan_runs r ON sr.scan_run_id = r.id
                WHERE sr.symbol = ?
                ORDER BY sr.id DESC
                LIMIT ?
                """,
                (symbol, limit),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def log_alert(
        self,
        symbol: str,
        setup_score: float,
        pump_score: float,
        status: str,
    ) -> None:
        """Log that an alert was sent for a symbol."""
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                """
                INSERT INTO alert_log (symbol, setup_score, pump_score, status)
                VALUES (?, ?, ?, ?)
                """,
                (symbol, setup_score, pump_score, status),
            )
            await db.commit()

    async def prune(self) -> None:
        """
        Remove old scan runs beyond the configured retention window.
        Also prunes orphaned scan_results (CASCADE handles this).
        """
        max_days = int(cfg("database", "max_history_days", default=7))
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=max_days)
        ).isoformat()

        async with aiosqlite.connect(self._path) as db:
            await db.execute("PRAGMA foreign_keys=ON;")
            result = await db.execute(
                "DELETE FROM scan_runs WHERE created_at < ?", (cutoff,)
            )
            deleted = result.rowcount
            await db.commit()

        if deleted > 0:
            logger.info("Pruned %d old scan runs (older than %d days)", deleted, max_days)

    async def get_stats(self) -> dict:
        """Return database statistics."""
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            run_count = (await (await db.execute("SELECT COUNT(*) as n FROM scan_runs")).fetchone())["n"]
            result_count = (await (await db.execute("SELECT COUNT(*) as n FROM scan_results")).fetchone())["n"]
            alert_count = (await (await db.execute("SELECT COUNT(*) as n FROM alert_log")).fetchone())["n"]
            db_size_bytes = self._path.stat().st_size if self._path.exists() else 0

        return {
            "scan_runs": run_count,
            "scan_results": result_count,
            "alert_log_entries": alert_count,
            "db_size_bytes": db_size_bytes,
            "db_size_mb": round(db_size_bytes / 1024 / 1024, 2),
        }


# Global singleton
_db: Optional[Database] = None


async def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
        await _db.init()
    return _db
