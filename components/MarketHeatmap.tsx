"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, Activity, BarChart2 } from "lucide-react";

type MarketData = {
  totalCoins: number;
  totalUp: number;
  totalDown: number;
  distribution: {
    up10: number;
    up5: number;
    up0: number;
    down0: number;
    down5: number;
    down10: number;
  };
  topGainers: any[];
  topLosers: any[];
};

type Props = {
  data: MarketData | null;
  loading: boolean;
  error?: string;
  onSelectCoin?: (symbol: string) => void;
};

export default function MarketHeatmap({ data, loading, error, onSelectCoin }: Props) {


  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 size={32} className="animate-spin text-primary" />
        <div className="text-xs font-bold text-primary tracking-widest uppercase">Analyzing Market...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-error/10 text-error p-4 rounded-2xl border border-error/20 text-center mx-5">
        <h3 className="font-bold text-sm mb-1">Market Data Failed</h3>
        <p className="text-xs font-medium">{error}</p>
      </div>
    );
  }

  const upRatio = Math.round((data.totalUp / data.totalCoins) * 100);
  const downRatio = 100 - upRatio;

  const renderCoinCard = (coin: any, isGainer: boolean) => (
    <div 
      key={coin.symbol}
      onClick={() => onSelectCoin && onSelectCoin(coin.symbol)}
      className={`bg-white rounded-2xl p-3 shadow-sm border border-border hover:shadow-md transition-all cursor-pointer flex flex-col justify-between`}
    >
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-[13px] text-foreground leading-none">{coin.symbol.replace("USDT", "")}</h3>
        <div className={`flex items-center text-[10px] px-1.5 py-0.5 rounded font-bold ${isGainer ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
          {isGainer ? <TrendingUp size={10} className="mr-1" /> : <TrendingDown size={10} className="mr-1" />}
          {isGainer ? "+" : ""}{coin.priceChangePercent.toFixed(1)}%
        </div>
      </div>
      <div className="font-bold text-sm text-foreground/80">${coin.lastPrice.toFixed(coin.lastPrice < 1 ? 4 : 2)}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 pb-24">
      {/* Market Breadth */}
      <section>
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-[14px] font-bold text-foreground flex items-center gap-2">
            <Activity size={16} className="text-primary" /> Market Breadth
          </h2>
          <span className="text-[11px] font-semibold text-muted-foreground">{data.totalCoins} Pairs</span>
        </div>
        
        <div className="bg-white rounded-[1.25rem] p-5 shadow-sm border border-border">
          <div className="flex justify-between items-end mb-3">
            <div>
              <div className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Advancing</div>
              <div className="text-2xl font-bold text-success">{data.totalUp}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Declining</div>
              <div className="text-2xl font-bold text-error">{data.totalDown}</div>
            </div>
          </div>
          
          <div className="h-3 w-full bg-muted rounded-full overflow-hidden flex">
            <div className="h-full bg-success transition-all duration-1000" style={{ width: `${upRatio}%` }} />
            <div className="h-full bg-error transition-all duration-1000" style={{ width: `${downRatio}%` }} />
          </div>
          <div className="flex justify-between mt-2 text-[10px] font-bold text-muted-foreground">
            <span>{upRatio}%</span>
            <span>{downRatio}%</span>
          </div>
        </div>
      </section>

      {/* Distribution */}
      <section>
        <h2 className="text-[14px] font-bold text-foreground flex items-center gap-2 mb-3">
          <BarChart2 size={16} className="text-primary" /> Performance Distribution
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-success/10 border border-success/20 rounded-xl p-3 flex flex-col items-center justify-center">
            <div className="text-success font-black text-xl">{data.distribution.up10}</div>
            <div className="text-[9px] font-bold text-success/70 uppercase">&gt; 10% Pump</div>
          </div>
          <div className="bg-success/5 border border-success/10 rounded-xl p-3 flex flex-col items-center justify-center">
            <div className="text-success/80 font-bold text-lg">{data.distribution.up5}</div>
            <div className="text-[9px] font-bold text-success/60 uppercase">5% to 10%</div>
          </div>
          <div className="bg-muted/50 border border-border rounded-xl p-3 flex flex-col items-center justify-center">
            <div className="text-foreground/70 font-bold text-lg">{data.distribution.up0}</div>
            <div className="text-[9px] font-bold text-muted-foreground uppercase">0% to 5%</div>
          </div>
          
          <div className="bg-muted/50 border border-border rounded-xl p-3 flex flex-col items-center justify-center">
            <div className="text-foreground/70 font-bold text-lg">{data.distribution.down0}</div>
            <div className="text-[9px] font-bold text-muted-foreground uppercase">-5% to 0%</div>
          </div>
          <div className="bg-error/5 border border-error/10 rounded-xl p-3 flex flex-col items-center justify-center">
            <div className="text-error/80 font-bold text-lg">{data.distribution.down5}</div>
            <div className="text-[9px] font-bold text-error/60 uppercase">-10% to -5%</div>
          </div>
          <div className="bg-error/10 border border-error/20 rounded-xl p-3 flex flex-col items-center justify-center">
            <div className="text-error font-black text-xl">{data.distribution.down10}</div>
            <div className="text-[9px] font-bold text-error/70 uppercase">&lt; -10% Dump</div>
          </div>
        </div>
      </section>

      {/* Top Gainers */}
      <section>
        <h2 className="text-[14px] font-bold text-foreground mb-3 flex justify-between items-end">
          <span>Top Gainers (24h)</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {data.topGainers.slice(0, 12).map(c => renderCoinCard(c, true))}
        </div>
      </section>

      {/* Top Losers */}
      <section>
        <h2 className="text-[14px] font-bold text-foreground mb-3 flex justify-between items-end">
          <span>Top Losers (24h)</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {data.topLosers.slice(0, 6).map(c => renderCoinCard(c, false))}
        </div>
      </section>
    </div>
  );
}
