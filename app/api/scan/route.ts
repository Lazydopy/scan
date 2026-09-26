import { NextResponse } from "next/server";
import { executeMarketScan } from "@/lib/scanner/core";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy"
);

export async function POST(request?: Request) {
  try {
    // 1. Primary Path: Read latest pre-computed scan from Supabase (Sub-30ms execution, zero Binance VPN block)
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://dummy.supabase.co") {
      const { data: latestRun, error: sbError } = await supabase
        .from("scan_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sbError && latestRun && latestRun.status) {
        try {
          const parsed = JSON.parse(latestRun.status);
          return NextResponse.json({
            ...parsed,
            fromSupabase: true,
            runId: latestRun.id,
            lastScanTime: latestRun.created_at,
            symbolsScanned: latestRun.symbols_scanned
          });
        } catch (jsonErr) {
          // If status was not JSON string, continue to fallback
        }
      }
    }

    // 2. Fallback Path: If Supabase has no scan yet, run live scan
    const liveScan = await executeMarketScan();
    return NextResponse.json({
      ...liveScan,
      fromSupabase: false,
      lastScanTime: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("Scan route error:", error);
    return NextResponse.json({ error: error?.message || "Scan failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
