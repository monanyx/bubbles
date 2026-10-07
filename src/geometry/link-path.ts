import type { Rect, Vec } from '../model/types';

export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface LinkGeometry {
  /** SVG path data; empty when the link is hidden. */
  readonly path: string;
  /** Point halfway along the curve (where the "cut" button sits). */
  readonly mid: Vec;
  /** False when the bubbles overlap and there is no wire left to draw. */
  readonly visible: boolean;
  /** Box around the curve's control points (which always contain the curve). */
  readonly bounds: Rect;
}

const MIN_GAP = 6;
const MAX_BOW = 36;
const BOW_RATIO = 0.18;

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString();

/**
 * A gently arched wire between two circles. The arc always bows upwards (or
 * leftwards when vertical) so parallel links read consistently, and both ends
 * are trimmed to the bubble surfaces so wires appear to plug into the glass.
 */
export function linkGeometry(a: Circle, b: Circle): LinkGeometry {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const span = dist - a.r - b.r;
  if (span < MIN_GAP) {
    return { path: '', mid, visible: false, bounds: { ...mid, width: 0, height: 0 } };
  }

  let nx = -dy / dist;
  let ny = dx / dist;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const bow = Math.min(MAX_BOW, span * BOW_RATIO);
  const c = { x: mid.x + nx * bow, y: mid.y + ny * bow };
  const s = towards(a, c);
  const e = towards(b, c);

  return {
    path: `M${fmt(s.x)} ${fmt(s.y)}Q${fmt(c.x)} ${fmt(c.y)} ${fmt(e.x)} ${fmt(e.y)}`,
    mid: { x: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y },
    visible: true,
    bounds: hull([s, c, e]),
  };
}

function hull(points: Vec[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Point on the circle's rim facing `target`. */
function towards(circle: Circle, target: Vec): Vec {
  const dx = target.x - circle.x;
  const dy = target.y - circle.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: circle.x + (dx / len) * circle.r, y: circle.y + (dy / len) * circle.r };
}
