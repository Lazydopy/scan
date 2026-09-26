import { NextResponse } from "next/server";
import { getExchangeInfo, get24hTickers } from "@/lib/binance/api";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy"
);

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
          if (parsed.marketOverview) {
            return NextResponse.json(parsed.marketOverview);
          }
        } catch (e) {
          // ignore
        }
      }
    }

    // 2. Fallback to live Binance query
    const exchangeInfo = await getExchangeInfo();
    const validSymbols = new Set(
      exchangeInfo.symbols
        .filter((s: any) =>
          s.quoteAsset === "USDT" &&
          s.contractType === "PERPETUAL" &&
          s.status === "TRADING" &&
          s.underlyingType === "COIN"
        )
        .map((s: any) => s.symbol)
    );

    const tickers = await get24hTickers();
    const cryptoTickers = tickers
      .filter(t => validSymbols.has(t.symbol))
      .map(t => ({
        symbol: t.symbol,
        priceChangePercent: parseFloat(t.priceChangePercent),
        lastPrice: parseFloat(t.lastPrice),
        quoteVolume: parseFloat(t.quoteVolume)
      }));

    const sortedTickers = [...cryptoTickers].sort((a, b) => b.priceChangePercent - a.priceChangePercent);
    const distribution = { up10: 0, up5: 0, up0: 0, down0: 0, down5: 0, down10: 0 };
    let totalUp = 0;
    let totalDown = 0;

    for (const t of cryptoTickers) {
      if (t.priceChangePercent >= 10) distribution.up10++;
      else if (t.priceChangePercent >= 5) distribution.up5++;
      else if (t.priceChangePercent >= 0) distribution.up0++;
      else if (t.priceChangePercent > -5) distribution.down0++;
      else if (t.priceChangePercent > -10) distribution.down5++;
      else distribution.down10++;

      if (t.priceChangePercent >= 0) totalUp++;
      else totalDown++;
    }

    return NextResponse.json({
      totalCoins: cryptoTickers.length,
      totalUp,
      totalDown,
      distribution,
      topGainers: sortedTickers.slice(0, 20),
      topLosers: sortedTickers.slice(-20).reverse()
    });
  } catch (error) {
    console.error("Failed to fetch market overview:", error);
    return NextResponse.json({ error: "Failed to fetch market overview" }, { status: 500 });
  }
}
