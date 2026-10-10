import { POIS } from './config';
import { distance, walkable } from './navigation';
import type { Action, AgentState } from './types';
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
export function validateAction(
  input: unknown,
  agent: AgentState,
): Action | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case 'MOVE_TO': {
      const p = a.target as Record<string, unknown> | undefined;
      return p && finite(p.x) && finite(p.z) && walkable({ x: p.x, z: p.z })
        ? { type: 'MOVE_TO', target: { x: p.x, z: p.z } }
        : null;
    }
    case 'WAIT':
      return finite(a.seconds) && a.seconds >= 0.5 && a.seconds <= 15
        ? { type: 'WAIT', seconds: a.seconds }
        : null;
    case 'OBSERVE':
      return { type: 'OBSERVE' };
    case 'SAY':
      return typeof a.message === 'string' &&
        a.message.trim().length > 0 &&
        a.message.length <= 160
        ? { type: 'SAY', message: a.message.trim() }
        : null;
    case 'INTERACT': {
      const poi = POIS.find((p) => p.id === a.poiId);
      return poi && distance(poi.position, agent.position) < 2
        ? { type: 'INTERACT', poiId: poi.id }
        : null;
    }
    default:
      return null;
  }
}
