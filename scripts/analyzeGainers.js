const fs = require('fs');

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

async function analyze() {
  console.log("Fetching 24hr tickers...");
  const tickers = await fetchBinance("/fapi/v1/ticker/24hr");
  
  const usdtTickers = tickers
    .filter(t => t.symbol.endsWith("USDT"))
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
    
  const top30 = usdtTickers.slice(0, 30);
  console.log(`Found top 30 gainers, highest is ${top30[0].symbol} with ${top30[0].priceChangePercent}%`);

  const results = [];

  for (const t of top30) {
    console.log(`Analyzing ${t.symbol}...`);
    try {
      // Fetch 5m klines to see intraday action
      const klinesData = await fetchBinance("/fapi/v1/klines", {
        symbol: t.symbol,
        interval: "5m",
        limit: "288" // 1 day of 5m candles
      });

      const klines = klinesData.map(d => ({
        time: new Date(d[0]).toISOString(),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        quoteVolume: parseFloat(d[7])
      }));

      let high = 0;
      let low = Infinity;
      klines.forEach(k => {
        if (k.close > high) high = k.close;
        if (k.close < low) low = k.close;
      });

      const current = klines[klines.length - 1].close;
      const pullbackFromHigh = ((high - current) / high) * 100;
      
      const oiData = await fetchBinance("/futures/data/openInterestHist", {
        symbol: t.symbol,
        period: "15m",
        limit: "10" 
      }).catch(() => null);

      let oiChange = 0;
      if (oiData && oiData.length >= 2) {
        const pastOi = parseFloat(oiData[0].sumOpenInterest);
        const currentOi = parseFloat(oiData[oiData.length - 1].sumOpenInterest);
        oiChange = ((currentOi - pastOi) / pastOi) * 100;
      }

      results.push({
        symbol: t.symbol,
        gain24h: parseFloat(t.priceChangePercent),
        volume24h: parseFloat(t.quoteVolume),
        high,
        low,
        current,
        pullbackPercent: pullbackFromHigh,
        recentOiChange: oiChange
      });

      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error(`Error analyzing ${t.symbol}:`, e.message);
    }
  }

  fs.writeFileSync('gainer_analysis.json', JSON.stringify(results, null, 2));
  console.log("Analysis saved to gainer_analysis.json");
}

analyze();
