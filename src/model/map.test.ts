import { describe, expect, it } from 'vitest';
import {
  addBubble,
  addLink,
  bounds,
  bubblesInRect,
  centralBubble,
  clampDiameter,
  createBubble,
  duplicateBubbles,
  emptyMap,
  findLink,
  MAX_DIAMETER,
  MAX_TEXT_LENGTH,
  MIN_DIAMETER,
  moveBubbles,
  neighbors,
  normalizeText,
  removeBubbles,
  removeLinks,
  setPositions,
  updateBubble,
} from './map';
import type { MindMap } from './types';

function threeBubbles(): { map: MindMap; ids: [string, string, string] } {
  let map = emptyMap();
  const a = createBubble({ x: 0, y: 0 }, { id: 'a' });
  const b = createBubble({ x: 300, y: 0 }, { id: 'b' });
  const c = createBubble({ x: 0, y: 300 }, { id: 'c' });
  for (const bubble of [a, b, c]) map = addBubble(map, bubble);
  return { map, ids: ['a', 'b', 'c'] };
}

describe('createBubble', () => {
  it('applies defaults and sanitises input', () => {
    const b = createBubble({ x: 1, y: 2 }, { d: 5000, text: '  hi  ' });
    expect(b).toMatchObject({ x: 1, y: 2, d: MAX_DIAMETER, text: 'hi', color: 'sky' });
    expect(b.id).toMatch(/^n_[0-9a-z]{8}$/);
  });
});

describe('normalizeText / clampDiameter', () => {
  it('normalises newlines, trims and truncates', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(normalizeText('a\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizeText('x'.repeat(500))).toHaveLength(MAX_TEXT_LENGTH);
  });

  it('clamps and rounds diameters', () => {
    expect(clampDiameter(10)).toBe(MIN_DIAMETER);
    expect(clampDiameter(1e9)).toBe(MAX_DIAMETER);
    expect(clampDiameter(150.6)).toBe(151);
  });
});

describe('updateBubble', () => {
  it('returns the same map when nothing changes', () => {
    const { map } = threeBubbles();
    expect(updateBubble(map, 'a', { x: 0 })).toBe(map);
    expect(updateBubble(map, 'missing', { x: 10 })).toBe(map);
  });

  it('ignores explicitly undefined fields instead of erasing them', () => {
    const { map } = threeBubbles();
    const named = updateBubble(map, 'a', { text: 'hello' });
    expect(updateBubble(named, 'a', { text: undefined }).nodes.get('a')?.text).toBe('hello');
  });

  it('only replaces the touched bubble (structural sharing)', () => {
    const { map } = threeBubbles();
    const next = updateBubble(map, 'a', { text: 'hello', d: 9999 });
    expect(next.nodes.get('a')).toMatchObject({ text: 'hello', d: MAX_DIAMETER });
    expect(next.nodes.get('b')).toBe(map.nodes.get('b'));
    expect(next.links).toBe(map.links);
    expect(map.nodes.get('a')?.text).toBe('');
  });
});

describe('moveBubbles / setPositions', () => {
  it('moves only the listed bubbles', () => {
    const { map } = threeBubbles();
    const next = moveBubbles(map, ['a', 'c'], 10, -5);
    expect(next.nodes.get('a')).toMatchObject({ x: 10, y: -5 });
    expect(next.nodes.get('c')).toMatchObject({ x: 10, y: 295 });
    expect(next.nodes.get('b')).toBe(map.nodes.get('b'));
    expect(moveBubbles(map, ['a'], 0, 0)).toBe(map);
  });

  it('sets absolute positions', () => {
    const { map } = threeBubbles();
    const next = setPositions(map, new Map([['b', { x: 1, y: 2 }]]));
    expect(next.nodes.get('b')).toMatchObject({ x: 1, y: 2 });
  });
});

describe('links', () => {
  it('rejects self links, dangling ends and duplicates in either direction', () => {
    const { map } = threeBubbles();
    expect(addLink(map, 'a', 'a').link).toBeNull();
    expect(addLink(map, 'a', 'nope').link).toBeNull();
    const first = addLink(map, 'a', 'b');
    expect(first.link).not.toBeNull();
    expect(addLink(first.map, 'b', 'a').link).toBeNull();
    expect(findLink(first.map, 'b', 'a')).toBe(first.link);
  });

  it('removes links touching removed bubbles', () => {
    let { map } = threeBubbles();
    map = addLink(map, 'a', 'b').map;
    map = addLink(map, 'b', 'c').map;
    map = addLink(map, 'a', 'c').map;
    const next = removeBubbles(map, ['b']);
    expect([...next.nodes.keys()]).toEqual(['a', 'c']);
    expect([...next.links.values()].map((l) => [l.a, l.b])).toEqual([['a', 'c']]);
    expect(neighbors(next, 'a')).toEqual(['c']);
  });

  it('removeLinks ignores unknown ids', () => {
    const { map } = threeBubbles();
    expect(removeLinks(map, ['zzz'])).toBe(map);
  });
});

describe('queries', () => {
  it('computes bounds including radii', () => {
    const { map } = threeBubbles();
    expect(bounds(map)).toEqual({ x: -65, y: -65, width: 430, height: 430 });
    expect(bounds(map, ['b'])).toEqual({ x: 235, y: -65, width: 130, height: 130 });
    expect(bounds(emptyMap())).toBeNull();
  });

  it('hit-tests circles against a rectangle', () => {
    const { map } = threeBubbles();
    // Touches the rim of `a` (radius 65) but not its centre.
    expect(bubblesInRect(map, { x: 60, y: -10, width: 20, height: 20 })).toEqual(['a']);
    expect(bubblesInRect(map, { x: 100, y: 100, width: 50, height: 50 })).toEqual([]);
  });

  it('finds the most connected bubble', () => {
    let { map } = threeBubbles();
    map = addLink(map, 'c', 'a').map;
    map = addLink(map, 'c', 'b').map;
    expect(centralBubble(map)?.id).toBe('c');
  });
});

describe('duplicateBubbles', () => {
  it('copies bubbles with fresh ids and preserves internal links only', () => {
    let { map } = threeBubbles();
    map = addLink(map, 'a', 'b').map;
    map = addLink(map, 'b', 'c').map;
    const result = duplicateBubbles(map, ['a', 'b'], { x: 10, y: 10 });
    expect(result.ids).toHaveLength(2);
    expect(result.map.nodes.size).toBe(5);
    expect(result.map.links.size).toBe(3);
    const [a2, b2] = result.ids as [string, string];
    expect(result.map.nodes.get(a2)).toMatchObject({ x: 10, y: 10 });
    expect(findLink(result.map, a2, b2)).toBeDefined();
  });
});
