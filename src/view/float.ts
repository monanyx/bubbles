import type { NodeId } from '../model/types';

/** Per-bubble drift rhythm, derived from its id so it survives reloads. */
export interface FloatRhythm {
  /** Seconds for one half-swing of the bob (like a CSS `alternate` cycle). */
  readonly period: number;
  readonly phase: number;
}

export interface FloatOffset {
  readonly x: number;
  readonly y: number;
  /** Degrees. */
  readonly rotate: number;
}

const BOB = 7;
const SWAY = 5;
const TILT = 1.2;

export const REST: FloatOffset = { x: 0, y: 0, rotate: 0 };

/** FNV-1a — tiny, stable string hash. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rhythmFor(id: NodeId): FloatRhythm {
  const h = hash(id);
  return { period: 4 + ((h & 0xffff) / 0xffff) * 3, phase: ((h >>> 16) / 0xffff) * 7 };
}

/**
 * Where a bubble has drifted to at time `t` (seconds). Mirrors the original
 * CSS bob (±7px, gentle tilt) and slower sway (±5px), scaled by `amplitude`
 * so selected bubbles can settle smoothly instead of snapping.
 */
export function floatOffset(rhythm: FloatRhythm, t: number, amplitude: number): FloatOffset {
  if (amplitude <= 0.001) return REST;
  const bob = Math.cos((Math.PI * (t + rhythm.phase)) / rhythm.period);
  const sway = Math.cos((Math.PI * (t + rhythm.phase)) / (rhythm.period * 1.7));
  return {
    x: -SWAY * sway * amplitude,
    y: -BOB * bob * amplitude,
    rotate: -TILT * bob * amplitude,
  };
}
