/** Browsers cap canvas dimensions; stay inside every engine's limits. */
const MAX_SIDE = 8192;
/** iOS Safari refuses canvases over 4096 × 4096 pixels in total. */
const MAX_AREA = 4096 * 4096;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Largest scale ≤ `scale` that keeps the canvas within side and area limits. */
export function rasterScale(width: number, height: number, scale = 2): number {
  return Math.min(
    scale,
    MAX_SIDE / Math.max(width, height),
    Math.sqrt(MAX_AREA / (width * height)),
  );
}

/** Rasterises an SVG string to a PNG blob at up to `scale`× resolution. */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const factor = rasterScale(width, height, scale);
  const image = new Image();
  image.decoding = 'async';
  // encodeURIComponent throws on half an emoji; swap any for U+FFFD first.
  const safe = svg.replace(LONE_SURROGATE, '�');
  // A data: URL (rather than a blob: URL) keeps Safari from tainting the canvas.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safe)}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * factor));
  canvas.height = Math.max(1, Math.floor(height * factor));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image is too large to encode.'))),
      'image/png',
    );
  });
}
