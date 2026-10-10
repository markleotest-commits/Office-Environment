import type { AgentState } from './types';
export function remember(agent: AgentState, time: number, text: string) {
  agent.memory.push({ time, text: text.slice(0, 160) });
  if (agent.memory.length > 12) agent.memory.shift();
}
