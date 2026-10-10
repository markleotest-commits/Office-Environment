import type { AgentState, Obstacle, POI } from './types';
export const WORLD_RADIUS = 23;
export const POIS: POI[] = [
  {
    id: 'station',
    name: 'Field station',
    position: { x: -10, z: -5 },
    activity: 'sorted supplies at the field station',
  },
  {
    id: 'lab',
    name: 'Research lab',
    position: { x: 10, z: -4 },
    activity: 'checked the instruments at the research lab',
  },
  {
    id: 'garden',
    name: 'Community garden',
    position: { x: 10, z: 9 },
    activity: 'tended the community garden',
  },
  {
    id: 'lookout',
    name: 'Lakeside lookout',
    position: { x: -10, z: 7 },
    activity: 'recorded observations at the lake',
  },
  {
    id: 'plaza',
    name: 'Meeting circle',
    position: { x: 0, z: 1 },
    activity: 'exchanged ideas at the meeting circle',
  },
];
export const OBSTACLES: Obstacle[] = [
  { x: -10, z: -9, width: 8, depth: 5 },
  { x: 10, z: -8, width: 7, depth: 5 },
  { x: -12, z: 12, width: 8, depth: 6 },
  { x: 13, z: 11, width: 3, depth: 5 },
];
export function initialAgents(): AgentState[] {
  return [
    {
      id: 'nova',
      name: 'Nova',
      role: 'Explorer',
      color: '#e98b53',
      position: { x: -3, z: 2 },
    },
    {
      id: 'atlas',
      name: 'Atlas',
      role: 'Caretaker',
      color: '#398b81',
      position: { x: 0, z: -1 },
    },
    {
      id: 'echo',
      name: 'Echo',
      role: 'Connector',
      color: '#9c85c5',
      position: { x: 3, z: 2 },
    },
  ].map((a) => ({
    ...a,
    heading: 0,
    energy: 100,
    state: 'idle',
    latestAction: 'Ready to explore',
    memory: [],
    path: [],
    remaining: 0,
    decisions: 0,
    visits: {},
  }));
}
