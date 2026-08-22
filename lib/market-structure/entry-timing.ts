export type EntryStatus = 
  | "READY"              // Price is currently in prime entry zone (0-1.5% away)
  | "WAIT_PULLBACK"      // Price has run up; wait for dip back to entry zone
  | "WAIT_BREAKOUT"      // Price is consolidating; wait for trigger confirmation
  | "WAIT_RECLAIM"       // Price wicked down; wait for 5m close above reclaim level
  | "DO_NOT_ENTER";      // Overheated / bad R:R / avoid

export type EntryTimingResult = {
  status: EntryStatus;
  badgeText: string;
  badgeClass: string;
  entryZoneMin: number;
  entryZoneMax: number;
  distanceToEntryPct: number;
  triggerPrice?: number;
  actionGuidance: string;
};

type EntryTimingInput = {
  currentPrice: number;
  support: number;
  resistance: number;
  breakoutTrigger: number;
  reclaimLevel?: number;
  isFlashCrashDip?: boolean;
  isRangeBound?: boolean;
  positionInRange?: number;
  isOverheated?: boolean;
  pullbackPct?: number;
  setupStatus: string;
};

/**
 * Calculates whether the trader should ENTER NOW or WAIT for a specific entry point.
 * Solves the classic problem of FOMO-buying tops or jumping in before confirmation.
 */
