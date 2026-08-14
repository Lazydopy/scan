async function checkCoin(symbol) {
  try {
    const res = await fetch(`http://localhost:3000/api/coin/${symbol}`);
    const data = await res.json();
    if (data.error) {
      console.log(`Error for ${symbol}:`, data.error);
      return;
    }
    console.log(`\n--- ${symbol} ---`);
    console.log(`24h Gain: ${data.gain24h}%`);
    console.log(`Setup Score: ${data.setupScore}`);
    console.log(`Pump Score: ${data.pumpScore}`);
    console.log(`Status: ${data.status}`);
    console.log(`Trend Bias 4H: ${data.trendBias}`);
    console.log(`MACD State: ${data.macdState}`);
    console.log(`Support: ${data.structure.support}`);
    console.log(`Current Price: ${data.currentPrice}`);
    console.log(`Distance to Support: ${data.structure.distanceToSupport.toFixed(2)}%`);
  } catch (e) {
    console.log(`Failed to fetch ${symbol}:`, e.message);
  }
}

async function run() {
  await checkCoin("ACEUSDT");
  await checkCoin("ARKUSDT");
  await checkCoin("APEUSDT");
  await checkCoin("AKROUSDT");
}

run();
