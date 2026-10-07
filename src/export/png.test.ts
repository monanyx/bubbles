import { describe, expect, it } from 'vitest';
import { rasterScale, toWellFormed } from './png';

describe('rasterScale', () => {
  it('uses the requested scale for ordinary maps', () => {
    expect(rasterScale(800, 600)).toBe(2);
  });

  it('keeps full resolution for large maps unless the area cap is asked for', () => {
    expect(rasterScale(4100, 4124)).toBeCloseTo(8192 / 4124);
    const capped = rasterScale(4100, 4124, 2, true);
    expect(4100 * capped * 4124 * capped).toBeLessThanOrEqual(4096 * 4096 + 1);
  });

  it('keeps each side within the per-side limit, even for very wide maps', () => {
    const s = rasterScale(200_000, 300);
    expect(Math.floor(200_000 * s)).toBeLessThanOrEqual(8192);
  });
});

describe('toWellFormed', () => {
  it('replaces lone surrogates and keeps real pairs', () => {
    expect(toWellFormed('a\uD83Cb')).toBe('a�b');
    expect(toWellFormed('\uDF89x')).toBe('�x');
    expect(toWellFormed('🎉 ok')).toBe('🎉 ok');
    expect(() => encodeURIComponent(toWellFormed('end\uD83C'))).not.toThrow();
  });
});
