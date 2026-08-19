import { NextResponse } from "next/server";
import { getExchangeInfo, get24hTickers } from "@/lib/binance/api";

export const dynamic = "force-dynamic";
export const revalidate = 60; // optionally cache for 60 seconds

export async function GET() {
  try {
    const exchangeInfo = await getExchangeInfo();
    const validSymbols = new Set(
      exchangeInfo.symbols
        .filter((s: any) => 
          s.quoteAsset === "USDT" && 
          s.contractType === "PERPETUAL" && 
          s.status === "TRADING" &&
          s.underlyingType === "COIN"  // crypto only
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

    // Sort by price change
    const sortedTickers = [...cryptoTickers].sort((a, b) => b.priceChangePercent - a.priceChangePercent);

    // Distribution Buckets
    const distribution = {
      up10: 0,
      up5: 0,
      up0: 0,
      down0: 0,
      down5: 0,
      down10: 0
    };

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

    const topGainers = sortedTickers.slice(0, 20);
    const topLosers = sortedTickers.slice(-20).reverse();

    return NextResponse.json({
      totalCoins: cryptoTickers.length,
      totalUp,
      totalDown,
      distribution,
      topGainers,
      topLosers
    });
  } catch (error) {
    console.error("Failed to fetch market overview:", error);
    return NextResponse.json({ error: "Failed to fetch market overview" }, { status: 500 });
  }
}
