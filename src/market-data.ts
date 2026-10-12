import { validateCandles, type Candle } from './trading';
export async function fetchMarketCandles(
  signal?: AbortSignal,
): Promise<Candle[]> {
  const response = await fetch(
    'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000',
    { signal: signal ?? AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new Error(
      `Market feed unavailable (${response.status}). Import an OHLC CSV instead.`,
    );
  const raw = await response.json();
  if (!Array.isArray(raw)) throw new Error('Unexpected candle response.');
  return validateCandles(
    raw
      .filter((r) => Array.isArray(r) && Number(r[6]) < Date.now())
      .map((r) => ({
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      })),
  );
}
export function demoCandles(): Candle[] {
  let seed = 123456,
    price = 100;
  const candles: Candle[] = [];
  for (let i = 0; i < 600; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const open = price;
    price = Math.max(
      10,
      price *
        (1 + (seed / 4294967296 - 0.5) * 0.028 + Math.sin(i / 40) * 0.003),
    );
    candles.push({
      time: Date.UTC(2025, 0, 1) + i * 3600000,
      open,
      close: price,
      high: Math.max(open, price) * 1.006,
      low: Math.min(open, price) * 0.994,
      volume: 1000,
    });
  }
  return candles;
}
