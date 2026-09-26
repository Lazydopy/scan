"use client";

import { useState, useEffect } from "react";
import BtcStatus from "@/components/BtcStatus";
import CandidateCard from "@/components/CandidateCard";
import CoinModal from "@/components/CoinModal";
import MarketHeatmap from "@/components/MarketHeatmap";
import { Search, Loader2, LayoutGrid, ScanLine, BarChart2, TrendingUp, Zap, Flame, Shield, HelpCircle, Check, Copy, X } from "lucide-react";

type Tab = "SCANNER" | "DIP_HUNTER" | "RANGE" | "MACD" | "MARKET";

function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="flex flex-col justify-center items-center py-20 opacity-60">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
        <Icon size={24} className="text-muted-foreground" />
      </div>
      <p className="text-xs font-semibold text-muted-foreground text-center px-4 max-w-xs">{message}</p>
    </div>
  );
}

function CandidateList({
  coins,
  onSelect,
  emptyMessage,
}: {
  coins: any[];
  onSelect: (s: string) => void;
  emptyMessage: string;
}) {
  if (coins.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-xs font-medium bg-white rounded-2xl border border-border/50 p-6">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {coins.map((c, i) => (
        <CandidateCard key={c.symbol} candidate={c} rank={i + 1} onSelect={onSelect} />
      ))}
    </div>
  );
}

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [marketData, setMarketData] = useState<any>(null);
  const [marketRegime, setMarketRegime] = useState<any>(null);
  const [error, setError] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [filterStrategy, setFilterStrategy] = useState<"ALL" | "READY_ONLY" | "PRE-BREAKOUT" | "DIP" | "MOMENTUM" | "RANGE">("ALL");
  const [currentTab, setCurrentTab] = useState<Tab>("SCANNER");
  const [showCronModal, setShowCronModal] = useState(false);
  const [copiedCron, setCopiedCron] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [workerLive, setWorkerLive] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    let symbol = searchQuery.trim().toUpperCase();
    if (!symbol) return;
    if (!symbol.endsWith("USDT")) symbol += "USDT";
    setSelectedSymbol(symbol);
  };

  const handleScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setError("");

    try {
      const [scanRes, marketRes] = await Promise.all([
        fetch("/api/scan", { method: "POST" }),
        fetch("/api/market-overview"),
      ]);

      if (!scanRes.ok || !marketRes.ok) throw new Error("Network request failed.");

      const scanData = await scanRes.json();
      const marketJson = await marketRes.json();

      if (scanData.error) throw new Error(scanData.error);
      if (marketJson.error) throw new Error(marketJson.error);

      setCandidates(scanData.candidates || []);
      setMarketRegime(scanData.marketRegime || null);
      setMarketData(marketJson);

      if (scanData.lastScanTime) {
        setLastScanTime(scanData.lastScanTime);
        const ageSec = (Date.now() - new Date(scanData.lastScanTime).getTime()) / 1000;
        setWorkerLive(ageSec < 240); // Active if updated in last 4 mins
      }
    } catch (err: any) {
      setError(err.message || "An error occurred during scan.");
    } finally {
      setIsScanning(false);
    }
  };

  // Auto-fetch on mount & poll every 45s
  useEffect(() => {
    handleScan();
    const timer = setInterval(() => {
      handleScan();
    }, 45000);
    return () => clearInterval(timer);
  }, []);

  // Derived filtered candidate lists
  const dipCandidates = candidates.filter(
    (c) => c.isDipReversal || c.status.includes("DIP-REVERSAL") || c.liquidityHunt?.isFlashCrashDip
  ).sort((a, b) => (b.liquidityHunt?.absorptionScore ?? 0) - (a.liquidityHunt?.absorptionScore ?? 0));

  const rangeCandidates = candidates
    .filter((c) => c.isRangeBound)
    .sort((a, b) => (a.positionInRange ?? 50) - (b.positionInRange ?? 50));

  const macdCandidates = candidates
    .filter((c) => c.macdState === "RED_IMPROVING" || c.macdState === "CROSSING_GREEN")
    .sort((a, b) => b.setupScore - a.setupScore);

  const filteredScannerCandidates = candidates.filter((c) => {
    if (filterStrategy === "ALL") return true;
    if (filterStrategy === "READY_ONLY") return c.entryTiming?.status === "READY";
    if (filterStrategy === "PRE-BREAKOUT") return c.status.includes("PRE-BREAKOUT");
    if (filterStrategy === "DIP") return c.isDipReversal || c.status.includes("DIP-REVERSAL");
    if (filterStrategy === "MOMENTUM") return c.status.includes("BULL-MOMENTUM");
    if (filterStrategy === "RANGE") return c.status.includes("RANGE-BOTTOM") || c.isRangeBound;
    return true;
  });

  const readyEntryCount = candidates.filter((c) => c.entryTiming?.status === "READY").length;

  const copyCronUrl = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/api/cron`;
    navigator.clipboard.writeText(url);
    setCopiedCron(true);
    setTimeout(() => setCopiedCron(false), 2500);
  };

  const navBtn = (tab: Tab, icon: any, label: string, badgeCount?: number) => {
    const Icon = icon;
    const active = currentTab === tab;
    return (
      <button
        onClick={() => setCurrentTab(tab)}
        className={`flex flex-col items-center gap-0.5 transition-all flex-1 relative ${
          active ? "text-primary scale-105" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Icon size={19} strokeWidth={active ? 2.5 : 2} />
        <span className="text-[9px] font-bold">{label}</span>
        {badgeCount !== undefined && badgeCount > 0 && (
          <span className="absolute -top-1 right-2 bg-primary text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
            {badgeCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="px-5 pt-8 pb-3 bg-white sticky top-0 z-20 border-b border-border/40">
        <div className="flex justify-between items-center mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-foreground">Pump Scanner</h1>
              <span className="text-[9px] font-extrabold bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase">
                Bull Market v2
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-medium mt-0.5">
              Liquidity Hunts · Dip Reversals · Entry Timing
            </p>
          </div>

          <button
            onClick={() => setShowCronModal(true)}
            className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-xl border transition-all ${
              workerLive
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100/70"
                : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/70"
            }`}
            title="Worker & Sync Status"
          >
            <span className={`w-2 h-2 rounded-full ${workerLive ? "bg-emerald-500 animate-pulse" : "bg-amber-400"}`} />
            <span>{workerLive ? "Daemon Live" : "Worker Idle"}</span>
          </button>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="relative">
          <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none">
            <Search size={15} className="text-muted-foreground" />
          </div>
          <input
            type="text"
            className="w-full bg-[#f3f4f6] border-none rounded-xl py-3 pl-10 pr-20 text-xs font-semibold focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-muted-foreground/70"
            placeholder="Search coin (e.g. SOL, DOGE, SUI)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1.5 bottom-1.5 bg-primary text-white px-3.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 shadow-sm"
          >
            Analyze
          </button>
        </form>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-5 pb-32 relative z-10 pt-4">

        {/* ── ⚡ DIP HUNTER TAB (FLASH CRASH REVERSALS) ── */}
        <div className={currentTab === "DIP_HUNTER" ? "flex flex-col gap-4" : "hidden"}>
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={16} className="text-purple-600 fill-purple-600" />
              <h2 className="text-xs font-bold text-purple-900 uppercase tracking-wider">⚡ Dip Hunter: Liquidity Sweeps</h2>
            </div>
            <p className="text-[11px] text-purple-800/80 font-medium leading-relaxed">
              Detects coins that dropped violently in flash crashes, wicked below support, absorbed limit bids, and are reclaiming structural levels.
            </p>
          </div>

          {isScanning ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={32} className="animate-spin text-purple-600" />
              <div className="text-xs font-bold text-purple-600 tracking-widest uppercase">Hunting Flash Dips...</div>
            </div>
          ) : candidates.length === 0 ? (
            <EmptyState icon={Zap} message="Press scan to hunt flash crash liquidity sweeps and wick reversals" />
          ) : (
            <CandidateList
              coins={dipCandidates}
              onSelect={setSelectedSymbol}
              emptyMessage="No active flash crash dip candidates right now. Market is stable."
            />
          )}
        </div>

        {/* ── MARKET OVERVIEW ── */}
        <div className={currentTab === "MARKET" ? "block" : "hidden"}>
          {!marketData && !isScanning ? (
            <EmptyState icon={LayoutGrid} message="Press the scan button to load market breadth and overview" />
          ) : (
            <MarketHeatmap data={marketData} loading={isScanning} onSelectCoin={setSelectedSymbol} />
          )}
        </div>

        {/* ── RANGE SETUPS ── */}
        <div className={currentTab === "RANGE" ? "flex flex-col gap-4" : "hidden"}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-[14px] font-bold text-foreground">Range Setups</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Sorted: bottoms first with ATR buffers</p>
            </div>
            {rangeCandidates.length > 0 && (
              <span className="text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full">
                {rangeCandidates.filter((c) => (c.positionInRange ?? 50) <= 20).length} at bottom
              </span>
            )}
          </div>

          {isScanning ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={32} className="animate-spin text-primary" />
              <div className="text-xs font-bold text-primary tracking-widest uppercase">Scanning Ranges...</div>
            </div>
          ) : candidates.length === 0 ? (
            <EmptyState icon={BarChart2} message="Press scan to detect range-bound coins" />
          ) : (
            <CandidateList
              coins={rangeCandidates}
              onSelect={setSelectedSymbol}
              emptyMessage="No range-bound coins detected yet."
            />
          )}
        </div>

        {/* ── MACD TURNING GREEN ── */}
        <div className={currentTab === "MACD" ? "flex flex-col gap-4" : "hidden"}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-[14px] font-bold text-foreground">MACD Turning Green</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Red improving or crossing signal line</p>
            </div>
            {macdCandidates.length > 0 && (
              <span className="text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded-full">
                {macdCandidates.length} coins
              </span>
            )}
          </div>

          {isScanning ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={32} className="animate-spin text-primary" />
              <div className="text-xs font-bold text-primary tracking-widest uppercase">Scanning MACD...</div>
            </div>
          ) : candidates.length === 0 ? (
            <EmptyState icon={TrendingUp} message="Press scan to find coins where MACD is turning green" />
          ) : (
            <CandidateList
              coins={macdCandidates}
              onSelect={setSelectedSymbol}
              emptyMessage="No coins found with MACD turning green right now."
            />
          )}
        </div>

        {/* ── SCANNER (DEFAULT) ── */}
        <div className={currentTab === "SCANNER" ? "flex flex-col gap-5" : "hidden"}>
          <section>
            <div className="flex justify-between items-center mb-2.5">
              <h2 className="text-[13px] font-bold text-foreground">Market Stock & Regime</h2>
            </div>
            <BtcStatus />
          </section>

          {candidates.length === 0 && !isScanning && !error && (
            <EmptyState icon={Search} message="Press the scan button below to analyze the market and find high probability setups" />
          )}

          {isScanning && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={32} className="animate-spin text-primary" />
              <div className="text-xs font-bold text-primary tracking-widest uppercase">Running Fast Multi-Layer Scan...</div>
            </div>
          )}

          {error && (
            <div className="bg-error/10 text-error p-4 rounded-2xl border border-error/20 text-center mx-1">
              <h3 className="font-bold text-sm mb-1">Scan Failed</h3>
              <p className="text-xs font-medium">{error}</p>
              <button
                onClick={() => setError("")}
                className="mt-3 bg-error text-white px-4 py-1.5 rounded-lg font-bold text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {candidates.length > 0 && !isScanning && (
            <section className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <h2 className="text-[13px] font-bold text-foreground">
                  Scanned Signals{" "}
                  <span className="text-muted-foreground font-normal ml-1">({candidates.length} active)</span>
                </h2>
                {readyEntryCount > 0 && (
                  <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                    🎯 {readyEntryCount} in Entry Zone
                  </span>
                )}
              </div>

              {/* Enhanced Strategy Filter Tabs */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 hide-scrollbar">
                {[
                  { id: "ALL", label: "All Setups" },
                  { id: "READY_ONLY", label: "🎯 Ready to Enter" },
                  { id: "DIP", label: "⚡ Dip Reversals" },
                  { id: "PRE-BREAKOUT", label: "🟢 Pre-Breakout" },
                  { id: "MOMENTUM", label: "🔥 Momentum" },
                  { id: "RANGE", label: "🔵 Range Bottom" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilterStrategy(f.id as any)}
                    className={`text-[10px] font-bold px-3 py-1.5 rounded-xl whitespace-nowrap transition-all border ${
                      filterStrategy === f.id
                        ? "bg-foreground text-white border-foreground shadow-sm"
                        : "bg-white text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <CandidateList
                coins={filteredScannerCandidates}
                onSelect={setSelectedSymbol}
                emptyMessage="No coins match this strategy filter."
              />
            </section>
          )}
        </div>
      </main>

      {/* ── BOTTOM NAVIGATION ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-3 pt-3 pb-5 flex justify-between items-center z-40 shadow-[0_-4px_20px_rgb(0,0,0,0.04)]">
        {navBtn("SCANNER", ScanLine, "Scanner")}
        {navBtn("DIP_HUNTER", Zap, "Dip Hunter", dipCandidates.length)}

        {/* Centre FAB */}
        <div className="relative -top-6 flex-shrink-0 mx-2">
          <button
            onClick={handleScan}
            disabled={isScanning}
            className="bg-primary text-white p-4 rounded-full shadow-[0_8px_24px_rgba(59,130,246,0.45)] hover:bg-primary-hover active:scale-95 transition-all flex items-center justify-center disabled:opacity-70"
            title="Scan Market"
          >
            {isScanning ? <Loader2 size={22} className="animate-spin" /> : <Search size={22} strokeWidth={3} />}
          </button>
        </div>

        {navBtn("RANGE", BarChart2, "Range")}
        {navBtn("MARKET", LayoutGrid, "Overview")}
      </div>

      {/* Coin Details Modal */}
      {selectedSymbol && (
        <CoinModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} />
      )}

      {/* Worker & Architecture Status Modal */}
      {showCronModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-5">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm text-foreground">Sync & Worker Status</h3>
                <p className="text-[10px] text-muted-foreground">Free Tier • Zero VPN Block Architecture</p>
              </div>
              <button onClick={() => setShowCronModal(false)} className="p-1 hover:bg-muted rounded-full">
                <X size={16} />
              </button>
            </div>

            <div className={`p-3 rounded-2xl border flex items-center gap-3 ${
              workerLive ? "bg-emerald-50/70 border-emerald-200" : "bg-amber-50/70 border-amber-200"
            }`}>
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${workerLive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              <div className="text-xs">
                <div className="font-bold text-foreground">
                  {workerLive ? "Local Daemon is Actively Pushing" : "Local Daemon is Idle / Offline"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {lastScanTime ? `Last update: ${new Date(lastScanTime).toLocaleTimeString()}` : "No scan recorded yet"}
                </div>
              </div>
            </div>

            <div className="bg-muted/40 p-3.5 rounded-2xl border border-border/50 flex flex-col gap-2">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">How to Run Local Worker</span>
              <div className="bg-slate-900 text-slate-100 p-2.5 rounded-xl font-mono text-[11px] select-all">
                npm run worker
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">
                Or double-click <strong>run-worker.bat</strong> on your PC. It scans Binance using your home IP (zero VPN blocks) and auto-cleans Supabase so the database stays under 50 rows forever.
              </p>
            </div>

            <div className="text-[11px] text-muted-foreground space-y-1.5 bg-gray-50 p-3 rounded-2xl">
              <div>⚡ <strong>Vercel Site:</strong> Display only (under 30ms, 0 compute quota burned)</div>
              <div>🧹 <strong>Supabase:</strong> Free tier safe (keeps only latest 2 runs)</div>
              <div>🌐 <strong>Binance API:</strong> Residential IP (no 451/403 blocks)</div>
            </div>

            <button
              onClick={() => setShowCronModal(false)}
              className="w-full bg-foreground text-white font-bold py-2.5 rounded-xl text-xs mt-1"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
