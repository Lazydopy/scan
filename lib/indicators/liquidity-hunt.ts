import { Kline } from "../binance/api";

export type LiquidityHuntResult = {
  isFlashCrashDip: boolean;      // True if recently dumped hard (>3.5-10% wick) and showing strong absorption
  isSweepReclaim: boolean;       // True if swept below recent swing low/support and reclaimed above it
  lowerWickRatio: number;        // Percentage of the key candle that is lower wick (0 to 1)
  wickReboundPct: number;        // How much price has bounced from the lowest wick point (%)
  dipDepthPct: number;           // Depth of the drop from local high to wick low (%)
  absorptionScore: number;       // 0 - 100 score of dip buying strength
  sweepLow: number;              // Lowest price reached during the liquidity sweep
  reclaimLevel: number;          // Price level that confirms full structural reclaim
};

/**
 * Detects liquidity sweeps, flash crash wicks, and buyer absorption.
 * In a bull market flash crash, late longs get liquidated as price wicks below support,
 * followed by aggressive limit bid absorption and a strong bounce (long lower shadow / hammer).
 */
export function analyzeLiquidityHunt(
  klines5m: Kline[],
  klines1h?: Kline[],
  supportLevel?: number
): LiquidityHuntResult {
  const defaultResult: LiquidityHuntResult = {
    isFlashCrashDip: false,
    isSweepReclaim: false,
    lowerWickRatio: 0,
    wickReboundPct: 0,
    dipDepthPct: 0,
    absorptionScore: 0,
    sweepLow: 0,
    reclaimLevel: 0
  };

  if (!klines5m || klines5m.length < 12) return defaultResult;

  const currentCandle = klines5m[klines5m.length - 1];
  const currentPrice = currentCandle.close;

  // Look at the last 12 candles on 5m (last 1 hour of price action) to detect flash crashes
  const recent5m = klines5m.slice(-12);
  
  // Find local high and lowest wick
  let localHigh = 0;
  let sweepLow = Infinity;
  let lowestCandleIndex = -1;

  recent5m.forEach((k, idx) => {
    if (k.high > localHigh) localHigh = k.high;
    if (k.low < sweepLow) {
      sweepLow = k.low;
      lowestCandleIndex = idx;
    }
  });

  if (sweepLow === Infinity || localHigh <= 0) return defaultResult;

  // 1. Calculate Dip Depth (how violently it dropped from the local high)
  const dipDepthPct = ((localHigh - sweepLow) / localHigh) * 100;

  // 2. Calculate Rebound from the sweep low
  const wickReboundPct = sweepLow > 0 ? ((currentPrice - sweepLow) / sweepLow) * 100 : 0;

  // 3. Analyze the crash/sweep candle geometry (check the lowest candle or most recent completed candle)
  const sweepCandle = recent5m[lowestCandleIndex];
  const candleRange = sweepCandle.high - sweepCandle.low;
  let lowerWickRatio = 0;

  if (candleRange > 0) {
    const candleBodyBottom = Math.min(sweepCandle.open, sweepCandle.close);
    const lowerWick = candleBodyBottom - sweepCandle.low;
    lowerWickRatio = Math.max(0, Math.min(1, lowerWick / candleRange));
  }

  // Also check if current 5m candle has a prominent lower wick
  const currRange = currentCandle.high - currentCandle.low;
  if (currRange > 0) {
    const currBodyBottom = Math.min(currentCandle.open, currentCandle.close);
    const currLowerWick = currBodyBottom - currentCandle.low;
    const currWickRatio = currLowerWick / currRange;
    lowerWickRatio = Math.max(lowerWickRatio, currWickRatio);
  }

  // 4. Volume Absorption: check if volume during the dip was high compared to average
  let totalVol = 0;
  klines5m.slice(-30).forEach(k => { totalVol += k.volume; });
  const avgVol = totalVol / Math.min(30, klines5m.length);
  const sweepVolRatio = avgVol > 0 ? sweepCandle.volume / avgVol : 1;

  // 5. Sweep & Reclaim check against support level or previous swing low
  let isSweepReclaim = false;
  const reclaimTarget = supportLevel && supportLevel > 0 ? supportLevel : (localHigh + sweepLow) / 2;

  if (supportLevel && supportLevel > 0) {
    // If wick dropped below support but current price is back at or above support
    if (sweepLow < supportLevel && currentPrice >= supportLevel * 0.995) {
      isSweepReclaim = true;
    }
  } else {
    // If rebound recovered more than 50% of the drop
    if (dipDepthPct >= 4 && wickReboundPct >= (dipDepthPct * 0.45)) {
      isSweepReclaim = true;
    }
  }

  // 6. Calculate Absorption Score (0 - 100)
  let absorptionScore = 0;

  // A: Prominent lower wick (Buyers stepped in before candle closed)
  if (lowerWickRatio >= 0.40) absorptionScore += 25;
  if (lowerWickRatio >= 0.60) absorptionScore += 15; // Up to 40 for pin-bar/hammer

  // B: Meaningful dip followed by strong rebound
  if (dipDepthPct >= 4 && wickReboundPct >= 2) absorptionScore += 20;
  if (dipDepthPct >= 7 && wickReboundPct >= 4) absorptionScore += 15;

  // C: Volume surge during the sweep (limit order absorption by smart money)
  if (sweepVolRatio > 1.5) absorptionScore += 15;
  if (sweepVolRatio > 2.5) absorptionScore += 10;

  // D: Structural reclaim bonus
  if (isSweepReclaim) absorptionScore += 20;

  absorptionScore = Math.min(100, Math.max(0, Math.round(absorptionScore)));

  // Qualifies as a Flash Crash Dip if:
  // - Dropped at least 3.5% recently AND
  // - Lower wick is at least 35% or rebound >= 2% AND
  // - Absorption score >= 50
  const isFlashCrashDip = dipDepthPct >= 3.5 && (lowerWickRatio >= 0.35 || wickReboundPct >= 2) && absorptionScore >= 50;

  return {
    isFlashCrashDip,
    isSweepReclaim,
    lowerWickRatio: Math.round(lowerWickRatio * 100) / 100,
    wickReboundPct: Math.round(wickReboundPct * 100) / 100,
    dipDepthPct: Math.round(dipDepthPct * 100) / 100,
    absorptionScore,
    sweepLow,
    reclaimLevel: reclaimTarget
  };
}
