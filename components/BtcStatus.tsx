"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type CoinData = {
  price: number;
  change15m: number;
  change1h: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
};

type MarketData = {
  btc: CoinData;
  eth: CoinData;
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
    // 2. Connect to WebSocket for live prices to save Vercel costs
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
  }, [loading]); // Only connect after loading finishes

  if (error) {
    return (
      <div className="p-4 border rounded-xl bg-red-50 border-red-100 text-red-600 text-sm">
        Failed to load market status.
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="p-4 border rounded-xl bg-muted animate-pulse h-32"></div>
    );
  }

  const formatPrice = (p: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p);

  const renderCoin = (title: string, coin: CoinData, iconColor: string, iconBg: string) => (
    <div className="bg-white rounded-[1.25rem] p-4 flex-1 shadow-[0_2px_10px_rgb(0,0,0,0.02)] border border-border flex flex-col justify-between h-full min-w-[140px]">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-full ${iconBg} flex items-center justify-center`}>
          <TrendingUp size={14} className={iconColor} />
        </div>
        <h2 className="text-xs font-semibold text-foreground/80">{title}</h2>
      </div>
      
      <div className="mb-2">
        <div className="text-xl font-bold text-foreground">
          {formatPrice(coin.price)}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border/50">
        <div className={`text-[10px] font-semibold flex items-center bg-muted px-1.5 py-0.5 rounded ${coin.change15m >= 0 ? "text-success" : "text-error"}`}>
          {coin.change15m >= 0 ? "+" : ""}{coin.change15m.toFixed(2)}%
        </div>
        <span className="text-[9px] text-muted-foreground font-medium uppercase">15m</span>
      </div>
    </div>
  );

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 snap-x hide-scrollbar">
      {renderCoin("Bitcoin", data.btc, "text-orange-500", "bg-orange-50")}
      {renderCoin("Ethereum", data.eth, "text-blue-500", "bg-blue-50")}
    </div>
  );
}
