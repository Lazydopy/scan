import { NextResponse } from "next/server";
import { getKlines, getOpenInterestHist, getPremiumIndex, get24hTicker } from "@/lib/binance/api";
import { calculateMACD } from "@/lib/indicators/macd";
import { analyzeCompression, calculateVolumeRatio } from "@/lib/indicators/compression";
import { analyzeLiquidityHunt } from "@/lib/indicators/liquidity-hunt";
import { analyzeOverheatRisk } from "@/lib/indicators/overheat";
import { analyzeMarketStructure } from "@/lib/market-structure/levels";
import { analyzeTrendBias } from "@/lib/market-structure/bias";
import { calculateScores } from "@/lib/scoring/scores";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy"
);

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await context.params;
  const symbol = rawSymbol.toUpperCase();

  // Try live Binance calculation first
  try {
    const [klines5m, klines1h, klines4h, ticker24h] = await Promise.all([
      getKlines(symbol, "5m", 100).catch(() => []),
      getKlines(symbol, "1h", 150).catch(() => []),
      getKlines(symbol, "4h", 300).catch(() => []),
      get24hTicker(symbol).catch(() => null)
    ]);

    if (klines5m.length >= 30 && klines1h.length >= 30) {
      const macd5m = calculateMACD(klines5m);
      const currentMacd5m = macd5m[macd5m.length - 1];
      const compression = analyzeCompression(klines5m);
      const volumeRatio = calculateVolumeRatio(klines5m);
      
      const structure = analyzeMarketStructure(klines1h);
      const biasResult = klines4h.length >= 50 ? analyzeTrendBias(klines4h) : { bias: "NEUTRAL" as const, ema50: 0, ema200: 0, distanceToEma: 0 };
      const macd4h = calculateMACD(klines4h.length > 0 ? klines4h : klines1h);

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
        klines1h,
        bias: biasResult.bias,
        gain24h: ticker24h ? parseFloat(ticker24h.priceChangePercent) : 0,
        liquidityHunt,
        overheat
      });

      const currentPrice = klines5m[klines5m.length - 1].close;

      return NextResponse.json({
        klines: klines4h.length > 0 ? klines4h : klines1h,
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
    }
  } catch (liveErr) {
    // If Binance blocked or failed, fall back to Supabase cached candidate data
  }

  // Fallback: Check if candidate is present in latest Supabase scan
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://dummy.supabase.co") {
      const { data: latestRun } = await supabase
        .from("scan_runs")
        .select("status")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRun?.status) {
        const parsed = JSON.parse(latestRun.status);
        const cachedCandidate = parsed.candidates?.find((c: any) => c.symbol === symbol);
        if (cachedCandidate) {
          return NextResponse.json({
            ...cachedCandidate,
            klines: [],
            macd: [],
            currentPrice: cachedCandidate.price,
            fromSupabaseCache: true
          });
        }
      }
    }
  } catch (fallbackErr) {
    // ignore
  }

  return NextResponse.json({ error: "Failed to fetch coin data" }, { status: 500 });
}
