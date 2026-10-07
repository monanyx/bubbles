import { linkId as newLinkId, nodeId as newNodeId } from './ids';
import { DEFAULT_COLOR } from './palette';
import type { Bubble, Link, LinkId, MindMap, NodeId, Rect, Vec } from './types';

export const MIN_DIAMETER = 80;
export const MAX_DIAMETER = 280;
export const DEFAULT_DIAMETER = 130;
export const MAX_TEXT_LENGTH = 200;

export const clampDiameter = (d: number): number =>
  Math.round(Math.min(MAX_DIAMETER, Math.max(MIN_DIAMETER, d)));

/**
 * Cuts `text` to at most `max` UTF-16 units without splitting a surrogate
 * pair: a lone half of an emoji is not valid Unicode and breaks encoders such
 * as `encodeURIComponent` (used by the PNG export).
 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, Math.max(0, max));
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

/** Idempotent: normalising twice gives the same text (clipping can expose trailing space). */
export const normalizeText = (text: string): string =>
  clipText(
    text
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    MAX_TEXT_LENGTH,
  ).trimEnd();

export function emptyMap(): MindMap {
  return { nodes: new Map(), links: new Map() };
}

export function createBubble(at: Vec, init: Partial<Omit<Bubble, 'x' | 'y'>> = {}): Bubble {
  return {
    id: init.id ?? newNodeId(),
    x: at.x,
    y: at.y,
    d: clampDiameter(init.d ?? DEFAULT_DIAMETER),
    text: normalizeText(init.text ?? ''),
    color: init.color ?? DEFAULT_COLOR,
  };
}

export function addBubble(map: MindMap, bubble: Bubble): MindMap {
  const nodes = new Map(map.nodes);
  nodes.set(bubble.id, bubble);
  return { ...map, nodes };
}

/** Applies `fn` to each listed bubble; returns the same map if nothing changed. */
export function updateBubbles(
  map: MindMap,
  ids: Iterable<NodeId>,
  fn: (bubble: Bubble) => Bubble,
): MindMap {
  let nodes: Map<NodeId, Bubble> | null = null;
  for (const id of ids) {
    const current = map.nodes.get(id);
    if (!current) continue;
    const next = fn(current);
    if (next === current) continue;
    nodes ??= new Map(map.nodes);
    nodes.set(id, next);
  }
  return nodes ? { ...map, nodes } : map;
}

export function updateBubble(
  map: MindMap,
  id: NodeId,
  patch: Partial<Omit<Bubble, 'id'>>,
): MindMap {
  return updateBubbles(map, [id], (bubble) => {
    const next: Bubble = {
      ...bubble,
      x: patch.x ?? bubble.x,
      y: patch.y ?? bubble.y,
      d: patch.d === undefined ? bubble.d : clampDiameter(patch.d),
      text: patch.text === undefined ? bubble.text : normalizeText(patch.text),
      color: patch.color ?? bubble.color,
    };
    return shallowEqual(bubble, next) ? bubble : next;
  });
}

export function moveBubbles(map: MindMap, ids: Iterable<NodeId>, dx: number, dy: number): MindMap {
  if (dx === 0 && dy === 0) return map;
  return updateBubbles(map, ids, (b) => ({ ...b, x: b.x + dx, y: b.y + dy }));
}

export function setPositions(map: MindMap, positions: ReadonlyMap<NodeId, Vec>): MindMap {
  return updateBubbles(map, positions.keys(), (b) => {
    const p = positions.get(b.id);
    return p && (p.x !== b.x || p.y !== b.y) ? { ...b, x: p.x, y: p.y } : b;
  });
}

/** Removes bubbles together with every link that touches them. */
export function removeBubbles(map: MindMap, ids: Iterable<NodeId>): MindMap {
  const doomed = new Set([...ids].filter((id) => map.nodes.has(id)));
  if (doomed.size === 0) return map;
  const nodes = new Map(map.nodes);
  for (const id of doomed) nodes.delete(id);
  const links = new Map(map.links);
  for (const [id, link] of map.links) {
    if (doomed.has(link.a) || doomed.has(link.b)) links.delete(id);
  }
  return { nodes, links };
}

