import { distance } from './navigation';
import type { AgentState } from './types';
export function advanceAgent(a: AgentState, dt: number) {
  if (a.state === 'moving' && a.path.length) {
    const goal = a.path[0];
    const d = distance(a.position, goal);
    const step = Math.min(d, dt * 1.65);
    if (d > 0.001) {
      a.heading = Math.atan2(goal.x - a.position.x, goal.z - a.position.z);
      a.position.x += ((goal.x - a.position.x) / d) * step;
      a.position.z += ((goal.z - a.position.z) / d) * step;
      a.energy = Math.max(0, a.energy - dt * 0.7);
    }
    if (d <= step + 0.001) a.path.shift();
    if (!a.path.length) {
      a.state = 'idle';
      a.remaining = 0.8;
    }
  } else {
    a.remaining = Math.max(0, a.remaining - dt);
    if (a.state === 'resting') a.energy = Math.min(100, a.energy + dt * 7);
    if (a.remaining === 0) a.state = 'idle';
  }
}
