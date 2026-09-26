import { executeMarketScan } from "../lib/scanner/core";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load environment variables from .env.local or .env
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(envLocalPath));
  for (const k in envConfig) {
    if (!process.env[k]) {
      process.env[k] = envConfig[k];
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL === "https://dummy.supabase.co") {
  console.error("❌ Error: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_SEC || "60", 10) * 1000;
const MAX_RUNS_TO_KEEP = 2; // Aggressively keep only latest 2 runs so Supabase DB stays <50 rows (<100KB)

let isRunning = false;
let runCount = 0;

async function pruneOldRuns(currentRunId: string) {
  try {
    // 1. Fetch latest 2 run IDs to keep
    const { data: latestRuns, error: fetchErr } = await supabase
      .from("scan_runs")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(MAX_RUNS_TO_KEEP);

    if (fetchErr) {
      console.warn("⚠️ [Prune Warning]:", fetchErr.message);
      return;
    }

    const keepIds = (latestRuns || []).map(r => r.id);
    if (!keepIds.includes(currentRunId)) {
      keepIds.push(currentRunId);
    }

    if (keepIds.length > 0) {
      // 2. Delete all older scan_runs.
      // Thanks to ON DELETE CASCADE on scan_results, all old scan_results rows are auto-purged!
      const { data: deleted, error: deleteErr } = await supabase
        .from("scan_runs")
        .delete()
        .not("id", "in", `(${keepIds.join(",")})`)
        .select("id");

      if (deleteErr) {
        console.warn("⚠️ [Prune Warning]:", deleteErr.message);
      } else if (deleted && deleted.length > 0) {
        console.log(`🧹 [Supabase Prune]: Auto-deleted ${deleted.length} old scan run(s) and their cascading rows.`);
      }
    }
  } catch (err: any) {
    console.warn("⚠️ [Prune Error]:", err?.message || err);
  }
}

async function runSingleCycle() {
  if (isRunning) return;
  isRunning = true;
  runCount++;

  const timeStr = new Date().toLocaleTimeString();
  console.log(`\n========================================================`);
  console.log(`🚀 [${timeStr}] Starting Scan Cycle #${runCount}...`);
  console.log(`========================================================`);

  try {
    // 1. Execute full market scan on user's ISP network (zero VPN/datacenter block)
    const scanData = await executeMarketScan();

    console.log(`✅ Scan completed in ${(scanData.durationMs / 1000).toFixed(2)}s`);
    console.log(`📊 Market Regime: ${scanData.marketRegime?.regime || "UNKNOWN"} | Coins Analyzed: ${scanData.symbolsScanned}`);
    console.log(`🎯 Top Setups: ${scanData.candidates.length} | Ready for Entry: ${scanData.readyEntryCount} | Dip Reversals: ${scanData.dipCount}`);

    // 2. Save full payload to scan_runs
    const payloadToStore = {
      ...scanData,
      workerId: "local-home-daemon",
      lastScannedAt: new Date().toISOString()
    };

    const { data: runData, error: runError } = await supabase
      .from("scan_runs")
      .insert({
        btc_bias: scanData.marketRegime?.regime || "UNKNOWN",
        symbols_scanned: scanData.symbolsScanned,
        duration_ms: scanData.durationMs,
        status: JSON.stringify(payloadToStore)
      })
      .select("id")
      .single();

    if (runError) {
      throw new Error(`Failed to insert scan_run: ${runError.message}`);
    }

    // 3. Save top 15 candidates into relational scan_results for backwards compatibility
    if (runData && scanData.candidates.length > 0) {
      const insertRows = scanData.candidates.slice(0, 15).map(r => ({
        scan_run_id: runData.id,
        symbol: r.symbol,
        price: r.price,
        change_15m: r.change5m,
        volume_ratio: r.volRatio,
        oi_change: r.oiChange,
        funding: r.funding,
        macd_state: r.macdState,
        macd: String(r.macdVal),
        macd_signal: String(r.macdSignal),
        macd_histogram: String(r.macdHist),
        setup_score: r.setupScore,
        pump_score: r.pumpScore,
        status: r.status,
        support: r.support,
        resistance: r.resistance,
        breakout_trigger: r.breakoutTrigger,
        invalidation: r.dynamicSl || r.invalidation,
        target1: r.target1,
        target2: r.target2
      }));

      await supabase.from("scan_results").insert(insertRows);
    }

    console.log(`💾 Supabase: Successfully uploaded new scan run (${runData.id.slice(0, 8)}...)`);

    // 4. Auto-clean Supabase to protect free tier storage
    await pruneOldRuns(runData.id);

  } catch (error: any) {
    console.error(`❌ Scan Cycle Error:`, error?.message || error);
  } finally {
    isRunning = false;
    console.log(`⏳ Next scan cycle in ${INTERVAL_MS / 1000} seconds... (Press Ctrl+C to exit)\n`);
  }
}

async function main() {
  console.log(`\n========================================================`);
  console.log(`📡 PUMP-SCANNER LOCAL WORKER INITIALIZING`);
  console.log(`========================================================`);
  console.log(`• Supabase Target: ${SUPABASE_URL}`);
  console.log(`• Scan Interval:   ${INTERVAL_MS / 1000}s`);
  console.log(`• Free-Tier Policy: Preserving latest ${MAX_RUNS_TO_KEEP} runs, auto-purging older data`);
  console.log(`• Binance Access:  Residential ISP (Zero VPN/Datacenter Blocks)`);
  console.log(`========================================================\n`);

  // Run immediate first scan
  await runSingleCycle();

  // Schedule recurring loop
  setInterval(runSingleCycle, INTERVAL_MS);
}

process.on("SIGINT", () => {
  console.log("\n👋 Stopping scanner daemon. Goodbye!");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Stopping scanner daemon. Goodbye!");
  process.exit(0);
});

main();
