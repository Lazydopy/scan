"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, X, TrendingUp, TrendingDown, Minus } from "lucide-react";

const CoinChart = dynamic(() => import("@/components/CoinChart"), { ssr: false, loading: () => <div className="h-80 bg-muted/20 animate-pulse rounded-2xl w-full"></div> });

type CoinModalProps = {
  symbol: string;
  onClose: () => void;
};

export default function CoinModal({ symbol, onClose }: CoinModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Prevent background scrolling when modal is open
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  useEffect(() => {
    const fetchCoin = async () => {
      try {
        const res = await fetch(`/api/coin/${symbol}`);
        if (!res.ok) throw new Error("Failed to fetch data");
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setData(json);
      } catch (err: any) {
        setError(err.message || "Error fetching coin data");
      } finally {
        setLoading(false);
      }
    };
    fetchCoin();
  }, [symbol]);

  const formatPrice = (p: number) => {
    if (p < 0.0001) return p.toFixed(8);
    if (p < 0.01) return p.toFixed(7);
    if (p < 1) return p.toFixed(6);
    if (p < 10) return p.toFixed(4);
    return p.toFixed(2);
  };

  const getStatusColor = (status: string) => {
    if (status.includes("PRE-BREAKOUT")) return "text-success border-success/30 bg-success/5";
    if (status.includes("EXTENDED")) return "text-error border-error/30 bg-error/5";
    if (status.includes("WATCH")) return "text-warning border-warning/30 bg-warning/5";
    if (status.includes("AVOID")) return "text-error border-error/30 bg-error/5";
    return "text-muted-foreground border-border bg-muted/30";
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Bottom Sheet Modal */}
      <div className="fixed bottom-0 left-0 right-0 h-[85vh] overflow-y-auto bg-white rounded-t-3xl shadow-2xl z-50 animate-in slide-in-from-bottom duration-300 flex flex-col">
        
        {/* Handle for dragging (visual only) */}
        <div className="w-full flex justify-center pt-4 pb-2 sticky top-0 bg-white z-20">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        <div className="px-5 pb-8 pt-2 flex-1 flex flex-col relative">
          <button 
            onClick={onClose}
            className="absolute top-2 right-5 p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors z-20"
          >
            <X size={18} className="text-foreground" />
          </button>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={32} className="animate-spin text-primary" />
              <div className="text-xs font-semibold text-muted-foreground">Loading details...</div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <div className="text-error font-medium bg-error/10 px-4 py-2 rounded-xl text-sm">{error}</div>
            </div>
          ) : data && (
            <div className="flex flex-col gap-6 pt-2">
              
              {/* Header Info */}
              <div className="text-center">
                <div className="flex justify-center items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-full bg-orange-50 text-orange-500 font-bold flex items-center justify-center text-[10px]">
                    {symbol.slice(0, 1)}
                  </div>
                  <h2 className="text-sm font-semibold text-muted-foreground">{symbol.replace("USDT", " / USDT")}</h2>
                </div>
                
                <div className="text-[32px] font-bold text-foreground mt-2">
                  ${formatPrice(data.currentPrice)}
                </div>
                
                <div className="flex items-center justify-center gap-2 mt-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${data.oiChange >= 0 ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
                    {data.oiChange > 0 ? "+" : ""}{data.oiChange.toFixed(2)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground font-medium">1H Change</span>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm overflow-hidden">
                <div className="-mx-2">
                  <CoinChart 
                    klines={data.klines} 
                    macd={data.macd} 
                    support={data.structure.support} 
                    resistance={data.structure.resistance}
                    trigger={data.structure.breakoutTrigger} 
                  />
                </div>
              </div>

              {/* Analysis Scores (like Key Statistics) */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <h3 className="text-sm font-semibold mb-4 text-foreground/80">Analysis Scores</h3>
                <div className="grid grid-cols-2 gap-y-4">
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">Setup Score</div>
                    <div className="text-sm font-bold text-foreground">{data.setupScore} / 100</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">Pump Score</div>
                    <div className="text-sm font-bold text-primary">{data.pumpScore} / 100</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">MACD State (5m)</div>
                    <div className="text-sm font-semibold text-foreground">{data.macdState.replace("_", " ")}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">Vol Ratio</div>
                    <div className="text-sm font-semibold text-foreground">{data.volumeRatio.toFixed(2)}x</div>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  );
}
