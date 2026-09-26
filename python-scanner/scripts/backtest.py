"""
Backtesting Framework.
Evaluates scanner signal quality by replaying historical kline data.

Usage:
    python scripts/backtest.py run --symbol RAREUSDT --days 7
    python scripts/backtest.py run-all --days 3
    python scripts/backtest.py report

What it measures:
- Were HIGH CONVICTION PRE-BREAKOUT signals followed by a ≥5% move in the next 1-3 candles?
- False positive rate
- Average gain per signal
- Optimal score threshold
"""
from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent.parent))

import typer
from rich.console import Console
from rich.table import Table

from app.analysis.compression import analyze_compression
from app.analysis.volume import analyze_volume
from app.analysis.oi import analyze_oi
from app.analysis.recent_pump import analyze_recent_pump
from app.analysis.structure import analyze_resistance, analyze_structure
from app.analysis.funding import analyze_funding
from app.analysis.breakout import analyze_breakout
from app.analysis.trend import score_trend_1h
from app.analysis.liquidity import score_liquidity
from app.analysis.btc_filter import analyze_btc_regime
from app.config import cfg
from app.data.binance_client import BinanceClient
from app.data.market_data import closed_candles
from app.models.candidate import BTCRegime, Candidate, CandleStatus
from app.scoring.levels import calculate_levels
from app.scoring.pump_score import calculate_pump_score
from app.scoring.setup_score import calculate_setup_score, classify_status, classify_alert_label, build_reasons

logger = logging.getLogger(__name__)
app = typer.Typer(name="backtest", help="Backtest scanner signals")
console = Console()