export function calculateEntryTiming(input: EntryTimingInput): EntryTimingResult {
  const {
    currentPrice,
    support,
    resistance,
    breakoutTrigger,
    reclaimLevel,
    isFlashCrashDip,
    isRangeBound,
    positionInRange,
    isOverheated,
    setupStatus
  } = input;

  if (currentPrice <= 0 || support <= 0) {
    return {
      status: "DO_NOT_ENTER",
      badgeText: "🚫 Avoid",
      badgeClass: "text-gray-500 bg-gray-50 border-gray-200",
      entryZoneMin: 0,
      entryZoneMax: 0,
      distanceToEntryPct: 0,
      actionGuidance: "Insufficient data for entry."
    };
  }

  // 1. Overheated or Avoid
  if (isOverheated || setupStatus.includes("EXTENDED") || setupStatus.includes("AVOID")) {
    return {
      status: "DO_NOT_ENTER",
      badgeText: "🚫 Do Not Enter",
      badgeClass: "text-red-600 bg-red-50 border-red-200",
      entryZoneMin: support,
      entryZoneMax: support * 1.02,
      distanceToEntryPct: Math.round(((currentPrice - support) / support) * 100 * 10) / 10,
      actionGuidance: "Over-extended or overheated. Wait for a deep reset to support before considering."
    };
  }

  // 2. Flash Crash / Liquidity Dip Reversal
  if (isFlashCrashDip) {
    const targetReclaim = reclaimLevel && reclaimLevel > 0 ? reclaimLevel : support;
    const isReclaimed = currentPrice >= targetReclaim * 0.99;
    const entryMin = targetReclaim * 0.995;
    const entryMax = targetReclaim * 1.025;
    const distance = ((currentPrice - targetReclaim) / targetReclaim) * 100;

    if (isReclaimed && currentPrice <= entryMax) {
      return {
        status: "READY",
        badgeText: "🎯 Ready to Enter",
        badgeClass: "text-emerald-600 bg-emerald-50 border-emerald-200",
        entryZoneMin: entryMin,
        entryZoneMax: entryMax,
        distanceToEntryPct: Math.round(distance * 10) / 10,
        triggerPrice: targetReclaim,
        actionGuidance: `In Dip Reversal Zone. Buy dip with SL below recent wick low.`
      };
    } else if (currentPrice > entryMax) {
      return {
        status: "WAIT_PULLBACK",
        badgeText: `⏳ Wait Dip (${Math.round(distance)}%)`,
        badgeClass: "text-amber-600 bg-amber-50 border-amber-200",
        entryZoneMin: entryMin,
        entryZoneMax: entryMax,
        distanceToEntryPct: Math.round(distance * 10) / 10,
        triggerPrice: targetReclaim,
        actionGuidance: `Bounced quickly. Wait for retest dip towards $${entryMax.toFixed(currentPrice < 1 ? 4 : 2)}.`
      };
    } else {
      return {
        status: "WAIT_RECLAIM",
        badgeText: "⏳ Wait Reclaim",
        badgeClass: "text-purple-600 bg-purple-50 border-purple-200",
        entryZoneMin: entryMin,
        entryZoneMax: entryMax,
        distanceToEntryPct: Math.round(distance * 10) / 10,
        triggerPrice: targetReclaim,
        actionGuidance: `Wait for 5m candle close above $${targetReclaim.toFixed(currentPrice < 1 ? 4 : 2)} to confirm reversal.`
      };
    }
  }

  // 3. Range-Bound Setups
  if (isRangeBound && positionInRange !== undefined) {
    const rangeEntryMin = support;
    const rangeEntryMax = support * 1.03; // Within bottom 3% of range
    const distanceToSupport = ((currentPrice - support) / support) * 100;

    if (positionInRange <= 20) {
      return {
        status: "READY",
        badgeText: "🎯 At Range Bottom",
        badgeClass: "text-blue-600 bg-blue-50 border-blue-200",
        entryZoneMin: rangeEntryMin,
        entryZoneMax: rangeEntryMax,
        distanceToEntryPct: Math.round(distanceToSupport * 10) / 10,
        actionGuidance: `At range bottom support. Prime entry zone with tight SL below support.`
      };
    } else if (positionInRange >= 75) {
      return {
        status: "DO_NOT_ENTER",
        badgeText: "⛔ Near Range Top",
        badgeClass: "text-red-500 bg-red-50 border-red-200",
        entryZoneMin: rangeEntryMin,
        entryZoneMax: rangeEntryMax,
        distanceToEntryPct: Math.round(distanceToSupport * 10) / 10,
        actionGuidance: `Near resistance. Do NOT buy here. Wait for breakout or pullback to bottom.`
      };
    } else {
      return {
        status: "WAIT_PULLBACK",
        badgeText: "⏳ Wait for Range Low",
        badgeClass: "text-amber-600 bg-amber-50 border-amber-200",
        entryZoneMin: rangeEntryMin,
        entryZoneMax: rangeEntryMax,
        distanceToEntryPct: Math.round(distanceToSupport * 10) / 10,
        actionGuidance: `In middle of range. Place limit bids near $${rangeEntryMax.toFixed(currentPrice < 1 ? 4 : 2)}.`
      };
    }
  }

  // 4. Pre-Breakout & Momentum Setups
  const distanceToResistance = ((resistance - currentPrice) / currentPrice) * 100;
  const distanceToSupport = ((currentPrice - support) / support) * 100;

  // If very close to breakout trigger
  if (distanceToResistance <= 1.2 && distanceToResistance >= -0.5) {
    return {
      status: "WAIT_BREAKOUT",
      badgeText: "⏳ Wait Breakout",
      badgeClass: "text-indigo-600 bg-indigo-50 border-indigo-200",
      entryZoneMin: resistance,
      entryZoneMax: breakoutTrigger,
      distanceToEntryPct: Math.round(distanceToResistance * 10) / 10,
      triggerPrice: breakoutTrigger,
      actionGuidance: `Compressing at resistance. Place buy-stop order at $${breakoutTrigger.toFixed(currentPrice < 1 ? 4 : 2)}.`
    };
  }

  // If close to base support (Golden Pocket / Bidding area)
  if (distanceToSupport <= 2.5 && distanceToSupport >= 0) {
    return {
      status: "READY",
      badgeText: "🎯 In Bidding Zone",
      badgeClass: "text-emerald-600 bg-emerald-50 border-emerald-200",
      entryZoneMin: support,
      entryZoneMax: support * 1.025,
      distanceToEntryPct: Math.round(distanceToSupport * 10) / 10,
      actionGuidance: `Price at key support base. Safe entry zone with favorable risk-to-reward.`
    };
  }

  // Otherwise price is floating mid-level
  return {
    status: "WAIT_PULLBACK",
    badgeText: `⏳ Wait Dip (+${Math.round(distanceToSupport)}%)`,
    badgeClass: "text-amber-600 bg-amber-50 border-amber-200",
    entryZoneMin: support,
    entryZoneMax: support * 1.025,
    distanceToEntryPct: Math.round(distanceToSupport * 10) / 10,
    actionGuidance: `Wait for pullback towards support $${(support * 1.02).toFixed(currentPrice < 1 ? 4 : 2)} before entering.`
  };
}
