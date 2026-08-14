import { NextResponse } from "next/server";
import { getExchangeInfo, get24hTickers, getKlines, getOpenInterestHist, getPremiumIndex } from "@/lib/binance/api";
import { calculateMACD } from "@/lib/indicators/macd";
import { analyzeCompression, calculateVolumeRatio } from "@/lib/indicators/compression";
import { analyzeMarketStructure } from "@/lib/market-structure/levels";
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
      .filter((s: any) => s.quoteAsset === "USDT" && s.contractType === "PERPETUAL" && s.status === "TRADING")
      .map((s: any) => s.symbol);

    // 2. Filter by volume to avoid illiquid coins (Top ~100 by volume)
    const tickers = await get24hTickers();
    const usdtTickers = tickers
      .filter(t => symbols.includes(t.symbol))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 100);

    const candidateSymbols = usdtTickers.map(t => t.symbol);

    // 3. Fetch Klines concurrently but rate limited
    const limit = pLimit(15);
    const results = [];

    const klinePromises = candidateSymbols.map(symbol => 
      limit(async () => {
        try {
          const klines = await getKlines(symbol, "15m", 100); // Need ~100 for proper EMA seeding
          if (klines.length < 50) return null;
          
          // Use closed candles mostly, remove the last one if it's not closed
          // For simplicity we just use all returned
          const macd = calculateMACD(klines);
          const currentMacd = macd[macd.length - 1];
          const compression = analyzeCompression(klines);
          const volRatio = calculateVolumeRatio(klines);
          const structure = analyzeMarketStructure(klines);

          // Fast preliminary filter: if MACD is RED_FALLING, skip expensive OI/Funding fetch
          if (currentMacd.state === "RED_FALLING" || structure.distanceToResistance > 15) {
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

          const { setupScore, pumpScore, status } = calculateScores({
            macdState: currentMacd.state,
            compression,
            volumeRatio: volRatio,
            structure,
            oiChange,
            funding,
            klines
          });

          const currentPrice = klines[klines.length - 1].close;
          const change15m = ((currentPrice - klines[klines.length - 2].close) / klines[klines.length - 2].close) * 100;

          return {
            symbol,
            price: currentPrice,
            change15m,
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

    const topResults = scannedCandidates.slice(0, 30);
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
            change_15m: r!.change15m,
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
