import { NextResponse } from "next/server";
import { getKlines, getOpenInterestHist, getPremiumIndex, get24hTicker } from "@/lib/binance/api";
import { calculateMACD } from "@/lib/indicators/macd";
import { analyzeCompression, calculateVolumeRatio } from "@/lib/indicators/compression";
import { analyzeLiquidityHunt } from "@/lib/indicators/liquidity-hunt";
import { analyzeOverheatRisk } from "@/lib/indicators/overheat";
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
      getKlines(symbol, "1h", 150),
      getKlines(symbol, "4h", 300),
      get24hTicker(symbol).catch(() => null)
    ]);

    if (klines5m.length < 30 || klines1h.length < 30) {
      return NextResponse.json({ error: "Insufficient data for symbol" }, { status: 400 });
    }

    const macd5m = calculateMACD(klines5m);
    const currentMacd5m = macd5m[macd5m.length - 1];
    const compression = analyzeCompression(klines5m);
    const volumeRatio = calculateVolumeRatio(klines5m);
    
    const structure = analyzeMarketStructure(klines1h);
    const biasResult = klines4h.length >= 50 ? analyzeTrendBias(klines4h) : { bias: "NEUTRAL" as const, ema50: 0, ema200: 0, distanceToEma: 0 };

    // Calculate 4H MACD for the chart visualization
    const macd4h = calculateMACD(klines4h);

    let oiChange = 0;
    let funding = 0;
    try {
      const [oi, premium] = await Promise.all([
        getOpenInterestHist(symbol, "15m", 4).catch(() => []),
        getPremiumIndex(symbol).catch(() => null)
      ]);
      if (oi && oi.length >= 2) {
        const currentOi = parseFloat(oi[oi.length - 1].sumOpenInterest);
        const pastOi = parseFloat(oi[0].sumOpenInterest);
        oiChange = pastOi > 0 ? ((currentOi - pastOi) / pastOi) * 100 : 0;
      }
      if (premium && premium.lastFundingRate) {
        funding = parseFloat(premium.lastFundingRate) * 100;
      }
    } catch (e) {
      // ignore
    }

    const liquidityHunt = analyzeLiquidityHunt(klines5m, klines1h, structure.support);
    const overheat = analyzeOverheatRisk(klines4h.length > 20 ? klines4h : klines1h, funding, oiChange, biasResult.ema50);

    const scoreResult = calculateScores({
      macdState: currentMacd5m.state,
      compression,
      volumeRatio,
      structure,
      oiChange,
      funding,
      klines: klines5m,
      klines1h: klines1h,
      bias: biasResult.bias,
      gain24h: ticker24h ? parseFloat(ticker24h.priceChangePercent) : 0,
      liquidityHunt,
      overheat
    });

    const currentPrice = klines5m[klines5m.length - 1].close;

    return NextResponse.json({
      klines: klines4h.length > 0 ? klines4h : klines1h, // Return 4H klines for chart
      macd: macd4h,
      macdState: currentMacd5m.state,
      currentPrice,
      compression,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      structure,
      oiChange: Math.round(oiChange * 100) / 100,
      funding: Math.round(funding * 1000) / 1000,
      setupScore: scoreResult.setupScore,
      pumpScore: scoreResult.pumpScore,
      status: scoreResult.status,
      pullback: Math.round(scoreResult.pullback * 10) / 10,
      goldenPocket: scoreResult.goldenPocket,
      entryTiming: scoreResult.entryTiming,
      isDipReversal: scoreResult.isDipReversal,
      isBullMomentum: scoreResult.isBullMomentum,
      isOverheated: scoreResult.isOverheated,
      liquidityHunt,
      overheat,
      trendBias: biasResult.bias,
      gain24h: ticker24h ? parseFloat(ticker24h.priceChangePercent) : 0
    });

  } catch (error) {
    console.error("Error fetching coin:", error);
    return NextResponse.json({ error: "Failed to fetch coin data" }, { status: 500 });
  }
}
