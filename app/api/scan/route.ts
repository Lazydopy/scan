import { NextResponse } from "next/server";
import { getExchangeInfo, get24hTickers, getKlines, getOpenInterestHist, getPremiumIndex } from "@/lib/binance/api";
import { calculateMACD } from "@/lib/indicators/macd";
import { analyzeCompression, calculateVolumeRatio } from "@/lib/indicators/compression";
import { analyzeLiquidityHunt } from "@/lib/indicators/liquidity-hunt";
import { analyzeOverheatRisk } from "@/lib/indicators/overheat";
import { analyzeMarketStructure } from "@/lib/market-structure/levels";
import { analyzeTrendBias } from "@/lib/market-structure/bias";
import { analyzeMarketRegime } from "@/lib/market-structure/market-regime";
import { calculateScores } from "@/lib/scoring/scores";
import pLimit from "p-limit";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60; // Allow function up to 60s
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy"
);

// In-memory cache to stay strictly within Vercel & Binance free-tier limits
let lastScanCache: {
  timestamp: number;
  data: any;
} | null = null;

const CACHE_TTL_MS = 45 * 1000; // 45 seconds cache

export async function POST(request?: Request) {
  const url = request ? new URL(request.url) : null;
  const forceRefresh = url?.searchParams.get("force") === "true";
  const now = Date.now();

  // Return cached scan if fresh and not explicitly forced
  if (!forceRefresh && lastScanCache && (now - lastScanCache.timestamp < CACHE_TTL_MS)) {
    return NextResponse.json({
      ...lastScanCache.data,
      cached: true,
      cachedAgeMs: now - lastScanCache.timestamp
    });
  }

  const startTime = Date.now();
  try {
    // 1. Get Universe & 24h Tickers in parallel
    const [exchangeInfo, tickers, btc5m, eth5m] = await Promise.all([
      getExchangeInfo(),
      get24hTickers(),
      getKlines("BTCUSDT", "5m", 30).catch(() => []),
      getKlines("ETHUSDT", "5m", 30).catch(() => [])
    ]);

    const validSymbolSet = new Set(
      exchangeInfo.symbols
        .filter((s: any) => 
          s.quoteAsset === "USDT" && 
          s.contractType === "PERPETUAL" && 
          s.status === "TRADING" &&
          s.underlyingType === "COIN"
        )
        .map((s: any) => s.symbol)
    );

    // 2. Select top ~75 highest volume USDT perpetuals for optimal free-tier performance
    const usdtTickers = tickers
      .filter(t => validSymbolSet.has(t.symbol))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 75);

    const gainMap = new Map<string, number>();
    let totalDeclining = 0;
    usdtTickers.forEach(t => {
      const chg = parseFloat(t.priceChangePercent);
      gainMap.set(t.symbol, chg);
      if (chg < 0) totalDeclining++;
    });

    const marketDecliningPct = usdtTickers.length > 0 ? (totalDeclining / usdtTickers.length) * 100 : 50;

    // 3. Compute Real-time Market Regime (Flash Crash / Recovery / Bull Momentum)
    const marketRegime = analyzeMarketRegime(btc5m, undefined, eth5m, marketDecliningPct);

    // 4. Fetch Klines concurrently with pLimit(20) for sub-4s completion
    const limit = pLimit(20);
    const candidateSymbols = usdtTickers.map(t => t.symbol);

    const klinePromises = candidateSymbols.map(symbol => 
      limit(async () => {
        try {
          const [klines5m, klines1h, klines4h] = await Promise.all([
            getKlines(symbol, "5m", 60),
            getKlines(symbol, "1h", 60),
            getKlines(symbol, "4h", 250)
          ]);
          
          if (klines5m.length < 30 || klines1h.length < 30) return null;

          const macd = calculateMACD(klines5m);
          const currentMacd = macd[macd.length - 1];
          const compression = analyzeCompression(klines5m);
          const volRatio = calculateVolumeRatio(klines5m);
          
          // Structure & Bias
          const structure = analyzeMarketStructure(klines1h);
          const biasResult = klines4h.length >= 50 ? analyzeTrendBias(klines4h) : { bias: "NEUTRAL" as const, ema50: 0, ema200: 0, distanceToEma: 0 };

          // Secondary fast fetches (OI & Funding)
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
            // Ignore
          }

          // Bull Market & Flash Crash Special Indicators
          const liquidityHunt = analyzeLiquidityHunt(klines5m, klines1h, structure.support);
          const overheat = analyzeOverheatRisk(klines4h.length > 20 ? klines4h : klines1h, funding, oiChange, biasResult.ema50);

          // Fast preliminary filter: if 4H Bias is BEARISH, ONLY keep if it's an active flash crash liquidity dip
          if (biasResult.bias === "BEARISH" && !liquidityHunt.isFlashCrashDip) {
            return null;
          }

          // Compute unified scores & entry timing
          const scoreResult = calculateScores({
            macdState: currentMacd.state,
            compression,
            volumeRatio: volRatio,
            structure,
            oiChange,
            funding,
            klines: klines5m,
            klines1h,
            bias: biasResult.bias,
            gain24h: gainMap.get(symbol) || 0,
            liquidityHunt,
            overheat,
            marketRegime: marketRegime.regime
          });

          const currentPrice = klines5m[klines5m.length - 1].close;
          const prev5m = klines5m[klines5m.length - 2]?.close || currentPrice;
          const change5m = prev5m > 0 ? ((currentPrice - prev5m) / prev5m) * 100 : 0;

          return {
            symbol,
            price: currentPrice,
            change5m: Math.round(change5m * 100) / 100,
            macdState: currentMacd.state,
            macdVal: currentMacd.macd,
            macdSignal: currentMacd.signal,
            macdHist: currentMacd.histogram,
            volRatio: Math.round(volRatio * 100) / 100,
            oiChange: Math.round(oiChange * 100) / 100,
            funding: Math.round(funding * 1000) / 1000,
            trendBias: biasResult.bias,
            gain24h: gainMap.get(symbol) || 0,
            // Score Results
            setupScore: scoreResult.setupScore,
            pumpScore: scoreResult.pumpScore,
            status: scoreResult.status,
            pullback: Math.round(scoreResult.pullback * 10) / 10,
            goldenPocket: scoreResult.goldenPocket,
            entryTiming: scoreResult.entryTiming,
            isDipReversal: scoreResult.isDipReversal,
            isBullMomentum: scoreResult.isBullMomentum,
            isOverheated: scoreResult.isOverheated,
            // Liquidity Hunt Metrics
            liquidityHunt,
            // Overheat Metrics
            overheat,
            // Market Structure & Volatility
            ...structure
          };

        } catch (e) {
          return null;
        }
      })
    );

    const scannedCandidates = (await Promise.all(klinePromises)).filter(Boolean);

    // Sorting: Prioritize Dip Reversals during recovery or high pump score, demote EXTENDED / OVERHEATED
    scannedCandidates.sort((a, b) => {
      if (a!.status.includes("EXTENDED") && !b!.status.includes("EXTENDED")) return 1;
      if (b!.status.includes("EXTENDED") && !a!.status.includes("EXTENDED")) return -1;
      if (a!.isDipReversal && !b!.isDipReversal) return -1;
      if (b!.isDipReversal && !a!.isDipReversal) return 1;
      return b!.pumpScore - a!.pumpScore;
    });

    const topResults = scannedCandidates.slice(0, 60);
    const durationMs = Date.now() - startTime;

    // Free-tier DB persistence: Save ONLY top 15 highest conviction setups to prevent row exhaustion
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://dummy.supabase.co") {
      try {
        const { data: runData } = await supabase
          .from("scan_runs")
          .insert({
            btc_bias: marketRegime.regime,
            symbols_scanned: candidateSymbols.length,
            duration_ms: durationMs,
            status: "SUCCESS"
          }).select().single();

        if (runData && topResults.length > 0) {
          const insertRows = topResults.slice(0, 15).map(r => ({
            scan_run_id: runData.id,
            symbol: r!.symbol,
            price: r!.price,
            change_15m: r!.change5m,
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
            invalidation: r!.dynamicSl || r!.invalidation,
            target1: r!.target1,
            target2: r!.target2
          }));
          await supabase.from("scan_results").insert(insertRows);
        }
      } catch (dbErr) {
        // Non-blocking database errors
      }
    }

    const payload = {
      success: true,
      durationMs,
      timestamp: Date.now(),
      marketRegime,
      candidates: topResults,
      dipCount: topResults.filter(c => c!.isDipReversal).length,
      readyEntryCount: topResults.filter(c => c!.entryTiming?.status === "READY").length
    };

    // Store in in-memory cache
    lastScanCache = {
      timestamp: Date.now(),
      data: payload
    };

    return NextResponse.json(payload);

  } catch (error) {
    console.error("Scan error:", error);
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // Support GET as well (e.g. for simple browser refresh or cron)
  return POST(request);
}
