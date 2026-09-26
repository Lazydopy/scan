"""
Scanner Orchestrator.
Coordinates all analysis modules and produces a ranked list of candidates.

Key invariants:
- Only CLOSED candles are used for scoring
- Unfinished (current) candles are labeled explicitly
- OI, funding marked UNAVAILABLE rather than fabricated
- BTC regime always checked first
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import pandas as pd

from app.analysis.breakout import analyze_breakout
from app.analysis.btc_filter import analyze_btc_regime
from app.analysis.compression import analyze_compression
from app.analysis.funding import analyze_funding
from app.analysis.liquidity import assess_liquidity_risk, score_liquidity
from app.analysis.oi import analyze_oi
from app.analysis.recent_pump import analyze_recent_pump
from app.analysis.structure import analyze_resistance, analyze_structure
from app.analysis.trend import score_trend_1h
from app.analysis.volume import analyze_volume
from app.config import cfg
from app.data.binance_client import BinanceClient
from app.data.market_data import MarketData, closed_candles, current_candle
from app.models.candidate import (
    BTCRegime,
    Candidate,
    CandleStatus,
    ScoreBreakdown,
)
from app.scoring.levels import calculate_levels
from app.scoring.pump_score import calculate_pump_score
from app.scoring.setup_score import (
    build_reasons,
    calculate_setup_score,
    classify_alert_label,
    classify_status,
)

logger = logging.getLogger(__name__)


class ScanResult:
    def __init__(
        self,
        candidates: list[Candidate],
        btc_regime: BTCRegime,
        scan_timestamp: datetime,
        total_symbols: int,
        scan_duration_seconds: float,
        mode: str,
    ) -> None:
        self.candidates = candidates
        self.btc_regime = btc_regime
        self.scan_timestamp = scan_timestamp
        self.total_symbols = total_symbols
        self.scan_duration_seconds = scan_duration_seconds
        self.mode = mode

    def to_dict(self) -> dict:
        return {
            "scan_timestamp": self.scan_timestamp.isoformat(),
            "btc_regime": self.btc_regime.value,
            "total_symbols_scanned": self.total_symbols,
            "scan_duration_seconds": round(self.scan_duration_seconds, 2),
            "mode": self.mode,
            "candidates": [c.to_dict() for c in self.candidates],
        }


async def _analyze_symbol(
    symbol: str,
    data: dict,
    btc_regime: BTCRegime,
) -> Optional[Candidate]:
    """
    Run all analysis modules for a single symbol.
    Returns None if data is insufficient.
    """
    try:
        klines_15m_raw: pd.DataFrame = data.get("klines_15m", pd.DataFrame())
        klines_5m_raw: pd.DataFrame = data.get("klines_5m", pd.DataFrame())
        klines_1h_raw: pd.DataFrame = data.get("klines_1h", pd.DataFrame())
        oi_history: list = data.get("oi_history", [])
        funding_rate = data.get("funding_rate")
        ticker = data.get("ticker_24h")

        # Split closed vs current candles
        df_15m = closed_candles(klines_15m_raw)
        df_5m = closed_candles(klines_5m_raw)
        df_1h = closed_candles(klines_1h_raw)
        live_candle = current_candle(klines_15m_raw)

        min_history = int(cfg("liquidity", "min_candle_history", default=50))
        if df_15m is None or len(df_15m) < min_history:
            return None

        current_price = float(df_15m["close"].iloc[-1])
        if current_price <= 0:
            return None

        candidate = Candidate()
        candidate.symbol = symbol
        candidate.scan_timestamp = datetime.now(timezone.utc)
        candidate.price = current_price
        candidate.btc_regime = btc_regime
        candidate.candle_status = (
            CandleStatus.UNFINISHED if live_candle is not None else CandleStatus.CLOSED
        )

        # ── Run all analysis engines ─────────────────────────────────────
        candidate.compression = analyze_compression(df_15m)
        candidate.volume = analyze_volume(df_15m)
        candidate.structure = analyze_structure(df_15m)
        candidate.resistance = analyze_resistance(df_15m, current_price)
        candidate.oi = analyze_oi(oi_history, df_15m)
        candidate.funding = analyze_funding(funding_rate)
        candidate.recent_pump = analyze_recent_pump(df_15m)
        candidate.breakout = analyze_breakout(
            df_15m,
            df_5m,
            candidate.resistance.level,
            candidate.recent_pump.is_extended,
        )

        # ── Liquidity & Trend scores ──────────────────────────────────────
        quote_vol = float(ticker.get("quoteVolume", 0) or 0) if ticker else None
        candidate.score_breakdown.liquidity = score_liquidity(quote_vol)
        candidate.score_breakdown.trend_1h = score_trend_1h(df_1h)
        candidate.risk = assess_liquidity_risk(quote_vol)

        # ── Calculate levels ──────────────────────────────────────────────
        candidate.levels = calculate_levels(
            df_15m,
            support=candidate.structure.local_support,
            secondary_support=candidate.structure.secondary_support,
            resistance=candidate.resistance.level,
            current_price=current_price,
        )

        # ── Calculate scores ──────────────────────────────────────────────
        liq_score = score_liquidity(quote_vol)
        trend_score = score_trend_1h(df_1h)

        setup_score, breakdown = calculate_setup_score(
            candidate,
            liquidity_score=liq_score,
            trend_score=trend_score,
        )
        candidate.setup_score = setup_score
        candidate.score_breakdown = breakdown  # breakdown now includes liquidity and trend

        candidate.pump_score = calculate_pump_score(candidate, live_candle, df_5m)
        candidate.status = classify_status(setup_score, candidate)
        candidate.alert_label = classify_alert_label(setup_score, candidate.status)
        candidate.reasons = build_reasons(candidate)

        return candidate

    except Exception as e:
        logger.warning("Analysis failed for %s: %s", symbol, e)
        return None


async def run_scan(mode: str = "fast") -> ScanResult:
    """
    Main scan entry point.
    mode: 'fast' | 'deep' | 'next-pump'
    """
    start = asyncio.get_event_loop().time()
    scan_time = datetime.now(timezone.utc)

    logger.info("=== Starting scan (mode=%s) ===", mode)

    async with BinanceClient() as client:
        market = MarketData(client)

        # ── BTC regime ────────────────────────────────────────────────────
        try:
            btc_klines_raw = await market.get_klines("BTCUSDT", "15m", limit=50)
            btc_klines_1h_raw = await market.get_klines("BTCUSDT", "1h", limit=50)
            btc_regime = analyze_btc_regime(
                closed_candles(btc_klines_raw),
                closed_candles(btc_klines_1h_raw),
            )
        except Exception as e:
            logger.warning("BTC regime fetch failed: %s — defaulting to NEUTRAL", e)
            btc_regime = BTCRegime.NEUTRAL

        logger.info("BTC regime: %s", btc_regime.value)

        # ── Symbol universe ───────────────────────────────────────────────
        symbols = await market.get_futures_universe()
        if not symbols:
            logger.error("No symbols passed liquidity filter!")
            return ScanResult([], btc_regime, scan_time, 0, 0.0, mode)

        # Mode limits
        if mode == "fast":
            symbols = symbols[:50]
        elif mode == "next-pump":
            symbols = symbols[:80]
        # else "deep" = full universe

        logger.info("Scanning %d symbols...", len(symbols))

        # ── Fetch data in batches of 10 concurrent ────────────────────────
        BATCH_SIZE = 10
        all_data: dict[str, dict] = {}

        for i in range(0, len(symbols), BATCH_SIZE):
            batch = symbols[i:i + BATCH_SIZE]
            tasks = {sym: asyncio.create_task(market.get_symbol_data(sym)) for sym in batch}
            results = await asyncio.gather(*tasks.values(), return_exceptions=True)
            for sym, result in zip(tasks.keys(), results):
                if not isinstance(result, Exception):
                    all_data[sym] = result
            # Brief pause between batches to respect rate limits
            if i + BATCH_SIZE < len(symbols):
                await asyncio.sleep(0.3)

        # ── Analyze all symbols ───────────────────────────────────────────
        analysis_tasks = [
            _analyze_symbol(sym, all_data[sym], btc_regime)
            for sym in all_data
        ]
        analysis_results = await asyncio.gather(*analysis_tasks, return_exceptions=True)

        candidates: list[Candidate] = []
        for res in analysis_results:
            if isinstance(res, Candidate) and res is not None:
                candidates.append(res)

        # ── Filter extended and filter by status ──────────────────────────
        candidates = [c for c in candidates if not c.recent_pump.is_heavy_extended]

        # ── Rank by setup_score ───────────────────────────────────────────
        candidates.sort(key=lambda c: c.setup_score, reverse=True)

        top_n = int(cfg("scanner", "top_candidates", default=20))
        candidates = candidates[:top_n]

        elapsed = asyncio.get_event_loop().time() - start
        logger.info(
            "Scan complete in %.1fs — %d candidates from %d symbols",
            elapsed, len(candidates), len(symbols)
        )

        return ScanResult(
            candidates=candidates,
            btc_regime=btc_regime,
            scan_timestamp=scan_time,
            total_symbols=len(symbols),
            scan_duration_seconds=elapsed,
            mode=mode,
        )
