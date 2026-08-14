"use client";

import { useState } from "react";
import BtcStatus from "@/components/BtcStatus";
import CandidateCard from "@/components/CandidateCard";
import CoinModal from "@/components/CoinModal";
import { Search, Loader2 } from "lucide-react";

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [filterStrategy, setFilterStrategy] = useState<"ALL" | "MACD" | "SUPPORT">("ALL");

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
      const res = await fetch("/api/scan", { method: "POST" });
      if (!res.ok) throw new Error("Scan request failed.");
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setCandidates(data.candidates || []);
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
      <main className="flex-1 px-5 pb-24 flex flex-col gap-6 relative z-10 pt-4">
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
                onClick={() => setFilterStrategy("MACD")}
                className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-all ${filterStrategy === "MACD" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                MACD Setup
              </button>
              <button 
                onClick={() => setFilterStrategy("SUPPORT")}
                className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-all ${filterStrategy === "SUPPORT" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                At Support
              </button>
            </div>

            {candidates
              .filter(c => {
                if (filterStrategy === "ALL") return true;
                if (filterStrategy === "MACD") return c.macdState !== "RED_FALLING";
                if (filterStrategy === "SUPPORT") return c.distanceToSupport < 2;
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
                if (filterStrategy === "MACD") return c.macdState !== "RED_FALLING";
                if (filterStrategy === "SUPPORT") return c.distanceToSupport < 2;
                return true;
              }).length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-xs font-medium">
                  No coins match this filter.
                </div>
            )}
          </section>
        )}
      </main>

      {/* Floating Scan Button */}
      {!isScanning && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center z-30 pointer-events-none">
          <button
            onClick={handleScan}
            className="pointer-events-auto bg-primary text-white shadow-[0_8px_20px_rgba(59,130,246,0.3)] hover:bg-primary-hover active:scale-95 transition-all flex items-center gap-2 px-6 py-3.5 rounded-full"
          >
            <Search size={16} strokeWidth={3} />
            <span className="font-bold text-[13px]">Scan Market</span>
          </button>
        </div>
      )}

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
