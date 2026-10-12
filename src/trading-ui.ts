import type { Simulation } from './simulation';
import type { UI } from './ui';
import type { World } from './world';
import { observe } from './observation';
import {
  baselineDecision,
  metrics,
  newTradingState,
  parseCSV,
  stepTrading,
  tradesCSV,
  validDecision,
  validTradingState,
  type TradingState,
  type TradeDecision,
} from './trading';
import { fetchMarketCandles, demoCandles } from './market-data';
const KEY = 'aurelius.trading.v1';
const money = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
const el = (id: string) => document.getElementById(id)!;
export class TradingDesk {
  state: TradingState = newTradingState();
  private running = false;
  private loading = false;
  private controller: AbortController | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private lastSave = 0;
  private saveMessage = 'Saved on this browser only';
  constructor(
    private sim: Simulation,
    private ui: UI,
    private world: World | null,
  ) {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const v = JSON.parse(saved);
        if (validTradingState(v)) this.state = v;
        else
          this.saveMessage =
            'Saved trading data could not be validated. Import data to start a new test.';
      }
    } catch {
      this.saveMessage = 'Trading storage unavailable or unreadable.';
    }
    el('research-desk').innerHTML = `
      <div class="desk-heading"><div><div class="eyebrow">02 / RESEARCH &amp; EXECUTION</div><h2>Ideas enter. Evidence decides.</h2><p>Historical paper execution · no real orders · three separate $10,000 accounts</p></div><span class="paper-badge">CAPITAL FLOOR $8,000 / AGENT</span></div>
      <div class="desk-controls"><div class="data-controls"><label>Market / CSV symbol<input id="market-symbol" value="BTCUSDT" maxlength="40" aria-label="Market symbol"></label><button id="fetch-candles" class="solid-button">Fetch BTC · 1h</button><label class="outline-button file-label">Import OHLC CSV<input id="import-candles" type="file" accept=".csv,text/csv" aria-label="Import OHLC CSV"></label><button id="demo-candles" class="text-button">Try synthetic demo</button></div>
      <div class="run-controls"><label>Decision source<select id="trading-mode"><option value="baseline">Fixed baselines · not AI</option><option value="models">Assigned AI models</option></select></label><label>Evaluation<select id="evaluation-split"><option value="holdout">Last 30% · held-out period</option><option value="full">Full sample · exploratory</option></select></label><button id="run-backtest" class="solid-button">Run test</button><button id="pause-backtest" class="outline-button" disabled>Pause test</button><button id="new-backtest" class="text-button">New test</button></div></div>
      <p id="data-status" class="data-status"></p><p id="test-status" class="test-status" role="status">Load historical data to begin.</p><progress id="test-progress" value="0" max="1" aria-label="Backtest progress"></progress>
      <div class="research-pipeline"><span><b>01 RESEARCH</b> Completed candles only</span><span><b>02 STRATEGY</b> Model thesis / fixed baseline</span><span><b>03 RISK</b> 0.5% risk · 25% allocation cap</span><span><b>04 EXECUTION</b> Next open · fees &amp; slippage</span></div>
      <div id="account-cards" class="account-cards"></div>
      <div class="results-grid"><div class="equity-panel"><div class="section-label">PARTNERSHIP EQUITY <span>USD · ALL THREE ACCOUNTS</span></div><svg id="equity-chart" viewBox="0 0 800 150" role="img" aria-label="Combined paper account equity curve"><path id="equity-baseline"/><path id="equity-path"/></svg><p id="evidence-status"></p></div><div class="protocol-panel"><div class="section-label">THE MANDATE</div><p><b>&gt;85% win rate</b> is a research target, never a promise. Qualification needs 100+ closed trades and positive net profit in the held-out period.</p><p>2% stop · 4% take profit · 0.10% fee per side · 0.05% adverse slippage. If both stop and target touch in one candle, the stop wins. No leverage.</p><p>New test resets all paper balances and eliminations. Export the ledger before replacing a run.</p></div></div>
      <div class="ledger-heading"><div class="section-label">EXECUTION LEDGER <span id="ledger-count">0 CLOSED TRADES</span></div><button id="export-trades" class="outline-button">Export ledger CSV</button></div>
      <div class="ledger-scroll"><table class="ledger"><thead><tr><th>Partner</th><th>Side</th><th>Entry → Exit</th><th>Net P&amp;L</th><th>Closed / UTC</th><th>Decision source</th></tr></thead><tbody id="trade-ledger"></tbody></table></div>
      <div class="tradingview-card"><div><div class="eyebrow">TRADINGVIEW WORKFLOW</div><h3>Bring your own chart. Keep the evidence.</h3><p>Import chart OHLC CSV, inspect the same symbol, and export this ledger. Pine export is the fixed Nova trend baseline for Strategy Tester; it cannot reproduce AI decisions or submit orders to TradingView Paper Trading. Its tick slippage and fill semantics differ from this engine.</p></div><div><a id="tradingview-link" class="outline-button" href="https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT" target="_blank" rel="noopener noreferrer">Open TradingView ↗</a><a href="./aurelius-trend.pine" download class="outline-button">Download Pine baseline ↓</a><a href="https://www.tradingview.com/pine-script-docs/faq/strategies/" target="_blank" rel="noopener noreferrer">Integration limits ↗</a></div></div><p id="trading-save-status" class="model-note"></p>`;
    (el('market-symbol') as HTMLInputElement).value = this.state.symbol;
    (el('trading-mode') as HTMLSelectElement).value = this.state.mode;
    (el('evaluation-split') as HTMLSelectElement).value = this.state.split;
    el('fetch-candles').addEventListener('click', () => void this.fetch());
    el('demo-candles').addEventListener('click', () =>
      this.replaceData(
        demoCandles(),
        'SYNTHETIC DEMO · generated prices, not market evidence',
        'DEMO',
      ),
    );
    el('import-candles').addEventListener(
      'change',
      (event) =>
        void this.import((event.target as HTMLInputElement).files?.[0]),
    );
    el('run-backtest').addEventListener('click', () => this.start());
    el('pause-backtest').addEventListener('click', () => this.pause());
    el('new-backtest').addEventListener('click', () => this.newTest());
    el('export-trades').addEventListener('click', () => {
      const url = URL.createObjectURL(
        new Blob([tradesCSV(this.state)], { type: 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `aurelius-${this.state.symbol}-ledger.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.querySelector('.desk-link')!.addEventListener('click', () => {
      document.body.dataset.tab = 'desk';
      document
        .querySelectorAll<HTMLElement>('[data-tab]')
        .forEach((b) => b.classList.toggle('active', b.dataset.tab === 'desk'));
    });
    window.addEventListener('pagehide', () => this.pause());
    this.render();
    if (this.state.candles.length)
      el('test-status').textContent = this.state.completed
        ? 'Saved test complete. Export results or start a new test.'
        : 'Saved test restored, paused. Run test to continue.';
  }
  private save(force = false) {
    if (!force && Date.now() - this.lastSave < 2000) return;
    this.lastSave = Date.now();
    try {
      if (this.state.candles.length)
        localStorage.setItem(KEY, JSON.stringify(this.state));
      this.saveMessage = 'Trading results saved on this browser only';
    } catch {
      this.saveMessage =
        'Trading storage unavailable or full. Export the ledger before closing.';
    }
  }
  private currentSettings() {
    return {
      split: (el('evaluation-split') as HTMLSelectElement).value as
        | 'holdout'
        | 'full',
      mode: (el('trading-mode') as HTMLSelectElement).value as
        | 'baseline'
        | 'models',
    };
  }
  private replaceData(
    candles: TradingState['candles'],
    source: string,
    symbol: string,
  ) {
    this.pause(false);
    const { split, mode } = this.currentSettings();
    this.state = newTradingState(candles, source, symbol, split, mode);
    (el('market-symbol') as HTMLInputElement).value = symbol;
    this.save(true);
    this.render();
    el('test-status').textContent =
      'Data ready. Choose the decision source, then Run test.';
  }
  private async fetch() {
    this.pause(false);
    this.loading = true;
    this.render();
    el('test-status').textContent = 'Fetching public BTC/USDT hourly candles…';
    try {
      this.replaceData(
        await fetchMarketCandles(),
        'Binance public historical feed · BTC/USDT · 1 hour',
        'BTCUSDT',
      );
    } catch (error) {
      el('test-status').textContent =
        error instanceof Error
          ? error.message
          : 'Market feed unavailable. Import CSV instead.';
    } finally {
      this.loading = false;
      this.render();
    }
  }
  private async import(file?: File) {
    if (!file) return;
    this.pause(false);
    this.loading = true;
    this.render();
    try {
      if (file.size > 8_000_000) throw Error('CSV exceeds 8 MB.');
      const symbol = (el('market-symbol') as HTMLInputElement).value
        .trim()
        .toUpperCase();
      if (!/^[A-Z0-9:/._-]{1,40}$/.test(symbol))
        throw Error('Enter a market symbol before importing.');
      this.replaceData(
        parseCSV(await file.text()),
        `Imported OHLC CSV · ${file.name.slice(0, 90)}`,
        symbol,
      );
    } catch (error) {
      el('test-status').textContent =
        error instanceof Error ? error.message : 'Could not import CSV.';
    } finally {
      this.loading = false;
      (el('import-candles') as HTMLInputElement).value = '';
      this.render();
    }
  }
  private newTest() {
    this.pause(false);
    const { split, mode } = this.currentSettings();
    this.state = newTradingState(
      this.state.candles,
      this.state.source,
      this.state.symbol,
      split,
      mode,
    );
    this.save(true);
    this.render();
    el('test-status').textContent =
      'New test. Accounts reset to $10,000; previous results replaced.';
  }
  private start() {
    if (this.loading || this.running || !this.state.candles.length) return;
    const settings = this.currentSettings();
    if (
      this.state.completed ||
      settings.mode !== this.state.mode ||
      settings.split !== this.state.split
    ) {
      if (this.state.cursor > this.state.start) {
        el('test-status').textContent =
          'Use New test to apply changed settings or rerun. Export the current ledger first.';
        return;
      }
      this.newTest();
    }
    if (
      settings.mode === 'models' &&
      !this.sim.agents.some(
        (a) => this.sim.providers.providerFor(a.id).mode === 'model',
      )
    ) {
      el('test-status').textContent =
        'Assign a real model in AI models first. No rule-based trades will be substituted.';
      return;
    }
    this.running = true;
    this.sim.tradingActive = true;
    this.render();
    void this.batch();
  }
  pause(message = true) {
    this.running = false;
    this.sim.tradingActive = false;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    clearTimeout(this.timer);
    this.save(true);
    if (message)
      el('test-status').textContent =
        'Test paused. Open positions remain in the paper ledger.';
    this.render();
  }
  private async modelDecisions(
    history: TradingState['candles'],
    signal: AbortSignal,
  ) {
    const decisions: TradeDecision[] = [],
      sources: string[] = [];
    for (let i = 0; i < this.sim.agents.length; i++) {
      const agent = this.sim.agents[i],
        account = this.state.accounts[i],
        provider = this.sim.providers.providerFor(agent.id);
      let decision: TradeDecision = {
        type: 'TRADE',
        side: 'HOLD',
        message: account.dead
          ? 'Eliminated'
          : provider.mode === 'model'
            ? 'Model unavailable · hold'
            : 'No model assigned · hold',
      };
      let source =
        provider.mode === 'model' ? provider.label : 'No model · hold';
      if (!account.dead && provider.mode === 'model') {
        el('test-status').textContent =
          `${agent.name} is researching bar ${this.state.cursor + 1} with ${provider.label}…`;
        const observation = observe(
          agent,
          this.sim.agents,
          this.sim.clock.elapsed,
        );
        observation.trading = {
          symbol: this.state.symbol,
          bars: history.slice(-50),
          equity: account.equity,
          position: account.position?.side ?? 'FLAT',
          target:
            'Over 85% win rate with positive net profit after costs; survive above $8,000.',
        };
        const request = new AbortController();
        const abort = () => request.abort();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        const timeout = setTimeout(abort, provider.timeoutMs ?? 60000);
        try {
          const cancelled = new Promise<never>((_, reject) => {
            request.signal.addEventListener(
              'abort',
              () => reject(Error('Model request cancelled or timed out')),
              { once: true },
            );
            if (request.signal.aborted) reject(Error('Cancelled'));
          });
          const response = await Promise.race([
            provider.decide(observation, request.signal),
            cancelled,
          ]);
          if (!validDecision(response))
            throw Error('Model returned an invalid trade action');
          decision = response;
          this.sim.providers.report(
            agent.id,
            provider.label,
            'Paper trading thesis received',
            true,
            false,
          );
        } catch (error) {
          const reason = (
            error instanceof Error ? error.message : 'Model failed'
          ).slice(0, 100);
          decision.message = `${reason} · HOLD`;
          source = `${provider.label} error · hold`;
          this.sim.providers.report(agent.id, source, reason, false, false);
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
        }
      }
      decisions.push(decision);
      sources.push(source);
      if (signal.aborted) break;
    }
    return { decisions, sources };
  }
  private async batch() {
    if (!this.running) return;
    const generation = this.generation;
    const count = this.state.mode === 'baseline' ? 12 : 1;
    for (let j = 0; j < count && !this.state.completed; j++) {
      const history = this.state.candles.slice(
        Math.max(0, this.state.cursor - 60),
        this.state.cursor,
      );
      let decisions: TradeDecision[], sources: string[];
      if (this.state.mode === 'models') {
        this.controller = new AbortController();
        const result = await this.modelDecisions(
          history,
          this.controller.signal,
        );
        if (generation !== this.generation || !this.running) return;
        ({ decisions, sources } = result);
      } else {
        decisions = this.state.accounts.map((a) =>
          baselineDecision(a.id, history),
        );
        sources = [
          'Trend baseline · not AI',
          'Reversion baseline · not AI',
          'Breakout baseline · not AI',
        ];
      }
      const previous = this.state.accounts.map((a) => ({
        count: a.trades.length,
        dead: a.dead,
      }));
      stepTrading(this.state, decisions, sources);
      this.state.accounts.forEach((a, i) => {
        if (a.dead && !previous[i].dead)
          this.sim.emit(
            this.sim.agents[i],
            'system',
            `${this.sim.agents[i].name} eliminated: paper equity reached the 20% loss limit.`,
          );
        else if (a.trades.length > previous[i].count) {
          const trade = a.trades.at(-1)!;
          this.sim.emit(
            this.sim.agents[i],
            'system',
            `Paper ${trade.side} closed: ${money(trade.pnl)} net · ${trade.reason}.`,
          );
        }
      });
    }
    this.save(this.state.completed);
    this.render();
    if (this.state.completed) {
      this.running = false;
      this.sim.tradingActive = false;
      el('test-status').textContent =
        'Evaluation complete. All remaining positions closed at the final candle, including costs.';
      this.render();
    } else {
      el('test-status').textContent =
        this.state.mode === 'models'
          ? 'AI cycle complete · next cycle in 20 seconds. Pause to stop.'
          : 'Running historical paper execution…';
      this.timer = setTimeout(
        () => void this.batch(),
        this.state.mode === 'models' ? 20000 : 100,
      );
    }
  }
  refreshPartner() {
    const a = this.state.accounts.find((a) => a.id === this.ui.selected)!;
    el('selected-account').textContent =
      `${money(a.equity)} equity · ${a.dead ? 'ELIMINATED' : (a.position?.side ?? 'FLAT')} · ${metrics(a).closed} trades`;
  }
  private render() {
    const state = this.state,
      dead = state.accounts.filter((a) => a.dead).map((a) => a.id);
    this.sim.setInactive(dead);
    this.world?.setInactive(dead);
    el('firm-equity').textContent = money(
      state.accounts.reduce((s, a) => s + a.equity, 0),
    );
    el('active-partners').textContent = `0${3 - dead.length} / 03`;
    for (const id of [
      'fetch-candles',
      'demo-candles',
      'import-candles',
      'new-backtest',
      'trading-mode',
      'evaluation-split',
      'market-symbol',
    ])
      (el(id) as HTMLButtonElement).disabled = this.running || this.loading;
    (el('run-backtest') as HTMLButtonElement).disabled =
      this.running || this.loading || !state.candles.length || state.completed;
    (el('pause-backtest') as HTMLButtonElement).disabled = !this.running;
    (el('export-trades') as HTMLButtonElement).disabled = !state.accounts.some(
      (a) => a.trades.length,
    );
    const candles = state.candles;
    el('data-status').textContent = candles.length
      ? `${state.source} · ${candles.length} bars · ${new Date(candles[0].time).toISOString().slice(0, 10)} — ${new Date(candles.at(-1)!.time).toISOString().slice(0, 10)} · Evaluation starts ${new Date(candles[state.start].time).toISOString().slice(0, 16)} UTC`
      : 'No data loaded. Fetch free public candles, import a CSV, or try the clearly labeled synthetic demo.';
    (el('test-progress') as HTMLProgressElement).value = candles.length
      ? (state.cursor - state.start) / (candles.length - state.start)
      : 0;
    const cards = el('account-cards');
    cards.replaceChildren();
    state.accounts.forEach((a, i) => {
      const m = metrics(a),
        card = document.createElement('article');
      card.className = `account-card ${a.dead ? 'eliminated' : ''}`;
      card.innerHTML = `<div class="account-title"><b>${this.sim.agents[i].name}</b><span>${a.dead ? 'ELIMINATED' : (a.position?.side ?? 'ACTIVE / FLAT')}</span></div><strong class="account-equity">${money(a.equity)}</strong><div class="account-metrics"><span>NET P&amp;L<b class="${m.net < 0 ? 'negative' : 'positive'}">${money(m.net)}</b></span><span>WIN RATE<b>${m.winRate === null ? '—' : m.winRate.toFixed(1) + '%'}</b></span><span>DRAWDOWN<b>${a.drawdown.toFixed(2)}%</b></span><span>TRADES / PF<b>${m.closed} / ${m.profitFactor === null ? '—' : Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}</b></span></div><p class="account-note"></p>`;
      card.querySelector('.account-note')!.textContent = a.note;
      cards.append(card);
    });
    const total = state.accounts.reduce((s, a) => s + a.trades.length, 0);
    el('ledger-count').textContent = `${total} CLOSED TRADES`;
    const ledger = el('trade-ledger');
    ledger.replaceChildren();
    for (const t of state.accounts
      .flatMap((a) => a.trades)
      .sort((a, b) => b.exitTime - a.exitTime)
      .slice(0, 30)) {
      const row = document.createElement('tr');
      for (const value of [
        t.agent,
        t.side,
        `${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}`,
        `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}`,
        new Date(t.exitTime).toISOString().slice(0, 16).replace('T', ' '),
        t.source,
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      ledger.append(row);
    }
    if (!total) {
      const row = document.createElement('tr'),
        cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No closed trades yet. A hold is a valid decision.';
      row.append(cell);
      ledger.append(row);
    }
    const stride = Math.max(1, Math.ceil(state.curve.length / 400));
    const values = [
        30000,
        ...state.curve
          .filter((_, i) => i % stride === 0 || i === state.curve.length - 1)
          .map((p) => p.equity),
      ],
      min = Math.min(...values) * 0.998,
      max = Math.max(...values) * 1.002;
    const y = (v: number) => 140 - ((v - min) / (max - min)) * 130;
    el('equity-path').setAttribute(
      'd',
      values
        .map(
          (v, i) =>
            `${i ? 'L' : 'M'}${(i / Math.max(1, values.length - 1)) * 800},${y(v)}`,
        )
        .join(' '),
    );
    el('equity-baseline').setAttribute('d', `M0,${y(30000)} L800,${y(30000)}`);
    const qualified =
      state.completed &&
      state.split === 'holdout' &&
      state.symbol !== 'DEMO' &&
      state.accounts.some((a) => metrics(a).qualified);
    el('evidence-status').textContent = qualified
      ? 'Sample target met by at least one partner. Validate on a fresh unseen period before drawing conclusions.'
      : state.symbol === 'DEMO'
        ? 'Synthetic data: engine demonstration only. These results do not establish a trading edge.'
        : `Target ${state.completed ? 'not established' : 'pending'} · >85% wins, positive net profit, and 100+ closed trades per partner on held-out data.`;
    (el('tradingview-link') as HTMLAnchorElement).href =
      `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(state.symbol === 'BTCUSDT' ? 'BINANCE:BTCUSDT' : state.symbol)}`;
    el('trading-save-status').textContent = this.saveMessage;
    this.refreshPartner();
    this.ui.render();
  }
}
