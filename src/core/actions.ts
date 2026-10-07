import { placeChild, relax } from '../geometry/layout';
import {
  addBubble,
  addLink,
  createBubble,
  duplicateBubbles,
  emptyMap,
  moveBubbles,
  removeBubbles,
  removeLinks,
  updateBubble,
  updateBubbles,
} from '../model/map';
import type { ColorId } from '../model/palette';
import type { Bubble, NodeId, Vec } from '../model/types';
import type { Editor } from './editor';

/** Blows a new bubble at a world position and starts editing it. */
export function createBubbleAt(
  editor: Editor,
  at: Vec,
  init: Partial<Omit<Bubble, 'id' | 'x' | 'y'>> = {},
): NodeId {
  const bubble = createBubble(at, init);
  editor.commit(addBubble(editor.map, bubble));
  editor.startEditing(bubble.id);
  return bubble.id;
}

/** Adds a connected child next to `parentId`, inheriting its colour. */
export function addChild(editor: Editor, parentId: NodeId, at?: Vec): NodeId | null {
  const parent = editor.map.nodes.get(parentId);
  if (!parent) return null;
  const d = Math.max(90, Math.round(parent.d * 0.85));
  const child = createBubble(at ?? placeChild(editor.map, parentId, d), {
    d,
    color: parent.color,
  });
  const withChild = addBubble(editor.map, child);
  editor.commit(addLink(withChild, parentId, child.id).map);
  editor.startEditing(child.id);
  return child.id;
}

export function connect(editor: Editor, a: NodeId, b: NodeId): boolean {
  const { map, link } = addLink(editor.map, a, b);
  if (!link) return false;
  editor.commit(map);
  return true;
}

export interface Removed {
  nodes: number;
  links: number;
}

/** Pops every selected bubble and cuts every selected link. */
export function deleteSelection(editor: Editor): Removed {
  const { nodes, links } = editor.state.selection;
  const before = editor.map;
  let map = removeLinks(before, links);
  const linksAfterCut = map.links.size;
  map = removeBubbles(map, nodes);
  if (map === before) return { nodes: 0, links: 0 };
  editor.commit(map);
  return {
    nodes: before.nodes.size - map.nodes.size,
    links: before.links.size - linksAfterCut,
  };
}

export function setText(editor: Editor, id: NodeId, text: string): void {
  editor.commit(updateBubble(editor.map, id, { text }));
}

export function setColor(editor: Editor, ids: Iterable<NodeId>, color: ColorId): void {
  editor.commit(updateBubbles(editor.map, ids, (b) => (b.color === color ? b : { ...b, color })));
}

export function nudgeSelection(editor: Editor, dx: number, dy: number): void {
  const { nodes } = editor.state.selection;
  if (nodes.size === 0) return;
  editor.commit(moveBubbles(editor.map, nodes, dx, dy), { coalesce: 'nudge' });
}

export function duplicateSelection(editor: Editor): NodeId[] {
  const { nodes } = editor.state.selection;
  if (nodes.size === 0) return [];
  const { map, ids } = duplicateBubbles(editor.map, nodes, { x: 36, y: 36 });
  editor.commit(map);
  editor.select(ids);
  return ids;
}

export function selectAll(editor: Editor): void {
  editor.select(editor.map.nodes.keys());
}

/** Empties the canvas (undoable). Returns how many bubbles were popped. */
export function clearMap(editor: Editor): number {
  const count = editor.map.nodes.size;
  if (count > 0) editor.commit(emptyMap());
  return count;
}

/** Target positions for a tidy-up; animation is the view's job. */
export function tidyPositions(editor: Editor): Map<NodeId, Vec> {
  return relax(editor.map);
}
