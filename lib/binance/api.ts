const BASE_URL = "https://fapi.binance.com";

// Simple in-memory cache to avoid hammering Binance (prevents IP bans)
const cache = new Map<string, { data: any; expires: number }>();

export async function fetchBinance<T>(endpoint: string, params?: Record<string, string>, ttlMs = 15000): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
  }

  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data as T;
  }
  
  const res = await fetch(url.toString(), {
    cache: "no-store" // Always fetch fresh data from Binance
  });

  if (!res.ok) {
    let errorMsg = res.statusText;
    try {
      const errorJson = await res.json();
      if (errorJson && errorJson.msg) errorMsg = errorJson.msg;
    } catch (e) {}
    throw new Error(`Binance API Error ${res.status}: ${errorMsg}`);
  }

  const data = await res.json();
  cache.set(cacheKey, { data, expires: Date.now() + ttlMs });
  return data as T;
}

export type Kline = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
};

export async function getKlines(symbol: string, interval: string, limit: number = 100): Promise<Kline[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchBinance<any[]>("/fapi/v1/klines", {
    symbol,
    interval,
    limit: limit.toString(),
  });

  return data.map((d) => ({
    openTime: d[0],
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
    closeTime: d[6],
    quoteVolume: parseFloat(d[7]),
    trades: d[8],
    takerBuyBaseVolume: parseFloat(d[9]),
    takerBuyQuoteVolume: parseFloat(d[10]),
  }));
}

export async function getExchangeInfo() {
  // exchangeInfo rarely changes — cache for 5 minutes
  return fetchBinance<any>("/fapi/v1/exchangeInfo", undefined, 5 * 60 * 1000);
}

export async function get24hTickers() {
  // All tickers — cache for 30 seconds (heavy call)
  return fetchBinance<any[]>("/fapi/v1/ticker/24hr", undefined, 30000);
}

export async function get24hTicker(symbol: string) {
  return fetchBinance<any>("/fapi/v1/ticker/24hr", { symbol }, 15000);
}

export async function getOpenInterestHist(symbol: string, period: string, limit: number = 30) {
  return fetchBinance<any[]>("/futures/data/openInterestHist", {
    symbol,
    period,
    limit: limit.toString()
  });
}

export async function getPremiumIndex(symbol: string) {
  return fetchBinance<any>("/fapi/v1/premiumIndex", { symbol });
}
