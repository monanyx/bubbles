type Rgb = readonly [number, number, number];

export interface BubbleTheme {
  readonly label: string;
  /** Glass body tint, from centre to rim. Alpha values are part of the look. */
  readonly tint: readonly [Rgb, Rgb, Rgb];
  readonly tintAlpha: readonly [number, number, number];
  /** Colour of the inner bottom shadow that gives the glass its depth. */
  readonly depth: Rgb;
  /** Text shadow colour, keeps white labels legible on every tint. */
  readonly ink: Rgb;
  /** Selection glow. */
  readonly glow: Rgb;
  /** Solid swatch shown in the colour picker. */
  readonly swatch: string;
}

/**
 * Single source of truth for bubble colours. The DOM view turns this into CSS
 * custom properties and the SVG exporter turns it into gradients, so the two
 * renderings can never drift apart.
 */
export const PALETTE = {
  sky: {
    label: 'Sky',
    tint: [
      [190, 228, 255],
      [140, 200, 245],
      [90, 160, 220],
    ],
    tintAlpha: [0.1, 0.16, 0.26],
    depth: [40, 110, 180],
    ink: [8, 45, 90],
    glow: [130, 215, 255],
    swatch: '#5db2e8',
  },
  aqua: {
    label: 'Aqua',
    tint: [
      [200, 255, 235],
      [120, 225, 190],
      [40, 170, 130],
    ],
    tintAlpha: [0.14, 0.24, 0.4],
    depth: [20, 120, 90],
    ink: [5, 70, 50],
    glow: [140, 255, 210],
    swatch: '#2fbf8f',
  },
  sun: {
    label: 'Sun',
    tint: [
      [255, 246, 205],
      [255, 205, 95],
      [252, 150, 25],
    ],
    tintAlpha: [0.26, 0.46, 0.68],
    depth: [190, 100, 20],
    ink: [120, 60, 0],
    glow: [255, 220, 130],
    swatch: '#f5a640',
  },
  rose: {
    label: 'Rose',
    tint: [
      [255, 215, 235],
      [250, 160, 200],
      [225, 90, 150],
    ],
    tintAlpha: [0.14, 0.24, 0.4],
    depth: [170, 40, 100],
    ink: [110, 20, 60],
    glow: [255, 170, 215],
    swatch: '#e86aa6',
  },
  violet: {
    label: 'Violet',
    tint: [
      [230, 215, 255],
      [185, 160, 250],
      [130, 95, 225],
    ],
    tintAlpha: [0.14, 0.24, 0.4],
    depth: [80, 50, 170],
    ink: [50, 25, 110],
    glow: [200, 175, 255],
    swatch: '#8d6be6',
  },
  lime: {
    label: 'Lime',
    tint: [
      [235, 255, 200],
      [190, 240, 120],
      [120, 200, 50],
    ],
    tintAlpha: [0.14, 0.24, 0.4],
    depth: [70, 140, 20],
    ink: [40, 90, 10],
    glow: [210, 255, 140],
    swatch: '#86cc3a',
  },
} as const satisfies Record<string, BubbleTheme>;

export type ColorId = keyof typeof PALETTE;

export const COLOR_IDS = Object.keys(PALETTE) as ColorId[];
export const DEFAULT_COLOR: ColorId = 'sky';

export function isColorId(value: unknown): value is ColorId {
  return typeof value === 'string' && Object.hasOwn(PALETTE, value);
}

export const rgba = ([r, g, b]: Rgb, alpha: number): string => `rgba(${r},${g},${b},${alpha})`;
