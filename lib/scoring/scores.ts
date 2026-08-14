import { MACDResult } from "../indicators/macd";
import { CompressionResult } from "../indicators/compression";
import { MarketStructure } from "../market-structure/levels";
import { Kline } from "../binance/api";

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
};

export function calculateScores(input: ScoringInput) {
  let setupScore = 0;
  let pumpScore = 0;

  // 1. Price Compression (Max 15)
  setupScore += (input.compression.score / 100) * 15;
  pumpScore += (input.compression.score / 100) * 20; // Compression is very important for pre-pump

  // 1.5 MTF Trend Bias (Max 15 for BULLISH, penalty for BEARISH)
  if (input.bias === "BULLISH") {
    setupScore += 15;
    pumpScore += 10;
  } else if (input.bias === "BEARISH") {
    setupScore -= 10;
    pumpScore -= 10;
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

  // 1.9 Pullback Depth "Golden Zone"
  if (input.klines1h && input.klines1h.length > 0) {
    let maxHigh = 0;
    input.klines1h.slice(-100).forEach(k => {
      if (k.high > maxHigh) maxHigh = k.high;
    });
    const currentPrice = input.klines1h[input.klines1h.length - 1].close;
    const pullback = ((maxHigh - currentPrice) / maxHigh) * 100;

    if (pullback > 5 && pullback <= 15) {
      setupScore += 10;
      pumpScore += 10; // Golden zone
    } else if (pullback > 20) {
      setupScore -= 10;
      pumpScore -= 10; // Dumped too hard
    } else if (pullback < 3) {
      setupScore -= 5; // Not pulled back enough
    }
  }

  // 2. Volume Expansion (Max 15)
  if (input.volumeRatio > 1.2 && input.volumeRatio <= 2) {
    setupScore += 10;
    pumpScore += 15;
  } else if (input.volumeRatio > 2) {
    setupScore += 15;
    pumpScore += 10; // slightly lower pump score if it's already massive
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
  if (input.oiChange > 0 && input.oiChange <= 5) {
    setupScore += 15;
    pumpScore += 20; // gradual OI build up is great
  } else if (input.oiChange > 5) {
    setupScore += 20;
    pumpScore += 15;
  }

  // OI Accumulation at Support (Divergence)
  if (input.oiChange > 0 && input.structure.distanceToSupport < 2) {
    pumpScore += 10;
    setupScore += 5;
  }

  // 5. Funding (Max 5)
  if (input.funding < 0) {
    setupScore += 5;
    pumpScore += 5; // potential squeeze
  } else if (input.funding < 0.01) {
    setupScore += 3;
    pumpScore += 3;
  }

  // 6. MACD state for Pump Score
  if (input.macdState === "RED_IMPROVING" || input.macdState === "CROSSING_GREEN") {
    pumpScore += 20;
  } else if (input.macdState === "GREEN_RISING") {
    pumpScore += 10;
  }
  
  if (input.macdState === "GREEN_RISING" || input.macdState === "CROSSING_GREEN") {
    setupScore += 10;
  }

  // 7. Prevent chasing pumps
  let status = "🟡 WATCH";
  const recent = input.klines.slice(-3); // check last 3 candles
  let hasPumped = false;
  
  for (const k of recent) {
    const candleChange = ((k.close - k.open) / k.open) * 100;
    if (candleChange > 10) {
      hasPumped = true;
    }
  }
  
  const currentPrice = input.klines[input.klines.length - 1].close;
  const oldPrice = input.klines[0].open;
  const totalChange = ((currentPrice - oldPrice) / oldPrice) * 100;
  
  // Only penalize as EXTENDED if it hasn't pulled back enough from its recent high
  let isOverextended = false;
  if (input.klines1h && input.klines1h.length > 0) {
    let maxHigh = 0;
    input.klines1h.slice(-100).forEach(k => { if (k.high > maxHigh) maxHigh = k.high; });
    const pullback = ((maxHigh - currentPrice) / maxHigh) * 100;
    if (totalChange > 20 && pullback < 3) isOverextended = true;
  } else {
    if (totalChange > 20) isOverextended = true;
  }
  
  if (isOverextended || hasPumped) {
    status = "⚠️ EXTENDED";
    pumpScore -= 40; // heavily penalize for chasing pumps
  } else if (setupScore > 70 && pumpScore > 75) {
    status = "🟢 PRE-BREAKOUT";
  } else if (input.macdState === "RED_FALLING") {
    status = "🔴 AVOID";
  }

  return {
    setupScore: Math.min(100, Math.max(0, Math.round(setupScore))),
    pumpScore: Math.min(100, Math.max(0, Math.round(pumpScore))),
    status
  };
}
