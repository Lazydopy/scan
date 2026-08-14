import { NextResponse } from "next/server";
import { getKlines, getOpenInterestHist, getPremiumIndex } from "@/lib/binance/api";
import { calculateMACD } from "@/lib/indicators/macd";
import { analyzeCompression, calculateVolumeRatio } from "@/lib/indicators/compression";
import { analyzeMarketStructure } from "@/lib/market-structure/levels";
import { calculateScores } from "@/lib/scoring/scores";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await context.params;
  const symbol = rawSymbol.toUpperCase();
  try {
    const klines = await getKlines(symbol, "15m", 100);
    if (klines.length < 50) {
      return NextResponse.json({ error: "Insufficient data for symbol" }, { status: 400 });
    }

    const macd = calculateMACD(klines);
    const currentMacd = macd[macd.length - 1];
    const compression = analyzeCompression(klines);
    const volumeRatio = calculateVolumeRatio(klines);
    const structure = analyzeMarketStructure(klines);

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

    const { setupScore, pumpScore, status } = calculateScores({
      macdState: currentMacd.state,
      compression,
      volumeRatio,
      structure,
      oiChange,
      funding,
      klines
    });

    return NextResponse.json({
      klines,
      macd,
      compression,
      volumeRatio,
      structure,
      oiChange,
      funding,
      setupScore,
      pumpScore,
      status
    });

  } catch (error) {
    console.error("Error fetching coin:", error);
    return NextResponse.json({ error: "Failed to fetch coin data" }, { status: 500 });
  }
}
