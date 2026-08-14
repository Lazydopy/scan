import { Kline } from "../binance/api";

export type CompressionResult = {
  score: number; // 0-100
  isCompressing: boolean;
  hasHigherLows: boolean;
};

export function analyzeCompression(klines: Kline[], lookback = 20): CompressionResult {
  if (klines.length < lookback) {
    return { score: 0, isCompressing: false, hasHigherLows: false };
  }

  const recentKlines = klines.slice(-lookback);
  
  // 1. Calculate ATR (Average True Range) approximation over the lookback
  let totalRange = 0;
  for (const k of recentKlines) {
    totalRange += (k.high - k.low);
  }
  const avgRange = totalRange / lookback;
  
  // Look at the last 5 candles compared to average
  const ultraRecent = recentKlines.slice(-5);
  let ultraRecentRange = 0;
  for (const k of ultraRecent) {
    ultraRecentRange += (k.high - k.low);
  }
  const avgUltraRecentRange = ultraRecentRange / 5;
  
  // Compression factor: if recent range is significantly smaller than historical range
  const compressionRatio = avgRange > 0 ? avgUltraRecentRange / avgRange : 1;
  
  let score = 0;
  if (compressionRatio < 0.8) score += 20;
  if (compressionRatio < 0.6) score += 20; // up to 40 for pure volatility compression

  // 2. Check for Higher Lows in the recent swing
  // We'll look at the lowest point in the first half vs second half of lookback
  const firstHalf = recentKlines.slice(0, Math.floor(lookback/2));
  const secondHalf = recentKlines.slice(Math.floor(lookback/2));
  
  const minFirst = Math.min(...firstHalf.map(k => k.low));
  const minSecond = Math.min(...secondHalf.map(k => k.low));
  
  const hasHigherLows = minSecond > minFirst;
  if (hasHigherLows) {
    score += 40;
  }
  
  // 3. Price hovering near recent resistance
  const maxHigh = Math.max(...recentKlines.map(k => k.high));
  const currentPrice = recentKlines[recentKlines.length - 1].close;
  const distanceToHigh = (maxHigh - currentPrice) / currentPrice;
  
  if (distanceToHigh < 0.02) score += 20; // within 2% of local high

  return {
    score: Math.min(100, score),
    isCompressing: compressionRatio < 0.8,
    hasHigherLows
  };
}

export function calculateVolumeRatio(klines: Kline[]): number {
  if (klines.length < 21) return 1;
  
  // We exclude the current unclosed candle (last element is often unclosed)
  // Let's assume the passed klines are CLOSED. If the last is unclosed, the caller should slice it.
  
  const currentVol = klines[klines.length - 1].volume;
  const prevVols = klines.slice(klines.length - 21, klines.length - 1).map(k => k.volume).sort((a,b) => a-b);
  
  const medianVol = prevVols[Math.floor(prevVols.length / 2)];
  
  if (medianVol === 0) return 1;
  return currentVol / medianVol;
}
