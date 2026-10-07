import { linkGeometry } from '../geometry/link-path';
import { fontSizeFor } from '../geometry/text-fit';
import { bounds } from '../model/map';
import { PALETTE, rgba, type ColorId } from '../model/palette';
import type { Bubble, MindMap } from '../model/types';

export const FONT_STACK =
  "'Segoe UI', 'Segoe UI Variable', Frutiger, 'Frutiger Linotype', 'Myriad Pro', system-ui, -apple-system, Tahoma, sans-serif";

export type MeasureText = (text: string, fontSize: number) => number;

export interface SvgOptions {
  padding?: number;
  /** Paint the Aero wallpaper behind the map (default true). */
  background?: boolean;
  /** Text width measurement; defaults to canvas metrics with a heuristic fallback. */
  measure?: MeasureText;
}

export interface RenderedSvg {
  svg: string;
  width: number;
  height: number;
}

/**
 * Renders the map as a standalone SVG that mirrors the on-screen look. Each
 * CSS layer of a bubble maps to an SVG primitive: the stacked radial
 * gradients become gradient-filled circles (in bounding-box units, so one
 * definition serves every size), the inset shadow becomes a rim gradient,
 * and the outer shadow is masked so it never shows through the glass —
 * exactly like a CSS box-shadow.
 */
