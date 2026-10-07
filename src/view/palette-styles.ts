import { COLOR_IDS, PALETTE, rgba } from '../model/palette';

/** CSS custom properties for each bubble colour, generated from the palette. */
export function paletteCss(): string {
  return COLOR_IDS.map((id) => {
    const t = PALETTE[id];
    return (
      `.bubble[data-color="${id}"]{` +
      `--tint-1:${rgba(t.tint[0], t.tintAlpha[0])};` +
      `--tint-2:${rgba(t.tint[1], t.tintAlpha[1])};` +
      `--tint-3:${rgba(t.tint[2], t.tintAlpha[2])};` +
      `--depth:${rgba(t.depth, 0.25)};` +
      `--ink:${rgba(t.ink, 0.85)};` +
      `--glow:${rgba(t.glow, 0.95)};}`
    );
  }).join('\n');
}

export function installPaletteStyles(doc: Document = document): void {
  if (doc.head.querySelector('style[data-palette]')) return;
  const style = doc.createElement('style');
  style.dataset.palette = '';
  style.textContent = paletteCss();
  doc.head.append(style);
}
