import { MACDResult } from "../indicators/macd";
import { CompressionResult } from "../indicators/compression";
import { MarketStructure } from "../market-structure/levels";
import { Kline } from "../binance/api";
import { LiquidityHuntResult } from "../indicators/liquidity-hunt";
import { OverheatResult } from "../indicators/overheat";
import { MarketRegimeType } from "../market-structure/market-regime";
import { calculateEntryTiming, EntryTimingResult } from "../market-structure/entry-timing";

type ScoringInput = {
  macdState: MACDResult["state"];
  compression: CompressionResult;
  volumeRatio: number;
  structure: MarketStructure;
  oiChange: number; // percentage
  funding: number; // percentage
  klines: Kline[];
  klines1h?: Kline[];
  bias?: "BULLISH" | "BEARISH" | "NEUTRAL";
  gain24h?: number;
  liquidityHunt?: LiquidityHuntResult;
  overheat?: OverheatResult;
  marketRegime?: MarketRegimeType;
};

export type ScoreResult = {
  setupScore: number;
  pumpScore: number;
  status: string;
  pullback: number;
  goldenPocket: { top: number; bottom: number };
  entryTiming: EntryTimingResult;
  isDipReversal: boolean;
  isBullMomentum: boolean;
  isOverheated: boolean;
};

