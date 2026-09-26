"""
Pydantic-style dataclasses for scanner candidates and analysis results.
Using Python dataclasses (no pydantic required) for zero extra dependency.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class Status(str, Enum):
    PRE_BREAKOUT = "PRE-BREAKOUT"
    BREAKOUT = "BREAKOUT"
    BREAKOUT_CONFIRMED = "BREAKOUT_CONFIRMED"
    WATCH = "WATCH"
    EXTENDED = "EXTENDED"
    FAILED = "FAILED"
    AVOID = "AVOID"
    WEAK = "WEAK"


class BTCRegime(str, Enum):
    BULLISH = "BULLISH"
    NEUTRAL = "NEUTRAL"
    BEARISH = "BEARISH"


class CandleStatus(str, Enum):
    CLOSED = "CLOSED"
    UNFINISHED = "UNFINISHED"


class Risk(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class OIClassification(str, Enum):
    PRICE_UP_OI_UP = "PRICE_UP_OI_UP"
    PRICE_UP_OI_DOWN = "PRICE_UP_OI_DOWN"
    PRICE_FLAT_OI_UP = "PRICE_FLAT_OI_UP"
    PRICE_DOWN_OI_UP = "PRICE_DOWN_OI_UP"
    PRICE_UP_OI_FLAT = "PRICE_UP_OI_FLAT"
    OI_UNAVAILABLE = "OI_UNAVAILABLE"
    NORMAL = "NORMAL"


@dataclass
class ScoreBreakdown:
    """Individual component scores — nothing is a black box."""
    compression: float = 0.0          # 0-15
    volume: float = 0.0               # 0-15
    breakout_structure: float = 0.0   # 0-15
    oi_behavior: float = 0.0          # 0-20
    price_oi_divergence: float = 0.0  # 0-10
    funding: float = 0.0              # 0-5
    liquidity: float = 0.0            # 0-5
    trend_1h: float = 0.0             # 0-5
    distance_from_pump: float = 0.0   # 0-10

    @property
    def total(self) -> float:
        return (
            self.compression + self.volume + self.breakout_structure +
            self.oi_behavior + self.price_oi_divergence + self.funding +
            self.liquidity + self.trend_1h + self.distance_from_pump
        )


@dataclass
class CompressionResult:
    is_compressed: bool = False
    compression_range_pct: float = 0.0   # (high-low)/low as %
    atr_ratio: float = 1.0               # recent_atr / historical_atr
    normalized_atr: float = 0.0
    candles_in_range: int = 0
    higher_lows: bool = False
    higher_highs: bool = False
    lower_lows: bool = False
    resistance_tests: int = 0
    score: float = 0.0                   # 0-15


@dataclass
class VolumeResult:
    current_volume: float = 0.0
    median_10: float = 0.0
    median_20: float = 0.0
    mean_20: float = 0.0
    volume_ratio_10: float = 1.0
    volume_ratio_20: float = 1.0
    volume_trend: str = "FLAT"           # RISING | FLAT | DECLINING
    is_expanding: bool = False
    score: float = 0.0                   # 0-15


@dataclass
class StructureResult:
    swing_lows: list[float] = field(default_factory=list)
    swing_highs: list[float] = field(default_factory=list)
    higher_lows: bool = False
    lower_lows: bool = False
    flat_lows: bool = False
    higher_highs: bool = False
    lower_highs: bool = False
    local_support: float = 0.0
    secondary_support: float = 0.0
    invalidation: float = 0.0


@dataclass
class ResistanceResult:
    level: float = 0.0
    distance_pct: float = 0.0           # % distance from current price
    tests: int = 0
    candles_since_last_test: int = 999
    is_well_defined: bool = False
    breakout_level: float = 0.0


@dataclass
class OIResult:
    oi_current: float = 0.0
    oi_change_5m: Optional[float] = None
    oi_change_15m: Optional[float] = None
    oi_change_30m: Optional[float] = None
    oi_change_1h: Optional[float] = None
    classification: OIClassification = OIClassification.OI_UNAVAILABLE
    price_oi_signal: float = 0.0        # -1 to +1
    is_available: bool = False
    score: float = 0.0                  # 0-20


@dataclass
class FundingResult:
    rate: Optional[float] = None
    is_available: bool = False
    interpretation: str = "NEUTRAL"
    score: float = 0.0                  # 0-5


@dataclass
class RecentPumpResult:
    change_15m: float = 0.0
    change_30m: float = 0.0
    change_45m: float = 0.0
    change_1h: float = 0.0
    change_3h: float = 0.0
    largest_15m_candle: float = 0.0
    largest_3_candle_move: float = 0.0
    is_extended: bool = False
    is_heavy_extended: bool = False
    candles_since_expansion: int = 999
    score: float = 0.0                  # 0-10


@dataclass
class BreakoutResult:
    status: Status = Status.WATCH
    breakout_level: float = 0.0
    distance_to_breakout_pct: float = 0.0
    is_false_breakout: bool = False
    upper_wick_ratio: float = 0.0
    score: float = 0.0                  # 0-15


@dataclass
class Levels:
    current_price: float = 0.0
    support: float = 0.0
    secondary_support: float = 0.0
    resistance: float = 0.0
    breakout_level: float = 0.0
    invalidation: float = 0.0
    target1: float = 0.0
    target2: float = 0.0
    target_method: str = "atr_projection"


@dataclass
class Candidate:
    """Complete candidate result from scanner."""
    # Identity
    symbol: str = ""
    scan_timestamp: datetime = field(default_factory=datetime.utcnow)
    binance_timestamp: Optional[datetime] = None
    candle_status: CandleStatus = CandleStatus.CLOSED

    # Price
    price: float = 0.0

    # Analysis results
    compression: CompressionResult = field(default_factory=CompressionResult)
    volume: VolumeResult = field(default_factory=VolumeResult)
    structure: StructureResult = field(default_factory=StructureResult)
    resistance: ResistanceResult = field(default_factory=ResistanceResult)
    oi: OIResult = field(default_factory=OIResult)
    funding: FundingResult = field(default_factory=FundingResult)
    recent_pump: RecentPumpResult = field(default_factory=RecentPumpResult)
    breakout: BreakoutResult = field(default_factory=BreakoutResult)
    levels: Levels = field(default_factory=Levels)

    # Scores
    score_breakdown: ScoreBreakdown = field(default_factory=ScoreBreakdown)
    setup_score: float = 0.0        # 0-100
    pump_score: float = 0.0         # 0-100

    # Classification
    status: Status = Status.WEAK
    risk: Risk = Risk.HIGH
    btc_regime: BTCRegime = BTCRegime.NEUTRAL

    # Why this candidate was selected
    reasons: list[str] = field(default_factory=list)

    # Alert tracking
    alert_label: str = "🟡 WATCH"

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return {
            "symbol": self.symbol,
            "scan_timestamp": self.scan_timestamp.isoformat(),
            "candle_status": self.candle_status.value,
            "price": self.price,
            "setup_score": round(self.setup_score, 1),
            "pump_score": round(self.pump_score, 1),
            "status": self.status.value,
            "risk": self.risk.value,
            "btc_regime": self.btc_regime.value,
            "alert_label": self.alert_label,
            "reasons": self.reasons,

            # Changes
            "change_15m": round(self.recent_pump.change_15m, 3),
            "change_30m": round(self.recent_pump.change_30m, 3),
            "change_1h": round(self.recent_pump.change_1h, 3),
            "change_3h": round(self.recent_pump.change_3h, 3),

            # Volume
            "volume_ratio_10": round(self.volume.volume_ratio_10, 2),
            "volume_ratio_20": round(self.volume.volume_ratio_20, 2),
            "volume_trend": self.volume.volume_trend,

            # OI
            "oi_change_15m": self.oi.oi_change_15m,
            "oi_change_1h": self.oi.oi_change_1h,
            "oi_classification": self.oi.classification.value,
            "oi_signal": round(self.oi.price_oi_signal, 3),

            # Funding
            "funding_rate": self.funding.rate,
            "funding_interpretation": self.funding.interpretation,

            # Compression
            "compression_range_pct": round(self.compression.compression_range_pct, 3),
            "atr_ratio": round(self.compression.atr_ratio, 3),
            "is_compressed": self.compression.is_compressed,
            "higher_lows": self.compression.higher_lows,
            "resistance_tests": self.compression.resistance_tests,

            # Levels
            "support": self.levels.support,
            "resistance": self.levels.resistance,
            "breakout_level": self.levels.breakout_level,
            "invalidation": self.levels.invalidation,
            "target1": self.levels.target1,
            "target2": self.levels.target2,
            "target_method": self.levels.target_method,
            "distance_to_breakout_pct": round(self.resistance.distance_pct, 3),

            # Score breakdown
            "score_breakdown": {
                "compression": self.score_breakdown.compression,
                "volume": self.score_breakdown.volume,
                "breakout_structure": self.score_breakdown.breakout_structure,
                "oi_behavior": self.score_breakdown.oi_behavior,
                "price_oi_divergence": self.score_breakdown.price_oi_divergence,
                "funding": self.score_breakdown.funding,
                "liquidity": self.score_breakdown.liquidity,
                "trend_1h": self.score_breakdown.trend_1h,
                "distance_from_pump": self.score_breakdown.distance_from_pump,
            },
        }
