-- schema.sql
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS scan_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    btc_bias TEXT,
    symbols_scanned INTEGER,
    duration_ms INTEGER,
    status TEXT
);

CREATE TABLE IF NOT EXISTS scan_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_run_id UUID REFERENCES scan_runs(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    price NUMERIC,
    change_15m NUMERIC,
    volume_ratio NUMERIC,
    oi_change NUMERIC,
    funding NUMERIC,
    macd TEXT,
    macd_signal TEXT,
    macd_histogram TEXT,
    macd_state TEXT,
    setup_score INTEGER,
    pump_score INTEGER,
    status TEXT,
    support NUMERIC,
    resistance NUMERIC,
    breakout_trigger NUMERIC,
    invalidation NUMERIC,
    target1 NUMERIC,
    target2 NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scan_results_run_id ON scan_results(scan_run_id);
CREATE INDEX IF NOT EXISTS idx_scan_runs_created_at ON scan_runs(created_at DESC);
