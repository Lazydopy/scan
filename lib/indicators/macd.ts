import { Kline } from "../binance/api";

export type MACDResult = {
  macd: number;
  signal: number;
  histogram: number;
  state: "RED_FALLING" | "RED_IMPROVING" | "CROSSING_GREEN" | "GREEN_RISING" | "GREEN_WEAKENING" | "NEUTRAL";
};

function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaData: number[] = [];
  let ema = data[0]; // Start with SMA as first EMA (or just first value if data is small, usually SMA of first 'period' values is better but this is simpler and converges)
  
  // Actually, standard way is to use SMA for first value.
  // For simplicity and since we only care about the latest values, we just seed it.
  let sum = 0;
  for(let i=0; i<period && i<data.length; i++) sum += data[i];
  ema = data.length >= period ? sum / period : data[0];

  emaData.push(ema);
  
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    emaData.push(ema);
  }
  
  // Pad the beginning to match original length so indices align
  const padding = Array(period - 1).fill(NaN);
  return [...padding, ...emaData];
}

export function calculateMACD(klines: Kline[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MACDResult[] {
  if (klines.length < slowPeriod + signalPeriod) {
    return []; // Not enough data
  }

  const closes = klines.map(k => k.close);
  const fastEma = calculateEMA(closes, fastPeriod);
  const slowEma = calculateEMA(closes, slowPeriod);
  
  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(fastEma[i]) || isNaN(slowEma[i])) {
      macdLine.push(NaN);
    } else {
      macdLine.push(fastEma[i] - slowEma[i]);
    }
  }

  // Calculate Signal line (EMA of MACD line)
  // We need to filter out NaNs for the EMA calculation
  const validMacdStartIndex = macdLine.findIndex(val => !isNaN(val));
  const validMacd = macdLine.slice(validMacdStartIndex);
  
  const signalEma = calculateEMA(validMacd, signalPeriod);
  
  const signalLine = Array(validMacdStartIndex).fill(NaN).concat(signalEma);

  const results: MACDResult[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(macdLine[i]) || isNaN(signalLine[i])) {
      results.push({ macd: NaN, signal: NaN, histogram: NaN, state: "NEUTRAL" });
      continue;
    }

    const macd = macdLine[i];
    const signal = signalLine[i];
    const histogram = macd - signal;
    
    let state: MACDResult["state"] = "NEUTRAL";
    
    // Determine state based on current and previous histograms
    if (i > 0 && !isNaN(results[i-1].histogram)) {
      const prevHist = results[i-1].histogram;
      
      if (histogram < 0) {
        if (histogram < prevHist) state = "RED_FALLING";
        else state = "RED_IMPROVING";
      } else {
        if (prevHist < 0) state = "CROSSING_GREEN";
        else if (histogram > prevHist) state = "GREEN_RISING";
        else state = "GREEN_WEAKENING";
      }
    }

    results.push({ macd, signal, histogram, state });
  }

  return results;
}
