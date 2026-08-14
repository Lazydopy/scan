"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi, CandlestickSeries, HistogramSeries } from "lightweight-charts";
import { Kline } from "@/lib/binance/api";
import { MACDResult } from "@/lib/indicators/macd";

type CoinChartProps = {
  klines: Kline[];
  macd: MACDResult[];
  support: number;
  resistance: number;
  trigger: number;
};

export default function CoinChart({ klines, macd, support, resistance, trigger }: CoinChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Filter to last ~80 candles for better mobile view
    const viewKlines = klines.slice(-80);
    const viewMacd = macd.slice(-80);

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6b7280", // text-muted-foreground
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      rightPriceScale: {
        borderColor: "#e5e7eb",
        scaleMargins: {
          top: 0.1,
          bottom: 0.3, // Leave room for MACD
        },
      },
      timeScale: {
        borderColor: "#e5e7eb",
        timeVisible: true,
      },
      autoSize: true,
    });

    chartRef.current = chart;

    const currentPrice = klines[klines.length - 1].close;
    let precision = 2;
    let minMove = 0.01;
    
    if (currentPrice < 0.0001) {
      precision = 8;
      minMove = 0.00000001;
    } else if (currentPrice < 0.01) {
      precision = 7;
      minMove = 0.0000001;
    } else if (currentPrice < 1) {
      precision = 6;
      minMove = 0.000001;
    } else if (currentPrice < 10) {
      precision = 4;
      minMove = 0.0001;
    }

    // Main Candle Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#6b7280",
      downColor: "#111827",
      borderVisible: false,
      wickUpColor: "#6b7280",
      wickDownColor: "#111827",
      priceFormat: {
        type: "price",
        precision: precision,
        minMove: minMove,
      },
    });

    const candleData = viewKlines.map((k) => ({
      time: (k.closeTime / 1000) as any,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));
    candleSeries.setData(candleData);

    // Add support / resistance lines
    candleSeries.createPriceLine({
      price: support,
      color: "#111827",
      lineWidth: 1,
      lineStyle: 2,
      title: "Support",
    });

    candleSeries.createPriceLine({
      price: resistance,
      color: "#111827",
      lineWidth: 1,
      lineStyle: 0,
      title: "Resistance",
    });

    candleSeries.createPriceLine({
      price: trigger,
      color: "#6b7280",
      lineWidth: 1,
      lineStyle: 1,
      title: "Trigger",
    });

    // MACD Histogram Series
    const macdSeries = chart.addSeries(HistogramSeries, {
      color: "#3b82f6",
      priceFormat: { type: "volume" },
      priceScaleId: "", // Overlay it
    });
    
    chart.priceScale("").applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    const validMacdData = viewMacd
      .map((m, i) => {
        const isGreen = m.histogram >= 0;
        return {
          time: (viewKlines[i].closeTime / 1000) as any,
          value: m.histogram,
          color: isGreen ? "rgba(107, 114, 128, 0.5)" : "rgba(17, 24, 39, 0.5)",
        };
      })
      .filter(d => d.value !== null && !isNaN(d.value as any));

    macdSeries.setData(validMacdData);

    return () => {
      chart.remove();
    };
  }, [klines, macd, support, resistance, trigger]);

  return <div ref={chartContainerRef} className="w-full h-80" />;
}
