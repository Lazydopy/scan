import { NextResponse } from "next/server";
import { getKlines, getOpenInterestHist, getPremiumIndex, get24hTicker } from "@/lib/binance/api";
import { calculateMACD } from "@/lib/indicators/macd";
import { analyzeCompression, calculateVolumeRatio } from "@/lib/indicators/compression";
import { analyzeMarketStructure } from "@/lib/market-structure/levels";
import { analyzeTrendBias } from "@/lib/market-structure/bias";
import { calculateScores } from "@/lib/scoring/scores";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await context.params;
  const symbol = rawSymbol.toUpperCase();
  try {
    const [klines5m, klines1h, klines4h, ticker24h] = await Promise.all([
      getKlines(symbol, "5m", 100),
      getKlines(symbol, "1h", 150), // Fetch 150 for 1H chart (6.25 days)
      getKlines(symbol, "4h", 1000),
      get24hTicker(symbol).catch(() => null)
    ]);

    if (klines5m.length < 50 || klines1h.length < 50 || klines4h.length < 50) {
      return NextResponse.json({ error: "Insufficient data for symbol" }, { status: 400 });
    }

    const macd5m = calculateMACD(klines5m);
    const currentMacd5m = macd5m[macd5m.length - 1];
    const compression = analyzeCompression(klines5m);
    const volumeRatio = calculateVolumeRatio(klines5m);
    
    const structure = analyzeMarketStructure(klines1h);
    const biasResult = analyzeTrendBias(klines4h);

    // Calculate 4H MACD for the chart visualization
    const macd4h = calculateMACD(klines4h);

    let oiChange = 0;
    let funding = 0;
    try {
      const oi = await getOpenInterestHist(symbol, "15m", 4);
      if (oi.length >= 2) {
        const currentOi = parseFloat(oi[oi.length - 1].sumOpenInterest);

        const pastOi = parseFloat(oi[0].sumOpenInterest);
        oiChange = ((currentOi - pastOi) / pastOi) * 100;
      }
      const premium = await getPremiumIndex(symbol);
      funding = parseFloat(premium.lastFundingRate) * 100;
    } catch (e) {
      // ignore
    }

    const { setupScore, pumpScore, status, pullback, goldenPocket } = calculateScores({
      macdState: currentMacd5m.state,
      compression,
      volumeRatio,
      structure,
      oiChange,
      funding,
      klines: klines5m,
      klines1h: klines1h,
      bias: biasResult.bias,
      gain24h: ticker24h ? parseFloat(ticker24h.priceChangePercent) : 0
    });

    return NextResponse.json({
      klines: klines4h, // Return 4H klines for the chart
      macd: macd4h,     // Return 4H macd for the chart
      macdState: currentMacd5m.state, // Return 5m MACD state for the text stats
      currentPrice: klines5m[klines5m.length - 1].close,
      compression,
      volumeRatio,
      structure,
      oiChange,
      funding,
      setupScore,
      pumpScore,
      status,
      pullback,
      goldenPocket,
      trendBias: biasResult.bias,
      gain24h: ticker24h ? parseFloat(ticker24h.priceChangePercent) : 0
    });

  } catch (error) {
    console.error("Error fetching coin:", error);
    return NextResponse.json({ error: "Failed to fetch coin data" }, { status: 500 });
  }
}
