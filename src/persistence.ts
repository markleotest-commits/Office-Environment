import { initialAgents, POIS } from './config';
import { walkable, segmentWalkable } from './navigation';
import type { Snapshot } from './types';
const KEY = 'aurelius.office.v1';
const n = (v: unknown, min = 0, max = 1e9) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.length <= max;
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const counts = (v: unknown) =>
  record(v) &&
  Object.entries(v).every(([k, v]) => POIS.some((p) => p.id === k) && n(v));
export function validSnapshot(raw: unknown): raw is Snapshot {
  if (
    !record(raw) ||
    raw.version !== 1 ||
    !text(raw.savedAt, 60) ||
    !Number.isFinite(Date.parse(raw.savedAt)) ||
    !n(raw.elapsed) ||
    ![0.5, 1, 2, 4].includes(raw.speed) ||
    typeof raw.paused !== 'boolean' ||
    !n(raw.randomSeed) ||
    !n(raw.nextEventId, 1) ||
    !counts(raw.interactions) ||
    !Array.isArray(raw.agents) ||
    raw.agents.length !== 3 ||
    !Array.isArray(raw.events) ||
    raw.events.length > 80
  )
    return false;
  if (
    raw.providers !== undefined &&
    (!record(raw.providers) ||
      Object.entries(raw.providers).some(
        ([id, model]) =>
          !initialAgents().some((a) => a.id === id) ||
          !['rules', 'gpt61', 'qwen', 'smollm'].includes(model),
      ))
  )
    return false;
  const templates = initialAgents();
  if (
    !raw.agents.every(
      (a, i) =>
        record(a) &&
        a.id === templates[i].id &&
        a.name === templates[i].name &&
        a.role === templates[i].role &&
        a.color === templates[i].color &&
        record(a.position) &&
        walkable(a.position as any) &&
        n(a.heading, -Math.PI, Math.PI) &&
        n(a.energy, 0, 100) &&
        n(a.remaining, 0, 15) &&
        n(a.decisions) &&
        [
          'idle',
          'moving',
          'observing',
          'talking',
          'interacting',
          'resting',
        ].includes(a.state) &&
        text(a.latestAction, 180) &&
        counts(a.visits) &&
        Array.isArray(a.path) &&
        a.path.length <= 200 &&
        a.path.every(
          (p: unknown, i: number) =>
            record(p) &&
            walkable(p as any) &&
            segmentWalkable(i === 0 ? a.position : a.path[i - 1], p as any),
        ) &&
        Array.isArray(a.memory) &&
        a.memory.length <= 12 &&
        a.memory.every(
          (m: unknown) => record(m) && n(m.time) && text(m.text, 160),
        ),
    )
  )
    return false;
  return raw.events.every(
    (e) =>
      record(e) &&
      n(e.id, 1, raw.nextEventId - 1) &&
      n(e.time) &&
      (e.agentId === null || templates.some((a) => a.id === e.agentId)) &&
      text(e.text, 240) &&
      ['move', 'observe', 'message', 'interact', 'system'].includes(e.kind),
  );
}
export class Persistence {
  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  ) {}
  save(snapshot: Snapshot): { ok: boolean; message: string } {
    try {
      this.storage.setItem(KEY, JSON.stringify(snapshot));
      return { ok: true, message: 'World saved on this device' };
    } catch {
      return {
        ok: false,
        message:
          'Storage unavailable or full. World is running without a save.',
      };
    }
  }
  load(): { snapshot: Snapshot | null; message: string } {
    try {
      const data =
        this.storage.getItem(KEY) ?? this.storage.getItem('fieldwork.world.v1');
      if (!data)
        return {
          snapshot: null,
          message: 'New world · autosave every 10 seconds',
        };
      let parsed: unknown = JSON.parse(data);
      if (
        record(parsed) &&
        Array.isArray(parsed.agents) &&
        parsed.agents.length === 3 &&
        parsed.agents.every(
          (a: any, i: number) =>
            a?.role === ['Explorer', 'Caretaker', 'Connector'][i],
        )
      ) {
        const legacy = parsed;
        parsed = {
          ...legacy,
          agents: initialAgents().map((a, i) => ({
            ...a,
            energy: legacy.agents[i].energy,
            memory: legacy.agents[i].memory,
            decisions: legacy.agents[i].decisions,
            visits: legacy.agents[i].visits,
          })),
        };
      }
      if (!validSnapshot(parsed))
        return {
          snapshot: null,
          message: 'Saved world is incompatible or damaged. Starting fresh.',
        };
      return { snapshot: parsed, message: 'Your saved world is restored' };
    } catch {
      return {
        snapshot: null,
        message: 'Save could not be read. Starting fresh.',
      };
    }
  }
}