def _parse_klines_df(raw: list) -> "pd.DataFrame":
    import pandas as pd
    from datetime import timezone
    df = pd.DataFrame(raw, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades",
        "taker_buy_base", "taker_buy_quote", "ignore"
    ])
    for col in ["open", "high", "low", "close", "volume", "quote_volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    df["close_time"] = pd.to_datetime(df["close_time"], unit="ms", utc=True)
    df["is_closed"] = True  # In backtest, all candles from history are closed
    return df


async def _score_at_index(
    symbol: str,
    df_all: "pd.DataFrame",
    df_1h: "pd.DataFrame",
    i: int,
    client: BinanceClient,
) -> Optional[Candidate]:
    """Score a symbol as if we were at candle index i."""
    import pandas as pd
    if i < 50:
        return None  # Not enough history

    df_slice = df_all.iloc[:i].copy()

    candidate = Candidate()
    candidate.symbol = symbol
    candidate.scan_timestamp = df_slice["open_time"].iloc[-1].to_pydatetime()
    candidate.price = float(df_slice["close"].iloc[-1])
    candidate.btc_regime = BTCRegime.NEUTRAL
    candidate.candle_status = CandleStatus.CLOSED

    candidate.compression = analyze_compression(df_slice)
    candidate.volume = analyze_volume(df_slice)
    candidate.structure = analyze_structure(df_slice)
    candidate.resistance = analyze_resistance(df_slice, candidate.price)
    candidate.oi = analyze_oi([], df_slice)  # OI not available in backtest
    candidate.funding = analyze_funding(None)
    candidate.recent_pump = analyze_recent_pump(df_slice)
    candidate.breakout = analyze_breakout(df_slice, pd.DataFrame(), candidate.resistance.level, candidate.recent_pump.is_extended)
    candidate.score_breakdown.liquidity = 4.0  # Assume adequate
    candidate.score_breakdown.trend_1h = score_trend_1h(df_1h.iloc[: max(1, i // 3)])

    candidate.levels = calculate_levels(
        df_slice,
        candidate.structure.local_support,
        candidate.structure.secondary_support,
        candidate.resistance.level,
        candidate.price,
    )

    setup_score, breakdown = calculate_setup_score(candidate)
    candidate.setup_score = setup_score
    candidate.score_breakdown = breakdown
    candidate.pump_score = calculate_pump_score(candidate, None, pd.DataFrame())
    candidate.status = classify_status(setup_score, candidate)
    candidate.alert_label = classify_alert_label(setup_score, candidate.status)
    candidate.reasons = build_reasons(candidate)

    return candidate


@app.command()
def run(
    symbol: str = typer.Option("RAREUSDT", help="Symbol to backtest"),
    days: int = typer.Option(7, help="Days of history to use"),
    min_score: float = typer.Option(70.0, help="Min setup score for a signal"),
    forward_candles: int = typer.Option(3, help="Candles forward to measure outcome"),
    target_pct: float = typer.Option(3.0, help="% gain to count as a win"),
):
    """Backtest scanner signals for a single symbol."""

    async def _run():
        import pandas as pd
        symbol_upper = symbol.upper()
        limit = days * 24 * 4 + 50  # 15m candles

        console.print(f"[cyan]Fetching {limit} x 15m candles for {symbol_upper}...[/cyan]")

        async with BinanceClient() as client:
            raw_15m = await client.get_futures_klines(symbol_upper, "15m", limit=min(limit, 1000))
            raw_1h = await client.get_futures_klines(symbol_upper, "1h", limit=200)

        df_all = _parse_klines_df(raw_15m)
        df_1h = _parse_klines_df(raw_1h)

        console.print(f"[green]Loaded {len(df_all)} candles.[/green]")

        signals = []
        console.print("[cyan]Evaluating signals...[/cyan]")

        async with BinanceClient() as client:
            for i in range(60, len(df_all) - forward_candles):
                candidate = await _score_at_index(symbol_upper, df_all, df_1h, i, client)
                if candidate is None:
                    continue
                if candidate.setup_score >= min_score:
                    # Measure forward outcome
                    entry_price = float(df_all["close"].iloc[i])
                    future_slice = df_all.iloc[i + 1: i + 1 + forward_candles]
                    max_price = float(future_slice["high"].max()) if not future_slice.empty else entry_price
                    max_gain_pct = (max_price - entry_price) / entry_price * 100 if entry_price > 0 else 0

                    signals.append({
                        "timestamp": candidate.scan_timestamp.isoformat()[:16],
                        "setup_score": candidate.setup_score,
                        "pump_score": candidate.pump_score,
                        "status": candidate.status.value,
                        "entry_price": entry_price,
                        "max_gain_pct": round(max_gain_pct, 2),
                        "win": max_gain_pct >= target_pct,
                        "reasons": candidate.reasons[:2],
                    })

        if not signals:
            console.print(f"[yellow]No signals above score {min_score} found.[/yellow]")
            return

        wins = [s for s in signals if s["win"]]
        losses = [s for s in signals if not s["win"]]
        win_rate = len(wins) / len(signals) * 100 if signals else 0
        avg_gain = sum(s["max_gain_pct"] for s in signals) / len(signals)
        avg_gain_wins = sum(s["max_gain_pct"] for s in wins) / len(wins) if wins else 0

        # Table
        table = Table(title=f"Backtest: {symbol_upper} | {days}d | Score≥{min_score} | Fwd={forward_candles}c | Target={target_pct}%")
        table.add_column("Time", style="dim", width=16)
        table.add_column("Setup", justify="right", style="green")
        table.add_column("Pump", justify="right")
        table.add_column("Status", width=14)
        table.add_column("Entry", justify="right")
        table.add_column("Max Gain%", justify="right")
        table.add_column("Win?", justify="center")

        for s in signals[-30:]:  # Show last 30
            table.add_row(
                s["timestamp"],
                f"{s['setup_score']:.0f}",
                f"{s['pump_score']:.0f}",
                s["status"],
                f"${s['entry_price']:.4g}",
                f"{s['max_gain_pct']:+.2f}%",
                "✅" if s["win"] else "❌",
            )

        console.print(table)
        console.print(f"\n[bold]Summary:[/bold]")
        console.print(f"  Total signals: {len(signals)}")
        console.print(f"  Wins: {len(wins)} ({win_rate:.1f}%)")
        console.print(f"  Avg max gain (all): {avg_gain:+.2f}%")
        console.print(f"  Avg max gain (wins): {avg_gain_wins:+.2f}%")

    asyncio.run(_run())


@app.command()
def run_all(
    days: int = typer.Option(3, help="Days of history"),
    min_score: float = typer.Option(70.0, help="Min setup score"),
    symbols: str = typer.Option(
        "RAREUSDT,SCRTUSDT,ENAUSDT,JUPUSDT,WIFUSDT",
        help="Comma-separated symbols",
    ),
):
    """Backtest across multiple symbols."""
    sym_list = [s.strip().upper() for s in symbols.split(",")]
    for sym in sym_list:
        console.print(f"\n[bold]Backtesting {sym}...[/bold]")
        try:
            typer.main.get_command(app)([
                "run", "--symbol", sym,
                "--days", str(days),
                "--min-score", str(min_score),
            ], standalone_mode=False)
        except Exception as e:
            console.print(f"[red]Error for {sym}: {e}[/red]")


if __name__ == "__main__":
    app()
