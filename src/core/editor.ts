import { IDENTITY } from '../geometry/viewport';
import { History, type RecordOptions } from '../model/history';
import { emptyMap } from '../model/map';
import type { LinkId, MindMap, NodeId, Viewport } from '../model/types';

export interface Selection {
  readonly nodes: ReadonlySet<NodeId>;
  readonly links: ReadonlySet<LinkId>;
}

export interface ConnectState {
  /** Connect mode: taps pick a source bubble, then a target. */
  readonly active: boolean;
  readonly source: NodeId | null;
}

export interface EditorState {
  readonly map: MindMap;
  readonly viewport: Viewport;
  readonly selection: Selection;
  /** Bubble whose label is being edited inline. */
  readonly editing: NodeId | null;
  readonly connect: ConnectState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type Listener = (state: EditorState, previous: EditorState) => void;

const EMPTY_SELECTION: Selection = { nodes: new Set(), links: new Set() };
const IDLE_CONNECT: ConnectState = { active: false, source: null };

/**
 * Owns all application state. Views subscribe to changes; nothing else
 * mutates state. Document edits go through {@link commit} (undoable) or
 * {@link preview} + {@link commitFrom} for continuous gestures such as drags,
 * so a whole drag becomes a single undo step.
 */
export class Editor {
  private current: EditorState;
  private readonly history = new History<MindMap>();
  private readonly listeners = new Set<Listener>();
  private readonly queue: [EditorState, EditorState][] = [];
  private notifying = false;

  constructor(map: MindMap = emptyMap(), viewport: Viewport = IDENTITY) {
    this.current = {
      map,
      viewport,
      selection: EMPTY_SELECTION,
      editing: null,
      connect: IDLE_CONNECT,
      canUndo: false,
      canRedo: false,
    };
  }

  get state(): EditorState {
    return this.current;
  }

  get map(): MindMap {
    return this.current.map;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ---------------------------------------------------------------- document */

  /** Applies an undoable document change. */
  commit(map: MindMap, options?: RecordOptions): void {
    if (map === this.current.map) return;
    this.history.record(this.current.map, options);
    this.set({ map });
  }

  /** Shows an in-progress change without recording history. */
  preview(map: MindMap): void {
    this.set({ map });
  }

  /** Records `before` as the undo point for changes already previewed. */
  commitFrom(before: MindMap, options?: RecordOptions): void {
    if (before === this.current.map) return;
    this.history.record(before, options);
    this.set({});
  }

  undo(): boolean {
    const previous = this.history.undo(this.current.map);
    if (previous === undefined) return false;
    this.set({ map: previous, editing: null });
    return true;
  }

  redo(): boolean {
    const next = this.history.redo(this.current.map);
    if (next === undefined) return false;
    this.set({ map: next, editing: null });
    return true;
  }

  /** Replaces the document wholesale and forgets history (e.g. initial load). */
  reset(map: MindMap, viewport?: Viewport): void {
    this.history.clear();
    this.set({
      map,
      viewport: viewport ?? this.current.viewport,
      selection: EMPTY_SELECTION,
      editing: null,
      connect: IDLE_CONNECT,
    });
  }

  /* --------------------------------------------------------------- selection */

  select(nodes: Iterable<NodeId> = [], links: Iterable<LinkId> = []): void {
    const next: Selection = { nodes: new Set(nodes), links: new Set(links) };
    if (sameSelection(next, this.current.selection)) return;
    const editing =
      this.current.editing !== null && next.nodes.has(this.current.editing)
        ? this.current.editing
        : null;
    this.set({ selection: next, editing });
  }

  toggleNode(id: NodeId): void {
    const nodes = new Set(this.current.selection.nodes);
    if (!nodes.delete(id)) nodes.add(id);
    this.select(nodes, this.current.selection.links);
  }

  clearSelection(): void {
    this.select();
  }

  /** The single selected bubble, if exactly one is selected (and no links). */
  get soleSelected(): NodeId | null {
    const { nodes, links } = this.current.selection;
    if (nodes.size !== 1 || links.size !== 0) return null;
    return nodes.values().next().value ?? null;
  }

  /* ----------------------------------------------------------------- editing */

  startEditing(id: NodeId): void {
    if (!this.current.map.nodes.has(id)) return;
    this.set({
      selection: { nodes: new Set([id]), links: new Set() },
      editing: id,
      connect: IDLE_CONNECT,
    });
  }

  stopEditing(): void {
    if (this.current.editing !== null) this.set({ editing: null });
  }

  /* ----------------------------------------------------------------- connect */

  setConnect(active: boolean, source: NodeId | null = null): void {
    const connect = active ? { active, source } : IDLE_CONNECT;
    const { connect: prev } = this.current;
    if (prev.active === connect.active && prev.source === connect.source) return;
    this.set(
      active ? { connect, editing: null, selection: EMPTY_SELECTION } : { connect: IDLE_CONNECT },
    );
  }

  /* ---------------------------------------------------------------- viewport */

  setViewport(viewport: Viewport): void {
    const v = this.current.viewport;
    if (v.x === viewport.x && v.y === viewport.y && v.zoom === viewport.zoom) return;
    this.set({ viewport });
  }

  /* ---------------------------------------------------------------- internal */

  private set(patch: Partial<EditorState>): void {
    const previous = this.current;
    let next: EditorState = {
      ...previous,
      ...patch,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
    if (next.map !== previous.map) next = prune(next);

    const changed = (Object.keys(next) as (keyof EditorState)[]).some(
      (key) => next[key] !== previous[key],
    );
    if (!changed) return;

    this.current = next;
    // Listeners may change state themselves (e.g. committing text when editing
    // ends). Queue those so every listener sees each transition in order.
    this.queue.push([next, previous]);
    if (this.notifying) return;
    this.notifying = true;
    try {
      for (let item = this.queue.shift(); item; item = this.queue.shift()) {
        for (const listener of this.listeners) listener(item[0], item[1]);
      }
    } finally {
      this.notifying = false;
      this.queue.length = 0;
    }
  }
}

/** Drops references to bubbles/links that no longer exist. */
function prune(state: EditorState): EditorState {
  const { map, selection, editing, connect } = state;
  const nodes = [...selection.nodes].filter((id) => map.nodes.has(id));
  const links = [...selection.links].filter((id) => map.links.has(id));
  const selectionChanged =
    nodes.length !== selection.nodes.size || links.length !== selection.links.size;
  return {
    ...state,
    selection: selectionChanged ? { nodes: new Set(nodes), links: new Set(links) } : selection,
    editing: editing !== null && map.nodes.has(editing) ? editing : null,
    connect:
      connect.source !== null && !map.nodes.has(connect.source)
        ? { ...connect, source: null }
        : connect,
  };
}

function sameSelection(a: Selection, b: Selection): boolean {
  return sameSet(a.nodes, b.nodes) && sameSet(a.links, b.links);
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
