"""
CLI entrypoint for the scanner.
Usage:
    python scripts/scanner.py scan               # Run one scan (fast mode)
    python scripts/scanner.py scan --mode deep   # Deep scan
    python scripts/scanner.py run                # Continuous daemon
    python scripts/scanner.py serve              # Start FastAPI server
    python scripts/scanner.py status             # Show DB stats
"""
from __future__ import annotations

import asyncio
import logging
import signal
import sys
import time
from pathlib import Path

# Add parent to path so we can import app.*
sys.path.insert(0, str(Path(__file__).parent.parent))

import typer
from rich.console import Console
from rich.table import Table
from rich.live import Live

from app.config import cfg
from app.scanner import run_scan
from app.storage.database import get_db
from app.alerts.telegram import send_alert, send_scan_summary

app = typer.Typer(
    name="pump-scanner",
    help="Binance Pre-Pump Scanner CLI",
    rich_markup_mode="rich",
)
console = Console()

logging.basicConfig(
    level=getattr(logging, str(cfg("logging", "level", default="INFO"))),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


def _render_table(candidates: list) -> Table:
    table = Table(
        title="Pre-Pump Candidates",
        show_header=True,
        header_style="bold cyan",
    )
    table.add_column("#", style="dim", width=3)
    table.add_column("Symbol", style="bold white", width=12)
    table.add_column("Label", width=28)
    table.add_column("Setup", justify="right", style="green")
    table.add_column("Pump", justify="right", style="yellow")
    table.add_column("Vol×10", justify="right")
    table.add_column("OI 1h", justify="right")
    table.add_column("1h Chg", justify="right")
    table.add_column("Compr%", justify="right")

    for i, c in enumerate(candidates[:20], 1):
        oi_str = f"{c.get('oi_change_1h', 0) or 0:+.1f}%" if c.get("oi_change_1h") is not None else "N/A"
        table.add_row(
            str(i),
            c.get("symbol", ""),
            c.get("alert_label", ""),
            f"{c.get('setup_score', 0):.0f}",
            f"{c.get('pump_score', 0):.0f}",
            f"{c.get('volume_ratio_10', 1):.1f}×",
            oi_str,
            f"{c.get('change_1h', 0):+.2f}%",
            f"{c.get('compression_range_pct', 0):.2f}%",
        )
    return table


@app.command()
def scan(
    mode: str = typer.Option("fast", help="fast | deep | next-pump"),
    no_db: bool = typer.Option(False, help="Skip database save"),
    no_alert: bool = typer.Option(False, help="Skip Telegram alerts"),
):
    """Run a single scan and display results."""
    console.print(f"[bold cyan]Starting scan (mode={mode})...[/bold cyan]")

    async def _run():
        result = await run_scan(mode=mode)

        # Display results
        data = result.to_dict()
        candidates = data["candidates"]

        console.print(f"\n[green]✓ Scan complete in {data['scan_duration_seconds']:.1f}s[/green]")
        console.print(f"  BTC Regime: [bold]{data['btc_regime']}[/bold]")
        console.print(f"  Symbols scanned: {data['total_symbols_scanned']}")
        console.print(f"  Candidates: {len(candidates)}\n")

        if candidates:
            table = _render_table(candidates)
            console.print(table)
        else:
            console.print("[yellow]No candidates found this scan.[/yellow]")

        # Save to DB
        if not no_db:
            db = await get_db()
            run_id = await db.save_scan_run(
                scan_timestamp=result.scan_timestamp,
                btc_regime=result.btc_regime.value,
                mode=result.mode,
                total_symbols=result.total_symbols,
                scan_duration_seconds=result.scan_duration_seconds,
                candidates=result.candidates,
            )
            console.print(f"[dim]Saved to database (run_id={run_id})[/dim]")

        # Send alerts
        if not no_alert:
            sent = 0
            for candidate in result.candidates:
                if await send_alert(candidate):
                    sent += 1
            if sent:
                console.print(f"[green]Sent {sent} Telegram alert(s)[/green]")

    asyncio.run(_run())


@app.command()
def run(
    mode: str = typer.Option("fast", help="fast | deep | next-pump"),
    interval: int = typer.Option(0, help="Override scan interval seconds (0=use config)"),
):
    """
    Run continuous daemon. Scans every N seconds.
    Press Ctrl+C to stop.
    """
    scan_interval = interval or int(cfg("scanner", "scan_interval_seconds", default=120))
    console.print(
        f"[bold cyan]Starting scanner daemon (mode={mode}, interval={scan_interval}s)[/bold cyan]"
    )
    console.print("[dim]Press Ctrl+C to stop[/dim]\n")

    running = True

    def _stop(sig, frame):
        nonlocal running
        running = False
        console.print("\n[yellow]Stopping...[/yellow]")

    signal.signal(signal.SIGINT, _stop)

    async def _daemon():
        nonlocal running
        while running:
            try:
                console.print(f"[dim]{__import__('datetime').datetime.now().strftime('%H:%M:%S')} — Scanning...[/dim]")
                result = await run_scan(mode=mode)

                candidates = result.candidates
                data = result.to_dict()

                console.print(
                    f"[green]✓ {data['scan_duration_seconds']:.1f}s — "
                    f"{len(candidates)} candidates — BTC: {data['btc_regime']}[/green]"
                )

                # Display top 5
                top5 = candidates[:5]
                for c in top5:
                    cd = c.to_dict()
                    console.print(
                        f"  {cd['alert_label']:30s} {cd['symbol']:12s} "
                        f"Score={cd['setup_score']:.0f} Vol={cd['volume_ratio_10']:.1f}× "
                        f"1h={cd['change_1h']:+.2f}%"
                    )

                # Save & alert
                db = await get_db()
                await db.save_scan_run(
                    scan_timestamp=result.scan_timestamp,
                    btc_regime=result.btc_regime.value,
                    mode=result.mode,
                    total_symbols=result.total_symbols,
                    scan_duration_seconds=result.scan_duration_seconds,
                    candidates=candidates,
                )

                for candidate in candidates:
                    await send_alert(candidate)

                await send_scan_summary(candidates, result.btc_regime.value)

            except Exception as e:
                logger.error("Scan iteration failed: %s", e, exc_info=True)
                console.print(f"[red]Error: {e}[/red]")

            if not running:
                break

            console.print(f"[dim]Next scan in {scan_interval}s[/dim]")
            await asyncio.sleep(scan_interval)

    asyncio.run(_daemon())


@app.command()
def serve(
    host: str = typer.Option("0.0.0.0", help="Host to bind"),
    port: int = typer.Option(8000, help="Port to listen on"),
    reload: bool = typer.Option(False, help="Enable auto-reload (dev only)"),
):
    """Start the FastAPI server."""
    import uvicorn
    console.print(f"[bold cyan]Starting FastAPI server on {host}:{port}[/bold cyan]")
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level=str(cfg("logging", "level", default="info")).lower(),
    )


@app.command()
def status():
    """Show database statistics and scanner status."""
    async def _status():
        db = await get_db()
        stats = await db.get_stats()
        history = await db.get_scan_history(limit=5)

        console.print("\n[bold cyan]Scanner Status[/bold cyan]")
        console.print(f"  DB path: {db._path}")
        console.print(f"  DB size: {stats['db_size_mb']} MB")
        console.print(f"  Scan runs: {stats['scan_runs']}")
        console.print(f"  Scan results: {stats['scan_results']}")
        console.print(f"  Alert log: {stats['alert_log_entries']}")

        if history:
            console.print("\n[bold]Recent Scans:[/bold]")
            for h in history:
                console.print(
                    f"  {h['scan_timestamp'][:19]} | {h['mode']:8s} | "
                    f"{h['candidate_count']} candidates | {h['scan_duration_seconds']:.1f}s | BTC={h['btc_regime']}"
                )

    asyncio.run(_status())


if __name__ == "__main__":
    app()
