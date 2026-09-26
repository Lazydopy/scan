"""
Configuration loader — reads config.yaml and environment variables.
Secrets are NEVER stored in config.yaml. They come from .env / GitHub Secrets.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

# Load .env if present (local dev only — never commit .env)
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)


def _load_yaml(path: Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


@lru_cache(maxsize=1)
def get_config() -> dict[str, Any]:
    """Return merged config from config.yaml."""
    config_path = Path(__file__).parent.parent / "config.yaml"
    if not config_path.exists():
        raise FileNotFoundError(f"config.yaml not found at {config_path}")
    return _load_yaml(config_path)


def cfg(*keys: str, default: Any = None) -> Any:
    """Dot-path config accessor. cfg('scanner', 'scan_interval_seconds')"""
    data = get_config()
    for key in keys:
        if not isinstance(data, dict):
            return default
        data = data.get(key, default)
        if data is None:
            return default
    return data


# ── Secrets (from env only) ────────────────────────────────────────────────

def get_telegram_token() -> str | None:
    return os.getenv("TELEGRAM_BOT_TOKEN") or None


def get_telegram_chat_id() -> str | None:
    return os.getenv("TELEGRAM_CHAT_ID") or None


def get_webhook_secret() -> str | None:
    return os.getenv("WEBHOOK_SECRET") or None


def get_binance_api_key() -> str | None:
    return os.getenv("BINANCE_API_KEY") or None


def get_binance_api_secret() -> str | None:
    return os.getenv("BINANCE_API_SECRET") or None


def telegram_enabled() -> bool:
    """Telegram is enabled only if token and chat_id are set and config allows."""
    return (
        bool(get_telegram_token())
        and bool(get_telegram_chat_id())
        and cfg("alerts", "enabled", default=True)
    )
