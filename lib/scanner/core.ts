import { getExchangeInfo, get24hTickers, getKlines, getOpenInterestHist, getPremiumIndex } from "../binance/api";
import { calculateMACD } from "../indicators/macd";
import { analyzeCompression, calculateVolumeRatio } from "../indicators/compression";
import { analyzeLiquidityHunt } from "../indicators/liquidity-hunt";
import { analyzeOverheatRisk } from "../indicators/overheat";
import { analyzeMarketStructure } from "../market-structure/levels";
import { analyzeTrendBias } from "../market-structure/bias";
import { analyzeMarketRegime } from "../market-structure/market-regime";
import { calculateScores } from "../scoring/scores";
import pLimit from "p-limit";

export interface ScanResultPayload {
  success: boolean;
  timestamp: number;
  durationMs: number;
  marketRegime: any;
  marketOverview: {
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
  btcStatus: {
    btc: {
      price: number;
      change5m: number;
      change15m: number;
      change1h: number;
      bias: string;
    };
    eth: {
      price: number;
      change5m: number;
      change15m: number;
      change1h: number;
      bias: string;
    };
    marketRegime: any;
  };
  candidates: any[];
  dipCount: number;
  readyEntryCount: number;
  symbolsScanned: number;
}

export async function executeMarketScan(): Promise<ScanResultPayload> {
  const startTime = Date.now();

  // 1. Fetch Universe, 24h Tickers, and Major Kline data in parallel
  const [exchangeInfo, tickers, btc5m, eth5m, btc15m, btc1h, eth15m, eth1h] = await Promise.all([
    getExchangeInfo(),
    get24hTickers(),
    getKlines("BTCUSDT", "5m", 30).catch(() => []),
    getKlines("ETHUSDT", "5m", 30).catch(() => []),
    getKlines("BTCUSDT", "15m", 10).catch(() => []),
    getKlines("BTCUSDT", "1h", 10).catch(() => []),
    getKlines("ETHUSDT", "15m", 10).catch(() => []),
    getKlines("ETHUSDT", "1h", 10).catch(() => [])
  ]);

  const validSymbolSet = new Set(
    exchangeInfo.symbols
      .filter((s: any) =>
        s.quoteAsset === "USDT" &&
        s.contractType === "PERPETUAL" &&
        s.status === "TRADING" &&
        s.underlyingType === "COIN"
      )
      .map((s: any) => s.symbol)
  );

  // 2. Build 24h Market Overview
  const cryptoTickers = tickers
    .filter(t => validSymbolSet.has(t.symbol))
    .map(t => ({
      symbol: t.symbol,
      priceChangePercent: parseFloat(t.priceChangePercent),
      lastPrice: parseFloat(t.lastPrice),
      quoteVolume: parseFloat(t.quoteVolume)
    }));

  const sortedByGain = [...cryptoTickers].sort((a, b) => b.priceChangePercent - a.priceChangePercent);
  const distribution = { up10: 0, up5: 0, up0: 0, down0: 0, down5: 0, down10: 0 };
  let totalUp = 0;
  let totalDown = 0;

  for (const t of cryptoTickers) {
    if (t.priceChangePercent >= 10) distribution.up10++;
    else if (t.priceChangePercent >= 5) distribution.up5++;
    else if (t.priceChangePercent >= 0) distribution.up0++;
    else if (t.priceChangePercent > -5) distribution.down0++;
    else if (t.priceChangePercent > -10) distribution.down5++;
    else distribution.down10++;

    if (t.priceChangePercent >= 0) totalUp++;
    else totalDown++;
  }

  const marketOverview = {
    totalCoins: cryptoTickers.length,
    totalUp,
    totalDown,
    distribution,
    topGainers: sortedByGain.slice(0, 20),
    topLosers: sortedByGain.slice(-20).reverse()
  };

  // 3. Compute BTC and ETH Status & Market Regime
  const calcCoinStats = (klines5m: any[], klines15m: any[], klines1h: any[]) => {
    if (!klines5m || klines5m.length < 2) return { price: 0, change5m: 0, change15m: 0, change1h: 0, bias: "NEUTRAL" };
    const cur = klines5m[klines5m.length - 1].close;
    const p5 = klines5m[klines5m.length - 2]?.close || cur;
    const p15 = klines15m?.[0]?.close || cur;
    const p1h = klines1h?.[0]?.close || cur;

    const change5m = p5 > 0 ? ((cur - p5) / p5) * 100 : 0;
    const change15m = p15 > 0 ? ((cur - p15) / p15) * 100 : 0;
    const change1h = p1h > 0 ? ((cur - p1h) / p1h) * 100 : 0;

    let bias = "NEUTRAL";
    if (change1h > 0.5 && change15m > 0.1) bias = "BULLISH";
    if (change1h < -0.5 && change15m < -0.1) bias = "BEARISH";

    return {
      price: cur,
      change5m: Math.round(change5m * 100) / 100,
      change15m: Math.round(change15m * 100) / 100,
      change1h: Math.round(change1h * 100) / 100,
      bias
    };
  };

  const btcStats = calcCoinStats(btc5m, btc15m, btc1h);
  const ethStats = calcCoinStats(eth5m, eth15m, eth1h);

  // 4. Select top 75 highest volume USDT perpetuals
  const topVolumeTickers = tickers
    .filter(t => validSymbolSet.has(t.symbol))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 75);