export function renderSvg(map: MindMap, options: SvgOptions = {}): RenderedSvg | null {
  const box = bounds(map);
  if (!box) return null;
  const { padding = 60, background = true, measure = defaultMeasure() } = options;

  // Room for drop shadows below the bubbles.
  const x = Math.floor(box.x - padding);
  const y = Math.floor(box.y - padding);
  const width = Math.ceil(box.width + padding * 2);
  const height = Math.ceil(box.height + padding * 2 + 12);
  const region = `filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}"`;

  const bubbles = [...map.nodes.values()];
  const colors = new Set<ColorId>(bubbles.map((b) => b.color));

  const defs: string[] = [
    // Wallpaper
    `<linearGradient id="bg" x1="0.33" y1="0" x2="0.67" y2="1"><stop offset="0" stop-color="#7ec8f0"/><stop offset=".38" stop-color="#2f86cf"/><stop offset=".7" stop-color="#1259a0"/><stop offset="1" stop-color="#0a3b6e"/></linearGradient>`,
    ellipseGradient('bg-sky', 0.7, -0.1, 1.2, 0.8, [173, 228, 255], 0.85, 0.6),
    ellipseGradient('bg-grass', 0.15, 1.1, 0.9, 0.7, [38, 142, 96], 0.55, 0.62),
    ellipseGradient('bg-deep', 0.95, 0.95, 0.7, 0.6, [20, 90, 170], 0.7, 0.65),
    // Wires
    `<linearGradient id="wire" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".5" stop-color="rgb(150,220,255)" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity=".9"/></linearGradient>`,
    `<filter id="wire-shadow" ${region}><feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="rgb(8,40,80)" flood-opacity=".4"/></filter>`,
    // Bubble layers shared by every colour (CSS farthest-corner radii)
    radial('spec', 0.3, 0.24, 1.0332, [
      [0, 'rgba(255,255,255,.95)'],
      [0.07, 'rgba(255,255,255,.5)'],
      [0.22, 'rgba(255,255,255,0)'],
    ]),
    radial('hot', 0.38, 0.18, 1.028, [
      [0, 'rgba(255,255,255,1)'],
      [0.06, 'rgba(255,255,255,0)'],
    ]),
    radial('refl', 0.74, 0.82, 1.1045, [
      [0, 'rgba(255,255,255,.5)'],
      [0.09, 'rgba(210,245,255,.18)'],
      [0.24, 'rgba(255,255,255,0)'],
    ]),
    radial('rim', 0.5, 0.5, 0.7071, [
      [0.58, 'rgba(255,255,255,0)'],
      [0.7, 'rgba(173,255,235,.16)'],
      [0.79, 'rgba(255,190,240,.2)'],
      [0.87, 'rgba(150,210,255,.34)'],
      [0.96, 'rgba(255,255,255,.55)'],
      [1, 'rgba(255,255,255,.18)'],
    ]),
    // Approximates the thin `0 1px 1px rgba(255,255,255,.7) inset` top highlight.
    radial('top-light', 0.5, 0.62, 0.62, [
      [0.96, 'rgba(255,255,255,0)'],
      [1, 'rgba(255,255,255,.5)'],
    ]),
    `<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".55" stop-color="#fff" stop-opacity=".32"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
    `<filter id="bubble-shadow" ${region}>` +
      `<feGaussianBlur in="SourceAlpha" stdDeviation="11"/><feOffset dy="10" result="s1"/>` +
      `<feFlood flood-color="rgb(6,38,76)" flood-opacity=".35"/><feComposite in2="s1" operator="in" result="c1"/>` +
      `<feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dy="2" result="s2"/>` +
      `<feFlood flood-color="rgb(6,38,76)" flood-opacity=".25"/><feComposite in2="s2" operator="in" result="c2"/>` +
      `<feMerge><feMergeNode in="c1"/><feMergeNode in="c2"/></feMerge></filter>`,
  ];

  for (const id of colors) {
    const t = PALETTE[id];
    defs.push(
      radial(`tint-${id}`, 0.5, 0.56, 0.7507, [
        [0, rgba(t.tint[0], t.tintAlpha[0])],
        [0.6, rgba(t.tint[1], t.tintAlpha[1])],
        [1, rgba(t.tint[2], t.tintAlpha[2])],
      ]),
      // Approximates `box-shadow: 0 -8px 18px <depth> inset`.
      radial(`depth-${id}`, 0.5, 0.36, 0.72, [
        [0.62, rgba(t.depth, 0)],
        [1, rgba(t.depth, 0.4)],
      ]),
      `<filter id="ink-${id}" ${region}>` +
        `<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="gb"/><feFlood flood-color="${rgba(t.glow, 0.95)}"/><feComposite in2="gb" operator="in" result="glow"/>` +
        `<feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/><feOffset dy="1" result="ib"/><feFlood flood-color="${rgba(t.ink, 0.85)}"/><feComposite in2="ib" operator="in" result="ink"/>` +
        `<feMerge><feMergeNode in="glow"/><feMergeNode in="ink"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    );
  }

  const wires: string[] = [];
  for (const link of map.links.values()) {
    const a = map.nodes.get(link.a);
    const b = map.nodes.get(link.b);
    if (!a || !b) continue;
    const g = linkGeometry({ x: a.x, y: a.y, r: a.d / 2 }, { x: b.x, y: b.y, r: b.d / 2 });
    if (!g.visible) continue;
    wires.push(
      `<path d="${g.path}" fill="none" stroke="url(#wire)" stroke-width="3" stroke-linecap="round" filter="url(#wire-shadow)"/>` +
        `<path d="${g.path}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1" stroke-linecap="round"/>`,
    );
  }

  const shapes = bubbles.map((bubble, i) => {
    const { mask, body } = renderBubble(bubble, i, { x, y, width, height }, measure);
    defs.push(mask);
    return body;
  });

  const backdrop = background
    ? ['bg', 'bg-deep', 'bg-grass', 'bg-sky']
        .map(
          (id) =>
            `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#${id})"/>`,
        )
        .join('')
    : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" font-family="${escapeAttr(FONT_STACK)}">` +
    `<defs>${defs.join('')}</defs>${backdrop}<g>${wires.join('')}</g><g>${shapes.join('')}</g></svg>`;

  return { svg, width, height };
}