export function findLink(map: MindMap, a: NodeId, b: NodeId): Link | undefined {
  for (const link of map.links.values()) {
    if ((link.a === a && link.b === b) || (link.a === b && link.b === a)) return link;
  }
  return undefined;
}

/**
 * Connects two bubbles. Self-links, dangling ends and duplicates (in either
 * direction) are rejected by returning the map unchanged and `link: null`.
 */
export function addLink(
  map: MindMap,
  a: NodeId,
  b: NodeId,
  id: LinkId = newLinkId(),
): { map: MindMap; link: Link | null } {
  if (a === b || !map.nodes.has(a) || !map.nodes.has(b) || findLink(map, a, b)) {
    return { map, link: null };
  }
  const link: Link = { id, a, b };
  const links = new Map(map.links);
  links.set(id, link);
  return { map: { ...map, links }, link };
}

export function removeLinks(map: MindMap, ids: Iterable<LinkId>): MindMap {
  let links: Map<LinkId, Link> | null = null;
  for (const id of ids) {
    if (!map.links.has(id)) continue;
    links ??= new Map(map.links);
    links.delete(id);
  }
  return links ? { ...map, links } : map;
}

export function linksOf(map: MindMap, id: NodeId): Link[] {
  return [...map.links.values()].filter((l) => l.a === id || l.b === id);
}

export function neighbors(map: MindMap, id: NodeId): NodeId[] {
  return linksOf(map, id).map((l) => (l.a === id ? l.b : l.a));
}

/** Axis-aligned bounds of the given bubbles (all bubbles by default). */
export function bounds(map: MindMap, ids?: Iterable<NodeId>): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const list = ids ? [...ids].map((id) => map.nodes.get(id)) : map.nodes.values();
  for (const b of list) {
    if (!b) continue;
    const r = b.d / 2;
    minX = Math.min(minX, b.x - r);
    minY = Math.min(minY, b.y - r);
    maxX = Math.max(maxX, b.x + r);
    maxY = Math.max(maxY, b.y + r);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Copies bubbles (and the links among them) offset by `delta`.
 * Returns the new ids in the same order as `ids`.
 */
export function duplicateBubbles(
  map: MindMap,
  ids: Iterable<NodeId>,
  delta: Vec,
): { map: MindMap; ids: NodeId[] } {
  const idMap = new Map<NodeId, NodeId>();
  let next = map;
  for (const id of ids) {
    const source = map.nodes.get(id);
    if (!source || idMap.has(id)) continue;
    const copy = createBubble(
      { x: source.x + delta.x, y: source.y + delta.y },
      { d: source.d, text: source.text, color: source.color },
    );
    idMap.set(id, copy.id);
    next = addBubble(next, copy);
  }
  for (const link of map.links.values()) {
    const a = idMap.get(link.a);
    const b = idMap.get(link.b);
    if (a && b) next = addLink(next, a, b).map;
  }
  return { map: next, ids: [...idMap.values()] };
}

/** Bubbles whose circle intersects the rectangle. */
export function bubblesInRect(map: MindMap, rect: Rect): NodeId[] {
  const hits: NodeId[] = [];
  for (const b of map.nodes.values()) {
    const r = b.d / 2;
    const nx = Math.max(rect.x, Math.min(b.x, rect.x + rect.width));
    const ny = Math.max(rect.y, Math.min(b.y, rect.y + rect.height));
    if ((b.x - nx) ** 2 + (b.y - ny) ** 2 <= r * r) hits.push(b.id);
  }
  return hits;
}

/** The bubble with the most connections — a good guess at the map's topic. */
export function centralBubble(map: MindMap): Bubble | undefined {
  let best: Bubble | undefined;
  let bestDegree = -1;
  const degree = new Map<NodeId, number>();
  for (const l of map.links.values()) {
    degree.set(l.a, (degree.get(l.a) ?? 0) + 1);
    degree.set(l.b, (degree.get(l.b) ?? 0) + 1);
  }
  for (const b of map.nodes.values()) {
    const d = degree.get(b.id) ?? 0;
    if (d > bestDegree || (d === bestDegree && best && b.d > best.d)) {
      best = b;
      bestDegree = d;
    }
  }
  return best;
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
