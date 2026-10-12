import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newAccount,
  executeBar,
  metrics,
  newTradingState,
  stepTrading,
  baselineDecision,
  finishTest,
  parseCSV,
  validTradingState,
  validDecision,
  tradesCSV,
  type Candle,
  type TradeDecision,
} from '../src/trading';
import { demoCandles } from '../src/market-data';
import { localPhase, weatherName } from '../src/atmosphere';
import {
  parseModelAction,
  compactObservation,
} from '../shared/model-protocol.mjs';
import { observe } from '../src/observation';
import { Simulation } from '../src/simulation';
import { validObservation } from '../server/index.mjs';
const bar = (
  open = 100,
  high = 101,
  low = 99,
  close = 100,
  time = 1700000000000,
): Candle => ({ open, high, low, close, time, volume: 1000 });
const decision = (side: TradeDecision['side']): TradeDecision => ({
  type: 'TRADE',
  side,
  message: 'Test thesis',
});
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
test('fills next open with adverse slippage and charges both fees; mark-to-market reconciles to ledger', () => {
  const a = newAccount('nova');
  executeBar(a, bar(), decision('LONG'), 'test');
  assert.ok(a.position);
  near(a.position.entry, 100.05);
  near(a.position.quantity * a.position.entry, 2500);
  near(a.balance, 9997.5);
  executeBar(
    a,
    bar(101, 101.2, 100.8, 101, 1700003600000),
    decision('FLAT'),
    'test',
  );
  assert.equal(a.trades.length, 1);
  const t = a.trades[0];
  near(t.exit, 100.9495);
  near(t.fees, 2.5 + t.exit * t.quantity * 0.001);
  near(a.equity, 10000 + t.pnl);
  assert.equal(t.source, 'test');
});
test('shorts use adverse fills and no leverage; stop wins when stop and target both touched', () => {
  for (const side of ['LONG', 'SHORT'] as const) {
    const a = newAccount('nova');
    executeBar(a, bar(100, 106, 94, 100), decision(side), 'test');
    assert.equal(a.position, null);
    assert.equal(a.trades[0].reason, 'Stop loss');
    assert.ok(a.trades[0].pnl < 0);
    assert.ok(a.trades[0].entry * a.trades[0].quantity <= 2500.000001);
  }
  const a = newAccount('echo');
  executeBar(a, bar(), decision('SHORT'), 'test');
  executeBar(a, bar(99, 99.2, 98.8, 99), decision('FLAT'), 'test');
  assert.ok(a.trades[0].pnl > 0);
  near(a.equity, 10000 + a.trades[0].pnl);
});
test('gaps through stop fill at the adverse open; 20% loss permanently eliminates the account', () => {
  const a = newAccount('atlas');
  executeBar(a, bar(), decision('LONG'), 'test');
  executeBar(a, bar(90, 91, 89, 90), decision('HOLD'), 'test');
  assert.equal(a.trades[0].reason, 'Gap through stop');
  assert.ok(a.trades[0].exit < 90);
  const dying = newAccount('nova');
  dying.balance = 8001;
  dying.equity = 8001;
  executeBar(dying, bar(100, 101, 95, 96), decision('LONG'), 'test');
  assert.equal(dying.dead, true);
  assert.equal(dying.position, null);
  assert.ok(dying.equity <= 8000);
  const saved = structuredClone(dying);
  executeBar(dying, bar(), decision('LONG'), 'test');
  assert.deepEqual(dying, saved);
});
test('held-out tests start at 70%, use past-only observations, and liquidate residual positions', () => {
  const candles = demoCandles(),
    s = newTradingState(candles, 'Synthetic', 'DEMO');
  assert.equal(s.start, 420);
  const history = s.candles.slice(0, s.cursor);
  assert.ok(history.at(-1)!.time < s.candles[s.cursor].time);
  const decisions = s.accounts.map((a) => baselineDecision(a.id, history));
  const copy = structuredClone(history);
  const altered = structuredClone(candles);
  altered[s.cursor].close *= 100;
  assert.deepEqual(
    decisions,
    s.accounts.map((a) => baselineDecision(a.id, copy)),
  );
  stepTrading(
    s,
    [decision('LONG'), decision('SHORT'), decision('HOLD')],
    ['test', 'test', 'test'],
  );
  assert.equal(s.cursor, 421);
  assert.ok(s.accounts[0].position || s.accounts[0].trades.length);
  finishTest(s);
  assert.equal(s.completed, true);
  assert.ok(s.accounts.every((a) => a.position === null));
  for (const a of s.accounts)
    near(a.equity, 10000 + a.trades.reduce((v, t) => v + t.pnl, 0));
  assert.ok(validTradingState(s));
});
test('CSV accepts TradingView OHLC with extra columns and seconds/ISO timestamps; rejects corrupt data', () => {
  const candles = demoCandles().slice(0, 100);
  const csv = (rows: Candle[]) =>
    'time,open,high,low,close,Volume,My indicator\n' +
    rows
      .map((c) =>
        [
          new Date(c.time).toISOString(),
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
          42,
        ].join(','),
      )
      .join('\n');
  assert.deepEqual(parseCSV(csv(candles)), candles);
  const seconds = csv(candles).replaceAll(/2025-[^,\n]+Z/g, (m) =>
    String(Date.parse(m) / 1000),
  );
  assert.deepEqual(parseCSV(seconds), candles);
  assert.throws(() => parseCSV(csv(candles.slice(0, 10))));
  assert.throws(() => parseCSV(csv([...candles].reverse())));
  assert.throws(() =>
    parseCSV(csv(candles).replace(String(candles[0].high), 'NaN')),
  );
  assert.throws(() => parseCSV(csv([...candles.slice(0, 99), candles[98]])));
});
test('target qualification requires >85%, profit, sufficient trades and survival; serialized state rejects tampering', () => {
  const s = newTradingState(demoCandles(), 'Synthetic', 'DEMO');
  while (!s.completed)
    stepTrading(
      s,
      s.accounts.map((a) =>
        baselineDecision(a.id, s.candles.slice(0, s.cursor)),
      ),
      ['test', 'test', 'test'],
    );
  assert.ok(validTradingState(JSON.parse(JSON.stringify(s))));
  assert.equal(metrics(newAccount('nova')).winRate, null);
  assert.equal(metrics(newAccount('nova')).qualified, false);
  const a = newAccount('nova');
  a.equity = 10100;
  const template = s.accounts.flatMap((a) => a.trades)[0];
  a.trades = Array.from({ length: 100 }, (_, i) => ({
    ...template,
    pnl: i < 86 ? 10 : -10,
  }));
  assert.equal(metrics(a).qualified, true);
  a.equity = 9900;
  assert.equal(metrics(a).qualified, false);
  a.equity = 10100;
  a.dead = true;
  assert.equal(metrics(a).qualified, false);
  for (const mutate of [
    (s: any) => (s.accounts[0].equity = null),
    (s: any) => (s.cursor = 99999),
    (s: any) => (s.accounts[0].position = { side: 'LOL' }),
    (s: any) => (s.candles[0].close = -1),
    (s: any) => (s.start = 0),
  ]) {
    const c = structuredClone(s);
    mutate(c);
    assert.equal(validTradingState(c), false);
  }
  assert.match(tradesCSV(s), /decision_source/);
  assert.match(tradesCSV(s), /test/);
});
test('model trading contract preserves market observations and rejects unsupported trade output', () => {
  const sim = new Simulation(),
    o = observe(sim.agents[0], sim.agents, 0);
  o.trading = {
    symbol: 'BTCUSDT',
    bars: demoCandles().slice(0, 50),
    equity: 10000,
    position: 'FLAT',
    target: '85% target',
  };
  assert.ok(validObservation(o));
  assert.deepEqual(compactObservation(o).trading, o.trading);
  assert.ok(validDecision(parseModelAction(JSON.stringify(decision('LONG')))));
  assert.equal(
    validDecision({ type: 'TRADE', side: 'BUY', message: 'bad' }),
    false,
  );
  o.trading.bars = demoCandles().slice(0, 61);
  assert.equal(validObservation(o), false);
});
test('day and night use device-local time and weather codes distinguish snow from rain', () => {
  assert.equal(localPhase(new Date(2026, 0, 1, 2)).phase, 'Night session');
  assert.equal(localPhase(new Date(2026, 0, 1, 12)).phase, 'Day session');
  assert.equal(localPhase(new Date(2026, 0, 1, 18)).phase, 'Golden hour');
  assert.equal(weatherName(75), 'Snow');
  assert.equal(weatherName(61), 'Rain');
  assert.equal(weatherName(0), 'Clear');
});
