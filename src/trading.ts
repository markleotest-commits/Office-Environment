export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type Side = 'LONG' | 'SHORT';
export type TradeDecision = {
  type: 'TRADE';
  side: Side | 'FLAT' | 'HOLD';
  message: string;
};
export type Position = {
  side: Side;
  quantity: number;
  entry: number;
  fee: number;
  time: number;
  stop: number;
  take: number;
  source: string;
};
export type Fill = {
  id: number;
  agent: string;
  side: Side;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  fees: number;
  reason: string;
  source: string;
};
export type Account = {
  id: string;
  balance: number;
  equity: number;
  peak: number;
  drawdown: number;
  dead: boolean;
  position: Position | null;
  trades: Fill[];
  note: string;
};
export type TradingState = {
  version: 1;
  symbol: string;
  source: string;
  mode: 'baseline' | 'models';
  split: 'holdout' | 'full';
  cursor: number;
  start: number;
  candles: Candle[];
  accounts: Account[];
  curve: { time: number; equity: number }[];
  completed: boolean;
};
export const INITIAL_FUNDS = 10000;
export const DEATH_EQUITY = 8000;
export const FEE = 0.001; // 0.10% per side
export const SLIPPAGE = 0.0005; // adverse 0.05% per fill
export const AGENT_IDS = ['nova', 'atlas', 'echo'];
export const newAccount = (id: string): Account => ({
  id,
  balance: INITIAL_FUNDS,
  equity: INITIAL_FUNDS,
  peak: INITIAL_FUNDS,
  drawdown: 0,
  dead: false,
  position: null,
  trades: [],
  note: 'Awaiting research',
});
export function newTradingState(
  candles: Candle[] = [],
  source = 'No market data',
  symbol = 'BTCUSDT',
  split: 'holdout' | 'full' = 'holdout',
  mode: 'baseline' | 'models' = 'baseline',
): TradingState {
  const start =
    split === 'holdout' ? Math.max(30, Math.floor(candles.length * 0.7)) : 30;
  return {
    version: 1,
    symbol,
    source,
    mode,
    split,
    cursor: start,
    start,
    candles,
    accounts: AGENT_IDS.map(newAccount),
    curve: [],
    completed: false,
  };
}
export function validCandle(c: any): c is Candle {
  return (
    !!c &&
    ['time', 'open', 'high', 'low', 'close', 'volume'].every(
      (k) => typeof c[k] === 'number' && Number.isFinite(c[k]),
    ) &&
    c.time > 0 &&
    c.time < 8640000000000000 &&
    c.low > 0 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) &&
    c.volume >= 0 &&
    c.high < 1e12
  );
}
export function validateCandles(candles: Candle[]) {
  if (candles.length < 100 || candles.length > 10000)
    throw new Error('Use 100–10,000 candles for a test.');
  if (
    !candles.every(
      (c, i) => validCandle(c) && (!i || c.time > candles[i - 1].time),
    )
  )
    throw new Error(
      'Candles must have valid OHLC values and unique, increasing times.',
    );
  return candles;
}
export function parseCSV(text: string): Candle[] {
  if (text.length > 8_000_000)
    throw new Error('CSV is too large (8 MB maximum).');
  const lines = text.trim().split(/\r?\n/);
  const fields = (line: string) =>
    line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  const headers = fields(lines.shift()!).map((s) => s.toLowerCase());
  const indices = ['time', 'open', 'high', 'low', 'close'].map((k) =>
    headers.indexOf(k),
  );
  if (indices.some((i) => i < 0))
    throw new Error(
      'CSV needs time, open, high, low, close columns; volume is optional.',
    );
  const volume = headers.indexOf('volume');
  const candles = lines
    .filter((l) => l.trim())
    .map((line) => {
      const f = fields(line),
        raw = f[indices[0]];
      const t = Number(raw);
      const time =
        raw !== '' && Number.isFinite(t)
          ? t < 1e12
            ? t * 1000
            : t
          : Date.parse(raw);
      if (indices.slice(1).some((i) => !f[i]))
        throw new Error('A candle contains an empty price.');
      return {
        time,
        open: Number(f[indices[1]]),
        high: Number(f[indices[2]]),
        low: Number(f[indices[3]]),
        close: Number(f[indices[4]]),
        volume: volume < 0 ? 0 : Number(f[volume]),
      };
    });
  return validateCandles(candles);
}
export function baselineDecision(id: string, history: Candle[]): TradeDecision {
  const closes = history.map((c) => c.close),
    last = closes.at(-1)!;
  const avg = (n: number) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
  const slow = avg(30),
    fast = avg(8);
  let side: TradeDecision['side'] = 'FLAT';
  if (id === 'nova')
    side =
      fast > slow * 1.002 ? 'LONG' : fast < slow * 0.998 ? 'SHORT' : 'FLAT';
  else if (id === 'atlas')
    side =
      last < slow * 0.985 ? 'LONG' : last > slow * 1.015 ? 'SHORT' : 'FLAT';
  else {
    const previous = history.slice(-21, -1);
    side =
      last > Math.max(...previous.map((c) => c.high))
        ? 'LONG'
        : last < Math.min(...previous.map((c) => c.low))
          ? 'SHORT'
          : 'HOLD';
  }
  return {
    type: 'TRADE',
    side,
    message: `${id === 'nova' ? 'Trend' : id === 'atlas' ? 'Mean reversion' : 'Breakout'} baseline · fixed parameters`,
  };
}
export function validDecision(value: any): value is TradeDecision {
  return (
    value?.type === 'TRADE' &&
    ['LONG', 'SHORT', 'FLAT', 'HOLD'].includes(value.side) &&
    typeof value.message === 'string' &&
    value.message.length <= 160
  );
}
const signed = (p: Position) => (p.side === 'LONG' ? 1 : -1);
function mark(a: Account, price: number) {
  a.equity =
    a.balance +
    (a.position
      ? signed(a.position) * a.position.quantity * (price - a.position.entry)
      : 0);
  a.peak = Math.max(a.peak, a.equity);
  a.drawdown = Math.max(a.drawdown, ((a.peak - a.equity) / a.peak) * 100);
}
function close(a: Account, raw: number, time: number, reason: string) {
  const p = a.position;
  if (!p) return;
  const price = raw * (1 - signed(p) * SLIPPAGE),
    fee = price * p.quantity * FEE;
  const gross = signed(p) * p.quantity * (price - p.entry);
  a.balance += gross - fee;
  a.trades.push({
    id: a.trades.length + 1,
    agent: a.id,
    side: p.side,
    entryTime: p.time,
    exitTime: time,
    entry: p.entry,
    exit: price,
    quantity: p.quantity,
    pnl: gross - p.fee - fee,
    fees: p.fee + fee,
    reason,
    source: p.source,
  });
  a.position = null;
  mark(a, price);
}
function checkDeath(a: Account, price: number, time: number) {
  mark(a, price);
  if (a.equity <= DEATH_EQUITY) {
    close(a, price, time, '20% capital floor');
    a.dead = true;
    a.note = 'ELIMINATED · equity reached the $8,000 capital floor';
  }
}
export function executeBar(
  a: Account,
  bar: Candle,
  decision: TradeDecision,
  source: string,
) {
  if (a.dead) return;
  // A decision based on completed history can only fill at this next bar's open.
  if (a.position) {
    const p = a.position;
    if (
      (p.side === 'LONG' && bar.open <= p.stop) ||
      (p.side === 'SHORT' && bar.open >= p.stop)
    )
      close(a, bar.open, bar.time, 'Gap through stop');
    else if (
      (p.side === 'LONG' && bar.open >= p.take) ||
      (p.side === 'SHORT' && bar.open <= p.take)
    )
      close(a, p.take, bar.time, 'Take profit at open');
  }
  checkDeath(a, bar.open, bar.time);
  if (a.dead) return;
  if (
    a.position &&
    (decision.side === 'FLAT' ||
      (decision.side !== 'HOLD' && decision.side !== a.position.side))
  )
    close(a, bar.open, bar.time, 'Signal exit');
  if (!a.position && (decision.side === 'LONG' || decision.side === 'SHORT')) {
    const sign = decision.side === 'LONG' ? 1 : -1,
      entry = bar.open * (1 + sign * SLIPPAGE);
    // 0.5% capital risk at a 2% stop, capped at 25% notional. No leverage.
    const quantity = Math.min(
      (a.balance * 0.005) / (entry * 0.02),
      (a.balance * 0.25) / entry,
    );
    const fee = entry * quantity * FEE;
    a.balance -= fee;
    a.position = {
      side: decision.side,
      quantity,
      entry,
      fee,
      time: bar.time,
      stop: entry * (1 - sign * 0.02),
      take: entry * (1 + sign * 0.04),
      source,
    };
  }
  if (a.position) {
    const p = a.position,
      stop = p.side === 'LONG' ? bar.low <= p.stop : bar.high >= p.stop,
      take = p.side === 'LONG' ? bar.high >= p.take : bar.low <= p.take;
    // OHLC cannot reveal intrabar order: take the adverse stop first if both hit.
    if (stop) close(a, p.stop, bar.time, 'Stop loss');
    else if (take) close(a, p.take, bar.time, 'Take profit');
  }
  checkDeath(a, bar.close, bar.time);
  if (!a.dead) a.note = decision.message;
}
export function finishTest(state: TradingState) {
  const c = state.candles[Math.min(state.cursor, state.candles.length) - 1];
  if (c)
    for (const a of state.accounts) {
      close(a, c.close, c.time, 'End of sample');
      checkDeath(a, c.close, c.time);
    }
  state.completed = true;
  if (c)
    state.curve.push({
      time: c.time,
      equity: state.accounts.reduce((s, a) => s + a.equity, 0),
    });
}
export function stepTrading(
  state: TradingState,
  decisions: TradeDecision[],
  sources: string[],
) {
  if (state.completed || state.cursor >= state.candles.length) return;
  const candle = state.candles[state.cursor];
  state.accounts.forEach((a, i) =>
    executeBar(a, candle, decisions[i], sources[i]),
  );
  state.cursor++;
  state.curve.push({
    time: candle.time,
    equity: state.accounts.reduce((s, a) => s + a.equity, 0),
  });
  if (
    state.cursor === state.candles.length ||
    state.accounts.every((a) => a.dead)
  )
    finishTest(state);
}
export function metrics(a: Account) {
  const wins = a.trades.filter((t) => t.pnl > 0),
    losses = a.trades.filter((t) => t.pnl < 0);
  const gain = wins.reduce((s, t) => s + t.pnl, 0),
    loss = -losses.reduce((s, t) => s + t.pnl, 0);
  return {
    winRate: a.trades.length ? (wins.length / a.trades.length) * 100 : null,
    profitFactor: loss ? gain / loss : gain ? Infinity : null,
    net: a.equity - INITIAL_FUNDS,
    closed: a.trades.length,
    qualified:
      a.trades.length >= 100 &&
      wins.length / a.trades.length > 0.85 &&
      a.equity > INITIAL_FUNDS &&
      !a.dead,
  };
}
export function tradesCSV(state: TradingState) {
  const quote = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [
    [
      'agent',
      'side',
      'entry_time',
      'exit_time',
      'entry',
      'exit',
      'quantity',
      'net_pnl',
      'fees',
      'reason',
      'decision_source',
    ],
  ];
  for (const a of state.accounts)
    for (const t of a.trades)
      rows.push([
        a.id,
        t.side,
        new Date(t.entryTime).toISOString(),
        new Date(t.exitTime).toISOString(),
        ...['entry', 'exit', 'quantity', 'pnl', 'fees'].map((k) =>
          String(t[k as keyof Fill]),
        ),
        t.reason,
        t.source,
      ]);
  return rows.map((r) => r.map(quote).join(',')).join('\n');
}
// Defensive restore: replay the stored ledger is not required, but corrupt/nonfinite accounts are rejected.
export function validTradingState(v: any): v is TradingState {
  const n = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  try {
    if (
      !v ||
      v.version !== 1 ||
      !['baseline', 'models'].includes(v.mode) ||
      !['holdout', 'full'].includes(v.split) ||
      typeof v.symbol !== 'string' ||
      v.symbol.length > 40 ||
      typeof v.source !== 'string' ||
      v.source.length > 180 ||
      typeof v.completed !== 'boolean'
    )
      return false;
    validateCandles(v.candles);
    const expected =
      v.split === 'holdout'
        ? Math.max(30, Math.floor(v.candles.length * 0.7))
        : 30;
    if (
      v.start !== expected ||
      !Number.isInteger(v.cursor) ||
      v.cursor < v.start ||
      v.cursor > v.candles.length
    )
      return false;
    if (
      !Array.isArray(v.accounts) ||
      v.accounts.length !== 3 ||
      !Array.isArray(v.curve) ||
      v.curve.length > 10002 ||
      !v.curve.every((p: any) => n(p.time) && n(p.equity))
    )
      return false;
    return v.accounts.every(
      (a: any, i: number) =>
        a.id === AGENT_IDS[i] &&
        ['balance', 'equity', 'peak', 'drawdown'].every((k) => n(a[k])) &&
        a.peak > 0 &&
        a.drawdown >= 0 &&
        typeof a.dead === 'boolean' &&
        typeof a.note === 'string' &&
        a.note.length <= 240 &&
        (!a.dead || a.position === null) &&
        (a.position === null ||
          (a.position &&
            ['LONG', 'SHORT'].includes(a.position.side) &&
            ['quantity', 'entry', 'fee', 'time', 'stop', 'take'].every(
              (k) => n(a.position[k]) && a.position[k] >= 0,
            ) &&
            a.position.quantity > 0 &&
            a.position.entry > 0 &&
            typeof a.position.source === 'string' &&
            a.position.source.length <= 100)) &&
        Array.isArray(a.trades) &&
        a.trades.length <= 10000 &&
        a.trades.every(
          (t: any) =>
            t.agent === a.id &&
            ['LONG', 'SHORT'].includes(t.side) &&
            [
              'id',
              'entryTime',
              'exitTime',
              'entry',
              'exit',
              'quantity',
              'pnl',
              'fees',
            ].every((k) => n(t[k])) &&
            t.entry > 0 &&
            t.exit > 0 &&
            t.quantity > 0 &&
            t.fees >= 0 &&
            t.exitTime >= t.entryTime &&
            typeof t.reason === 'string' &&
            t.reason.length <= 100 &&
            typeof t.source === 'string' &&
            t.source.length <= 100,
        ),
    );
  } catch {
    return false;
  }
}
