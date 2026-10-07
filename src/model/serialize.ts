import { clampZoom } from '../geometry/viewport';
import { linkId, nodeId } from './ids';
import { clampDiameter, DEFAULT_DIAMETER, normalizeText } from './map';
import { DEFAULT_COLOR, isColorId } from './palette';
import type { Bubble, Link, MindMap, Viewport } from './types';

export const FORMAT = 'aero-bubbles';
export const VERSION = 1;

/** Keep a hostile or corrupted file from freezing the tab. */
const MAX_NODES = 5000;
const MAX_LINKS = MAX_NODES * 4;
const MAX_ID_LENGTH = 64;
const COORD_LIMIT = 1e6;

export interface SerializedBubble {
  id: string;
  x: number;
  y: number;
  d: number;
  text: string;
  color: string;
}

export interface SerializedMap {
  format: typeof FORMAT;
  version: typeof VERSION;
  nodes: SerializedBubble[];
  links: { id: string; a: string; b: string }[];
  viewport?: Viewport;
}

export interface LoadedMap {
  map: MindMap;
  viewport: Viewport | null;
}

export class MapFormatError extends Error {
  override name = 'MapFormatError';
}

const round = (n: number, places = 2): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function serialize(map: MindMap, viewport?: Viewport): SerializedMap {
  const out: SerializedMap = {
    format: FORMAT,
    version: VERSION,
    nodes: [...map.nodes.values()].map((b) => ({
      id: b.id,
      x: round(b.x),
      y: round(b.y),
      d: b.d,
      text: b.text,
      color: b.color,
    })),
    links: [...map.links.values()].map(({ id, a, b }) => ({ id, a, b })),
  };
  if (viewport) {
    out.viewport = { x: round(viewport.x), y: round(viewport.y), zoom: round(viewport.zoom, 4) };
  }
  return out;
}

export const stringify = (map: MindMap, viewport?: Viewport): string =>
  JSON.stringify(serialize(map, viewport), null, 2);

/**
 * Parses and sanitises a map from untrusted JSON (a file the user opened or a
 * possibly stale/corrupted localStorage entry). Recoverable problems — unknown
 * colours, out-of-range sizes, dangling or duplicate links — are repaired;
 * structural problems throw {@link MapFormatError}.
 */
export function deserialize(input: unknown): LoadedMap {
  const data = typeof input === 'string' ? parseJson(input) : input;
  if (!isRecord(data)) throw new MapFormatError('Expected a JSON object.');
  if (data.format !== undefined && data.format !== FORMAT) {
    throw new MapFormatError(`Not an Aero Bubbles file (format ${JSON.stringify(data.format)}).`);
  }
  if (typeof data.version === 'number' && data.version > VERSION) {
    throw new MapFormatError(
      `This file was saved by a newer version (v${data.version}). Please update the app.`,
    );
  }
  if (!Array.isArray(data.nodes)) throw new MapFormatError('Missing "nodes" list.');
  if (data.nodes.length > MAX_NODES) {
    throw new MapFormatError(`Too many bubbles (${data.nodes.length}; limit ${MAX_NODES}).`);
  }
  if (Array.isArray(data.links) && data.links.length > MAX_LINKS) {
    throw new MapFormatError(`Too many connections (${data.links.length}; limit ${MAX_LINKS}).`);
  }

  const nodes = new Map<string, Bubble>();
  /** Raw id in the file → id actually assigned (first occurrence wins). */
  const resolved = new Map<string, string>();
  for (const raw of data.nodes) {
    if (!isRecord(raw)) continue;
    const x = finite(raw.x);
    const y = finite(raw.y);
    if (x === null || y === null) continue;
    const rawId = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
    let id = rawId?.slice(0, MAX_ID_LENGTH) ?? nodeId();
    if (nodes.has(id)) id = nodeId();
    if (rawId !== null && !resolved.has(rawId)) resolved.set(rawId, id);
    nodes.set(id, {
      id,
      x: clampCoord(x),
      y: clampCoord(y),
      d: clampDiameter(finite(raw.d) ?? DEFAULT_DIAMETER),
      text: normalizeText(typeof raw.text === 'string' ? raw.text : ''),
      color: isColorId(raw.color) ? raw.color : DEFAULT_COLOR,
    });
  }

  // Built in one pass (not via addLink, which copies the map per call) so
  // loading stays linear in the number of links.
  const links = new Map<string, Link>();
  const pairs = new Set<string>();
  for (const raw of Array.isArray(data.links) ? data.links : []) {
    if (!isRecord(raw) || typeof raw.a !== 'string' || typeof raw.b !== 'string') continue;
    // Resolve through the ids actually assigned: clipped or re-keyed nodes
    // keep their links, and ids sharing a long prefix can't be confused.
    const a = resolved.get(raw.a);
    const b = resolved.get(raw.b);
    if (a === undefined || b === undefined || a === b) continue;
    const pair = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    let id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id.slice(0, MAX_ID_LENGTH) : '';
    if (!id || links.has(id)) id = linkId();
    links.set(id, { id, a, b });
  }

  const map: MindMap = { nodes, links };
  return { map, viewport: parseViewport(data.viewport) };
}

function parseViewport(raw: unknown): Viewport | null {
  if (!isRecord(raw)) return null;
  const x = finite(raw.x);
  const y = finite(raw.y);
  const zoom = finite(raw.zoom);
  if (x === null || y === null || zoom === null || zoom <= 0) return null;
  return { x: clampCoord(x), y: clampCoord(y), zoom: clampZoom(zoom) };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MapFormatError('The file is not valid JSON.');
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const clampCoord = (n: number): number => Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, n));
