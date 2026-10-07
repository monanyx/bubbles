import { describe, expect, it } from 'vitest';
import { addBubble, addLink, createBubble, emptyMap } from '../model/map';
import type { MindMap } from '../model/types';
import { navigate, placeChild, relax } from './layout';
import { linkGeometry } from './link-path';
import { fontSizeFor } from './text-fit';
import {
  centerOn,
  clampZoom,
  fitRect,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './viewport';

function mapOf(...specs: [string, number, number, number?][]): MindMap {
  let map = emptyMap();
  for (const [id, x, y, d] of specs) map = addBubble(map, createBubble({ x, y }, { id, d }));
  return map;
}

function overlaps(map: MindMap, positions: Map<string, { x: number; y: number }>): number {
  const list = [...map.nodes.values()];
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const pa = positions.get(a.id)!;
      const pb = positions.get(b.id)!;
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < a.d / 2 + b.d / 2) count++;
    }
  }
  return count;
}

describe('viewport', () => {
  it('converts between screen and world space', () => {
    const v = { x: 100, y: 50, zoom: 2 };
    const world = screenToWorld(v, { x: 300, y: 250 });
    expect(world).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(v, world)).toEqual({ x: 300, y: 250 });
  });

  it('zooms around an anchor point', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(v, anchor);
    const next = zoomAt(v, anchor, 2);
    expect(next.zoom).toBe(2);
    expect(screenToWorld(next, anchor)).toEqual(before);
  });

  it('clamps zoom and returns the same object at the limits', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    const maxed = { x: 0, y: 0, zoom: MAX_ZOOM };
    expect(zoomAt(maxed, { x: 0, y: 0 }, 2)).toBe(maxed);
  });

  it('fits a rectangle inside the screen without exceeding maxZoom', () => {
    const v = fitRect({ x: 0, y: 0, width: 100, height: 100 }, 800, 600);
    expect(v.zoom).toBe(1);
    expect(worldToScreen(v, { x: 50, y: 50 })).toEqual({ x: 400, y: 300 });

    const big = fitRect({ x: -1000, y: -500, width: 2000, height: 1000 }, 800, 600, {
      padding: 0,
    });
    expect(big.zoom).toBeCloseTo(0.4);
  });

  it('centres on a point', () => {
    const v = centerOn({ x: 10, y: 20 }, 800, 600, 1);
    expect(worldToScreen(v, { x: 10, y: 20 })).toEqual({ x: 400, y: 300 });
  });
});

describe('linkGeometry', () => {
  it('trims both ends to the bubble rims', () => {
    const g = linkGeometry({ x: 0, y: 0, r: 50 }, { x: 300, y: 0, r: 50 });
    expect(g.visible).toBe(true);
    const [sx, sy, cx, cy, ex, ey] = g.path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.hypot(sx!, sy!)).toBeCloseTo(50, 0);
    expect(Math.hypot(ex! - 300, ey!)).toBeCloseTo(50, 0);
    // Horizontal links bow upwards (negative y).
    expect(cy).toBeLessThan(0);
    expect(cx).toBeCloseTo(150, 0);
    expect(g.mid.y).toBeLessThan(0);
  });

  it('bows consistently regardless of direction', () => {
    const ab = linkGeometry({ x: 0, y: 0, r: 10 }, { x: 200, y: 0, r: 10 });
    const ba = linkGeometry({ x: 200, y: 0, r: 10 }, { x: 0, y: 0, r: 10 });
    expect(ab.mid.y).toBeCloseTo(ba.mid.y);
  });

  it('hides the wire when bubbles overlap', () => {
    expect(linkGeometry({ x: 0, y: 0, r: 50 }, { x: 80, y: 0, r: 50 }).visible).toBe(false);
  });
});

describe('fontSizeFor', () => {
  it('shrinks as text grows and respects bounds', () => {
    const short = fontSizeFor(130, 'Hi');
    const long = fontSizeFor(130, 'A considerably longer label for this bubble');
    expect(short).toBeGreaterThan(long);
    expect(fontSizeFor(130, 'x'.repeat(500))).toBe(10);
    expect(fontSizeFor(280, 'Hi')).toBeLessThanOrEqual(40);
  });

  it('counts emoji as single characters', () => {
    expect(fontSizeFor(130, '✨✨')).toBe(fontSizeFor(130, 'ab'));
  });
});

describe('placeChild', () => {
  it('puts the first child of a lone bubble to its right', () => {
    const map = mapOf(['root', 0, 0]);
    const p = placeChild(map, 'root', 130);
    expect(p.x).toBeGreaterThan(100);
    expect(Math.abs(p.y)).toBeLessThan(1);
  });

  it('grows away from the parent and never overlaps existing bubbles', () => {
    let map = mapOf(['root', 0, 0], ['mid', 250, 0]);
    map = addLink(map, 'root', 'mid').map;
    const first = placeChild(map, 'mid', 130);
    expect(first.x).toBeGreaterThan(250);

    for (let i = 0; i < 8; i++) {
      const p = placeChild(map, 'mid', 130);
      for (const b of map.nodes.values()) {
        expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeGreaterThanOrEqual(b.d / 2 + 65);
      }
      const child = createBubble(p, { id: `c${i}` });
      map = addLink(addBubble(map, child), 'mid', child.id).map;
    }
  });
});

describe('relax', () => {
  it('separates a pile of overlapping bubbles and keeps the centroid', () => {
    const specs: [string, number, number][] = Array.from({ length: 12 }, (_, i) => [
      `n${i}`,
      (i % 3) * 10,
      Math.floor(i / 3) * 10,
    ]);
    let map = mapOf(...specs);
    for (let i = 1; i < 12; i++) map = addLink(map, 'n0', `n${i}`).map;

    const positions = relax(map);
    expect(overlaps(map, positions)).toBe(0);

    const cx = [...positions.values()].reduce((s, p) => s + p.x, 0) / 12;
    const cy = [...positions.values()].reduce((s, p) => s + p.y, 0) / 12;
    expect(cx).toBeCloseTo(10, -1);
    expect(cy).toBeCloseTo(15, -1);
  });

  it('pulls distant connected bubbles closer', () => {
    let map = mapOf(['a', 0, 0], ['b', 3000, 0]);
    map = addLink(map, 'a', 'b').map;
    const p = relax(map);
    const dist = Math.hypot(p.get('a')!.x - p.get('b')!.x, p.get('a')!.y - p.get('b')!.y);
    expect(dist).toBeLessThan(1000);
  });

  it('handles empty maps and coincident bubbles', () => {
    expect(relax(emptyMap()).size).toBe(0);
    const map = mapOf(['a', 5, 5], ['b', 5, 5]);
    expect(overlaps(map, relax(map))).toBe(0);
  });
});

describe('navigate', () => {
  const map = mapOf(['c', 0, 0], ['r', 200, 10], ['far', 600, 0], ['u', 0, -200], ['d', 20, 300]);

  it.each([
    ['right', 'r'],
    ['up', 'u'],
    ['down', 'd'],
    ['left', null],
  ] as const)('%s → %s', (direction, expected) => {
    expect(navigate(map, 'c', direction)).toBe(expected);
  });
});
