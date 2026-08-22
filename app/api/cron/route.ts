import { NextResponse } from "next/server";
import { POST as runScan } from "../scan/route";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy"
);

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}

async function handleCron(request: Request) {
  const startTime = Date.now();
  const url = new URL(request.url);
  const authHeader = request.headers.get("authorization");
  const secretParam = url.searchParams.get("secret");

  // Optional Secret protection if CRON_SECRET is configured in env
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const isSecretValid = 
      secretParam === expectedSecret || 
      authHeader === `Bearer ${expectedSecret}`;
    if (!isSecretValid) {
      return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
    }
  }

  try {
    // 1. Force a fresh scan run
    const fakeRequest = new Request(new URL("/api/scan?force=true", request.url).toString(), {
      method: "POST"
    });
    const scanResponse = await runScan(fakeRequest);
    const scanData = await scanResponse.json();

    if (scanData.error) {
      throw new Error(scanData.error);
    }

    // 2. Free-tier Database Pruning: Delete scan runs older than 3 days to keep DB tiny
    let prunedRunsCount = 0;
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://dummy.supabase.co") {
      try {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const { data: oldRuns } = await supabase
          .from("scan_runs")
          .delete()
          .lt("created_at", threeDaysAgo)
          .select("id");
        prunedRunsCount = oldRuns?.length || 0;
      } catch (dbErr) {
        // Non-blocking
      }
    }

    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: "Cron scan completed successfully for cron-job.org",
      durationMs,
      timestamp: new Date().toISOString(),
      marketRegime: scanData.marketRegime?.regime || "UNKNOWN",
      circuitBreakerActive: scanData.marketRegime?.circuitBreakerActive || false,
      dipHunterActive: scanData.marketRegime?.dipHunterActive || false,
      totalCandidates: scanData.candidates?.length || 0,
      readyForEntryCount: scanData.readyEntryCount || 0,
      dipReversalsFound: scanData.dipCount || 0,
      prunedOldRuns: prunedRunsCount
    });

  } catch (error: any) {
    console.error("Cron handler error:", error);
    return NextResponse.json({
      success: false,
      error: error?.message || "Cron execution failed",
      durationMs: Date.now() - startTime
    }, { status: 500 });
  }
}
