import { initialAgents, POIS } from './config';
import { SimulationClock } from './clock';
import { advanceAgent } from './agent';
import { validateAction } from './actions';
import { remember } from './memory';
import { distance, findPath, walkable } from './navigation';
import { observe } from './observation';
import { ProviderRouter } from './ai-provider';
import type { Action, AgentState, Snapshot, WorldEvent } from './types';
export class Simulation {
  clock = new SimulationClock();
  agents = initialAgents();
  events: WorldEvent[] = [];
  interactions: Record<string, number> = {};
  randomSeed = 42;
  nextEventId = 1;
  readonly providers = new ProviderRouter();
  private pending = new Map<string, AbortController>();
  private generation = 0;
  readonly inactive = new Set<string>();
  tradingActive = false;
  constructor() {
    this.emit(
      null,
      'system',
      'AURELIUS opened. Research → strategy → risk → paper execution.',
    );
  }
  emit(agent: AgentState | null, kind: WorldEvent['kind'], text: string) {
    const event = {
      id: this.nextEventId++,
      time: this.clock.elapsed,
      agentId: agent?.id ?? null,
      kind,
      text,
    };
    this.events.push(event);
    if (this.events.length > 80) this.events.shift();
    if (agent) remember(agent, this.clock.elapsed, text);
    if (kind === 'message' && agent) {
      for (const listener of this.agents)
        if (
          listener.id !== agent.id &&
          distance(listener.position, agent.position) <= 9
        ) {
          remember(
            listener,
            this.clock.elapsed,
            `Heard ${agent.name}: ${text}`,
          );
        }
    }
  }
  tick(seconds: number) {
    const dt = this.clock.advance(seconds);
    if (!dt) return;
    for (const a of this.agents) {
      if (this.inactive.has(a.id)) continue;
      advanceAgent(a, dt);
      if (a.state === 'idle' && a.remaining === 0 && !this.pending.has(a.id))
        void this.decide(a);
    }
  }
  private async decide(a: AgentState) {
    const controller = new AbortController();
    const generation = this.generation;
    this.pending.set(a.id, controller);
    a.decisions++;
    try {
      const o = observe(a, this.agents, this.clock.elapsed);
      const result = this.tradingActive
        ? {
            action: await this.providers.fallback.decide(o),
            fallback: false,
            reason:
              'Office routine; trading decisions run at the research desk',
          }
        : await this.providers.decide(o, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      let action = validateAction(result.action, a);
      let fallback = result.fallback,
        reason = result.reason;
      if (!action) {
        fallback = true;
        reason = 'Invalid model action';
        action = validateAction(await this.providers.fallback.decide(o), a);
        this.emit(
          a,
          'system',
          `${a.name}: invalid provider action; using local rules.`,
        );
      } else if (result.fallback)
        this.emit(
          a,
          'system',
          `${a.name}: provider unavailable or over budget; using local rules.`,
        );
      if (generation !== this.generation || controller.signal.aborted) return;
      const applied = this.apply(a, action ?? { type: 'WAIT', seconds: 2 });
      const provider = this.tradingActive
        ? this.providers.fallback
        : this.providers.providerFor(a.id);
      this.providers.report(
        a.id,
        fallback ? 'Local rules' : provider.label,
        !applied
          ? 'Destination could not be reached'
          : (reason ?? 'Decision applied'),
        provider.mode === 'model' && !fallback && applied,
        fallback,
      );
    } catch {
      if (generation === this.generation && !controller.signal.aborted)
        this.apply(a, { type: 'WAIT', seconds: 2 });
    } finally {
      if (this.pending.get(a.id) === controller) this.pending.delete(a.id);
    }
  }
  apply(a: AgentState, action: Action): boolean {
    if (!validateAction(action, a)) return false;
    a.path = [];
    if (action.type === 'MOVE_TO') {
      const path = findPath(a.position, action.target);
      if (!path) {
        a.state = 'resting';
        a.remaining = 2;
        return false;
      }
      a.path = path;
      a.state = 'moving';
      a.remaining = 0;
      const poi = POIS.find((p) => distance(p.position, action.target) < 1);
      a.latestAction = `Heading to ${poi?.name ?? 'a new spot'}`;
      this.emit(a, 'move', `${a.name} is ${a.latestAction.toLowerCase()}.`);
    } else if (action.type === 'SAY') {
      a.state = 'talking';
      a.remaining = 3;
      a.latestAction = action.message;
      this.emit(a, 'message', `${a.name}: “${action.message}”`);
    } else if (action.type === 'INTERACT') {
      const poi = POIS.find((p) => p.id === action.poiId)!;
      a.state = 'interacting';
      a.remaining = 4;
      a.latestAction = poi.activity;
      a.visits[poi.id] = (a.visits[poi.id] ?? 0) + 1;
      this.interactions[poi.id] = (this.interactions[poi.id] ?? 0) + 1;
      this.emit(a, 'interact', `${a.name} ${poi.activity}.`);
    } else if (action.type === 'OBSERVE') {
      const o = observe(a, this.agents, this.clock.elapsed);
      a.state = 'observing';
      a.remaining = 3;
      a.latestAction = `Observing ${o.pointsOfInterest.length} nearby places`;
      this.emit(
        a,
        'observe',
        `${a.name} spotted ${o.nearbyAgents.map((n) => n.name).join(' and ') || 'a quiet section of the office'}.`,
      );
    } else if (action.type === 'WAIT') {
      a.state = 'resting';
      a.remaining = action.seconds;
      a.latestAction = 'Taking a moment to recharge';
      this.emit(a, 'observe', `${a.name} is resting.`);
    }
    return true;
  }
  setInactive(ids: Iterable<string>) {
    const next = new Set(ids);
    for (const a of this.agents) {
      if (next.has(a.id) && !this.inactive.has(a.id)) {
        this.pending.get(a.id)?.abort();
        this.pending.delete(a.id);
        a.path = [];
        a.state = 'idle';
        a.remaining = 0;
        a.latestAction = 'Eliminated at the paper capital floor';
      }
    }
    this.inactive.clear();
    next.forEach((id) => this.inactive.add(id));
  }
  setProvider(agentId: string, providerId: string) {
    const agent = this.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error('Unknown agent');
    if (this.providers.providerFor(agentId).id === providerId) return;
    this.pending.get(agentId)?.abort();
    this.pending.delete(agentId);
    const previousSource = this.providers.status(agentId).source;
    this.providers.assign(agentId, providerId);
    this.providers.report(
      agentId,
      previousSource,
      'Ready for next decision',
      false,
      false,
    );
  }
  command(agentId: string, action: Action): boolean {
    const a = this.agents.find((a) => a.id === agentId);
    if (!a || this.inactive.has(agentId) || !validateAction(action, a))
      return false;
    this.pending.get(agentId)?.abort();
    this.pending.delete(agentId);
    return this.apply(a, action);
  }
  snapshot(): Snapshot {
    return structuredClone({
      version: 1,
      savedAt: new Date().toISOString(),
      elapsed: this.clock.elapsed,
      speed: this.clock.speed,
      paused: this.clock.paused,
      randomSeed: this.randomSeed,
      providers: this.providers.assignmentsSnapshot(),
      agents: this.agents,
      events: this.events,
      nextEventId: this.nextEventId,
      interactions: this.interactions,
    });
  }
  restore(snapshot: Snapshot) {
    this.cancel();
    this.providers.restoreAssignments(snapshot.providers);
    this.agents = structuredClone(snapshot.agents);
    this.events = structuredClone(snapshot.events);
    this.clock.elapsed = snapshot.elapsed;
    this.clock.speed = snapshot.speed;
    this.clock.paused = snapshot.paused;
    this.randomSeed = snapshot.randomSeed;
    this.nextEventId = snapshot.nextEventId;
    this.interactions = { ...snapshot.interactions };
    for (const a of this.agents)
      if (!walkable(a.position)) a.position = { x: 0, z: 0 };
  }
  reset() {
    this.cancel();
    this.providers.clearReports();
    this.agents = initialAgents();
    this.events = [];
    this.clock = new SimulationClock();
    this.interactions = {};
    this.randomSeed = 42;
    this.nextEventId = 1;
    this.emit(null, 'system', 'A fresh start. The office has been reset.');
  }
  private cancel() {
    this.generation++;
    this.pending.forEach((c) => c.abort());
    this.pending.clear();
  }
}
