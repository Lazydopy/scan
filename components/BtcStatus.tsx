"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, ShieldAlert, Zap, AlertTriangle, Activity } from "lucide-react";

type CoinData = {
  price: number;
  change5m?: number;
  change15m: number;
  change1h: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
};

type MarketRegime = {
  regime: string;
  title: string;
  description: string;
  circuitBreakerActive: boolean;
  dipHunterActive: boolean;
  btcVelocity5m: number;
  btcVelocity15m: number;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  recommendedAction: string;
};

type MarketData = {
  btc: CoinData;
  eth: CoinData;
  marketRegime?: MarketRegime;
};

export default function BtcStatus() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const res = await fetch("/api/btc-status");
        if (!res.ok) throw new Error("Failed");
        
        const data = await res.json();
        setData(data);
      } catch (err) {
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchInitial();
  }, []);

  useEffect(() => {
    if (!data) return;

    const connectWs = (symbol: string, key: "btc" | "eth") => {
      const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol}@ticker`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.e === "24hrTicker") {
            const price = parseFloat(msg.c);
            setData(prev => {
              if (!prev || prev[key].price === price) return prev;
              return { ...prev, [key]: { ...prev[key], price } };
            });
          }
        } catch (e) {
          // ignore ws errors
        }
      };
      return ws;
    };

    const wsBtc = connectWs("btcusdt", "btc");
    const wsEth = connectWs("ethusdt", "eth");

    return () => {
      wsBtc.close();
      wsEth.close();
    };
  }, [loading]);

  if (error) {
    return (
      <div className="p-4 border rounded-xl bg-red-50 border-red-100 text-red-600 text-xs">
        Market status currently unavailable.
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="p-4 border border-border/50 rounded-2xl bg-muted/40 animate-pulse h-28"></div>
    );
  }

  const formatPrice = (p: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p);

  const getRegimeBanner = (regime?: MarketRegime) => {
    if (!regime) return null;

    if (regime.circuitBreakerActive) {
      return (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-3 mb-3 flex items-start gap-2.5">
          <ShieldAlert size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold text-red-600">{regime.title}</div>
            <div className="text-[10px] text-red-900/80 font-medium leading-tight mt-0.5">{regime.description}</div>
            <div className="text-[9px] text-red-700 font-bold mt-1 uppercase tracking-wider">⚠️ {regime.recommendedAction}</div>
          </div>
        </div>
      );
    }

    if (regime.dipHunterActive) {
      return (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-3 mb-3 flex items-start gap-2.5">
          <Zap size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold text-emerald-700">{regime.title}</div>
            <div className="text-[10px] text-emerald-900/80 font-medium leading-tight mt-0.5">{regime.description}</div>
            <div className="text-[9px] text-emerald-700 font-bold mt-1 uppercase tracking-wider">🎯 {regime.recommendedAction}</div>
          </div>
        </div>
      );
    }

    if (regime.regime === "OVERHEATED_BULL") {
      return (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 mb-3 flex items-start gap-2.5">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold text-amber-700">{regime.title}</div>
            <div className="text-[10px] text-amber-900/80 font-medium leading-tight mt-0.5">{regime.description}</div>
            <div className="text-[9px] text-amber-800 font-bold mt-1 uppercase tracking-wider">🛡️ {regime.recommendedAction}</div>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-2.5 mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-blue-600" />
          <span className="text-[11px] font-bold text-blue-700">{regime.title}</span>
        </div>
        <span className="text-[9px] font-semibold text-muted-foreground uppercase">{regime.riskLevel} RISK</span>
      </div>
    );
  };

  const renderCoin = (title: string, coin: CoinData, iconColor: string, iconBg: string) => (
    <div className="bg-white rounded-[1.25rem] p-4 flex-1 shadow-[0_2px_10px_rgb(0,0,0,0.02)] border border-border flex flex-col justify-between h-full min-w-[140px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full ${iconBg} flex items-center justify-center`}>
            <TrendingUp size={13} className={iconColor} />
          </div>
          <h2 className="text-xs font-bold text-foreground/90">{title}</h2>
        </div>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
          coin.bias === "BULLISH" ? "bg-emerald-50 text-emerald-600 border border-emerald-200" :
          coin.bias === "BEARISH" ? "bg-red-50 text-red-600 border border-red-200" :
          "bg-gray-50 text-gray-600 border border-gray-200"
        }`}>
          {coin.bias}
        </span>
      </div>
      
      <div className="mb-2">
        <div className="text-lg font-bold text-foreground">
          {formatPrice(coin.price)}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border/50 text-[10px] font-semibold">
        <div className={`flex items-center px-1.5 py-0.5 rounded ${coin.change15m >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
          {coin.change15m >= 0 ? "+" : ""}{coin.change15m.toFixed(2)}%
          <span className="text-[8px] text-muted-foreground ml-1 font-normal uppercase">15m</span>
        </div>
        {coin.change5m !== undefined && (
          <div className={`flex items-center px-1.5 py-0.5 rounded ${coin.change5m >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
            {coin.change5m >= 0 ? "+" : ""}{coin.change5m.toFixed(2)}%
            <span className="text-[8px] text-muted-foreground ml-1 font-normal uppercase">5m</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col">
      {getRegimeBanner(data.marketRegime)}
      <div className="flex gap-3 overflow-x-auto pb-1 snap-x hide-scrollbar">
        {renderCoin("Bitcoin", data.btc, "text-orange-500", "bg-orange-50")}
        {renderCoin("Ethereum", data.eth, "text-blue-500", "bg-blue-50")}
      </div>
    </div>
  );
}
