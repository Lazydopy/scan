import { NextResponse } from "next/server";
import { getKlines } from "@/lib/binance/api";
import { analyzeMarketRegime } from "@/lib/market-structure/market-regime";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy"
);

async function getStats(symbol: string) {
  const [klines5m, klines15m, klines1h] = await Promise.all([
    getKlines(symbol, "5m", 30),
    getKlines(symbol, "15m", 10),
    getKlines(symbol, "1h", 10)
  ]);

  if (klines5m.length < 2 || klines15m.length < 2 || klines1h.length < 2) {
    throw new Error("Not enough data");
  }

  const currentPrice = klines5m[klines5m.length - 1].close;
  const prev5m = klines5m[klines5m.length - 2].close;
  const prev15m = klines15m[0].close;
  const prev1h = klines1h[0].close;

  const change5m = prev5m > 0 ? ((currentPrice - prev5m) / prev5m) * 100 : 0;
  const change15m = prev15m > 0 ? ((currentPrice - prev15m) / prev15m) * 100 : 0;
  const change1h = prev1h > 0 ? ((currentPrice - prev1h) / prev1h) * 100 : 0;

  let bias = "NEUTRAL";
  if (change1h > 0.5 && change15m > 0.1) bias = "BULLISH";
  if (change1h < -0.5 && change15m < -0.1) bias = "BEARISH";

  return { price: currentPrice, change5m, change15m, change1h, bias, klines5m };
}

export async function GET() {
  try {
    // 1. Try Supabase fast-cache first
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://dummy.supabase.co") {
      const { data: latestRun } = await supabase
        .from("scan_runs")
        .select("status")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRun?.status) {
        try {
          const parsed = JSON.parse(latestRun.status);
          if (parsed.btcStatus) {
            return NextResponse.json(parsed.btcStatus);
          }
        } catch (e) {
          // ignore
        }
      }
    }

    // 2. Fallback to live Binance query
    const [btcData, ethData] = await Promise.all([
      getStats("BTCUSDT"),
      getStats("ETHUSDT")
    ]);

    const marketRegime = analyzeMarketRegime(btcData.klines5m, undefined, ethData.klines5m);

    return NextResponse.json({
      btc: {
        price: btcData.price,
        change5m: Math.round(btcData.change5m * 100) / 100,
        change15m: Math.round(btcData.change15m * 100) / 100,
        change1h: Math.round(btcData.change1h * 100) / 100,
        bias: btcData.bias
      },
      eth: {
        price: ethData.price,
        change5m: Math.round(ethData.change5m * 100) / 100,
        change15m: Math.round(ethData.change15m * 100) / 100,
        change1h: Math.round(ethData.change1h * 100) / 100,
        bias: ethData.bias
      },
      marketRegime
    });
  } catch (error) {
    console.error("Error fetching market status:", error);
    return NextResponse.json({ error: "Failed to fetch market status" }, { status: 500 });
  }
}
