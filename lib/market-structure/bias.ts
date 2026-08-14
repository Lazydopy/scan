import { Kline } from "../binance/api";

export type TrendBias = "BULLISH" | "BEARISH" | "NEUTRAL";

export type BiasResult = {
  bias: TrendBias;
  ema50: number;
  ema200: number;
  distanceToEma: number;
};

function calculateEMA(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const emaData: number[] = [];
  
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) sum += data[i];
  let ema = data.length >= period ? sum / period : data[0];

  emaData.push(ema);
  
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    emaData.push(ema);
  }
  
  const padding = Array(Math.min(period - 1, data.length - emaData.length)).fill(NaN);
  return [...padding, ...emaData];
}

export function analyzeTrendBias(klines: Kline[]): BiasResult {
  if (klines.length < 200) {
    return { bias: "NEUTRAL", ema50: 0, ema200: 0, distanceToEma: 0 };
  }

  const closes = klines.map(k => k.close);
  const ema50Series = calculateEMA(closes, 50);
  const ema200Series = calculateEMA(closes, 200);
  
  const ema50 = ema50Series[ema50Series.length - 1];
  const ema200 = ema200Series[ema200Series.length - 1];
  
  if (isNaN(ema50) || isNaN(ema200)) {
    return { bias: "NEUTRAL", ema50: 0, ema200: 0, distanceToEma: 0 };
  }

  const currentPrice = closes[closes.length - 1];
  const distanceToEma = ((currentPrice - ema50) / ema50) * 100;

  let bias: TrendBias = "NEUTRAL";
  
  // Strong Bullish: Price > 50 EMA > 200 EMA
  if (currentPrice > ema50 && ema50 > ema200 && distanceToEma > 1) {
    bias = "BULLISH";
  // Strong Bearish: Price < 50 EMA < 200 EMA
  } else if (currentPrice < ema50 && ema50 < ema200 && distanceToEma < -1) {
    bias = "BEARISH";
  } else {
    // If it's chopping between EMAs or close to EMA, check the slope of the 50 EMA
    const prevEma50 = ema50Series[ema50Series.length - 3];
    if (ema50 > prevEma50 && currentPrice > ema200) bias = "BULLISH";
    else if (ema50 < prevEma50 && currentPrice < ema200) bias = "BEARISH";
  }

  return { bias, ema50, ema200, distanceToEma };
}
