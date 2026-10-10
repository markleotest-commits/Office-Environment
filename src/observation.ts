import { POIS } from './config';
import { distance } from './navigation';
import type { AgentState, Observation } from './types';
export function observe(
  agent: AgentState,
  agents: AgentState[],
  time: number,
): Observation {
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    time,
    energy: agent.energy,
    position: { ...agent.position },
    decision: agent.decisions,
    nearbyAgents: agents
      .filter(
        (a) => a.id !== agent.id && distance(a.position, agent.position) <= 9,
      )
      .map((a) => ({ id: a.id, name: a.name, position: { ...a.position } })),
    pointsOfInterest: POIS.filter(
      (p) => distance(p.position, agent.position) <= 18,
    ).map((p) => ({ ...p, position: { ...p.position } })),
    memory: agent.memory.map((m) => ({ ...m })),
    visits: { ...agent.visits },
    availableActions: ['MOVE_TO', 'OBSERVE', 'SAY', 'WAIT', 'INTERACT'],
  };
}
