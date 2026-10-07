import { neighbors } from '../model/map';
import type { Bubble, MindMap, NodeId, Vec } from '../model/types';

const CLEARANCE = 16;
const CHILD_DISTANCE = 70;

function collides(map: MindMap, x: number, y: number, r: number): boolean {
  for (const b of map.nodes.values()) {
    const min = b.d / 2 + r + CLEARANCE;
    if ((b.x - x) ** 2 + (b.y - y) ** 2 < min * min) return true;
  }
  return false;
}

/**
 * Finds a free spot for a new child bubble of diameter `d` next to `parentId`.
 *
 * Children grow away from the parent's first connection (its own parent, in
 * mind-map terms) and fan out around that direction, then spill onto wider
 * rings when the inner one is full.
 */
export function placeChild(map: MindMap, parentId: NodeId, d: number): Vec {
  const parent = map.nodes.get(parentId);
  if (!parent) return { x: 0, y: 0 };

  let base = 0;
  const first = neighbors(map, parentId)[0];
  const anchor = first === undefined ? undefined : map.nodes.get(first);
  if (anchor && (anchor.x !== parent.x || anchor.y !== parent.y)) {
    base = Math.atan2(parent.y - anchor.y, parent.x - anchor.x);
  }

  const r = d / 2;
  const step = Math.PI / 12; // 15°
  for (let ring = 0; ring < 4; ring++) {
    const dist = parent.d / 2 + r + CHILD_DISTANCE + ring * (d + CLEARANCE);
    for (let i = 0; i <= 24; i++) {
      // 0, +15°, −15°, +30°, −30° … so the preferred direction wins ties.
      const offset = Math.ceil(i / 2) * step * (i % 2 === 0 ? -1 : 1);
      const angle = base + offset;
      const x = parent.x + Math.cos(angle) * dist;
      const y = parent.y + Math.sin(angle) * dist;
      if (!collides(map, x, y, r)) return { x, y };
    }
  }
  const dist = parent.d / 2 + r + CHILD_DISTANCE;
  return { x: parent.x + Math.cos(base) * dist, y: parent.y + Math.sin(base) * dist };
}

export interface RelaxOptions {
  /** Minimum clear space between any two bubbles. */
  gap?: number;
  /** Preferred wire length between connected bubbles (edge to edge). */
  linkLength?: number;
}

/**
 * Force-directed tidy-up. Connected bubbles are pulled to a comfortable wire
 * length, crowded ones are pushed apart, and a final pass guarantees that no
 * two bubbles overlap. The centroid is preserved so the map doesn't jump.
 */
export function relax(
  map: MindMap,
  { gap = 28, linkLength = 90 }: RelaxOptions = {},
): Map<NodeId, Vec> {
  const list: Bubble[] = [...map.nodes.values()];
  const n = list.length;
  const result = new Map<NodeId, Vec>();
  if (n === 0) return result;

  const index = new Map(list.map((b, i) => [b.id, i]));
  const px = Float64Array.from(list, (b) => b.x);
  const py = Float64Array.from(list, (b) => b.y);
  const r = Float64Array.from(list, (b) => b.d / 2);
  const edges: [number, number][] = [];
  for (const l of map.links.values()) {
    const a = index.get(l.a);
    const b = index.get(l.b);
    if (a !== undefined && b !== undefined) edges.push([a, b]);
  }

  const cx0 = px.reduce((s, v) => s + v, 0) / n;
  const cy0 = py.reduce((s, v) => s + v, 0) / n;

  // Budget roughly constant work regardless of map size.
  const iterations = Math.round(Math.min(300, Math.max(40, 400_000 / (n * n))));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;

    for (const [a, b] of edges) {
      const [dx, dy, dist] = separation(px, py, a, b);
      const rest = r[a]! + r[b]! + linkLength;
      const shift = ((dist - rest) / dist) * 0.25 * alpha;
      px[a]! += dx * shift;
      py[a]! += dy * shift;
      px[b]! -= dx * shift;
      py[b]! -= dy * shift;
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const [dx, dy, dist] = separation(px, py, i, j);
        const min = r[i]! + r[j]! + gap;
        let push = 0;
        if (dist < min) push = (min - dist) / dist / 2;
        else if (dist < min * 2) push = ((min * 2 - dist) / dist) * 0.02 * alpha;
        px[i]! -= dx * push;
        py[i]! -= dy * push;
        px[j]! += dx * push;
        py[j]! += dy * push;
      }
    }

    // Weak gravity keeps disconnected islands from drifting away.
    const cx = px.reduce((s, v) => s + v, 0) / n;
    const cy = py.reduce((s, v) => s + v, 0) / n;
    for (let i = 0; i < n; i++) {
      px[i]! += (cx - px[i]!) * 0.004 * alpha;
      py[i]! += (cy - py[i]!) * 0.004 * alpha;
    }
  }

  // Hard constraint pass: resolve any remaining overlap.
  for (let pass = 0; pass < 100; pass++) {
    let clean = true;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const [dx, dy, dist] = separation(px, py, i, j);
        const min = r[i]! + r[j]! + gap * 0.5;
        if (dist >= min) continue;
        clean = false;
        const push = ((min - dist) / dist / 2) * 1.01;
        px[i]! -= dx * push;
        py[i]! -= dy * push;
        px[j]! += dx * push;
        py[j]! += dy * push;
      }
    }
    if (clean) break;
  }

  const cx = px.reduce((s, v) => s + v, 0) / n;
  const cy = py.reduce((s, v) => s + v, 0) / n;
  list.forEach((b, i) => {
    result.set(b.id, {
      x: Math.round(px[i]! - cx + cx0),
      y: Math.round(py[i]! - cy + cy0),
    });
  });
  return result;
}

/** Vector i→j and its length; coincident points get a deterministic nudge. */
function separation(
  px: Float64Array,
  py: Float64Array,
  i: number,
  j: number,
): [number, number, number] {
  let dx = px[j]! - px[i]!;
  let dy = py[j]! - py[i]!;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-6) {
    const angle = (i * 7 + j * 13) % 360;
    dx = Math.cos(angle) * 0.01;
    dy = Math.sin(angle) * 0.01;
    dist = 0.01;
  }
  return [dx, dy, dist];
}

export type Direction = 'left' | 'right' | 'up' | 'down';

const DIRECTIONS: Record<Direction, Vec> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

/** Nearest bubble in a 120° cone towards `direction` (arrow-key navigation). */
export function navigate(map: MindMap, fromId: NodeId, direction: Direction): NodeId | null {
  const from = map.nodes.get(fromId);
  if (!from) return null;
  const dir = DIRECTIONS[direction];
  let best: NodeId | null = null;
  let bestScore = Infinity;
  for (const b of map.nodes.values()) {
    if (b.id === fromId) continue;
    const vx = b.x - from.x;
    const vy = b.y - from.y;
    const dist = Math.hypot(vx, vy);
    if (dist === 0) continue;
    const cos = (vx * dir.x + vy * dir.y) / dist;
    if (cos < 0.5) continue;
    const score = dist * (2 - cos);
    if (score < bestScore) {
      bestScore = score;
      best = b.id;
    }
  }
  return best;
}
