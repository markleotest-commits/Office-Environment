export class SimulationClock {
  elapsed = 0;
  paused = false;
  speed = 1;
  advance(seconds: number) {
    const dt = this.paused
      ? 0
      : Math.min(Math.max(seconds, 0), 0.1) * this.speed;
    this.elapsed += dt;
    return dt;
  }
}
