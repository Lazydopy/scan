import { Kline } from "../binance/api";

export type OverheatResult = {
  isOverheated: boolean;        // True if asset is dangerously extended with extreme funding/exhaustion
  overheatScore: number;        // 0-100 risk score
  fundingRisk: "LOW" | "ELEVATED" | "EXTREME";
  distanceToEmaPct: number;
  rsi: number;
  warningMessage?: string;
};

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Analyzes whether an altcoin is in a "Late Long Trap" or overheated state.
 * In bull markets, sharp violent dumps occur when funding rate explodes (>0.03% to 0.10%+),
 * RSI is overbought (>75), and price is over-extended from major EMAs.
 */
export function analyzeOverheatRisk(
  klines: Kline[],
  fundingRate: number, // percentage, e.g. 0.05 is 0.05%
  oiChange: number,
  ema50?: number
): OverheatResult {
  const defaultResult: OverheatResult = {
    isOverheated: false,
    overheatScore: 0,
    fundingRisk: "LOW",
    distanceToEmaPct: 0,
    rsi: 50
  };

  if (!klines || klines.length < 20) return defaultResult;

  const closes = klines.map(k => k.close);
  const currentPrice = closes[closes.length - 1];
  const rsi = calculateRSI(closes, 14);

  // Distance to EMA50 if provided
  let distanceToEmaPct = 0;
  if (ema50 && ema50 > 0) {
    distanceToEmaPct = ((currentPrice - ema50) / ema50) * 100;
  } else {
    // Approximate with SMA20 of current klines
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    distanceToEmaPct = ((currentPrice - sma20) / sma20) * 100;
  }

  let overheatScore = 0;
  let fundingRisk: OverheatResult["fundingRisk"] = "LOW";

  // 1. Funding rate risk
  if (fundingRate >= 0.08) {
    overheatScore += 40;
    fundingRisk = "EXTREME";
  } else if (fundingRate >= 0.04) {
    overheatScore += 25;
    fundingRisk = "ELEVATED";
  } else if (fundingRate < 0) {
    // Negative funding reduces overheat risk (potential short squeeze)
    overheatScore -= 15;
  }

  // 2. RSI Overbought
  if (rsi >= 80) overheatScore += 30;
  else if (rsi >= 72) overheatScore += 15;

  // 3. Price extension
  if (distanceToEmaPct >= 15) overheatScore += 30;
  else if (distanceToEmaPct >= 8) overheatScore += 15;

  // 4. OI Divergence (OI surging but price stalling near top)
  if (oiChange > 8 && rsi > 70) {
    overheatScore += 15;
  }

  overheatScore = Math.min(100, Math.max(0, Math.round(overheatScore)));
  const isOverheated = overheatScore >= 60;

  let warningMessage;
  if (isOverheated) {
    if (fundingRisk === "EXTREME") {
      warningMessage = "Extreme Long Crowding: Astronomical funding rate. High risk of leverage flush!";
    } else if (rsi >= 80) {
      warningMessage = "Exhaustion Zone: Extreme RSI overbought. Wait for dip to support.";
    } else {
      warningMessage = "Over-extended from base. Avoid market buying at peak.";
    }
  }

  return {
    isOverheated,
    overheatScore,
    fundingRisk,
    distanceToEmaPct: Math.round(distanceToEmaPct * 10) / 10,
    rsi: Math.round(rsi),
    warningMessage
  };
}
