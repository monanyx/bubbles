import type { ColorId } from './palette';

export type NodeId = string;
export type LinkId = string;

export interface Vec {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A bubble on the canvas. Coordinates are world-space and refer to its centre. */
export interface Bubble {
  readonly id: NodeId;
  readonly x: number;
  readonly y: number;
  /** Diameter in world pixels. */
  readonly d: number;
  readonly text: string;
  readonly color: ColorId;
}

/** An undirected connection between two bubbles. */
export interface Link {
  readonly id: LinkId;
  readonly a: NodeId;
  readonly b: NodeId;
}

/**
 * The persistent document. Maps preserve insertion order, which doubles as
 * paint order (later bubbles render on top).
 */
export interface MindMap {
  readonly nodes: ReadonlyMap<NodeId, Bubble>;
  readonly links: ReadonlyMap<LinkId, Link>;
}

/** Camera: `screen = world * zoom + (x, y)`. */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}
