import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation';
import { findPath, walkable, distance } from '../src/navigation';
import { validateAction } from '../src/actions';
import { observe } from '../src/observation';
import { Persistence, validSnapshot } from '../src/persistence';
import { ProviderRouter } from '../src/ai-provider';
import { POIS } from '../src/config';
const flush = () => new Promise((resolve) => setImmediate(resolve));
test('agents navigate, interact, and stay within navigable ground over a long simulation', async () => {
  const sim = new Simulation();
  for (let i = 0; i < 8000; i++) {
    sim.tick(0.05);
    await flush();
    sim.agents.forEach((a) => {
      assert.ok(walkable(a.position));
      assert.ok(a.memory.length <= 12);
    });
  }
  assert.ok(Object.values(sim.interactions).reduce((a, b) => a + b, 0) > 20);
  assert.ok(sim.agents.every((a) => a.decisions > 10));
  assert.ok(sim.events.length <= 80);
  assert.ok(validSnapshot(sim.snapshot()));
});
test('all points of interest can be reached around building obstacles without clipping', () => {
  for (const from of POIS)
    for (const to of POIS) {
      const path = findPath(from.position, to.position);
      assert.ok(path);
      let previous = from.position;
      for (const waypoint of path) {
        const steps = Math.ceil(distance(previous, waypoint) / 0.05);
        for (let i = 1; i <= steps; i++)
          assert.ok(
            walkable({
              x: previous.x + ((waypoint.x - previous.x) * i) / steps,
              z: previous.z + ((waypoint.z - previous.z) * i) / steps,
            }),
          );
        previous = waypoint;
      }
    }
  assert.equal(findPath({ x: 0, z: 0 }, { x: -10, z: -9 }), null);
  assert.equal(findPath({ x: 0, z: 0 }, { x: 25, z: 0 }), null);
});
test('rejects untrusted model actions, distant interactions, and invalid bounds', () => {
  const a = new Simulation().agents[0];
  for (const input of [
    null,
    { type: 'DELETE' },
    { type: 'MOVE_TO', target: { x: Infinity, z: 0 } },
    { type: 'MOVE_TO', target: { x: 10, z: -8 } },
    { type: 'INTERACT', poiId: 'lab' },
    { type: 'WAIT', seconds: 99 },
    { type: 'SAY', message: 'a'.repeat(161) },
  ])
    assert.equal(validateAction(input, a), null);
  assert.deepEqual(validateAction({ type: 'SAY', message: '  hello  ' }, a), {
    type: 'SAY',
    message: 'hello',
  });
});
test('only nearby residents hear messages; observations do not expose shared mutable state', () => {
  const sim = new Simulation();
  sim.agents[2].position = { x: 18, z: 0 };
  sim.command('nova', { type: 'SAY', message: 'Hello' });
  assert.ok(sim.agents[1].memory.some((m) => m.text.includes('Heard Nova')));
  assert.equal(sim.agents[2].memory.length, 0);
  const o = observe(sim.agents[0], sim.agents, 0);
  o.position.x = 99;
  o.memory[0].text = 'changed';
  assert.notEqual(sim.agents[0].position.x, 99);
  assert.ok(!sim.agents[0].memory.some((m) => m.text === 'changed'));
});
test('pause freezes time and movement; snapshot restores positions, memories, visits and settings', async () => {
  const sim = new Simulation();
  sim.clock.speed = 4;
  for (let i = 0; i < 100; i++) {
    sim.tick(0.05);
    await flush();
  }
  sim.clock.paused = true;
  const before = sim.snapshot();
  sim.tick(0.05);
  assert.equal(sim.clock.elapsed, before.elapsed);
  assert.deepEqual(sim.agents, before.agents);
  sim.reset();
  sim.restore(before);
  assert.deepEqual(sim.snapshot().agents, before.agents);
  assert.deepEqual(sim.interactions, before.interactions);
  assert.equal(sim.clock.speed, 4);
  assert.equal(sim.clock.paused, true);
});
test('save schema rejects corrupt, out-of-bounds, wrong-version and oversized data; storage failures are recoverable', () => {
  const sim = new Simulation(),
    snapshot = sim.snapshot();
  assert.ok(validSnapshot(snapshot));
  for (const change of [
    (s: any) => (s.version = 2),
    (s: any) => (s.agents[0].position.x = 99),
    (s: any) => (s.agents[0].memory = Array(100).fill({ time: 0, text: 'x' })),
    (s: any) => (s.speed = 99),
    (s: any) => (s.agents[1].id = 'nova'),
    (s: any) => (s.events[0].kind = 'oops'),
    (s: any) =>
      (s.agents[0].path = [
        { x: -16, z: -9 },
        { x: -4, z: -9 },
      ]),
  ]) {
    const s = structuredClone(snapshot);
    change(s);
    assert.equal(validSnapshot(s), false);
  }
  let value: string | null = null;
  const persistence = new Persistence({
    getItem: () => value,
    setItem: (_, v) => {
      value = v;
    },
    removeItem: () => {
      value = null;
    },
  });
  assert.ok(persistence.save(snapshot).ok);
  assert.deepEqual(persistence.load().snapshot, snapshot);
  value = '{bad';
  assert.equal(persistence.load().snapshot, null);
  const blocked = new Persistence({
    getItem: () => {
      throw Error();
    },
    setItem: () => {
      throw Error();
    },
    removeItem: () => {},
  });
  assert.equal(blocked.save(snapshot).ok, false);
  assert.equal(blocked.load().snapshot, null);
});
test('model timeout and rate budget fall back to rules; per-agent routing works', async () => {
  const router = new ProviderRouter(5, 1),
    o = observe(new Simulation().agents[0], [], 0);
  let calls = 0;
  router.register({
    id: 'test-model',
    label: 'Test model',
    mode: 'model',
    decide: () => {
      calls++;
      return new Promise(() => {});
    },
  });
  router.assign('nova', 'test-model');
  const timedOut = await router.decide(o, new AbortController().signal);
  assert.equal(timedOut.fallback, true);
  assert.equal(timedOut.reason, 'Provider timed out');
  assert.equal(
    (await router.decide(o, new AbortController().signal)).fallback,
    true,
  );
  assert.equal(calls, 1);
  assert.equal(router.providerFor('echo').mode, 'simulated');
});
test('reset discards late asynchronous decisions from the old world', async () => {
  const sim = new Simulation();
  let resolve!: (value: unknown) => void;
  sim.providers.register({
    id: 'delayed',
    label: 'Delayed',
    mode: 'model',
    decide: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  sim.providers.assign('nova', 'delayed');
  sim.tick(0.05);
  sim.reset();
  resolve({ type: 'SAY', message: 'Old world' });
  await flush();
  await flush();
  assert.equal(sim.agents[0].state, 'idle');
  assert.equal(sim.events.length, 1);
});

test('model assignments survive snapshots and the reported source separates models from fallback', async () => {
  const sim = new Simulation();
  let decisionSignal!: AbortSignal;
  sim.providers.register({
    id: 'gpt61',
    label: 'GPT‑6.1‑sol',
    mode: 'model',
    decide: async (_, signal) => {
      decisionSignal = signal;
      return { type: 'OBSERVE' };
    },
  });
  sim.setProvider('nova', 'gpt61');
  sim.tick(0.05);
  sim.setProvider('nova', 'gpt61');
  assert.equal(decisionSignal.aborted, false);
  await flush();
  await flush();
  assert.equal(sim.providers.status('nova').modelDecisions, 1);
  assert.equal(sim.providers.status('nova').source, 'GPT‑6.1‑sol');
  const snap = sim.snapshot();
  assert.ok(validSnapshot(snap));
  assert.equal(snap.providers?.nova, 'gpt61');
  sim.setProvider('nova', 'rules');
  sim.restore(snap);
  assert.equal(sim.providers.providerFor('nova').id, 'gpt61');
  sim.providers.register({
    id: 'qwen',
    label: 'Qwen',
    mode: 'model',
    decide: async () => {
      throw new Error('Not loaded');
    },
  });
  sim.setProvider('atlas', 'qwen');
  sim.agents[1].state = 'idle';
  sim.agents[1].remaining = 0;
  sim.tick(0.05);
  await flush();
  await flush();
  assert.equal(sim.providers.status('atlas').source, 'Local rules');
  assert.equal(sim.providers.status('atlas').fallbacks, 1);
  assert.equal(sim.providers.status('atlas').detail, 'Not loaded');
});

test('legacy island save migrates memories and models into safe office positions without overwriting the old key', () => {
  const legacy = new Simulation().snapshot();
  const roles = ['Explorer', 'Caretaker', 'Connector'];
  const colors = ['#e98b53', '#398b81', '#9c85c5'];
  legacy.agents.forEach((a, i) => {
    a.role = roles[i];
    a.color = colors[i];
    a.position = { x: 20, z: 0 };
    a.path = [{ x: 20, z: 10 }];
    a.memory = [{ time: 0, text: 'Preserved research note' }];
  });
  legacy.providers = { nova: 'gpt61' };
  const values = new Map([['fieldwork.world.v1', JSON.stringify(legacy)]]);
  const p = new Persistence({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  });
  const result = p.load();
  assert.ok(result.snapshot);
  assert.ok(validSnapshot(result.snapshot));
  assert.equal(result.snapshot.providers?.nova, 'gpt61');
  assert.equal(
    result.snapshot.agents[0].memory[0].text,
    'Preserved research note',
  );
  assert.equal(result.snapshot.agents[0].role, 'Research lead');
  assert.equal(result.snapshot.agents[0].path.length, 0);
  p.save(result.snapshot);
  assert.equal(values.get('fieldwork.world.v1'), JSON.stringify(legacy));
  assert.ok(values.has('aurelius.office.v1'));
});

test('capital elimination cancels pending office decisions and prevents later actions', async () => {
  const sim = new Simulation();
  let resolve!: (value: unknown) => void;
  sim.providers.register({
    id: 'delayed',
    label: 'Delayed',
    mode: 'model',
    decide: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  sim.providers.assign('nova', 'delayed');
  sim.tick(0.05);
  sim.setInactive(['nova']);
  resolve({ type: 'SAY', message: 'Late message from eliminated agent' });
  await flush();
  await flush();
  assert.equal(sim.command('nova', { type: 'SAY', message: 'Hello' }), false);
  assert.ok(!sim.events.some((e) => e.text.includes('Late message')));
  const position = { ...sim.agents[0].position };
  sim.tick(0.05);
  assert.deepEqual(sim.agents[0].position, position);
});
