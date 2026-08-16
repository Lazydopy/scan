const BASE_URL = "https://fapi.binance.com";

export async function fetchBinance<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
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

  return res.json();
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
  return fetchBinance<any>("/fapi/v1/exchangeInfo");
}

export async function get24hTickers() {
  return fetchBinance<any[]>("/fapi/v1/ticker/24hr");
}

export async function get24hTicker(symbol: string) {
  return fetchBinance<any>("/fapi/v1/ticker/24hr", { symbol });
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
