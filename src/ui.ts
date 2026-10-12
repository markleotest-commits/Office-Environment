import type { Simulation } from './simulation';
const icons: Record<string, string> = {
  leaf: '<path d="M5 18C2 8 9 3 20 3c0 11-6 18-15 15Zm0 0L16 7"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  focus:
    '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/>',
  load: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  chat: '<path d="M4 4h16v12H8l-4 4Z"/><path d="M8 8h8m-8 4h5"/>',
  arrow: '<path d="m8 5 7 7-7 7"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
export const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
export function timeLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
export function shell(app: HTMLElement) {
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="./" aria-label="Aurelius home"><span class="brand-mark">A<span>↗</span></span><span>AURELIUS<small>CAPITAL LAB</small></span></a>
      <div class="header-center"><span class="live-dot"></span> INDEPENDENT MINDS. ACCOUNTABLE CAPITAL.</div>
      <div class="header-end"><span class="paper-badge">PAPER ONLY</span><button id="models" class="models-button" aria-label="Configure AI models">${icon('chat')} AI models</button><button id="help" class="icon-button" aria-label="Controls and help">${icon('help')}</button></div>
    </header>
    <div class="market-strip"><span><i class="live-dot"></i> THE PARTNERSHIP</span><span>STARTING CAPITAL <b>$30,000</b></span><span>NET EQUITY <b id="firm-equity">$30,000</b></span><span>ACTIVE PARTNERS <b id="active-partners">03 / 03</b></span><span>WIN-RATE OBJECTIVE <b>&gt;85%</b></span></div>
    <main class="workspace">
      <aside class="sidebar" aria-label="Agent controls">
        <div class="sidebar-heading"><div class="eyebrow">PERSONNEL <span>01 / THE FIRM</span></div><h1>Conviction.<br>With consequences.</h1><p>Three independent paper accounts.<br>One disciplined research floor.</p></div>
        <div class="agent-section"><div class="section-label">THE PARTNERS <span class="count">03</span></div><div id="agent-list"></div></div>
        <div class="selected-panel"><div class="section-label">PARTNER FILE <span id="selected-role"></span></div>
          <div class="agent-heading"><span id="selected-avatar" class="avatar large"></span><div><h2 id="selected-name"></h2><span id="selected-state" class="state-badge"></span></div><button id="focus" class="icon-button" aria-label="Center camera on selected agent">${icon('focus')}</button></div>
          <p id="selected-account" class="account-line">$10,000 paper capital</p><p id="latest-action" class="latest-action"></p><p id="provider-status" class="provider-status"></p>
          <div class="energy-row"><span>Focus</span><span id="energy-value"></span></div><div class="energy-track"><div id="energy-fill"></div></div>
          <div class="agent-actions"><button id="move" class="outline-button">${icon('arrow')} Guide agent</button><button id="say" class="outline-button">${icon('chat')} Say hello</button></div>
          <div class="memory-title">DESK NOTES <span id="memory-count"></span></div><ul id="memory-list" class="memory-list"></ul>
        </div>
        <div class="sidebar-foot"><span class="tiny-dot"></span><span id="decision-mode">Simulated decisions · no AI model assigned</span></div>
      </aside>
      <section class="world-panel" aria-label="World simulation">
        <div id="viewport" class="viewport">
          <div class="world-heading"><div class="eyebrow"><span class="live-dot"></span> HEADQUARTERS / FLOOR 24</div><h2>The trading floor<span>.</span></h2><span class="world-subtitle">RESEARCH · STRATEGY · RISK · EXECUTION</span></div>
          <div class="world-status"><span id="running-label">LIVE</span><span id="clock">00:00</span></div>
          <div class="office-atmosphere"><span id="local-time"></span><button id="weather-connect">↗ Local weather</button><span id="weather-status">Weather off · enable location to connect</span></div>
          <div class="world-tools"><button id="zoom-in" class="icon-button" aria-label="Zoom in">${icon('plus')}</button><button id="zoom-out" class="icon-button" aria-label="Zoom out">${icon('minus')}</button><span></span><button id="camera-reset" class="icon-button" aria-label="Reset camera">${icon('focus')}</button></div>
          <div class="view-hint" id="view-hint">Drag to orbit · Pinch to zoom · Tap a partner</div>
          <div class="render-status"><span id="fps">— FPS</span><span id="render-detail"></span></div>
          <div id="world-error" class="world-error" hidden></div>
        </div>
        <div class="simulation-bar"><div class="simulation-play"><button id="pause" class="play-button" aria-label="Pause simulation">${icon('pause')}</button><div><strong id="simulation-label">World is running</strong><span>The floor never trades with real funds.</span></div></div><div class="speed-control" aria-label="Simulation speed"><button data-speed="0.5">½×</button><button data-speed="1" class="active">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button></div><button id="reset" class="reset-button">${icon('reset')}<span>Reset office</span></button></div>
        <div class="world-bottom"><div><span class="tiny-dot"></span><span id="save-status">Opening office…</span></div><div class="bottom-actions"><label class="quality-label"><span>Graphics</span><select id="quality" aria-label="Graphics quality"><option value="low">Economy</option><option value="high">Detailed</option></select></label><button id="save" class="text-button">${icon('save')} Save</button><button id="load" class="text-button">${icon('load')} Load</button></div></div>
        <a href="#research-desk" class="desk-link">OPEN THE RESEARCH DESK <span>Backtest →</span></a>
      </section>
      <aside class="journal" aria-label="World activity"><div class="journal-title"><span class="section-label">FLOOR WIRE</span><span class="live-dot"></span></div><h2>The edge is<br>in the process.</h2><p class="journal-subtitle">A record of decisions, not promises.</p><div class="department-list"><span>01 <b>Research</b> Market observations</span><span>02 <b>Strategy</b> Independent hypotheses</span><span>03 <b>Risk</b> $8,000 survival floor</span><span>04 <b>Execution</b> Paper fills &amp; costs</span></div><div class="journal-tabs"><button data-filter="all" class="active">All activity</button><button data-filter="message">Conversations</button></div><ol id="event-list" class="event-list" aria-live="off"></ol><div class="journal-foot"><span id="interaction-count">0</span> desk visits <i>·</i> saved locally</div></aside>
      <section id="research-desk" class="research-desk" aria-label="Paper trading research desk"></section>
    </main>
    <nav class="mobile-tabs" aria-label="Mobile panels"><button data-tab="world" class="active">${icon('globe')} Floor</button><button data-tab="desk">${icon('arrow')} Trading</button><button data-tab="agents">${icon('leaf')} Team</button><button data-tab="journal">${icon('chat')} Wire</button></nav>
    <div id="toast" class="toast" role="status"></div>
    <dialog id="help-dialog"><button class="dialog-close icon-button" aria-label="Close help">${icon('close')}</button><div class="eyebrow">WELCOME TO THE FIRM</div><h2>Every thesis needs evidence.</h2><p>Drag to orbit. Pinch to zoom, two fingers to pan. On desktop, right-drag to pan and scroll to zoom. Select a partner to inspect their model and account.</p><p>In the research desk, fetch free BTC candles or import an OHLC CSV. Run fixed baselines to check the engine, or select Assigned AI models to request real model decisions. Failed model requests hold positions; they never become hidden rule-based trades.</p><p>Each partner starts with $10,000 paper capital and is eliminated at $8,000 equity. A new test starts new accounts. The 85% target is evaluated only with positive net profit and at least 100 closed trades. Results are historical simulations, not a return promise.</p><p>The floor clock follows your device time. Local weather uses approximate location only after you press Local weather, with data from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. Office and backtests save on this browser; they do not sync between devices.</p><button class="solid-button dialog-close">Back to the floor ${icon('arrow')}</button></dialog>
    <dialog id="reset-dialog"><div class="eyebrow">A FRESH START</div><h2>Reset the office?</h2><p>This replaces office positions, memories, and activity. Paper accounts and results are kept; use New test in the research desk to reset those.</p><div class="dialog-actions"><button id="reset-cancel" class="outline-button">Keep working</button><button id="reset-confirm" class="solid-button">Reset office</button></div></dialog>

  `;
}
export class UI {
  selected = 'nova';
  filter = 'all';
  guiding = false;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private lastEvents = '';
  private lastMemory = '';
  private lastAgents = '';
  onSelect: (id: string) => void = () => {};
  constructor(private simulation: Simulation) {
    const el = (id: string) => document.getElementById(id)!;
    el('agent-list').innerHTML = simulation.agents
      .map(
        (a) =>
          `<button class="agent-card" data-agent="${a.id}" style="--agent-color:${a.color}"><span class="avatar">${a.name[0]}</span><span class="agent-card-text"><strong>${a.name}</strong><small>${a.role}</small></span><span class="agent-card-state" data-state="${a.id}"></span>${icon('arrow')}</button>`,
      )
      .join('');
    document
      .querySelectorAll<HTMLElement>('[data-agent]')
      .forEach((button) =>
        button.addEventListener('click', () =>
          this.onSelect(button.dataset.agent!),
        ),
      );
    document.querySelectorAll<HTMLElement>('[data-filter]').forEach((button) =>
      button.addEventListener('click', () => {
        this.filter = button.dataset.filter!;
        document
          .querySelectorAll('[data-filter]')
          .forEach((b) => b.classList.toggle('active', b === button));
        this.render();
      }),
    );
    document
      .querySelectorAll<HTMLElement>('button[data-tab]')
      .forEach((button) =>
        button.addEventListener('click', () => {
          document.body.dataset.tab = button.dataset.tab;
          document
            .querySelectorAll('button[data-tab]')
            .forEach((b) => b.classList.toggle('active', b === button));
        }),
      );
    el('help').addEventListener('click', () =>
      (el('help-dialog') as HTMLDialogElement).showModal(),
    );
    document
      .querySelectorAll('.dialog-close')
      .forEach((b) =>
        b.addEventListener('click', () =>
          (el('help-dialog') as HTMLDialogElement).close(),
        ),
      );
    el('pause').addEventListener('click', () => {
      simulation.clock.paused = !simulation.clock.paused;
      this.render();
    });
    document.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        simulation.clock.speed = Number(b.dataset.speed);
        this.render();
      }),
    );
    el('reset').addEventListener('click', () =>
      (el('reset-dialog') as HTMLDialogElement).showModal(),
    );
    el('reset-cancel').addEventListener('click', () =>
      (el('reset-dialog') as HTMLDialogElement).close(),
    );
    el('say').addEventListener('click', () => {
      simulation.command(this.selected, {
        type: 'SAY',
        message: 'Hello, neighbors! What have you discovered today?',
      });
      this.toast('Greeting sent to agents within 9 meters');
      this.render();
    });
    el('move').addEventListener('click', () => {
      this.guiding = !this.guiding;
      this.render();
      if (this.guiding) {
        document.body.dataset.tab = 'world';
        document
          .querySelectorAll<HTMLElement>('button[data-tab]')
          .forEach((b) =>
            b.classList.toggle('active', b.dataset.tab === 'world'),
          );
        this.toast('Tap an open spot on the office floor to guide your agent');
      }
    });
    this.render();
  }
  select(id: string) {
    this.selected = id;
    this.guiding = false;
    this.render();
  }
  toast(message: string) {
    const toast = document.getElementById('toast')!;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
  }
  saveStatus(message: string, ok = true) {
    const node = document.getElementById('save-status')!;
    node.textContent = message;
    node.classList.toggle('warning', !ok);
  }
  render() {
    const sim = this.simulation,
      a = sim.agents.find((a) => a.id === this.selected)!;
    const set = (id: string, text: string) => {
      const e = document.getElementById(id)!;
      if (e.textContent !== text) e.textContent = text;
    };
    set('clock', timeLabel(sim.clock.elapsed));
    set('running-label', sim.clock.paused ? 'PAUSED' : 'LIVE');
    set(
      'simulation-label',
      sim.clock.paused ? 'World is paused' : 'World is running',
    );
    const pause = document.getElementById('pause')!;
    if (pause.dataset.paused !== String(sim.clock.paused)) {
      pause.innerHTML = icon(sim.clock.paused ? 'play' : 'pause');
      pause.dataset.paused = String(sim.clock.paused);
      pause.setAttribute(
        'aria-label',
        sim.clock.paused ? 'Resume simulation' : 'Pause simulation',
      );
    }
    document
      .querySelectorAll<HTMLElement>('[data-speed]')
      .forEach((b) =>
        b.classList.toggle(
          'active',
          Number(b.dataset.speed) === sim.clock.speed,
        ),
      );
    document.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.agent === a.id);
      b.setAttribute('aria-pressed', String(b.dataset.agent === a.id));
    });
    const agentKey = sim.agents
      .map((a) => (sim.inactive.has(a.id) ? 'eliminated' : a.state))
      .join('|');
    if (agentKey !== this.lastAgents) {
      sim.agents.forEach((a) => {
        document.querySelector(`[data-state="${a.id}"]`)!.textContent =
          sim.inactive.has(a.id) ? 'eliminated' : a.state;
      });
      this.lastAgents = agentKey;
    }
    set('selected-name', a.name);
    set('selected-role', a.role);
    set('selected-state', sim.inactive.has(a.id) ? 'eliminated' : a.state);
    (document.getElementById('move') as HTMLButtonElement).disabled =
      sim.inactive.has(a.id);
    (document.getElementById('say') as HTMLButtonElement).disabled =
      sim.inactive.has(a.id);
    set('latest-action', a.latestAction);
    const report = sim.providers.status(a.id);
    const assigned = sim.providers.providerFor(a.id);
    set(
      'provider-status',
      `Assigned: ${assigned.label} · Last source: ${report.source} · ${report.detail} · ${report.modelDecisions} model decisions / ${report.fallbacks} fallbacks`,
    );
    const modelCount = sim.agents.filter(
      (agent) => sim.providers.providerFor(agent.id).mode === 'model',
    ).length;
    set(
      'decision-mode',
      modelCount
        ? `${modelCount} model assignments · fallbacks are labeled`
        : 'Simulated decisions · no AI model assigned',
    );
    set('energy-value', `${Math.round(a.energy)}%`);
    const avatar = document.getElementById('selected-avatar')!;
    avatar.textContent = a.name[0];
    avatar.style.setProperty('--agent-color', a.color);
    document.getElementById('energy-fill')!.style.width = `${a.energy}%`;
    const move = document.getElementById('move')!;
    move.classList.toggle('active', this.guiding);
    move.setAttribute('aria-pressed', String(this.guiding));
    set(
      'view-hint',
      this.guiding
        ? `Tap a clear spot to guide ${a.name} · Guide agent again to cancel`
        : 'Drag to orbit · Pinch to zoom · Tap an agent',
    );
    const memoryKey = a.id + JSON.stringify(a.memory);
    if (memoryKey !== this.lastMemory) {
      const list = document.getElementById('memory-list')!;
      list.replaceChildren();
      for (const m of [...a.memory].reverse().slice(0, 3)) {
        const li = document.createElement('li'),
          time = document.createElement('time'),
          text = document.createElement('span');
        time.textContent = timeLabel(m.time);
        text.textContent = m.text;
        li.append(time, text);
        list.append(li);
      }
      if (!a.memory.length) {
        const li = document.createElement('li');
        li.textContent = 'A clean desk. Research starts here.';
        list.append(li);
      }
      set('memory-count', String(a.memory.length));
      this.lastMemory = memoryKey;
    }
    const eventKey = this.filter + JSON.stringify(sim.events);
    if (eventKey !== this.lastEvents) {
      const list = document.getElementById('event-list')!;
      list.replaceChildren();
      const events = [...sim.events]
        .reverse()
        .filter((e) => this.filter === 'all' || e.kind === this.filter)
        .slice(0, 24);
      for (const e of events) {
        const li = document.createElement('li');
        li.className = `event event-${e.kind}`;
        const agent = sim.agents.find((a) => a.id === e.agentId);
        li.style.setProperty('--agent-color', agent?.color ?? '#859482');
        const dot = document.createElement('span');
        dot.className = 'event-dot';
        const body = document.createElement('div'),
          meta = document.createElement('div');
        meta.className = 'event-meta';
        const name = document.createElement('strong'),
          time = document.createElement('time'),
          text = document.createElement('p');
        name.textContent = agent?.name ?? 'The firm';
        time.textContent = timeLabel(e.time);
        text.textContent = e.text;
        meta.append(name, time);
        body.append(meta, text);
        li.append(dot, body);
        list.append(li);
      }
      if (!events.length) {
        const li = document.createElement('li');
        li.className = 'empty-events';
        li.textContent =
          'It’s quiet for now. A conversation will appear here when an agent speaks.';
        list.append(li);
      }
      this.lastEvents = eventKey;
    }
    set(
      'interaction-count',
      String(Object.values(sim.interactions).reduce((s, n) => s + n, 0)),
    );
  }
}
