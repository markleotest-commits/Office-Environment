export type Vec2 = { x: number; z: number };
export type Action =
  | { type: 'MOVE_TO'; target: Vec2 }
  | { type: 'OBSERVE' }
  | { type: 'SAY'; message: string }
  | { type: 'WAIT'; seconds: number }
  | { type: 'INTERACT'; poiId: string };
export type MemoryEntry = { time: number; text: string };
export type AgentState = {
  id: string;
  name: string;
  role: string;
  color: string;
  position: Vec2;
  heading: number;
  energy: number;
  state:
    | 'idle'
    | 'moving'
    | 'observing'
    | 'talking'
    | 'interacting'
    | 'resting';
  latestAction: string;
  memory: MemoryEntry[];
  path: Vec2[];
  remaining: number;
  decisions: number;
  visits: Record<string, number>;
};
export type WorldEvent = {
  id: number;
  time: number;
  agentId: string | null;
  kind: 'move' | 'observe' | 'message' | 'interact' | 'system';
  text: string;
};
export type POI = {
  id: string;
  name: string;
  position: Vec2;
  activity: string;
};
export type Obstacle = { x: number; z: number; width: number; depth: number };
export type Observation = {
  agentId: string;
  name: string;
  role: string;
  time: number;
  energy: number;
  position: Vec2;
  nearbyAgents: { id: string; name: string; position: Vec2 }[];
  pointsOfInterest: POI[];
  memory: MemoryEntry[];
  visits: Record<string, number>;
  decision: number;
  availableActions: readonly string[];
};
export type Snapshot = {
  providers?: Record<string, string>;
  version: 1;
  savedAt: string;
  elapsed: number;
  speed: number;
  paused: boolean;
  randomSeed: number;
  agents: AgentState[];
  events: WorldEvent[];
  nextEventId: number;
  interactions: Record<string, number>;
};
