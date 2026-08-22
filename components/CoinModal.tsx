"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, X, TrendingUp, TrendingDown, Shield, Zap, AlertTriangle, Target, Compass, ArrowRight } from "lucide-react";

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

  const formatPrice = (p?: number) => {
    if (p === undefined || p === null || isNaN(p)) return "0.00";
    if (p < 0.0001) return p.toFixed(8);
    if (p < 0.01) return p.toFixed(7);
    if (p < 1) return p.toFixed(6);
    if (p < 10) return p.toFixed(4);
    return p.toFixed(2);
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Bottom Sheet Modal */}
      <div className="fixed bottom-0 left-0 right-0 h-[90vh] overflow-y-auto bg-white rounded-t-3xl shadow-2xl z-50 animate-in slide-in-from-bottom duration-300 flex flex-col">
        
        {/* Handle for dragging */}
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
              <div className="text-xs font-semibold text-muted-foreground">Loading analysis & signals...</div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <div className="text-error font-medium bg-error/10 px-4 py-2 rounded-xl text-sm">{error}</div>
            </div>
          ) : data && (
            <div className="flex flex-col gap-5 pt-2">
              
              {/* Header Info */}
              <div className="text-center">
                <div className="flex justify-center items-center gap-2 mb-1">
                  <div className="w-7 h-7 rounded-full bg-orange-50 text-orange-500 font-bold flex items-center justify-center text-xs">
                    {symbol.slice(0, 1)}
                  </div>
                  <h2 className="text-base font-bold text-foreground">{symbol.replace("USDT", " / USDT")}</h2>
                </div>
                
                <div className="text-[32px] font-black text-foreground mt-1">
                  ${formatPrice(data.currentPrice)}
                </div>
                
                <div className="flex items-center justify-center gap-2 mt-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${data.gain24h >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
                    {data.gain24h > 0 ? "+" : ""}{data.gain24h?.toFixed(2)}% (24h)
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${data.oiChange >= 0 ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                    OI: {data.oiChange > 0 ? "+" : ""}{data.oiChange?.toFixed(2)}%
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    Fund: {data.funding?.toFixed(3)}%
                  </span>
                </div>
              </div>

              {/* 🎯 "WAIT FOR ENTRY POINT" DECISION BANNER */}
              {data.entryTiming && (
                <div className={`p-4 rounded-2xl border flex flex-col gap-2 ${
                  data.entryTiming.status === "READY" ? "bg-emerald-500/10 border-emerald-500/30" :
                  data.entryTiming.status === "WAIT_PULLBACK" ? "bg-amber-500/10 border-amber-500/30" :
                  data.entryTiming.status === "WAIT_BREAKOUT" ? "bg-indigo-500/10 border-indigo-500/30" :
                  data.entryTiming.status === "WAIT_RECLAIM" ? "bg-purple-500/10 border-purple-500/30" :
                  "bg-red-500/10 border-red-500/30"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Compass size={18} className={
                        data.entryTiming.status === "READY" ? "text-emerald-600" :
                        data.entryTiming.status === "WAIT_PULLBACK" ? "text-amber-600" :
                        data.entryTiming.status === "WAIT_BREAKOUT" ? "text-indigo-600" :
                        data.entryTiming.status === "WAIT_RECLAIM" ? "text-purple-600" : "text-red-600"
                      } />
                      <span className="text-xs font-black uppercase tracking-wider text-foreground">Entry Timing Decision</span>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${data.entryTiming.badgeClass}`}>
                      {data.entryTiming.badgeText}
                    </span>
                  </div>

                  <div className="text-xs font-semibold text-foreground leading-relaxed">
                    {data.entryTiming.actionGuidance}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-1 pt-2 border-t border-border/40 text-[11px]">
                    <div>
                      <span className="text-muted-foreground font-medium">Optimal Entry Zone:</span>
                      <div className="font-bold text-foreground">
                        ${formatPrice(data.entryTiming.entryZoneMin)} - ${formatPrice(data.entryTiming.entryZoneMax)}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground font-medium">Distance from Entry:</span>
                      <div className="font-bold text-foreground">
                        {data.entryTiming.distanceToEntryPct > 0 ? "+" : ""}{data.entryTiming.distanceToEntryPct}%
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* OVERHEAT WARNING IF ANY */}
              {data.overheat?.isOverheated && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-3.5 flex items-start gap-2.5">
                  <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-red-700">⚡ Overheated / Late-Long Trap Risk</div>
                    <div className="text-[11px] text-red-900/80 mt-0.5 font-medium">
                      {data.overheat.warningMessage || "High positive funding and overextended RSI. Risk of violent leverage wipeout."}
                    </div>
                  </div>
                </div>
              )}

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

              {/* ⚡ FLASH CRASH & LIQUIDITY SWEEP METRICS */}
              {data.liquidityHunt?.isFlashCrashDip && (
                <div className="bg-purple-50/50 border border-purple-200 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap size={16} className="text-purple-600 fill-purple-600" />
                    <h3 className="text-xs font-bold text-purple-900 uppercase tracking-wider">Liquidity Sweep & Dip Reversal</h3>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="bg-white p-2.5 rounded-xl border border-purple-100">
                      <div className="text-[10px] text-muted-foreground font-semibold">Dip Depth</div>
                      <div className="text-sm font-bold text-red-500">-{data.liquidityHunt.dipDepthPct}%</div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-purple-100">
                      <div className="text-[10px] text-muted-foreground font-semibold">Lower Wick %</div>
                      <div className="text-sm font-bold text-purple-700">{(data.liquidityHunt.lowerWickRatio * 100).toFixed(0)}%</div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-purple-100">
                      <div className="text-[10px] text-muted-foreground font-semibold">Bounce from Low</div>
                      <div className="text-sm font-bold text-emerald-600">+{data.liquidityHunt.wickReboundPct}%</div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-purple-100">
                      <div className="text-[10px] text-muted-foreground font-semibold">Absorption Score</div>
                      <div className="text-sm font-bold text-foreground">{data.liquidityHunt.absorptionScore}/100</div>
                    </div>
                  </div>
                </div>
              )}

              {/* 🛡️ RISK MANAGEMENT & STOP LOSS GUIDE */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shield size={16} className="text-blue-600" />
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Risk Management</h3>
                  </div>
                  <span className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                    Recommended Max Leverage: {data.structure.recommendedLeverage ?? 3}x
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-y-3.5 gap-x-4">
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-0.5">Dynamic ATR Stop Loss</div>
                    <div className="text-sm font-bold text-red-600">
                      ${formatPrice(data.structure.dynamicSl ?? data.structure.invalidation)}
                      <span className="text-[10px] text-muted-foreground font-normal ml-1">
                        (-{(((data.currentPrice - (data.structure.dynamicSl ?? data.structure.invalidation)) / data.currentPrice) * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <div className="text-[9px] text-muted-foreground">Buffered against wick hunts</div>
                  </div>

                  <div>
                    <div className="text-[11px] text-muted-foreground mb-0.5">ATR Volatility (1H)</div>
                    <div className="text-sm font-bold text-foreground">{data.structure.atrPct ?? 0}%</div>
                    <div className="text-[9px] text-muted-foreground">Expected price swing</div>
                  </div>

                  <div>
                    <div className="text-[11px] text-muted-foreground mb-0.5">Risk:Reward Ratio</div>
                    <div className={`text-sm font-bold ${data.structure.rrRatio >= 2 ? "text-emerald-600" : data.structure.rrRatio >= 1 ? "text-amber-600" : "text-red-500"}`}>
                      1 : {data.structure.rrRatio?.toFixed(1) ?? "1.0"}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-muted-foreground mb-0.5">Golden Pocket Area</div>
                    <div className="text-sm font-bold text-amber-600">
                      ${formatPrice(data.goldenPocket?.bottom)} - ${formatPrice(data.goldenPocket?.top)}
                    </div>
                  </div>
                </div>
              </div>

              {/* 🎯 BULL MARKET EXPANSION TARGETS */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Target size={16} className="text-emerald-600" />
                  <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Bull Market Multi-Targets</h3>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-muted/30 p-2.5 rounded-xl border border-border/50">
                    <div className="text-[10px] text-muted-foreground font-semibold">Target 1 (Resistance)</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">${formatPrice(data.structure.target1)}</div>
                    <div className="text-[9px] text-emerald-600 font-bold">
                      +{(((data.structure.target1 - data.currentPrice) / data.currentPrice) * 100).toFixed(1)}%
                    </div>
                  </div>

                  <div className="bg-muted/30 p-2.5 rounded-xl border border-border/50">
                    <div className="text-[10px] text-muted-foreground font-semibold">Target 2 (1.272 Fib)</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">${formatPrice(data.structure.target2)}</div>
                    <div className="text-[9px] text-emerald-600 font-bold">
                      +{(((data.structure.target2 - data.currentPrice) / data.currentPrice) * 100).toFixed(1)}%
                    </div>
                  </div>

                  <div className="bg-muted/30 p-2.5 rounded-xl border border-border/50">
                    <div className="text-[10px] text-muted-foreground font-semibold">Target 3 (1.618 Fib)</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">${formatPrice(data.structure.target3)}</div>
                    <div className="text-[9px] text-emerald-600 font-bold">
                      +{(((data.structure.target3 - data.currentPrice) / data.currentPrice) * 100).toFixed(1)}%
                    </div>
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
