/** Browsers cap canvas dimensions; stay well inside every engine's limit. */
const MAX_SIDE = 8192;

/** Rasterises an SVG string to a PNG blob at up to `scale`× resolution. */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const factor = Math.max(0.1, Math.min(scale, MAX_SIDE / Math.max(width, height)));
  const image = new Image();
  image.decoding = 'async';
  // A data: URL (rather than a blob: URL) keeps Safari from tainting the canvas.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * factor);
  canvas.height = Math.round(height * factor);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG.'))),
      'image/png',
    );
  });
}
