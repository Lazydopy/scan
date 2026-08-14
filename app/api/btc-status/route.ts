import { NextResponse } from "next/server";
import { getKlines } from "@/lib/binance/api";

export const dynamic = "force-dynamic";

async function getStats(symbol: string) {
  const [klines15m, klines1h] = await Promise.all([
    getKlines(symbol, "15m", 2),
    getKlines(symbol, "1h", 2)
  ]);

  if (klines15m.length < 2 || klines1h.length < 2) {
    throw new Error("Not enough data");
  }

  const prev15m = klines15m[0];
  const prev1h = klines1h[0];
  const currentPrice = klines15m[1].close;

  const change15m = ((currentPrice - prev15m.close) / prev15m.close) * 100;
  const change1h = ((currentPrice - prev1h.close) / prev1h.close) * 100;

  let bias = "NEUTRAL";
  if (change1h > 0.5 && change15m > 0.1) bias = "BULLISH";
  if (change1h < -0.5 && change15m < -0.1) bias = "BEARISH";

  return { price: currentPrice, change15m, change1h, bias };
}

export async function GET() {
  try {
    const [btc, eth] = await Promise.all([
      getStats("BTCUSDT"),
      getStats("ETHUSDT")
    ]);
    return NextResponse.json({ btc, eth });
  } catch (error) {
    console.error("Error fetching market status:", error);
    return NextResponse.json({ error: "Failed to fetch market status" }, { status: 500 });
  }
}
