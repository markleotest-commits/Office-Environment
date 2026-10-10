import { distance, walkable } from './navigation';
import type { Action, Observation } from './types';
export interface AIProvider {
  readonly id: string;
  readonly label: string;
  readonly mode: 'simulated' | 'model';
  decide(observation: Observation, signal: AbortSignal): Promise<unknown>;
}
export class RuleBasedProvider implements AIProvider {
  readonly id = 'rules';
  readonly label = 'Local rules';
  readonly mode = 'simulated';
  async decide(o: Observation): Promise<Action> {
    if (o.energy < 25) return { type: 'WAIT', seconds: 8 };
    const close = o.pointsOfInterest.find(
      (p) => distance(p.position, o.position) < 1.8,
    );
    if (close && o.decision % 3 !== 0)
      return { type: 'INTERACT', poiId: close.id };
    if (o.nearbyAgents.length && o.decision % 4 === 0) {
      const other = o.nearbyAgents[o.decision % o.nearbyAgents.length];
      return {
        type: 'SAY',
        message: `Hi ${other.name}! ${o.role === 'Explorer' ? 'I’m mapping the island.' : o.role === 'Caretaker' ? 'The garden is in good hands.' : 'Let’s share what we find.'}`,
      };
    }
    if (o.decision % 7 === 0) {
      const angle =
        o.decision * 2.4 +
        (o.agentId === 'atlas' ? 1 : o.agentId === 'echo' ? 2 : 0);
      const target = { x: Math.sin(angle) * 13, z: Math.cos(angle) * 13 };
      if (walkable(target)) return { type: 'MOVE_TO', target };
    }
    if (o.decision % 5 === 0) return { type: 'OBSERVE' };
    const options = [...o.pointsOfInterest].sort(
      (a, b) => (o.visits[a.id] ?? 0) - (o.visits[b.id] ?? 0),
    );
    const target =
      options[
        (o.decision +
          (o.agentId === 'atlas' ? 1 : o.agentId === 'echo' ? 2 : 0)) %
          options.length
      ];
    return target
      ? { type: 'MOVE_TO', target: target.position }
      : { type: 'WAIT', seconds: 2 };
  }
}
// Register multiple model adapters later; the engine still validates every result.
// Adapters must call a user-controlled local bridge/proxy, never embed secret keys.
export class ProviderRouter {
  private providers = new Map<string, AIProvider>();
  private assignments = new Map<string, string>();
  private budget = new Map<string, { window: number; count: number }>();
  readonly fallback = new RuleBasedProvider();
  constructor(
    private timeoutMs = 4000,
    private perMinute = 6,
  ) {
    this.register(this.fallback);
  }
  register(provider: AIProvider) {
    this.providers.set(provider.id, provider);
  }
  assign(agentId: string, providerId: string) {
    if (!this.providers.has(providerId)) throw new Error('Unknown provider');
    this.assignments.set(agentId, providerId);
  }
  providerFor(agentId: string) {
    return (
      this.providers.get(this.assignments.get(agentId) ?? 'rules') ??
      this.fallback
    );
  }
  async decide(
    o: Observation,
    signal: AbortSignal,
  ): Promise<{ action: unknown; fallback: boolean }> {
    const provider = this.providerFor(o.agentId);
    if (provider.mode === 'simulated')
      return { action: await provider.decide(o, signal), fallback: false };
    const window = Math.floor(Date.now() / 60000);
    const usage = this.budget.get(o.agentId);
    const count = usage?.window === window ? usage.count : 0;
    if (count >= this.perMinute)
      return { action: await this.fallback.decide(o), fallback: true };
    this.budget.set(o.agentId, { window, count: count + 1 });
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Provider timed out'));
        }, this.timeoutMs);
      });
      const cancelled = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('Request cancelled')),
          { once: true },
        );
        if (controller.signal.aborted) reject(new Error('Request cancelled'));
      });
      return {
        action: await Promise.race([
          provider.decide(o, controller.signal),
          timeout,
          cancelled,
        ]),
        fallback: false,
      };
    } catch {
      return { action: await this.fallback.decide(o), fallback: true };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
}
