import { Kline } from "../binance/api";

export type MarketRegimeType = 
  | "CRASH_IN_PROGRESS"       // Violent flash dump happening right now (Circuit breaker)
  | "FLASH_CRASH_RECOVERY"    // Rebound phase after a dump (Golden dip buying window)
  | "OVERHEATED_BULL"         // Bull market overextended, high funding, leverage flush imminent
  | "BULL_MOMENTUM"           // Healthy strong bull market trend
  | "NEUTRAL_CHOP";           // Standard consolidation

export type MarketRegimeResult = {
  regime: MarketRegimeType;
  title: string;
  description: string;
  circuitBreakerActive: boolean;
  dipHunterActive: boolean;
  btcVelocity5m: number;
  btcVelocity15m: number;
  btcVelocity1h: number;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  recommendedAction: string;
};

/**
 * Analyzes market regime by checking BTC/ETH velocity, price changes, and volatility.
 */
export function analyzeMarketRegime(
  btcKlines5m: Kline[],
  btcKlines15m?: Kline[],
  ethKlines5m?: Kline[],
  marketDecliningPct?: number
): MarketRegimeResult {
  const defaultResult: MarketRegimeResult = {
    regime: "BULL_MOMENTUM",
    title: "Bull Market Trending",
    description: "Healthy market conditions. Standard setups active.",
    circuitBreakerActive: false,
    dipHunterActive: false,
    btcVelocity5m: 0,
    btcVelocity15m: 0,
    btcVelocity1h: 0,
    riskLevel: "LOW",
    recommendedAction: "Trade confirmed setups with proper risk management."
  };

  if (!btcKlines5m || btcKlines5m.length < 5) return defaultResult;

  const currentBtc = btcKlines5m[btcKlines5m.length - 1].close;
  const prev5m = btcKlines5m[btcKlines5m.length - 2]?.close || currentBtc;
  const prev15m = btcKlines5m[Math.max(0, btcKlines5m.length - 4)]?.close || currentBtc;
  const prev1h = btcKlines5m[Math.max(0, btcKlines5m.length - 13)]?.close || currentBtc;

  const btcVelocity5m = prev5m > 0 ? ((currentBtc - prev5m) / prev5m) * 100 : 0;
  const btcVelocity15m = prev15m > 0 ? ((currentBtc - prev15m) / prev15m) * 100 : 0;
  const btcVelocity1h = prev1h > 0 ? ((currentBtc - prev1h) / prev1h) * 100 : 0;

  // Check ETH velocity if available
  let ethVelocity5m = 0;
  if (ethKlines5m && ethKlines5m.length >= 2) {
    const currEth = ethKlines5m[ethKlines5m.length - 1].close;
    const prevEth = ethKlines5m[ethKlines5m.length - 2].close;
    ethVelocity5m = ((currEth - prevEth) / prevEth) * 100;
  }

  // 1. Check for Active Flash Crash / Liquidation Cascade
  const isViolentDump = btcVelocity5m < -1.4 || btcVelocity15m < -2.8 || (btcVelocity5m < -0.9 && ethVelocity5m < -1.3);
  const isBroadMarketDumping = marketDecliningPct !== undefined && marketDecliningPct > 75 && btcVelocity5m < -0.6;

  if (isViolentDump || isBroadMarketDumping) {
    return {
      regime: "CRASH_IN_PROGRESS",
      title: "⚡ Flash Crash / Leverage Flush Active",
      description: "Violent market dump in progress. Breakout setups paused to prevent liquidation.",
      circuitBreakerActive: true,
      dipHunterActive: false,
      btcVelocity5m: Math.round(btcVelocity5m * 100) / 100,
      btcVelocity15m: Math.round(btcVelocity15m * 100) / 100,
      btcVelocity1h: Math.round(btcVelocity1h * 100) / 100,
      riskLevel: "CRITICAL",
      recommendedAction: "HOLD OFF long entries. Wait for liquidation wicks to bottom and stabilize."
    };
  }

  // 2. Check for Flash Crash Recovery (Post-dump bounce & wick reclaim)
  // If recent 1h had a sharp dump (e.g. -2.5%+) but 5m is strongly bouncing (> +0.5%)
  const recentLowestBtc = Math.min(...btcKlines5m.slice(-12).map(k => k.low));
  const btcBounceFromLow = recentLowestBtc > 0 ? ((currentBtc - recentLowestBtc) / recentLowestBtc) * 100 : 0;

  if (btcBounceFromLow >= 0.8 && btcVelocity5m > 0.3 && btcVelocity1h < -1.0) {
    return {
      regime: "FLASH_CRASH_RECOVERY",
      title: "🎯 Dip Hunter Active: Liquidation Sweep Bounce",
      description: "Market is absorbing the flash crash. Prime window for wick reclaims and V-reversals.",
      circuitBreakerActive: false,
      dipHunterActive: true,
      btcVelocity5m: Math.round(btcVelocity5m * 100) / 100,
      btcVelocity15m: Math.round(btcVelocity15m * 100) / 100,
      btcVelocity1h: Math.round(btcVelocity1h * 100) / 100,
      riskLevel: "MODERATE",
      recommendedAction: "Focus on Dip Reversal candidates with high absorption scores and support reclaims."
    };
  }

  // 3. Check for Overheated Bull
  if (btcVelocity1h > 4.0 || (btcVelocity15m > 2.0 && btcVelocity5m > 1.0)) {
    return {
      regime: "OVERHEATED_BULL",
      title: "🔥 Overheated Bull: High Leverage Risk",
      description: "Market running hot. Beware of late-long traps and sharp leverage flushes.",
      circuitBreakerActive: false,
      dipHunterActive: false,
      btcVelocity5m: Math.round(btcVelocity5m * 100) / 100,
      btcVelocity15m: Math.round(btcVelocity15m * 100) / 100,
      btcVelocity1h: Math.round(btcVelocity1h * 100) / 100,
      riskLevel: "HIGH",
      recommendedAction: "Avoid chasing green candles. Set tight trailing stops and keep leverage low."
    };
  }

  // 4. Healthy Bull Momentum
  if (btcVelocity1h > 0.2 || (btcVelocity15m > 0.0 && btcVelocity5m >= -0.3)) {
    return {
      regime: "BULL_MOMENTUM",
      title: "🟢 Bull Market Momentum",
      description: "Stable upward trend. Breakout and range-bottom setups favored.",
      circuitBreakerActive: false,
      dipHunterActive: false,
      btcVelocity5m: Math.round(btcVelocity5m * 100) / 100,
      btcVelocity15m: Math.round(btcVelocity15m * 100) / 100,
      btcVelocity1h: Math.round(btcVelocity1h * 100) / 100,
      riskLevel: "LOW",
      recommendedAction: "Trade verified pre-breakout consolidations and support bounces."
    };
  }

  // 5. Neutral / Consolidation
  return {
    regime: "NEUTRAL_CHOP",
    title: "⚪ Range Consolidation",
    description: "Market moving sideways. Range trading strategies favored.",
    circuitBreakerActive: false,
    dipHunterActive: false,
    btcVelocity5m: Math.round(btcVelocity5m * 100) / 100,
    btcVelocity15m: Math.round(btcVelocity15m * 100) / 100,
    btcVelocity1h: Math.round(btcVelocity1h * 100) / 100,
    riskLevel: "MODERATE",
    recommendedAction: "Buy range support with tight invalidations; sell near resistance."
  };
}