export function calculateScores(input: ScoringInput): ScoreResult {
  let setupScore = 0;
  let pumpScore = 0;

  const isFlashCrash = input.liquidityHunt?.isFlashCrashDip ?? false;
  const absorptionScore = input.liquidityHunt?.absorptionScore ?? 0;
  const isOverheated = input.overheat?.isOverheated ?? false;

  // 1. Price Compression (Max 15)
  setupScore += (input.compression.score / 100) * 15;
  pumpScore += (input.compression.score / 100) * 20;

  // 1.5 MTF Trend Bias (Max 15 for BULLISH)
  if (input.bias === "BULLISH") {
    setupScore += 15;
    pumpScore += 10;
  } else if (input.bias === "BEARISH") {
    // If it's a flash crash liquidity hunt, do not overly penalize a temporary 4H dip
    if (isFlashCrash) {
      setupScore -= 5;
    } else {
      setupScore -= 15;
      pumpScore -= 15;
    }
  }

  // 1.8 Momentum Multiplier (Max 15)
  if (input.gain24h !== undefined) {
    if (input.gain24h > 10 && input.gain24h <= 20) {
      setupScore += 10;
      pumpScore += 10;
    } else if (input.gain24h > 20) {
      setupScore += 15;
      pumpScore += 15;
    }
  }

  // 1.9 Liquidity Hunt / Flash Crash Dip Absorption Bonus (Max 25)
  if (isFlashCrash) {
    setupScore += (absorptionScore / 100) * 25;
    pumpScore += (absorptionScore / 100) * 25;
  }

  let pullback = 0;
  let goldenPocket = { top: 0, bottom: 0 };
  if (input.klines1h && input.klines1h.length > 0) {
    let maxHigh = 0;
    input.klines1h.slice(-100).forEach(k => {
      if (k.high > maxHigh) maxHigh = k.high;
    });
    const currentPrice = input.klines1h[input.klines1h.length - 1].close;
    pullback = maxHigh > 0 ? ((maxHigh - currentPrice) / maxHigh) * 100 : 0;
    
    // Dynamic Golden Pocket based on Volume Bidding Area (Support)
    goldenPocket = {
      top: input.structure.support * 1.03, // 3% buffer above volume support where bids start
      bottom: input.structure.support      // Exact volume support floor
    };

    // Evaluate pullback against the dynamic volume/bidding zone
    if (input.structure.distanceToSupport >= 0 && input.structure.distanceToSupport <= 3) {
      setupScore += 15;
      pumpScore += 15; // In golden pocket zone
    } else if (input.structure.distanceToSupport < 0) {
      // Below support: only penalize if it is NOT a swept liquidation wick
      if (!isFlashCrash) {
        setupScore -= 10;
        pumpScore -= 10;
      }
    } else if (input.structure.distanceToSupport > 3) {
      if (pullback < 3) setupScore -= 5;
    }
  }

  // 2. Volume Expansion (Max 15)
  if (input.volumeRatio > 1.2 && input.volumeRatio <= 2.5) {
    setupScore += 10;
    pumpScore += 15;
  } else if (input.volumeRatio > 2.5) {
    setupScore += 15;
    pumpScore += 10;
  }

  // 3. Breakout Structure & Resistance proximity (Max 15)
  if (input.structure.distanceToResistance > 0 && input.structure.distanceToResistance < 2) {
    setupScore += 15;
    pumpScore += 15;
  } else if (input.structure.distanceToResistance >= 2 && input.structure.distanceToResistance < 5) {
    setupScore += 10;
    pumpScore += 5;
  }

  // 4. OI Behavior (Max 20)
  if (input.oiChange > 0 && input.oiChange <= 6) {
    setupScore += 15;
    pumpScore += 20; // Gradual healthy OI build up
  } else if (input.oiChange > 6) {
    setupScore += 20;
    pumpScore += 15;
  } else if (input.oiChange < -5 && isFlashCrash) {
    // OI dumped hard during flash crash (longs wiped) -> High fuel for reset bounce!
    setupScore += 15;
    pumpScore += 20;
  }

  // OI Accumulation at Support
  if (input.oiChange > 0 && input.structure.distanceToSupport < 2.5) {
    pumpScore += 10;
    setupScore += 5;
  }

  // 5. Funding (Max 5)
  if (input.funding < 0) {
    // Negative funding = short squeeze fuel
    setupScore += 8;
    pumpScore += 8;
  } else if (input.funding < 0.015) {
    setupScore += 4;
    pumpScore += 4;
  } else if (input.funding >= 0.05) {
    // Overheated positive funding = long squeeze danger
    setupScore -= 15;
    pumpScore -= 20;
  }

  // 6. MACD state
  if (input.macdState === "RED_IMPROVING" || input.macdState === "CROSSING_GREEN") {
    pumpScore += 20;
  } else if (input.macdState === "GREEN_RISING") {
    pumpScore += 10;
  }
  
  if (input.macdState === "GREEN_RISING" || input.macdState === "CROSSING_GREEN") {
    setupScore += 10;
  }

  // 7. Overheat Penalties
  if (isOverheated) {
    setupScore -= 25;
    pumpScore -= 30;
  }

  // 8. Prevent chasing pumps & determine primary status
  let status = "🟡 WATCH";
  const recent = input.klines.slice(-3);
  let hasPumped = false;
  
  for (const k of recent) {
    const candleChange = ((k.close - k.open) / k.open) * 100;
    if (candleChange > 12) hasPumped = true;
  }
  
  const currentPrice = input.klines[input.klines.length - 1].close;
  const oldPrice = input.klines[0].open;
  const totalChange = oldPrice > 0 ? ((currentPrice - oldPrice) / oldPrice) * 100 : 0;
  
  let isOverextended = false;
  if (input.klines1h && input.klines1h.length > 0) {
    let maxHigh = 0;
    input.klines1h.slice(-100).forEach(k => { if (k.high > maxHigh) maxHigh = k.high; });
    const pb = maxHigh > 0 ? ((maxHigh - currentPrice) / maxHigh) * 100 : 0;
    if (totalChange > 25 && pb < 3) isOverextended = true;
  } else {
    if (totalChange > 25) isOverextended = true;
  }

  // Range detection
  const pos = input.structure.positionInRange;
  const isRange = input.structure.isRangeBound;
  const rr = input.structure.rrRatio;

  // Determine status hierarchy:
  if (isOverheated) {
    status = "⚡ OVERHEATED";
  } else if (isOverextended || hasPumped) {
    status = "⚠️ EXTENDED";
    pumpScore -= 40;
  } else if (isFlashCrash && absorptionScore >= 50) {
    // Highest priority in a volatile bull market dip!
    status = "⚡ DIP-REVERSAL";
    pumpScore += 15;
    setupScore += 15;
  } else if (setupScore > 70 && pumpScore > 75) {
    status = "🟢 PRE-BREAKOUT";
  } else if (input.gain24h && input.gain24h > 15 && input.bias === "BULLISH" && input.structure.distanceToSupport <= 3.5) {
    status = "🔥 BULL-MOMENTUM";
  } else if (isRange && pos <= 20 && rr >= 1) {
    status = "🔵 RANGE-BOTTOM";
    pumpScore += 10;
    setupScore += 10;
  } else if (isRange && pos >= 80) {
    status = "🔴 RANGE-TOP";
    pumpScore -= 10;
  } else if (isRange) {
    status = "⚪ RANGING";
  } else if (input.macdState === "RED_FALLING" && !isFlashCrash) {
    status = "🔴 AVOID";
  }

  // 9. Calculate Entry Timing Guidance ("Wait for Entry Point")
  const entryTiming = calculateEntryTiming({
    currentPrice,
    support: input.structure.support,
    resistance: input.structure.resistance,
    breakoutTrigger: input.structure.breakoutTrigger,
    reclaimLevel: input.liquidityHunt?.reclaimLevel,
    isFlashCrashDip: isFlashCrash,
    isRangeBound: isRange,
    positionInRange: pos,
    isOverheated,
    pullbackPct: pullback,
    setupStatus: status
  });

  return {
    setupScore: Math.min(100, Math.max(0, Math.round(setupScore))),
    pumpScore: Math.min(100, Math.max(0, Math.round(pumpScore))),
    status,
    pullback,
    goldenPocket,
    entryTiming,
    isDipReversal: status === "⚡ DIP-REVERSAL" || isFlashCrash,
    isBullMomentum: status === "🔥 BULL-MOMENTUM",
    isOverheated
  };
}
