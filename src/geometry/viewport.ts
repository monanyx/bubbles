import type { Rect, Vec, Viewport } from '../model/types';

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;

export const IDENTITY: Viewport = { x: 0, y: 0, zoom: 1 };

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export function screenToWorld(view: Viewport, p: Vec): Vec {
  return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
}

export function worldToScreen(view: Viewport, p: Vec): Vec {
  return { x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y };
}

/** Zooms by `factor` while keeping the world point under `anchor` (screen) fixed. */
export function zoomAt(view: Viewport, anchor: Vec, factor: number): Viewport {
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) return view;
  const world = screenToWorld(view, anchor);
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
}

export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return dx === 0 && dy === 0 ? view : { ...view, x: view.x + dx, y: view.y + dy };
}

/** Viewport that frames `rect` inside a `width`×`height` screen. */
export function fitRect(
  rect: Rect,
  width: number,
  height: number,
  { padding = 48, maxZoom = 1 }: { padding?: number; maxZoom?: number } = {},
): Viewport {
  const availW = Math.max(1, width - padding * 2);
  const availH = Math.max(1, height - padding * 2);
  const zoom = clampZoom(
    Math.min(maxZoom, availW / Math.max(1, rect.width), availH / Math.max(1, rect.height)),
  );
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { zoom, x: width / 2 - cx * zoom, y: height / 2 - cy * zoom };
}

/** Viewport centred on a world point at the given zoom. */
export function centerOn(point: Vec, width: number, height: number, zoom: number): Viewport {
  const z = clampZoom(zoom);
  return { zoom: z, x: width / 2 - point.x * z, y: height / 2 - point.y * z };
}
