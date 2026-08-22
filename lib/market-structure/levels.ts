import { Kline } from "../binance/api";

export type MarketStructure = {
  support: number;
  resistance: number;
  breakoutTrigger: number;
  invalidation: number;
  target1: number;
  target2: number;
  target3: number;           // Bull market extension (1.618 Fib)
  distanceToResistance: number;
  distanceToSupport: number;
  // Range analysis
  rangeWidth: number;        // % width of the range (resistance - support) / support * 100
  positionInRange: number;   // 0 = at support, 100 = at resistance
  isRangeBound: boolean;     // true if coin is oscillating in a defined channel
  slForRange: number;        // tight SL just below range support
  rrRatio: number;           // reward:risk ratio (target=resistance, risk=sl)
  // Volatility & ATR Risk Buffer
  atr: number;               // Average True Range
  atrPct: number;            // ATR as % of price
  dynamicSl: number;         // ATR-buffered Stop Loss (support - 1.2 * ATR)
  recommendedLeverage: number; // Safe leverage recommendation based on volatility (2x to 5x)
};

export function calculateATR(klines: Kline[], period = 14): number {
  if (klines.length < period + 1) {
    const defaultRange = klines.length > 0 ? (klines[klines.length - 1].high - klines[klines.length - 1].low) : 0;
    return defaultRange;
  }

  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const high = klines[i].high;
    const low = klines[i].low;
    const prevClose = klines[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  // Calculate simple initial average
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  return atr;
}

export function analyzeMarketStructure(klines: Kline[]): MarketStructure {
  const defaultPrice = klines[klines.length - 1]?.close || 0;
  const defaultResult: MarketStructure = {
    support: defaultPrice,
    resistance: defaultPrice,
    breakoutTrigger: defaultPrice,
    invalidation: defaultPrice * 0.96,
    target1: defaultPrice,
    target2: defaultPrice,
    target3: defaultPrice,
    distanceToResistance: 0,
    distanceToSupport: 0,
    rangeWidth: 0,
    positionInRange: 50,
    isRangeBound: false,
    slForRange: defaultPrice * 0.96,
    rrRatio: 0,
    atr: 0,
    atrPct: 0,
    dynamicSl: defaultPrice * 0.96,
    recommendedLeverage: 3
  };

  if (klines.length < 30) return defaultResult;

  // Use last 100 candles for range analysis
  const recent = klines.slice(-100);
  const currentPrice = recent[recent.length - 1].close;

  // 1. Calculate ATR for dynamic volatility buffering
  const atr = calculateATR(recent, 14);
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

  // Find swing highs and lows using pivot detection
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = 2; i < recent.length - 2; i++) {
    const prev2 = recent[i - 2].high;
    const prev1 = recent[i - 1].high;
    const curr  = recent[i].high;
    const next1 = recent[i + 1].high;
    const next2 = recent[i + 2].high;
    if (curr >= prev1 && curr >= prev2 && curr >= next1 && curr >= next2) {
      swingHighs.push(curr);
    }

    const pLow2 = recent[i - 2].low;
    const pLow1 = recent[i - 1].low;
    const cLow  = recent[i].low;
    const nLow1 = recent[i + 1].low;
    const nLow2 = recent[i + 2].low;
    if (cLow <= pLow1 && cLow <= pLow2 && cLow <= nLow1 && cLow <= nLow2) {
      swingLows.push(cLow);
    }
  }

  // Cluster swing highs and lows to find the dominant range
  const clusterHighs = swingHighs.sort((a, b) => b - a);
  const clusterLows  = swingLows.sort((a, b) => a - b);

  // Use median of top 3 highs and bottom 3 lows for robustness
  const topHighs = clusterHighs.slice(0, Math.min(3, clusterHighs.length));
  const botLows  = clusterLows.slice(0, Math.min(3, clusterLows.length));

  const resistance = topHighs.length > 0 ? topHighs.reduce((a, b) => a + b, 0) / topHighs.length : recent.reduce((m, k) => k.high > m ? k.high : m, 0);
  const support    = botLows.length > 0  ? botLows.reduce((a, b) => a + b, 0)  / botLows.length  : recent.reduce((m, k) => k.low  < m ? k.low  : m, Infinity);

  const rangeWidth = ((resistance - support) / support) * 100;
  const positionInRange = support >= resistance ? 50 : Math.max(0, Math.min(100,
    ((currentPrice - support) / (resistance - support)) * 100
  ));

  // A coin is range-bound if:
  // - Range width is between 5% and 50%
  // - Has at least 2 swing highs AND 2 swing lows
  const isRangeBound = rangeWidth >= 5 && rangeWidth <= 50 && swingHighs.length >= 2 && swingLows.length >= 2;

  const distanceToResistance = ((resistance - currentPrice) / currentPrice) * 100;
  const distanceToSupport    = ((currentPrice - support) / currentPrice) * 100;

  // Trigger is just slightly above resistance
  const breakoutTrigger = resistance * 1.003;

  // Dynamic ATR Stop Loss: In a bull market, tight stops get wick-hunted.
  // We place the Stop Loss at Support minus 1.2x ATR buffer (or min 2.5%, max 6%)
  const atrBuffer = Math.max(atr * 1.2, support * 0.025);
  const dynamicSl = Math.max(0, support - atrBuffer);
  const slForRange = dynamicSl;
  const invalidation = dynamicSl;

  // Target Projections
  const rangeSize = Math.max(0, resistance - support);
  const target1 = resistance;
  const target2 = resistance + rangeSize * 0.618;
  const target3 = resistance + rangeSize * 1.618; // Bull market extended target

  // Risk / Reward Ratio
  const riskAmount = currentPrice - dynamicSl;
  const rewardAmount = resistance - currentPrice;
  const rrRatio = riskAmount > 0 ? Math.max(0, rewardAmount / riskAmount) : 0;

  // Recommended Max Leverage based on Volatility (ATR %)
  // High volatility (ATR > 6%) -> Max 2x leverage to avoid flash crash liquidations
  // Medium volatility (ATR 3.5 - 6%) -> Max 3x leverage
  // Low volatility (ATR < 3.5%) -> Max 5x leverage
  let recommendedLeverage = 3;
  if (atrPct >= 6.0) recommendedLeverage = 2;
  else if (atrPct <= 3.0) recommendedLeverage = 5;
  else recommendedLeverage = 3;

  return {
    support,
    resistance,
    breakoutTrigger,
    invalidation,
    target1,
    target2,
    target3,
    distanceToResistance,
    distanceToSupport,
    rangeWidth,
    positionInRange,
    isRangeBound,
    slForRange,
    rrRatio: Math.round(rrRatio * 10) / 10,
    atr,
    atrPct: Math.round(atrPct * 10) / 10,
    dynamicSl,
    recommendedLeverage
  };
}
