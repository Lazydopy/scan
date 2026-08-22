"use client";

import { ChevronRight, TrendingUp, TrendingDown, Minus, Zap, Shield, Flame, AlertTriangle, Target } from "lucide-react";

type Candidate = {
  symbol: string;
  price: number;
  change5m?: number;
  change15m?: number;
  gain24h?: number;
  setupScore: number;
  pumpScore: number;
  macdState: string;
  volRatio: number;
  oiChange: number;
  status: string;
  resistance: number;
  breakoutTrigger: number;
  distanceToSupport: number;
  trendBias?: string;
  pullback?: number;
  positionInRange?: number;
  isRangeBound?: boolean;
  rangeWidth?: number;
  // Bull Market & Flash Crash fields
  isDipReversal?: boolean;
  isBullMomentum?: boolean;
  isOverheated?: boolean;
  liquidityHunt?: {
    isFlashCrashDip: boolean;
    lowerWickRatio: number;
    wickReboundPct: number;
    dipDepthPct: number;
    absorptionScore: number;
  };
  entryTiming?: {
    status: string;
    badgeText: string;
    badgeClass: string;
    distanceToEntryPct: number;
    actionGuidance: string;
  };
  atrPct?: number;
  recommendedLeverage?: number;
};

type CandidateCardProps = {
  candidate: Candidate;
  rank: number;
  onSelect?: (symbol: string) => void;
};

export default function CandidateCard({ candidate, rank, onSelect }: CandidateCardProps) {
  const getStatusBadge = (status: string) => {
    if (status.includes("DIP-REVERSAL")) {
      return (
        <div className="flex items-center text-[9px] px-1.5 py-0.5 rounded-md font-bold text-emerald-700 bg-emerald-50 border border-emerald-200">
          <Zap size={10} className="mr-1 text-emerald-600 fill-emerald-600" /> DIP REVERSAL
        </div>
      );
    }
    if (status.includes("BULL-MOMENTUM")) {
      return (
        <div className="flex items-center text-[9px] px-1.5 py-0.5 rounded-md font-bold text-orange-600 bg-orange-50 border border-orange-200">
          <Flame size={10} className="mr-1 text-orange-500" /> BULL MOMENTUM
        </div>
      );
    }
    if (status.includes("OVERHEATED")) {
      return (
        <div className="flex items-center text-[9px] px-1.5 py-0.5 rounded-md font-bold text-red-600 bg-red-50 border border-red-200">
          <AlertTriangle size={10} className="mr-1 text-red-500" /> OVERHEATED
        </div>
      );
    }
    if (status.includes("PRE-BREAKOUT")) {
      return (
        <div className="flex items-center text-[9px] px-1.5 py-0.5 rounded-md font-bold text-green-700 bg-green-50 border border-green-200">
          <TrendingUp size={10} className="mr-1 text-green-600" /> PRE-BREAKOUT
        </div>
      );
    }
    if (status.includes("RANGE-BOTTOM")) {
      return (
        <div className="flex items-center text-[9px] px-1.5 py-0.5 rounded-md font-bold text-blue-600 bg-blue-50 border border-blue-200">
          <Target size={10} className="mr-1 text-blue-500" /> RANGE-BOTTOM
        </div>
      );
    }
    if (status.includes("EXTENDED")) {
      return (
        <div className="flex items-center text-[9px] px-1.5 py-0.5 rounded-md font-bold text-red-600 bg-red-50 border border-red-200">
          <TrendingDown size={10} className="mr-1 text-red-500" /> EXTENDED
        </div>
      );
    }
    if (status.includes("WATCH")) {
      return (
        <div className="flex items-center text-[9px] px-1.5 py-0.5 rounded-md font-bold text-amber-700 bg-amber-50 border border-amber-200">
          <Minus size={10} className="mr-1 text-amber-500" /> WATCH
        </div>
      );
    }
    return (
      <div className="flex items-center text-[9px] px-1.5 py-0.5 rounded-md font-medium text-gray-500 bg-gray-50 border border-gray-200">
        {status.replace(/[^a-zA-Z-\s]/g, "").trim()}
      </div>
    );
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
      className="bg-white rounded-2xl p-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] border border-border hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] transition-all cursor-pointer flex flex-col gap-2.5"
    >
      {/* Top Row: Symbol + Score + Entry Timing Badge */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-black shadow-sm ${getRankBadge(rank)}`}>
            {candidate.symbol.slice(0, 1)}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-bold text-[15px] text-foreground leading-none">{candidate.symbol.replace("USDT", "")}</h3>
              <span className="text-[10px] text-muted-foreground font-semibold">/ USDT</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-primary font-bold">Score: {candidate.pumpScore}</span>
              {candidate.recommendedLeverage && (
                <span className="text-[9px] font-semibold text-blue-700 bg-blue-50 px-1 py-0.2 rounded border border-blue-100 flex items-center gap-0.5">
                  <Shield size={9} /> Max {candidate.recommendedLeverage}x
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Price & Changes */}
        <div className="flex flex-col items-end">
          <div className="font-black text-[15px] text-foreground">${formatPrice(candidate.price)}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[10px] font-bold ${(candidate.change5m ?? candidate.change15m ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {(candidate.change5m ?? candidate.change15m ?? 0) > 0 ? "+" : ""}{(candidate.change5m ?? candidate.change15m ?? 0).toFixed(2)}% (5m)
            </span>
          </div>
        </div>
      </div>

      {/* Middle Row: Status Badge + Entry Timing ("Wait for Entry Point") */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-border/40">
        <div className="flex flex-wrap items-center gap-1.5">
          {getStatusBadge(candidate.status)}
          
          {/* Entry Timing Action Badge */}
          {candidate.entryTiming && (
            <div className={`text-[9px] font-bold px-2 py-0.5 rounded-md border ${candidate.entryTiming.badgeClass}`}>
              {candidate.entryTiming.badgeText}
            </div>
          )}

          {/* Flash Crash Lower Wick / Rebound Badge */}
          {candidate.liquidityHunt?.isFlashCrashDip && (
            <span className="text-[9px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-md">
              Wick Rebound +{candidate.liquidityHunt.wickReboundPct}%
            </span>
          )}
        </div>

        {/* 24h & ATR stats */}
        <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-2">
          {candidate.atrPct !== undefined && (
            <span>ATR: <strong className="text-foreground">{candidate.atrPct}%</strong></span>
          )}
          {candidate.gain24h !== undefined && (
            <span>24h: <strong className={candidate.gain24h >= 0 ? "text-emerald-600" : "text-red-500"}>
              {candidate.gain24h > 0 ? "+" : ""}{candidate.gain24h.toFixed(1)}%
            </strong></span>
          )}
        </div>
      </div>

      {/* Action Guidance Text for 'Wait for Entry Point' */}
      {candidate.entryTiming?.actionGuidance && (
        <div className="text-[10px] text-muted-foreground/90 font-medium bg-muted/30 px-2 py-1 rounded-lg flex items-center justify-between">
          <span className="truncate">{candidate.entryTiming.actionGuidance}</span>
          <ChevronRight size={12} className="text-muted-foreground flex-shrink-0 ml-1" />
        </div>
      )}
    </div>
  );
}
