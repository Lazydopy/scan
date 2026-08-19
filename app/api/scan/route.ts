import { NextResponse } from "next/server";
import { getExchangeInfo, get24hTickers, getKlines, getOpenInterestHist, getPremiumIndex } from "@/lib/binance/api";
import { calculateMACD } from "@/lib/indicators/macd";
import { analyzeCompression, calculateVolumeRatio } from "@/lib/indicators/compression";
import { analyzeMarketStructure } from "@/lib/market-structure/levels";
import { analyzeTrendBias } from "@/lib/market-structure/bias";
import { calculateScores } from "@/lib/scoring/scores";
import pLimit from "p-limit";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60; // Allow function to run longer on Vercel
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy"
);

export async function POST() {
  const startTime = Date.now();
  try {
    // 1. Get Universe
    const exchangeInfo = await getExchangeInfo();
    const symbols = exchangeInfo.symbols
      .filter((s: any) => 
        s.quoteAsset === "USDT" && 
        s.contractType === "PERPETUAL" && 
        s.status === "TRADING" &&
        s.underlyingType === "COIN"  // Only crypto — excludes GOLD, SILVER, stocks etc.
      )
      .map((s: any) => s.symbol);

    // 2. Filter by volume to avoid illiquid coins (Top ~100 by volume)
    const tickers = await get24hTickers();
    const usdtTickers = tickers
      .filter(t => symbols.includes(t.symbol))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    const gainMap = new Map<string, number>();
    usdtTickers.forEach(t => gainMap.set(t.symbol, parseFloat(t.priceChangePercent)));

    const candidateSymbols = usdtTickers.map(t => t.symbol);

    // 3. Fetch Klines concurrently but rate limited
    const limit = pLimit(15);
    const results = [];

    const klinePromises = candidateSymbols.map(symbol => 
      limit(async () => {
        try {
          const [klines5m, klines1h, klines4h] = await Promise.all([
            getKlines(symbol, "5m", 100),
            getKlines(symbol, "1h", 100),
            getKlines(symbol, "4h", 1000)
          ]);
          
          if (klines5m.length < 50 || klines1h.length < 50 || klines4h.length < 50) return null;
          
          // Use closed candles mostly, remove the last one if it's not closed
          // For simplicity we just use all returned
          const macd = calculateMACD(klines5m);
          const currentMacd = macd[macd.length - 1];
          const compression = analyzeCompression(klines5m);
          const volRatio = calculateVolumeRatio(klines5m);
          
          // Use 1h for structure
          const structure = analyzeMarketStructure(klines1h);
          
          // Use 4h for bias
          const biasResult = analyzeTrendBias(klines4h);

          // Fast preliminary filter: skip if 4H Bias is BEARISH to enforce MTF trend alignment
          // We can soften this to allow NEUTRAL, but strictly filter BEARISH out.
          if (biasResult.bias === "BEARISH") {
            return null;
          }

          // Skip if MACD is RED_FALLING AND it's not at support
          const isAtSupport = structure.distanceToSupport < 2;
          if (!isAtSupport && (currentMacd.state === "RED_FALLING" || structure.distanceToResistance > 15)) {
            return null;
          }

          // 4. Secondary fetch (OI & Funding)
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
            // Ignore missing OI/funding gracefully
          }

          const { setupScore, pumpScore, status, pullback, goldenPocket } = calculateScores({
            macdState: currentMacd.state,
            compression,
            volumeRatio: volRatio,
            structure,
            oiChange,
            funding,
            klines: klines5m,
            klines1h,
            bias: biasResult.bias,
            gain24h: gainMap.get(symbol) || 0
          });

          const currentPrice = klines5m[klines5m.length - 1].close;
          const change5m = ((currentPrice - klines5m[klines5m.length - 2].close) / klines5m[klines5m.length - 2].close) * 100;

          return {
            symbol,
            price: currentPrice,
            change5m,
            macdState: currentMacd.state,
            macdVal: currentMacd.macd,
            macdSignal: currentMacd.signal,
            macdHist: currentMacd.histogram,
            volRatio,
            oiChange,
            funding,
            setupScore,
            pumpScore,
            status,
            pullback,
            goldenPocket,
            trendBias: biasResult.bias,
            gain24h: gainMap.get(symbol) || 0,
            ...structure
          };

        } catch (e) {
          return null;
        }
      })
    );

    const scannedCandidates = (await Promise.all(klinePromises)).filter(Boolean);

    // Sort by Pump Score by default, but demote EXTENDED ones
    scannedCandidates.sort((a, b) => {
      if (a!.status === "⚠️ EXTENDED" && b!.status !== "⚠️ EXTENDED") return 1;
      if (b!.status === "⚠️ EXTENDED" && a!.status !== "⚠️ EXTENDED") return -1;
      return b!.pumpScore - a!.pumpScore;
    });

    const topResults = scannedCandidates.slice(0, 100);
    const durationMs = Date.now() - startTime;

    // Save to Supabase (non-blocking if possible, or await it)
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        const { data: runData, error: runError } = await supabase
          .from("scan_runs")
          .insert({
            btc_bias: "NEUTRAL", // We could fetch BTC here too
            symbols_scanned: candidateSymbols.length,
            duration_ms: durationMs,
            status: "SUCCESS"
          }).select().single();

        if (runData && topResults.length > 0) {
          const insertRows = topResults.map(r => ({
            scan_run_id: runData.id,
            symbol: r!.symbol,
            price: r!.price,
            change_15m: r!.change5m, // We keep the column name as is in DB but it's 5m data now
            volume_ratio: r!.volRatio,
            oi_change: r!.oiChange,
            funding: r!.funding,
            macd_state: r!.macdState,
            macd: String(r!.macdVal),
            macd_signal: String(r!.macdSignal),
            macd_histogram: String(r!.macdHist),
            setup_score: r!.setupScore,
            pump_score: r!.pumpScore,
            status: r!.status,
            support: r!.support,
            resistance: r!.resistance,
            breakout_trigger: r!.breakoutTrigger,
            invalidation: r!.invalidation,
            target1: r!.target1,
            target2: r!.target2
          }));
          await supabase.from("scan_results").insert(insertRows);
        }
      } catch (dbErr) {
        console.error("Database save failed", dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      durationMs,
      candidates: topResults
    });

  } catch (error) {
    console.error("Scan error:", error);
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
