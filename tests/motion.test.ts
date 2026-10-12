import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentMotion } from '../src/motion';
import { advanceAgent } from '../src/agent';
import { Simulation } from '../src/simulation';

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('presentation interpolates fixed steps without changing authoritative positions', () => {
  const agent = new Simulation().agents[0];
  agent.position = { x: 0, z: 0 };
  agent.state = 'moving';
  const motion = new AgentMotion(agent);
  motion.capture(agent);
  agent.position = { x: 0.08, z: 0.04 };
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    motion.sample(agent, alpha, 1 / 60);
    near(motion.x, 0.08 * alpha);
    near(motion.z, 0.04 * alpha);
    assert.deepEqual(agent.position, { x: 0.08, z: 0.04 });
  }
});

test('turns use the shortest angle and settle equally at different frame rates', () => {
  const sample = (fps: number) => {
    const agent = new Simulation().agents[0];
    agent.heading = Math.PI - 0.1;
    agent.state = 'moving';
    const motion = new AgentMotion(agent);
    agent.heading = -Math.PI + 0.1;
    for (let i = 0; i < fps / 2; i++) motion.sample(agent, 1, 1 / fps);
    assert.ok(motion.heading > Math.PI - 0.1 && motion.heading < Math.PI + 0.1);
    return motion;
  };
  const slow = sample(30),
    fast = sample(120);
  near(slow.heading, fast.heading);
  near(slow.gait, fast.gait);
});

test('pause freezes the walking pose and restored agents snap to their saved position', () => {
  const agent = new Simulation().agents[0];
  const motion = new AgentMotion(agent);
  motion.capture(agent);
  agent.position.x += 0.08;
  agent.heading += 1;
  agent.state = 'moving';
  motion.sample(agent, 1, 1 / 60);
  const pose = {
    phase: motion.phase,
    gait: motion.gait,
    heading: motion.heading,
  };
  for (let i = 0; i < 60; i++) motion.sample(agent, 1, 0);
  assert.deepEqual(
    { phase: motion.phase, gait: motion.gait, heading: motion.heading },
    pose,
  );
  const restored = structuredClone(agent);
  restored.position = { x: 10, z: 5 };
  restored.heading = -1;
  restored.state = 'idle';
  motion.sample(restored, 0.2, 1 / 60);
  near(motion.x, 10);
  near(motion.z, 5);
  near(motion.heading, -1);
  near(motion.phase, 0);
  near(motion.gait, 0);
});

test('movement preserves distance and energy across multiple waypoints per tick', () => {
  const agent = new Simulation().agents[0];
  agent.position = { x: 0, z: 0 };
  agent.state = 'moving';
  agent.path = [
    { x: 0, z: 0 },
    { x: 0.1, z: 0 },
    { x: 0.1, z: 2 },
  ];
  const smallSteps = structuredClone(agent);
  advanceAgent(agent, 0.5);
  for (let i = 0; i < 10; i++) advanceAgent(smallSteps, 0.05);
  near(agent.position.x, 0.1);
  near(agent.position.z, 0.725);
  near(agent.position.x, smallSteps.position.x);
  near(agent.position.z, smallSteps.position.z);
  near(agent.energy, smallSteps.energy);
  assert.deepEqual(agent.path, smallSteps.path);
});
