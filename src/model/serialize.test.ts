import { describe, expect, it } from 'vitest';
import { addBubble, addLink, createBubble, emptyMap, MAX_DIAMETER } from './map';
import { deserialize, FORMAT, MapFormatError, serialize, stringify, VERSION } from './serialize';
import { welcomeMap } from './welcome';

describe('serialize / deserialize', () => {
  it('round-trips a map and viewport', () => {
    const map = welcomeMap();
    const viewport = { x: 12.345, y: -6, zoom: 1.5 };
    const loaded = deserialize(stringify(map, viewport));
    expect(loaded.viewport).toEqual({ x: 12.35, y: -6, zoom: 1.5 });
    expect([...loaded.map.nodes.values()]).toEqual([...map.nodes.values()]);
    expect([...loaded.map.links.values()]).toEqual([...map.links.values()]);
  });

  it('writes a tagged, versioned envelope', () => {
    const data = serialize(emptyMap());
    expect(data).toMatchObject({ format: FORMAT, version: VERSION, nodes: [], links: [] });
    expect(data).not.toHaveProperty('viewport');
  });

  it('repairs recoverable problems', () => {
    const { map, viewport } = deserialize({
      nodes: [
        { id: 'a', x: 0, y: 0, d: 99999, text: 42, color: 'plaid' },
        { id: 'a', x: 10, y: 10 }, // duplicate id → re-keyed
        { x: 5, y: 5, text: 'no id' },
        { id: 'bad', x: 'nope', y: 0 }, // unusable → dropped
        null,
      ],
      links: [
        { a: 'a', b: 'a' }, // self link
        { a: 'a', b: 'ghost' }, // dangling
        { id: 'l1', a: 'a', b: '' }, // invalid end
      ],
      viewport: { x: 0, y: 0, zoom: 100 },
    });
    expect(map.nodes.size).toBe(3);
    expect(map.nodes.get('a')).toMatchObject({ d: MAX_DIAMETER, text: '', color: 'sky' });
    expect(map.links.size).toBe(0);
    expect(viewport?.zoom).toBe(3);
  });

  it('drops duplicate links and keeps valid ones', () => {
    let map = emptyMap();
    const a = createBubble({ x: 0, y: 0 }, { id: 'a' });
    const b = createBubble({ x: 200, y: 0 }, { id: 'b' });
    map = addLink(addBubble(addBubble(map, a), b), 'a', 'b', 'l1').map;
    const data = serialize(map);
    data.links.push({ id: 'l2', a: 'b', b: 'a' });
    expect(deserialize(data).map.links.size).toBe(1);
  });

  it.each([
    ['not json', 'not valid JSON'],
    ['[]', 'Expected a JSON object'],
    ['{"format":"other","nodes":[]}', 'Not an Aero Bubbles file'],
    ['{"version":99,"nodes":[]}', 'newer version'],
    ['{"links":[]}', 'Missing "nodes"'],
  ])('rejects %s', (input, message) => {
    expect(() => deserialize(input)).toThrow(MapFormatError);
    expect(() => deserialize(input)).toThrow(message);
  });

  it('loads thousands of links quickly (linear, not quadratic)', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
    // 19k distinct pairs {x, x+k} for k = 1..4.
    const links = Array.from({ length: 19_000 }, (_, i) => ({
      id: `l${i}`,
      a: `n${i % 5000}`,
      b: `n${((i % 5000) + 1 + Math.floor(i / 5000)) % 5000}`,
    }));
    const started = performance.now();
    const { map } = deserialize({ nodes, links });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(map.links.size).toBe(19_000);
  });

  it('rejects absurd link counts', () => {
    const links = Array.from({ length: 20_001 }, () => ({ a: 'x', b: 'y' }));
    expect(() => deserialize({ nodes: [], links })).toThrow('Too many connections');
  });

  it('matches links to node ids that were clipped for length', () => {
    const long = 'n'.repeat(100);
    const { map } = deserialize({
      nodes: [
        { id: long, x: 0, y: 0 },
        { id: 'b', x: 300, y: 0 },
      ],
      links: [{ id: 'l', a: long, b: 'b' }],
    });
    expect(map.links.size).toBe(1);
  });

  it('keeps links apart for long node ids that share a prefix', () => {
    const P = 'https://example.com/projects/mind-maps/2026/quarterly-planning/node-'; // 68 chars
    const { map } = deserialize({
      nodes: [
        { id: 'root', x: 0, y: 0, text: 'root' },
        { id: 'other', x: 0, y: 300, text: 'other' },
        { id: `${P}alpha`, x: 300, y: 0, text: 'alpha' },
        { id: `${P}beta`, x: 300, y: 300, text: 'beta' },
      ],
      links: [
        { a: 'root', b: `${P}alpha` },
        { a: 'other', b: `${P}beta` },
      ],
    });
    const text = (id: string) => map.nodes.get(id)?.text;
    const wires = [...map.links.values()].map((l) => [text(l.a), text(l.b)].sort().join('-'));
    expect(wires.sort()).toEqual(['alpha-root', 'beta-other']);
  });

  it('re-keys a link whose id collides after clipping', () => {
    const id = 'l'.repeat(70);
    const { map } = deserialize({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 300, y: 0 },
        { id: 'c', x: 0, y: 300 },
      ],
      links: [
        { id, a: 'a', b: 'b' },
        { id: `${id}x`, a: 'a', b: 'c' },
      ],
    });
    expect(map.links.size).toBe(2);
  });

  it('ignores an invalid viewport', () => {
    expect(deserialize({ nodes: [], viewport: { x: 0, y: 0, zoom: -1 } }).viewport).toBeNull();
  });
});