  const gainMap = new Map<string, number>();
  let totalDeclining = 0;
  topVolumeTickers.forEach(t => {
    const chg = parseFloat(t.priceChangePercent);
    gainMap.set(t.symbol, chg);
    if (chg < 0) totalDeclining++;
  });

  const marketDecliningPct = topVolumeTickers.length > 0 ? (totalDeclining / topVolumeTickers.length) * 100 : 50;
  const marketRegime = analyzeMarketRegime(btc5m, undefined, eth5m, marketDecliningPct);

  const btcStatus = {
    btc: btcStats,
    eth: ethStats,
    marketRegime
  };

  // 5. Fetch Klines concurrently with pLimit(20)
  const limit = pLimit(20);
  const candidateSymbols = topVolumeTickers.map(t => t.symbol);

  const klinePromises = candidateSymbols.map(symbol =>
    limit(async () => {
      try {
        const [klines5m, klines1h, klines4h] = await Promise.all([
          getKlines(symbol, "5m", 60),
          getKlines(symbol, "1h", 60),
          getKlines(symbol, "4h", 250)
        ]);

        if (klines5m.length < 30 || klines1h.length < 30) return null;

        const macd = calculateMACD(klines5m);
        const currentMacd = macd[macd.length - 1];
        const compression = analyzeCompression(klines5m);
        const volRatio = calculateVolumeRatio(klines5m);

        const structure = analyzeMarketStructure(klines1h);
        const biasResult = klines4h.length >= 50
          ? analyzeTrendBias(klines4h)
          : { bias: "NEUTRAL" as const, ema50: 0, ema200: 0, distanceToEma: 0 };

        let oiChange = 0;
        let funding = 0;
        try {
          const [oi, premium] = await Promise.all([
            getOpenInterestHist(symbol, "15m", 4).catch(() => []),
            getPremiumIndex(symbol).catch(() => null)
          ]);
          if (oi && oi.length >= 2) {
            const currentOi = parseFloat(oi[oi.length - 1].sumOpenInterest);
            const pastOi = parseFloat(oi[0].sumOpenInterest);
            oiChange = pastOi > 0 ? ((currentOi - pastOi) / pastOi) * 100 : 0;
          }
          if (premium && premium.lastFundingRate) {
            funding = parseFloat(premium.lastFundingRate) * 100;
          }
        } catch (e) {
          // Non-blocking
        }

        const liquidityHunt = analyzeLiquidityHunt(klines5m, klines1h, structure.support);
        const overheat = analyzeOverheatRisk(klines4h.length > 20 ? klines4h : klines1h, funding, oiChange, biasResult.ema50);

        if (biasResult.bias === "BEARISH" && !liquidityHunt.isFlashCrashDip) {
          return null;
        }

        const scoreResult = calculateScores({
          macdState: currentMacd.state,
          compression,
          volumeRatio: volRatio,
          structure,
          oiChange,
          funding,
          klines: klines5m,
          klines1h,
          bias: biasResult.bias,
          gain24h: gainMap.get(symbol) || 0,
          liquidityHunt,
          overheat,
          marketRegime: marketRegime.regime
        });

        const currentPrice = klines5m[klines5m.length - 1].close;
        const prev5m = klines5m[klines5m.length - 2]?.close || currentPrice;
        const change5m = prev5m > 0 ? ((currentPrice - prev5m) / prev5m) * 100 : 0;

        return {
          symbol,
          price: currentPrice,
          change5m: Math.round(change5m * 100) / 100,
          macdState: currentMacd.state,
          macdVal: currentMacd.macd,
          macdSignal: currentMacd.signal,
          macdHist: currentMacd.histogram,
          volRatio: Math.round(volRatio * 100) / 100,
          oiChange: Math.round(oiChange * 100) / 100,
          funding: Math.round(funding * 1000) / 1000,
          trendBias: biasResult.bias,
          gain24h: gainMap.get(symbol) || 0,
          setupScore: scoreResult.setupScore,
          pumpScore: scoreResult.pumpScore,
          status: scoreResult.status,
          pullback: Math.round(scoreResult.pullback * 10) / 10,
          goldenPocket: scoreResult.goldenPocket,
          entryTiming: scoreResult.entryTiming,
          isDipReversal: scoreResult.isDipReversal,
          isBullMomentum: scoreResult.isBullMomentum,
          isOverheated: scoreResult.isOverheated,
          liquidityHunt,
          overheat,
          ...structure
        };
      } catch (e) {
        return null;
      }
    })
  );

  const scannedCandidates = (await Promise.all(klinePromises)).filter(Boolean);

  scannedCandidates.sort((a, b) => {
    if (a!.status.includes("EXTENDED") && !b!.status.includes("EXTENDED")) return 1;
    if (b!.status.includes("EXTENDED") && !a!.status.includes("EXTENDED")) return -1;
    if (a!.isDipReversal && !b!.isDipReversal) return -1;
    if (b!.isDipReversal && !a!.isDipReversal) return 1;
    return b!.pumpScore - a!.pumpScore;
  });

  const topResults = scannedCandidates.slice(0, 60);
  const durationMs = Date.now() - startTime;

  return {
    success: true,
    timestamp: Date.now(),
    durationMs,
    marketRegime,
    marketOverview,
    btcStatus,
    candidates: topResults,
    dipCount: topResults.filter(c => c!.isDipReversal).length,
    readyEntryCount: topResults.filter(c => c!.entryTiming?.status === "READY").length,
    symbolsScanned: candidateSymbols.length
  };
}
