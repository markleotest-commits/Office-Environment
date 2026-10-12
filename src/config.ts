import type { AgentState, Obstacle, POI } from './types';
export const WORLD_RADIUS = 23;
export const OFFICE = { width: 36, depth: 26 };
export const POIS: POI[] = [
  {
    id: 'station',
    name: 'Research',
    position: { x: -11, z: -5 },
    activity: 'reviewed market observations in Research',
  },
  {
    id: 'lab',
    name: 'Risk control',
    position: { x: 11, z: -5 },
    activity: 'checked position limits in Risk control',
  },
  {
    id: 'garden',
    name: 'Execution',
    position: { x: 9, z: 7 },
    activity: 'reviewed the paper order ledger in Execution',
  },
  {
    id: 'lookout',
    name: 'Strategy lab',
    position: { x: -10, z: 7 },
    activity: 'prepared an out-of-sample test in Strategy lab',
  },
  {
    id: 'plaza',
    name: 'Investment committee',
    position: { x: 0, z: -6 },
    activity: 'shared a research brief with the investment committee',
  },
];
export const OBSTACLES: Obstacle[] = [
  { x: -4, z: -9, width: 0.12, depth: 7.4 },
  { x: 4, z: -9, width: 0.12, depth: 7.4 },
  { x: -11, z: -9, width: 8, depth: 3 },
  { x: 11, z: -9, width: 8, depth: 3 },
  { x: -9, z: 2, width: 9, depth: 3 },
  { x: 9, z: 2, width: 9, depth: 3 },
  { x: 0, z: -9, width: 5, depth: 2.8 },
];
export function initialAgents(): AgentState[] {
  return [
    {
      id: 'nova',
      name: 'Nova',
      role: 'Research lead',
      color: '#e3b45b',
      position: { x: -3, z: 5 },
    },
    {
      id: 'atlas',
      name: 'Atlas',
      role: 'Risk strategist',
      color: '#55c5b0',
      position: { x: 0, z: 2 },
    },
    {
      id: 'echo',
      name: 'Echo',
      role: 'Execution lead',
      color: '#95a9ef',
      position: { x: 3, z: 5 },
    },
  ].map((a) => ({
    ...a,
    heading: 0,
    energy: 100,
    state: 'idle',
    latestAction: 'Reporting to the trading floor',
    memory: [],
    path: [],
    remaining: 0,
    decisions: 0,
    visits: {},
  }));
}
