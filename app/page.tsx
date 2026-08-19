"use client";

import { useState } from "react";
import BtcStatus from "@/components/BtcStatus";
import CandidateCard from "@/components/CandidateCard";
import CoinModal from "@/components/CoinModal";
import MarketHeatmap from "@/components/MarketHeatmap";
import { Search, Loader2, LayoutGrid, ScanLine, BarChart2, TrendingUp } from "lucide-react";

type Tab = "SCANNER" | "RANGE" | "MACD" | "MARKET";

function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="flex flex-col justify-center items-center py-20 opacity-50">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
        <Icon size={24} className="text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-muted-foreground text-center px-4">{message}</p>
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
      <div className="text-center py-8 text-muted-foreground text-xs font-medium">
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
  const [error, setError] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [filterStrategy, setFilterStrategy] = useState<"ALL" | "PRE-BREAKOUT" | "WATCH">("ALL");
  const [currentTab, setCurrentTab] = useState<Tab>("SCANNER");

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
    setCandidates([]);

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
      setMarketData(marketJson);
    } catch (err: any) {
      setError(err.message || "An error occurred during scan.");
    } finally {
      setIsScanning(false);
    }
  };

  // Derived filtered lists (no extra API calls)
  const rangeCandidates = candidates
    .filter((c) => c.isRangeBound)
    .sort((a, b) => (a.positionInRange ?? 50) - (b.positionInRange ?? 50)); // bottoms first

  const macdCandidates = candidates
    .filter((c) => c.macdState === "RED_IMPROVING" || c.macdState === "CROSSING_GREEN")
    .sort((a, b) => b.setupScore - a.setupScore);

  const filteredScannerCandidates = candidates.filter((c) => {
    if (filterStrategy === "ALL") return true;
    if (filterStrategy === "PRE-BREAKOUT") return c.status.includes("PRE-BREAKOUT");
    if (filterStrategy === "WATCH") return c.status.includes("WATCH");
    return true;
  });

  const navBtn = (tab: Tab, icon: any, label: string) => {
    const Icon = icon;
    const active = currentTab === tab;
    return (
      <button
        onClick={() => setCurrentTab(tab)}
        className={`flex flex-col items-center gap-0.5 transition-all flex-1 ${
          active ? "text-primary scale-105" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Icon size={20} strokeWidth={active ? 2.5 : 2} />
        <span className="text-[9px] font-bold">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="px-5 pt-10 pb-4 bg-white sticky top-0 z-20">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Pump Scanner</h1>
            <p className="text-[11px] text-muted-foreground font-medium mt-0.5">Pre-Breakout Engine</p>
          </div>
        </div>
        <form onSubmit={handleSearch} className="relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search size={16} className="text-muted-foreground" />
          </div>
          <input
            type="text"
            className="w-full bg-[#f3f4f6] border-none rounded-xl py-3.5 pl-11 pr-24 text-sm font-medium focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-muted-foreground/70"
            placeholder="Search symbol (e.g. BTC)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            type="submit"
            className="absolute right-2 top-1.5 bottom-1.5 bg-primary text-white px-4 rounded-lg text-[11px] font-bold transition-all active:scale-95"
          >
            Check
          </button>
        </form>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-5 pb-32 relative z-10 pt-4">

        {/* ── MARKET OVERVIEW ── */}
        <div className={currentTab === "MARKET" ? "block" : "hidden"}>
          {!marketData && !isScanning ? (
            <EmptyState icon={LayoutGrid} message="Press the scan button to load market overview" />
          ) : (
            <MarketHeatmap data={marketData} loading={isScanning} onSelectCoin={setSelectedSymbol} />
          )}
        </div>

        {/* ── RANGE SETUPS ── */}
        <div className={currentTab === "RANGE" ? "flex flex-col gap-4" : "hidden"}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-[14px] font-bold text-foreground">Range Setups</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Sorted: bottoms first · tap for Range Map</p>
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
              <p className="text-[11px] text-muted-foreground mt-0.5">Red → improving or crossing signal line</p>
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
            <>
              {/* MACD State legend */}
              <div className="flex gap-2">
                <div className="flex items-center gap-1 text-[9px] font-bold bg-orange-50 text-orange-600 border border-orange-100 px-2 py-1 rounded-lg">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500" /> RED_IMPROVING
                </div>
                <div className="flex items-center gap-1 text-[9px] font-bold bg-green-50 text-green-600 border border-green-100 px-2 py-1 rounded-lg">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" /> CROSSING_GREEN
                </div>
              </div>
              <CandidateList
                coins={macdCandidates}
                onSelect={setSelectedSymbol}
                emptyMessage="No coins found with MACD turning green right now."
              />
            </>
          )}
        </div>

        {/* ── SCANNER (default) ── */}
        <div className={currentTab === "SCANNER" ? "flex flex-col gap-6" : "hidden"}>
          <section>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-[13px] font-bold text-foreground">Market Stock</h2>
            </div>
            <BtcStatus />
          </section>

          {candidates.length === 0 && !isScanning && !error && (
            <EmptyState icon={Search} message="No recent signals" />
          )}

          {isScanning && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={32} className="animate-spin text-primary" />
              <div className="text-xs font-bold text-primary tracking-widest uppercase">Fetching Signals...</div>
            </div>
          )}

          {error && (
            <div className="bg-error/10 text-error p-4 rounded-2xl border border-error/20 text-center mx-5">
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
              <div className="flex justify-between items-center mb-1">
                <h2 className="text-[13px] font-bold text-foreground">
                  Recent Signals{" "}
                  <span className="text-muted-foreground font-normal ml-1">({candidates.length} found)</span>
                </h2>
              </div>

              {/* Filter Tabs */}
              <div className="flex gap-2 mb-2 bg-muted/30 p-1 rounded-xl">
                {(["ALL", "PRE-BREAKOUT", "WATCH"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilterStrategy(f)}
                    className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-all ${
                      filterStrategy === f
                        ? f === "PRE-BREAKOUT"
                          ? "bg-white shadow-sm text-success"
                          : f === "WATCH"
                          ? "bg-white shadow-sm text-warning"
                          : "bg-white shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f === "PRE-BREAKOUT" ? "Pre-Breakout" : f === "WATCH" ? "Watch" : "All"}
                  </button>
                ))}
              </div>

              <CandidateList
                coins={filteredScannerCandidates}
                onSelect={setSelectedSymbol}
                emptyMessage="No coins match this filter."
              />
            </section>
          )}
        </div>
      </main>

      {/* ── BOTTOM NAVIGATION ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 pt-3 pb-5 flex justify-between items-center z-40 shadow-[0_-4px_20px_rgb(0,0,0,0.04)]">
        {/* Left: Scanner + Range */}
        {navBtn("SCANNER", ScanLine, "Scanner")}
        {navBtn("RANGE", BarChart2, "Range")}

        {/* Centre FAB */}
        <div className="relative -top-6 flex-shrink-0 mx-3">
          <button
            onClick={handleScan}
            disabled={isScanning}
            className="bg-primary text-white p-4 rounded-full shadow-[0_8px_24px_rgba(59,130,246,0.45)] hover:bg-primary-hover active:scale-95 transition-all flex items-center justify-center disabled:opacity-70"
          >
            {isScanning ? <Loader2 size={22} className="animate-spin" /> : <Search size={22} strokeWidth={3} />}
          </button>
        </div>

        {/* Right: MACD + Overview */}
        {navBtn("MACD", TrendingUp, "MACD")}
        {navBtn("MARKET", LayoutGrid, "Overview")}
      </div>

      {/* Coin Details Modal */}
      {selectedSymbol && (
        <CoinModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} />
      )}
    </div>
  );
}
