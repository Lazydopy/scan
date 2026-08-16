"use client";

import { useState } from "react";
import BtcStatus from "@/components/BtcStatus";
import CandidateCard from "@/components/CandidateCard";
import CoinModal from "@/components/CoinModal";
import MarketHeatmap from "@/components/MarketHeatmap";
import { Search, Loader2, LayoutGrid, ScanLine } from "lucide-react";

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [marketData, setMarketData] = useState<any>(null);
  const [error, setError] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [filterStrategy, setFilterStrategy] = useState<"ALL" | "PRE-BREAKOUT" | "WATCH">("ALL");
  const [currentTab, setCurrentTab] = useState<"SCANNER" | "MARKET">("SCANNER");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    let symbol = searchQuery.trim().toUpperCase();
    if (!symbol) return;
    if (!symbol.endsWith("USDT")) {
      symbol += "USDT";
    }
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
        fetch("/api/market-overview")
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

        {/* Search */}
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
        {/* Heatmap Tab */}
        <div className={currentTab === "MARKET" ? "block" : "hidden"}>
          {!marketData && !isScanning ? (
            <div className="flex flex-col justify-center items-center py-20 opacity-50">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <LayoutGrid size={24} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Press the scan button to fetch data</p>
            </div>
          ) : (
            <MarketHeatmap 
              data={marketData} 
              loading={isScanning} 
              onSelectCoin={setSelectedSymbol} 
            />
          )}
        </div>

        {/* Scanner Tab */}
        <div className={currentTab === "SCANNER" ? "flex flex-col gap-6" : "hidden"}>
          <section>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-[13px] font-bold text-foreground">Market Stock</h2>
          </div>
          <BtcStatus />
        </section>

        {candidates.length === 0 && !isScanning && !error && (
          <section className="flex-1 flex flex-col justify-center items-center mt-4 opacity-50">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Search size={24} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No recent signals</p>
          </section>
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
              <h2 className="text-[13px] font-bold text-foreground">Recent Signals <span className="text-muted-foreground font-normal ml-1">({candidates.length} found)</span></h2>
              <span className="text-[11px] font-semibold text-muted-foreground">Sort <span className="ml-1">▼</span></span>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 mb-2 bg-muted/30 p-1 rounded-xl">
              <button 
                onClick={() => setFilterStrategy("ALL")}
                className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-all ${filterStrategy === "ALL" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                All
              </button>
              <button 
                onClick={() => setFilterStrategy("PRE-BREAKOUT")}
                className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-all ${filterStrategy === "PRE-BREAKOUT" ? "bg-white shadow-sm text-success" : "text-muted-foreground hover:text-success"}`}
              >
                Pre-Breakout
              </button>
              <button 
                onClick={() => setFilterStrategy("WATCH")}
                className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-all ${filterStrategy === "WATCH" ? "bg-white shadow-sm text-warning" : "text-muted-foreground hover:text-warning"}`}
              >
                Watch
              </button>
            </div>

            {candidates
              .filter(c => {
                if (filterStrategy === "ALL") return true;
                if (filterStrategy === "PRE-BREAKOUT") return c.status.includes("PRE-BREAKOUT");
                if (filterStrategy === "WATCH") return c.status.includes("WATCH");
                return true;
              })
              .map((c, index) => (
              <CandidateCard 
                key={c.symbol} 
                candidate={c} 
                rank={index + 1} 
                onSelect={(symbol) => setSelectedSymbol(symbol)}
              />
            ))}
            
            {candidates.filter(c => {
                if (filterStrategy === "ALL") return true;
                if (filterStrategy === "PRE-BREAKOUT") return c.status.includes("PRE-BREAKOUT");
                if (filterStrategy === "WATCH") return c.status.includes("WATCH");
                return true;
              }).length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-xs font-medium">
                  No coins match this filter.
                </div>
            )}
          </section>
        )}
        </div>
      </main>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-6 py-4 flex justify-between items-center z-40 pb-safe shadow-[0_-4px_20px_rgb(0,0,0,0.03)]">
        <button 
          onClick={() => setCurrentTab("SCANNER")}
          className={`flex flex-col items-center gap-1 transition-all flex-1 ${currentTab === "SCANNER" ? "text-primary scale-105" : "text-muted-foreground hover:text-foreground"}`}
        >
          <ScanLine size={22} strokeWidth={currentTab === "SCANNER" ? 2.5 : 2} />
          <span className="text-[10px] font-bold">Scanner</span>
        </button>

        {/* Universal Central Refresh Button */}
        <div className="relative -top-7 flex-shrink-0">
          <button
            onClick={handleScan}
            disabled={isScanning}
            className="bg-primary text-white p-4 rounded-full shadow-[0_8px_20px_rgba(59,130,246,0.4)] hover:bg-primary-hover active:scale-95 transition-all flex items-center justify-center disabled:opacity-80 disabled:scale-95"
          >
            {isScanning ? <Loader2 size={24} className="animate-spin" /> : <Search size={24} strokeWidth={3} />}
          </button>
        </div>

        <button 
          onClick={() => setCurrentTab("MARKET")}
          className={`flex flex-col items-center gap-1 transition-all flex-1 ${currentTab === "MARKET" ? "text-primary scale-105" : "text-muted-foreground hover:text-foreground"}`}
        >
          <LayoutGrid size={22} strokeWidth={currentTab === "MARKET" ? 2.5 : 2} />
          <span className="text-[10px] font-bold">Overview</span>
        </button>
      </div>

      {/* Coin Details Modal */}
      {selectedSymbol && (
        <CoinModal 
          symbol={selectedSymbol} 
          onClose={() => setSelectedSymbol(null)} 
        />
      )}
    </div>
  );
}
