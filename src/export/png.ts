/** Browsers cap canvas dimensions; stay inside every engine's per-side limit. */
const MAX_SIDE = 8192;
/** iOS/iPadOS WebKit refuses canvases over 4096 × 4096 pixels in total. */
const MAX_AREA = 4096 * 4096;

/**
 * Largest scale ≤ `scale` that keeps the canvas within the per-side limit and,
 * when `capArea` is set, within the iOS total-area limit.
 */
export function rasterScale(width: number, height: number, scale = 2, capArea = false): number {
  const sideCap = MAX_SIDE / Math.max(width, height);
  const areaCap = capArea ? Math.sqrt(MAX_AREA / (width * height)) : Infinity;
  return Math.min(scale, sideCap, areaCap);
}

/** iPhone/iPad (including iPadOS reporting as a Mac), where the area cap applies. */
function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Replaces unpaired UTF-16 surrogates (half an emoji), which make
 * encodeURIComponent throw. Written without regex lookbehind so the bundle
 * still parses on Safari before 16.4.
 */
export function toWellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) =>
    m.length === 2 ? m : '�',
  );
}

/** Rasterises an SVG string to a PNG blob at up to `scale`× resolution. */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const image = new Image();
  image.decoding = 'async';
  // A data: URL (rather than a blob: URL) keeps Safari from tainting the canvas.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toWellFormed(svg))}`;
  await image.decode();

  const capArea = isAppleMobile();
  const blob = await rasterise(image, width, height, rasterScale(width, height, scale, capArea));
  if (blob) return blob;
  // Some engines refuse large canvases silently (null context or blob): retry
  // within the strictest known limit before giving up.
  const fallback = capArea
    ? null
    : await rasterise(image, width, height, rasterScale(width, height, scale, true));
  if (fallback) return fallback;
  throw new Error('The image is too large to encode.');
}

function rasterise(
  image: HTMLImageElement,
  width: number,
  height: number,
  factor: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * factor));
  canvas.height = Math.max(1, Math.floor(height * factor));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
