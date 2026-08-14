import { Kline } from "../binance/api";

export type MarketStructure = {
  support: number;
  resistance: number;
  breakoutTrigger: number;
  invalidation: number;
  target1: number;
  target2: number;
  distanceToResistance: number;
};

export function analyzeMarketStructure(klines: Kline[]): MarketStructure {
  if (klines.length < 50) {
    const currentPrice = klines[klines.length - 1]?.close || 0;
    return {
      support: currentPrice,
      resistance: currentPrice,
      breakoutTrigger: currentPrice,
      invalidation: currentPrice,
      target1: currentPrice,
      target2: currentPrice,
      distanceToResistance: 0
    };
  }

  // Use last 50 candles to find local structure
  const recent = klines.slice(-50);
  const currentPrice = recent[recent.length - 1].close;
  
  let localHigh = recent[0].high;
  let localLow = recent[0].low;

  for (const k of recent) {
    if (k.high > localHigh) localHigh = k.high;
    if (k.low < localLow) localLow = k.low;
  }

  const resistance = localHigh;
  const support = localLow;
  
  const distanceToResistance = ((resistance - currentPrice) / currentPrice) * 100;
  
  // Trigger is just slightly above resistance
  const breakoutTrigger = resistance * 1.002; 
  
  // Invalidation is below support or halfway through the range
  const invalidation = support;
  
  const range = resistance - support;
  const target1 = resistance + (range * 0.5);
  const target2 = resistance + range;

  return {
    support,
    resistance,
    breakoutTrigger,
    invalidation,
    target1,
    target2,
    distanceToResistance
  };
}
