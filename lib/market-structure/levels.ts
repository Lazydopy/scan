import { Kline } from "../binance/api";

export type MarketStructure = {
  support: number;
  resistance: number;
  breakoutTrigger: number;
  invalidation: number;
  target1: number;
  target2: number;
  distanceToResistance: number;
  distanceToSupport: number;
  // Range analysis
  rangeWidth: number;        // % width of the range (resistance - support) / support * 100
  positionInRange: number;   // 0 = at support, 100 = at resistance
  isRangeBound: boolean;     // true if coin is oscillating in a defined channel
  slForRange: number;        // tight SL just below range support
  rrRatio: number;           // reward:risk ratio (target=resistance, risk=sl)
};

export function analyzeMarketStructure(klines: Kline[]): MarketStructure {
  const defaultPrice = klines[klines.length - 1]?.close || 0;
  const defaultResult: MarketStructure = {
    support: defaultPrice,
    resistance: defaultPrice,
    breakoutTrigger: defaultPrice,
    invalidation: defaultPrice * 0.98,
    target1: defaultPrice,
    target2: defaultPrice,
    distanceToResistance: 0,
    distanceToSupport: 0,
    rangeWidth: 0,
    positionInRange: 50,
    isRangeBound: false,
    slForRange: defaultPrice * 0.97,
    rrRatio: 0
  };

  if (klines.length < 50) return defaultResult;

  // Use last 100 candles for range analysis (bigger picture)
  const recent = klines.slice(-100);
  const currentPrice = recent[recent.length - 1].close;

  // Find swing highs and lows using a simple pivot detection
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
  // - Range width is between 5% and 45% (meaningful but not a crazy dump)
  // - Has at least 2 swing highs AND 2 swing lows (it has oscillated)
  const isRangeBound = rangeWidth >= 5 && rangeWidth <= 45 && swingHighs.length >= 2 && swingLows.length >= 2;

  const distanceToResistance = ((resistance - currentPrice) / currentPrice) * 100;
  const distanceToSupport    = ((currentPrice - support) / currentPrice) * 100;

  // Trigger is just slightly above resistance
  const breakoutTrigger = resistance * 1.002;

  // Invalidation: 2% below support (tight SL for range trades)
  const slForRange  = support * 0.98;
  const invalidation = slForRange;

  const rangeTarget = resistance;
  const rewardPct   = ((rangeTarget - currentPrice) / currentPrice) * 100;
  const riskPct     = ((currentPrice - slForRange) / currentPrice) * 100;
  const rrRatio     = riskPct > 0 ? rewardPct / riskPct : 0;

  const rangeSize = resistance - support;
  const target1 = resistance + rangeSize * 0.5;
  const target2 = resistance + rangeSize;

  return {
    support,
    resistance,
    breakoutTrigger,
    invalidation,
    target1,
    target2,
    distanceToResistance,
    distanceToSupport,
    rangeWidth,
    positionInRange,
    isRangeBound,
    slForRange,
    rrRatio
  };
}