function renderBubble(
  bubble: Bubble,
  index: number,
  region: { x: number; y: number; width: number; height: number },
  measure: MeasureText,
): { mask: string; body: string } {
  const { x: cx, y: cy, d, color } = bubble;
  const r = d / 2;
  const c = `cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"`;
  const maskId = `m${index}`;

  // Keep the drop shadow outside the circle, as CSS box-shadow does.
  const mask =
    `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}">` +
    `<rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" fill="#fff"/>` +
    `<circle ${c} fill="#000"/></mask>`;

  // CSS gloss: left 9%, top 4%, 82%×46%, border-radius 50% / 58% (scaled to fit).
  const gw = d * 0.82;
  const gh = d * 0.46;
  const gloss = `<rect x="${num(cx - r + d * 0.09)}" y="${num(cy - r + d * 0.04)}" width="${num(gw)}" height="${num(gh)}" rx="${num(gw * 0.431)}" ry="${num(gh * 0.5)}" fill="url(#gloss)" opacity=".75" style="mix-blend-mode:screen"/>`;

  const layers = ['tint-' + color, 'rim', 'refl', 'hot', 'spec', 'depth-' + color, 'top-light']
    .map((id) => `<circle ${c} fill="url(#${id})"/>`)
    .join('');

  const body =
    `<g><circle ${c} fill="#000" filter="url(#bubble-shadow)" mask="url(#${maskId})"/>` +
    layers +
    `<circle ${c} fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>` +
    gloss +
    renderLabel(bubble, measure) +
    `</g>`;
  return { mask, body };
}

function renderLabel(bubble: Bubble, measure: MeasureText): string {
  if (!bubble.text) return '';
  const fontSize = fontSizeFor(bubble.d, bubble.text);
  const box = bubble.d * 0.64; // 18% padding each side
  const lineHeight = fontSize * 1.2;
  const maxLines = Math.max(1, Math.floor(box / lineHeight));
  const lines = wrapText(bubble.text, box, fontSize, measure).slice(0, maxLines);
  const top = bubble.y - (lines.length * lineHeight) / 2 + lineHeight / 2;
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${num(bubble.x)}" y="${num(top + i * lineHeight)}">${escapeText(line)}</tspan>`,
    )
    .join('');
  return `<text font-size="${fontSize}" font-weight="600" fill="#fff" text-anchor="middle" dominant-baseline="central" filter="url(#ink-${bubble.color})">${tspans}</text>`;
}

/** Greedy word wrap honouring explicit newlines; over-long words break anywhere. */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Break a word that is too long on its own, character by character.
      let chunk = '';
      for (const ch of word) {
        if (chunk && measure(chunk + ch, fontSize) > maxWidth) {
          lines.push(chunk);
          chunk = '';
        }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

/** Canvas-based text measurement, falling back to an average glyph width. */
export function defaultMeasure(): MeasureText {
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return (text, size) => [...text].length * size * 0.56;
  const context = ctx;
  return (text, size) => {
    context.font = `600 ${size}px ${FONT_STACK}`;
    return context.measureText(text).width;
  };
}

function radial(id: string, cx: number, cy: number, r: number, stops: [number, string][]): string {
  return (
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${cx}" fy="${cy}">` +
    stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('') +
    `</radialGradient>`
  );
}

/**
 * CSS `radial-gradient(ellipse RX RY at X Y, color, transparent STOP)`.
 * SVG interpolates without premultiplied alpha, so fade to the same colour at
 * zero opacity rather than to transparent black (which would leave grey halos).
 */
function ellipseGradient(
  id: string,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: readonly [number, number, number],
  alpha: number,
  stop: number,
): string {
  return (
    `<radialGradient id="${id}" cx="0" cy="0" r="1" gradientTransform="translate(${x} ${y}) scale(${rx} ${ry})">` +
    `<stop offset="0" stop-color="${rgba(color, alpha)}"/><stop offset="${stop}" stop-color="${rgba(color, 0)}"/></radialGradient>`
  );
}

/** Compact number formatting: at most two decimals, no float noise. */
const num = (n: number): string => String(Math.round(n * 100) / 100);

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');
