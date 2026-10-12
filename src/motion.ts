import type { AgentState } from './types';

// Presentation poses lag one fixed simulation step, leaving movement authoritative.
export class AgentMotion {
  x: number;
  z: number;
  heading: number;
  phase = 0;
  gait = 0;
  private previousX: number;
  private previousZ: number;
  constructor(private source: AgentState) {
    this.x = this.previousX = source.position.x;
    this.z = this.previousZ = source.position.z;
    this.heading = source.heading;
  }
  private reset(agent: AgentState) {
    this.source = agent;
    this.x = this.previousX = agent.position.x;
    this.z = this.previousZ = agent.position.z;
    this.heading = agent.heading;
    this.gait = this.phase = 0;
  }
  capture(agent: AgentState) {
    if (agent !== this.source) this.reset(agent);
    this.previousX = agent.position.x;
    this.previousZ = agent.position.z;
  }
  sample(agent: AgentState, alpha: number, seconds: number) {
    if (agent !== this.source) this.reset(agent);
    alpha = Math.max(0, Math.min(1, alpha));
    const x = this.previousX + (agent.position.x - this.previousX) * alpha;
    const z = this.previousZ + (agent.position.z - this.previousZ) * alpha;
    const travelled = Math.hypot(x - this.x, z - this.z);
    this.x = x;
    this.z = z;
    if (seconds > 0) {
      this.phase = (this.phase + travelled * 6) % (Math.PI * 2);
      const blend = 1 - Math.exp(-14 * seconds);
      const walking = agent.state === 'moving' || travelled > 0.0001;
      this.gait += ((walking ? 1 : 0) - this.gait) * blend;
      const turn = Math.atan2(
        Math.sin(agent.heading - this.heading),
        Math.cos(agent.heading - this.heading),
      );
      this.heading += turn * blend;
    }
    return this;
  }
}
