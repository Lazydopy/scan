const BASE_URL = "https://fapi.binance.com";

async function fetchBinance(endpoint, params) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Binance Error: ${res.status}`);
  return res.json();
}

async function test() {
  console.log("Testing live Binance data with upgraded bull market & flash crash logics...\n");
  
  // 1. Check BTC 5m velocity
  const btcKlines = await fetchBinance("/fapi/v1/klines", { symbol: "BTCUSDT", interval: "5m", limit: "20" });
  const currBtc = parseFloat(btcKlines[btcKlines.length - 1][4]);
  const prev5m = parseFloat(btcKlines[btcKlines.length - 2][4]);
  const change5m = ((currBtc - prev5m) / prev5m) * 100;
  console.log(`BTC Price: $${currBtc.toLocaleString()} | 5m Velocity: ${change5m >= 0 ? "+" : ""}${change5m.toFixed(2)}%`);

  // 2. Check a few top coins for wick geometry, funding, and entry timing
  const sampleSymbols = ["BTCUSDT", "SOLUSDT", "DOGEUSDT", "SUIUSDT", "ETHUSDT"];

  for (const sym of sampleSymbols) {
    const [klines5m, premium] = await Promise.all([
      fetchBinance("/fapi/v1/klines", { symbol: sym, interval: "5m", limit: "30" }),
      fetchBinance("/fapi/v1/premiumIndex", { symbol: sym }).catch(() => null)
    ]);

    const last = klines5m[klines5m.length - 1];
    const open = parseFloat(last[1]);
    const high = parseFloat(last[2]);
    const low = parseFloat(last[3]);
    const close = parseFloat(last[4]);
    const range = high - low;
    const bodyBottom = Math.min(open, close);
    const lowerWickRatio = range > 0 ? (bodyBottom - low) / range : 0;
    const fundingRate = premium ? parseFloat(premium.lastFundingRate) * 100 : 0;

    console.log(`\nSymbol: ${sym}`);
    console.log(`  Close: $${close} | Range: $${range.toFixed(4)} | Lower Wick Ratio: ${(lowerWickRatio * 100).toFixed(1)}%`);
    console.log(`  Funding Rate: ${fundingRate.toFixed(4)}% ${fundingRate > 0.03 ? "⚠️ HIGH" : "✅ HEALTHY"}`);
  }
}

test().catch(console.error);
