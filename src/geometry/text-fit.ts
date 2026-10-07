const MIN_FONT = 10;
const MAX_FONT = 40;

/**
 * Font size that lets `text` fill a bubble of diameter `d` comfortably.
 *
 * The usable label area is roughly the circle's inscribed square, so the ideal
 * size falls with the square root of the character count. It is capped
 * relative to the diameter so short labels don't look shouty.
 */
export function fontSizeFor(d: number, text: string): number {
  const length = Math.max(1, [...text].length);
  const ideal = (0.62 * d) / Math.sqrt(length);
  return Math.round(Math.max(MIN_FONT, Math.min(d / 7.5, ideal, MAX_FONT)));
}
