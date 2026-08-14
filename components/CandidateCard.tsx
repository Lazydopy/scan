"use client";

import { ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";

type Candidate = {
  symbol: string;
  price: number;
  change15m: number;
  setupScore: number;
  pumpScore: number;
  macdState: string;
  volRatio: number;
  oiChange: number;
  status: string;
  resistance: number;
  breakoutTrigger: number;
};

type CandidateCardProps = {
  candidate: Candidate;
  rank: number;
  onSelect?: (symbol: string) => void;
};

export default function CandidateCard({ candidate, rank, onSelect }: CandidateCardProps) {
  const getStatusColor = (status: string) => {
    if (status.includes("PRE-BREAKOUT")) return "text-success border-success/30 bg-success/5";
    if (status.includes("EXTENDED")) return "text-error border-error/30 bg-error/5";
    if (status.includes("WATCH")) return "text-warning border-warning/30 bg-warning/5";
    if (status.includes("AVOID")) return "text-error border-error/30 bg-error/5";
    return "text-muted-foreground border-border bg-muted/30";
  };

  const getStatusIcon = (status: string) => {
    if (status.includes("PRE-BREAKOUT")) return <TrendingUp size={10} className="mr-1" />;
    if (status.includes("EXTENDED") || status.includes("AVOID")) return <TrendingDown size={10} className="mr-1" />;
    return <Minus size={10} className="mr-1" />;
  };

  const formatPrice = (p: number) => {
    if (p < 0.0001) return p.toFixed(8);
    if (p < 0.01) return p.toFixed(7);
    if (p < 1) return p.toFixed(6);
    if (p < 10) return p.toFixed(4);
    return p.toFixed(2);
  };

  const getRankBadge = (r: number) => {
    if (r === 1) return "bg-yellow-400 text-yellow-950 shadow-sm";
    if (r === 2) return "bg-gray-300 text-gray-800 shadow-sm";
    if (r === 3) return "bg-amber-600 text-amber-50 shadow-sm";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div 
      onClick={() => onSelect && onSelect(candidate.symbol)}
      className="bg-white rounded-2xl p-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] border border-border hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] transition-all cursor-pointer flex items-center justify-between"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-sm ${getRankBadge(rank)}`}>
          {candidate.symbol.slice(0, 1)}
        </div>
        <div>
          <h3 className="font-bold text-[15px] text-foreground leading-none mb-1">{candidate.symbol.replace("USDT", "")}</h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground font-medium">{candidate.setupScore}/100</span>
            <div className={`flex items-center text-[9px] px-1 py-0.5 rounded font-medium ${getStatusColor(candidate.status)}`}>
              {candidate.status.replace(/[^a-zA-Z-\s]/g, "").trim()}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end">
        <div className="font-bold text-[15px] text-foreground mb-1">${formatPrice(candidate.price)}</div>
        <div className={`text-[11px] font-semibold flex items-center ${candidate.change15m >= 0 ? "text-success" : "text-error"}`}>
          {candidate.change15m > 0 ? "+" : ""}{candidate.change15m.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}
