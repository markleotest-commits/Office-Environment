import { OBSTACLES, WORLD_RADIUS } from './config';
import type { Vec2 } from './types';
export const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export function walkable(p: Vec2): boolean {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.z) &&
    Math.hypot(p.x, p.z) < WORLD_RADIUS - 1 &&
    !OBSTACLES.some(
      (o) =>
        Math.abs(p.x - o.x) < o.width / 2 + 0.6 &&
        Math.abs(p.z - o.z) < o.depth / 2 + 0.6,
    )
  );
}
export function segmentWalkable(a: Vec2, b: Vec2): boolean {
  if (!walkable(a) || !walkable(b)) return false;
  // Slab intersection with each expanded rectangle. The island disk is convex.
  return !OBSTACLES.some((o) => {
    let enter = 0,
      exit = 1;
    for (const [start, delta, center, half] of [
      [a.x, b.x - a.x, o.x, o.width / 2 + 0.6],
      [a.z, b.z - a.z, o.z, o.depth / 2 + 0.6],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (Math.abs(start - center) >= half) return false;
      } else {
        const t1 = (center - half - start) / delta;
        const t2 = (center + half - start) / delta;
        enter = Math.max(enter, Math.min(t1, t2));
        exit = Math.min(exit, Math.max(t1, t2));
      }
    }
    return enter < exit;
  });
}
// A bounded grid keeps models and user-directed movement out of buildings and water.
export function findPath(start: Vec2, target: Vec2): Vec2[] | null {
  if (!walkable(start) || !walkable(target)) return null;
  const origin = { x: Math.round(start.x), z: Math.round(start.z) };
  const goal = { x: Math.round(target.x), z: Math.round(target.z) };
  if (!segmentWalkable(start, origin) || !segmentWalkable(goal, target))
    return null;
  const key = (p: Vec2) => `${p.x},${p.z}`;
  const open = [{ p: origin, g: 0, f: distance(origin, goal) }];
  const costs = new Map([[key(origin), 0]]);
  const parents = new Map<string, Vec2>();
  let count = 0;
  while (open.length && count++ < 2500) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    if (current.g !== costs.get(key(current.p))) continue;
    if (key(current.p) === key(goal)) {
      const path: Vec2[] = [goal];
      while (key(path[0]) !== key(origin))
        path.unshift(parents.get(key(path[0]))!);
      // Keep the rounded origin: a direct diagonal from a fractional start could clip a corner.
      path.push({ ...target });
      return path;
    }
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) {
        if (!x && !z) continue;
        const p = { x: current.p.x + x, z: current.p.z + z };
        if (
          !walkable(p) ||
          !walkable({ x: current.p.x + x, z: current.p.z }) ||
          !walkable({ x: current.p.x, z: current.p.z + z })
        )
          continue;
        const g = current.g + Math.hypot(x, z);
        if (g >= (costs.get(key(p)) ?? Infinity)) continue;
        costs.set(key(p), g);
        parents.set(key(p), current.p);
        open.push({ p, g, f: g + distance(p, goal) });
      }
  }
  return null;
}
