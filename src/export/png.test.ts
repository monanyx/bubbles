import { describe, expect, it } from 'vitest';
import { rasterScale } from './png';

describe('rasterScale', () => {
  it('uses the requested scale for ordinary maps', () => {
    expect(rasterScale(800, 600)).toBe(2);
  });

  it('keeps the canvas within the iOS area limit', () => {
    const s = rasterScale(4100, 4124);
    expect(4100 * s * 4124 * s).toBeLessThanOrEqual(4096 * 4096 + 1);
  });

  it('keeps each side within the per-side limit, even for very wide maps', () => {
    const s = rasterScale(200_000, 300);
    expect(Math.floor(200_000 * s)).toBeLessThanOrEqual(8192);
  });
});
