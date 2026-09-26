# Binance Pre-Pump Scanner — Python Engine

Production-quality Python scanner that identifies **EARLY conditions preceding 15-minute price explosions** on Binance USDT perpetual futures.

---

## Architecture

```
Your PC (Residential IP)          GitHub                    Vercel
─────────────────────────         ──────                    ──────
run-python-scanner.bat  ──────>  GitHub Actions  ──────>  Next.js Display
  Python daemon runs              (cron trigger)            Reads from SQLite
  every 2 min                                               or via API
  Analyzes 50-150 symbols
  Pushes Telegram alerts
  Saves to SQLite
```

---

## Quick Start

### 1. Setup

```bash
cd python-scanner
python -m venv .venv
.venv\Scripts\activate       # Windows
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
```

### 2. Run a single scan

```bash
python scripts/scanner.py scan --mode fast
```

### 3. Run continuously (daemon)

```bash
python scripts/scanner.py run --mode fast
```

Or just double-click **`run-python-scanner.bat`** in the repo root.

### 4. Start the API server (for Vercel display)

```bash
python scripts/scanner.py serve
```

Or double-click **`run-api-server.bat`**.

### 5. Run backtest

```bash
python scripts/backtest.py run --symbol RAREUSDT --days 7 --min-score 70
```

---

## CLI Reference

```
python scripts/scanner.py scan [--mode fast|deep|next-pump] [--no-db] [--no-alert]
python scripts/scanner.py run  [--mode fast] [--interval 120]
python scripts/scanner.py serve [--port 8000]
python scripts/scanner.py status
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| GET | `/api/scan` | Latest scan results |
| GET | `/api/scan/history` | Recent scan run summaries |
| POST | `/api/scan/trigger` | Trigger manual scan (webhook) |
| GET | `/api/symbol/{symbol}` | Single symbol detail |
| GET | `/api/symbol/{symbol}/history` | Symbol score history |
| GET | `/api/btc-status` | BTC market regime |
| GET | `/api/stats` | DB and scanner stats |
| GET | `/api/health` | Detailed health check |

---

## Scan Modes

| Mode | Symbols | Use Case |
|------|---------|----------|
| `fast` | Top 50 by volume | Every 2 min continuous monitoring |
| `deep` | All 150 | Thorough hourly scan |
| `next-pump` | Top 80 by volume | Balanced — default for GitHub Actions |

---

## Scoring System

### SETUP_SCORE (0-100)
Measures how ideal the pre-pump setup conditions are.

| Component | Max | Signal |
|-----------|-----|--------|
| compression | 15 | Tight range, ATR contraction |
| volume | 15 | Volume expansion vs median |
| breakout_structure | 15 | Distance and quality of breakout setup |
| oi_behavior | 20 | OI rising while price flat (accumulation) |
| price_oi_divergence | 10 | Price/OI relationship signal |
| funding | 5 | Negative funding = squeeze setup |
| liquidity | 5 | 24h volume filter |
| trend_1h | 5 | 1h EMA and structure context |
| distance_from_pump | 10 | How far from last pump (higher = better) |

### PUMP_SCORE (0-100)
Measures **right-now momentum** using the current unfinished candle.

---

## Alert Labels

| Label | Meaning |
|-------|---------|
| 🔥 HIGH CONVICTION PRE-BREAKOUT | Score ≥ 85, compressed, approaching resistance |
| 🟠 PRE-BREAKOUT SETUP | Score ≥ 70, good structure |
| 🟡 WATCH | Score 55-70, building setup |
| ⚡ BREAKOUT | Just broke resistance |
| 🚀 BREAKOUT CONFIRMED | Two closes above + volume |
| 🔴 EXTENDED | Already pumped — do not chase |
| ❌ FAILED BREAKOUT | Wick above resistance, closed below |

---

## GitHub Actions + cron-job.org Setup

1. In your GitHub repo → Settings → Secrets → add:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `WEBHOOK_SECRET`

2. Go to [cron-job.org](https://cron-job.org) and create a job:
   - URL: `https://api.github.com/repos/{owner}/{repo}/dispatches`
   - Method: POST
   - Headers: `Authorization: Bearer {YOUR_GITHUB_PAT}` and `Content-Type: application/json`
   - Body: `{"event_type": "trigger-scan", "client_payload": {"mode": "fast"}}`
   - Schedule: Every 15 minutes

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes (for alerts) | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes (for alerts) | Your chat/channel ID |
| `WEBHOOK_SECRET` | Optional | Protects POST /api/scan/trigger |
| `BINANCE_API_KEY` | No | Only needed for private endpoints |

---

## Key Design Principles

1. **Closed candles only** — Scoring never uses the current unfinished candle (except PUMP_SCORE, which explicitly labels it)
2. **No fabrication** — OI, funding marked `_UNAVAILABLE` rather than invented
3. **Transparent scoring** — Every score has a detailed breakdown with reasons
4. **Residential IP** — Scanner runs on your local machine, bypassing Binance datacenter blocks
5. **No chasing** — `recent_pump` filter aggressively penalizes already-extended coins
6. **BTC regime** — All alt scores adjusted by BTC market conditions

---

## Running Tests

```bash
python -m pytest tests/ -v --tb=short
```

Or double-click **`run-tests.bat`**.
