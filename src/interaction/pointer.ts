import { addChild, connect, pickConnectTarget } from '../core/actions';
import type { Editor } from '../core/editor';
import { panBy, zoomAt } from '../geometry/viewport';
import { bubblesInRect, moveBubbles, updateBubble } from '../model/map';
import type { LinkId, MindMap, NodeId, Rect, Vec, Viewport } from '../model/types';
import type { Scene } from '../view/scene';

/** Movement (px) below which a press counts as a tap. */
const TAP_SLOP = 5;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP = 30;

export interface PointerHooks {
  /** Any pointer interaction began (close popovers, stop animations…). */
  interaction(): void;
  createAt(world: Vec): void;
  pop(id: NodeId): void;
  cut(id: LinkId): void;
  pickColor(id: NodeId, anchor: HTMLElement): void;
  connected(ok: boolean): void;
  sprouted(): void;
}

type Gesture =
  | { kind: 'pan'; pointerId: number; start: Vec; origin: Viewport; moved: boolean }
  | { kind: 'marquee'; pointerId: number; start: Vec; base: ReadonlySet<NodeId> }
  | {
      kind: 'drag';
      pointerId: number;
      id: NodeId;
      start: Vec;
      startWorld: Vec;
      before: MindMap;
      /** The map this gesture last previewed; anything else means someone else edited. */
      last: MindMap;
      moved: boolean;
      wasSole: boolean;
      additive: boolean;
      ids: NodeId[];
    }
  | {
      kind: 'resize';
      pointerId: number;
      id: NodeId;
      before: MindMap;
      last: MindMap;
      grip: number;
    }
  | { kind: 'connect'; pointerId: number; source: NodeId; start: Vec; moved: boolean }
  | { kind: 'link'; pointerId: number; id: LinkId; start: Vec; additive: boolean }
  | { kind: 'pinch'; startDistance: number; startMid: Vec; origin: Viewport };

/**
 * Translates raw pointer, wheel and touch input on the canvas into editor
 * operations. One gesture is active at a time; a second touch converts
 * whatever is happening into a pinch-zoom.
 */
export class PointerController {
  private gesture: Gesture | null = null;
  private readonly pointers = new Map<number, Vec>();
  private lastTap = { time: 0, x: 0, y: 0 };
  private spaceHeld = false;
  private readonly root: HTMLElement;

  constructor(
    private readonly scene: Scene,
    private readonly editor: Editor,
    private readonly hooks: PointerHooks,
  ) {
    this.root = scene.root;
    this.root.tabIndex = -1;
    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onCancel);
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onWindowBlur);
  }

  destroy(): void {
    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('pointermove', this.onMove);
    this.root.removeEventListener('pointerup', this.onUp);
    this.root.removeEventListener('pointercancel', this.onCancel);
    this.root.removeEventListener('wheel', this.onWheel);
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  /* ----------------------------------------------------------------- down */

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const point = this.scene.toCanvas(e);
    // A primary pointer starts a fresh sequence; forget any release we missed.
    if (e.isPrimary) this.pointers.clear();
    this.pointers.set(e.pointerId, point);
    this.hooks.interaction();

    if (this.pointers.size === 2 && e.pointerType !== 'mouse') {
      this.startPinch();
      return;
    }
    if (this.gesture) return;

    const target = e.target instanceof Element ? e.target : this.root;
    const bubbleEl = target.closest<HTMLElement>('.bubble');
    const chipEl = target.closest<HTMLElement>('[data-chip]');
    const { editing } = this.editor.state;

    // Inside the label being edited the browser owns the pointer (caret, selection).
    if (editing !== null && bubbleEl?.dataset.id === editing && target.closest('.label')) return;
    if (editing !== null) this.editor.stopEditing();

    if (e.button === 1 || this.spaceHeld) {
      e.preventDefault();
      this.startPan(e, point);
      return;
    }

    if (chipEl) {
      const sole = this.editor.soleSelected;
      const kind = chipEl.dataset.chip;
      if (sole === null || (kind !== 'link' && kind !== 'grow')) return; // handled on click
      e.preventDefault();
      chipEl.setPointerCapture(e.pointerId);
      if (kind === 'link') {
        this.gesture = {
          kind: 'connect',
          pointerId: e.pointerId,
          source: sole,
          start: point,
          moved: false,
        };
      } else {
        const bubble = this.editor.map.nodes.get(sole)!;
        const world = this.scene.toWorld(point);
        this.gesture = {
          kind: 'resize',
          pointerId: e.pointerId,
          id: sole,
          before: this.editor.map,
          last: this.editor.map,
          grip: 2 * Math.hypot(world.x - bubble.x, world.y - bubble.y) - bubble.d,
        };
      }
      return;
    }

    e.preventDefault();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    if (bubbleEl?.dataset.id && !bubbleEl.classList.contains('is-popping')) {
      const id = bubbleEl.dataset.id;
      bubbleEl.setPointerCapture(e.pointerId);
      this.gesture = {
        kind: 'drag',
        pointerId: e.pointerId,
        id,
        start: point,
        startWorld: this.scene.toWorld(point),
        before: this.editor.map,
        last: this.editor.map,
        moved: false,
        wasSole: this.editor.soleSelected === id,
        additive,
        ids: [],
      };
      return;
    }

    const linkEl = target.closest<SVGElement>('[data-link-id]');
    if (linkEl?.dataset.linkId) {
      this.root.setPointerCapture(e.pointerId);
      this.gesture = {
        kind: 'link',
        pointerId: e.pointerId,
        id: linkEl.dataset.linkId,
        start: point,
        additive,
      };
      return;
    }

    if (e.shiftKey) {
      this.root.setPointerCapture(e.pointerId);
      this.gesture = {
        kind: 'marquee',
        pointerId: e.pointerId,
        start: point,
        base: new Set(this.editor.state.selection.nodes),
      };
      return;
    }

    this.startPan(e, point);
  };

  private startPan(e: PointerEvent, point: Vec): void {
    this.root.setPointerCapture(e.pointerId);
    this.gesture = {
      kind: 'pan',
      pointerId: e.pointerId,
      start: point,
      origin: this.editor.state.viewport,
      moved: false,
    };
  }

  private startPinch(): void {
    this.abort();
    const [a, b] = [...this.pointers.values()] as [Vec, Vec];
    this.gesture = {
      kind: 'pinch',
      startDistance: Math.max(1, distance(a, b)),
      startMid: midpoint(a, b),
      origin: this.editor.state.viewport,
    };
  }

  /* ----------------------------------------------------------------- move */

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const point = this.scene.toCanvas(e);
    this.pointers.set(e.pointerId, point);
    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const mid = midpoint(a, b);
      const zoomed = zoomAt(g.origin, g.startMid, distance(a, b) / g.startDistance);
      this.editor.setViewport(panBy(zoomed, mid.x - g.startMid.x, mid.y - g.startMid.y));
      return;
    }
    if (e.pointerId !== g.pointerId) return;

    switch (g.kind) {
      case 'pan': {
        if (!g.moved && distance(point, g.start) < TAP_SLOP) return;
        if (!g.moved) {
          g.moved = true;
          this.root.classList.add('is-panning');
        }
        this.editor.setViewport(panBy(g.origin, point.x - g.start.x, point.y - g.start.y));
        return;
      }
      case 'marquee': {
        const rect = rectFrom(g.start, point);
        this.scene.setMarquee(rect);
        const a = this.scene.toWorld({ x: rect.x, y: rect.y });
        const b = this.scene.toWorld({ x: rect.x + rect.width, y: rect.y + rect.height });
        const hits = bubblesInRect(this.editor.map, rectFrom(a, b));
        this.editor.select(new Set([...g.base, ...hits]));
        return;
      }
      case 'drag': {
        if (this.superseded(g)) return;
        if (!g.moved) {
          if (distance(point, g.start) < TAP_SLOP) return;
          g.moved = true;
          g.ids = this.dragSet(g.id, g.additive);
          this.scene.setDragging(g.ids);
        }
        const world = this.scene.toWorld(point);
        g.last = moveBubbles(g.before, g.ids, world.x - g.startWorld.x, world.y - g.startWorld.y);
        this.editor.preview(g.last);
        return;
      }
      case 'resize': {
        if (this.superseded(g)) return;
        const bubble = g.before.nodes.get(g.id);
        if (!bubble) return;
        const world = this.scene.toWorld(point);
        const d = 2 * Math.hypot(world.x - bubble.x, world.y - bubble.y) - g.grip;
        g.last = updateBubble(g.before, g.id, { d });
        this.editor.preview(g.last);
        return;
      }
      case 'connect': {
        if (!g.moved && distance(point, g.start) < TAP_SLOP) return;
        g.moved = true;
        const world = this.scene.toWorld(point);
        this.scene.setTempWire(g.source, world);
        this.scene.setDropTarget(this.scene.bubbleAt(world, g.source));
        return;
      }
      case 'link': {
        // Dragging from a wire pans, like dragging empty space.
        if (distance(point, g.start) < TAP_SLOP) return;
        this.gesture = {
          kind: 'pan',
          pointerId: g.pointerId,
          start: g.start,
          origin: this.editor.state.viewport,
          moved: false,
        };
        this.onMove(e);
        return;
      }
    }
  };

  /**
   * True (and the gesture is dropped) when something else changed the document
   * mid-gesture — an undo, a Delete, another tab. Previewing or committing from
   * the stale `before` snapshot would silently revert that change.
   */
  private superseded(g: { last: MindMap }): boolean {
    if (this.editor.map === g.last) return false;
    this.gesture = null;
    this.cleanup();
    return true;
  }

  /** Which bubbles a drag should carry along. */
  private dragSet(id: NodeId, additive: boolean): NodeId[] {
    const { nodes } = this.editor.state.selection;
    if (additive) {
      const ids = new Set(nodes).add(id);
      this.editor.select(ids);
      return [...ids];
    }
    if (nodes.has(id)) return [...nodes];
    this.editor.select([id]);
    return [id];
  }

  /* ------------------------------------------------------------------- up */

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) this.gesture = null;
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    this.gesture = null;
    const point = this.scene.toCanvas(e);

    switch (g.kind) {
      case 'pan':
        this.root.classList.remove('is-panning');
        if (!g.moved) this.tapEmpty(point, e.shiftKey);
        return;
      case 'marquee':
        this.scene.setMarquee(null);
        return;
      case 'drag':
        if (!g.moved) {
          this.tapBubble(g.id, g.wasSole, g.additive);
        } else if (!this.superseded(g)) {
          this.scene.setDragging([]);
          this.editor.commitFrom(g.before);
        }
        return;
      case 'resize':
        if (!this.superseded(g)) this.editor.commitFrom(g.before);
        return;
      case 'connect': {
        this.scene.setTempWire(null);
        this.scene.setDropTarget(null);
        if (!this.editor.map.nodes.has(g.source)) return; // popped mid-gesture
        if (!g.moved) {
          this.editor.setConnect(true, g.source);
          return;
        }
        const world = this.scene.toWorld(point);
        const target = this.scene.bubbleAt(world, g.source);
        if (target !== null) {
          this.hooks.connected(connect(this.editor, g.source, target));
        } else {
          addChild(this.editor, g.source, world);
          this.hooks.sprouted();
        }
        return;
      }
      case 'link': {
        const { nodes, links } = this.editor.state.selection;
        if (g.additive) {
          const next = new Set(links);
          if (!next.delete(g.id)) next.add(g.id);
          this.editor.select(nodes, next);
        } else {
          this.editor.select([], [g.id]);
        }
        this.root.focus({ preventScroll: true });
        return;
      }
    }
  };

  private tapEmpty(point: Vec, additive: boolean): void {
    const now = performance.now();
    const { connect: mode } = this.editor.state;
    if (
      now - this.lastTap.time < DOUBLE_TAP_MS &&
      distance(point, this.lastTap) < DOUBLE_TAP_SLOP
    ) {
      this.lastTap.time = 0;
      this.hooks.createAt(this.scene.toWorld(point));
      return;
    }
    this.lastTap = { time: now, x: point.x, y: point.y };
    if (mode.active) this.editor.setConnect(true, null);
    else if (!additive) this.editor.clearSelection();
    this.root.focus({ preventScroll: true });
  }

  private tapBubble(id: NodeId, wasSole: boolean, additive: boolean): void {
    if (this.editor.state.connect.active) {
      const pick = pickConnectTarget(this.editor, id);
      if (pick === 'connected' || pick === 'exists') this.hooks.connected(pick === 'connected');
      return;
    }
    if (additive) this.editor.toggleNode(id);
    else if (wasSole) this.editor.startEditing(id);
    else this.editor.select([id]);
    if (this.editor.state.editing !== id) this.scene.focusBubble(id);
  }

  /* --------------------------------------------------------------- cancel */

  private readonly onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g || (g.kind !== 'pinch' && g.pointerId !== e.pointerId)) return;
    // Keep whatever the user saw; the platform interrupted, not the user.
    const keep = (g.kind === 'drag' && g.moved) || g.kind === 'resize';
    if (keep && this.editor.map === g.last) this.editor.commitFrom(g.before);
    this.gesture = null;
    this.cleanup();
  };

  /** Reverts an in-progress gesture (used when a pinch takes over). */
  private abort(): void {
    const g = this.gesture;
    this.gesture = null;
    // Only undo our own preview; never roll back something newer (undo, another tab).
    if ((g?.kind === 'drag' || g?.kind === 'resize') && this.editor.map === g.last) {
      this.editor.preview(g.before);
    }
    this.cleanup();
  }

  /**
   * Finishes an in-progress drag or resize as its own undo step. Called before
   * any keyboard or toolbar command, so the command applies on top of the drag
   * instead of recording the half-done preview as its undo point.
   */
  settle(): void {
    const g = this.gesture;
    if (g?.kind !== 'drag' && g?.kind !== 'resize') return;
    if (g.kind === 'drag' && !g.moved) return; // a press, not yet a drag
    this.gesture = null;
    if (this.editor.map === g.last) this.editor.commitFrom(g.before);
    this.cleanup();
  }

  private cleanup(): void {
    this.root.classList.remove('is-panning');
    this.scene.setDragging([]);
    this.scene.setTempWire(null);
    this.scene.setDropTarget(null);
    this.scene.setMarquee(null);
  }

  /* ---------------------------------------------------------------- wheel */

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.hooks.interaction();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.root.clientHeight : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    const view = this.editor.state.viewport;

    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinches arrive as small ctrl+wheel deltas; mouse notches are large.
      const factor = Math.abs(dy) >= 50 ? (dy > 0 ? 1 / 1.2 : 1.2) : Math.exp(-dy * 0.01);
      this.editor.setViewport(zoomAt(view, this.scene.toCanvas(e), factor));
      return;
    }
    if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
    this.editor.setViewport(panBy(view, -dx, -dy));
  };

  /* --------------------------------------------------------------- chips */

  private readonly onClick = (e: MouseEvent): void => {
    const chipEl =
      e.target instanceof Element ? e.target.closest<HTMLElement>('[data-chip]') : null;
    if (!chipEl) return;
    // Keyboard activation (detail 0) had no pointerdown to settle animations.
    if (e.detail === 0) this.hooks.interaction();
    const sole = this.editor.soleSelected;
    switch (chipEl.dataset.chip ?? '') {
      case 'pop':
        if (sole !== null) this.hooks.pop(sole);
        break;
      case 'color':
        if (sole !== null) this.hooks.pickColor(sole, chipEl);
        break;
      case 'cut': {
        const [linkId] = this.editor.state.selection.links;
        if (linkId !== undefined) this.hooks.cut(linkId);
        break;
      }
      case 'link':
        // Pointer taps are handled as gestures; this covers keyboard activation.
        if (e.detail === 0 && sole !== null) {
          this.editor.setConnect(true, sole);
          // The chip hides in connect mode; keep focus on the source bubble so
          // arrows and Enter can pick the target.
          this.scene.focusBubble(sole);
        }
        break;
      default:
        break;
    }
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (!(e.target instanceof Element && e.target.closest('.is-editing .label')))
      e.preventDefault();
  };

  /* -------------------------------------------------------- space to pan */

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== ' ') return;
    // Always honour the release, wherever focus went while Space was held
    // (a new bubble's label, a toolbar button…), or pan mode would stick.
    if (e.type === 'keyup') {
      this.spaceHeld = false;
      this.root.classList.remove('space-pan');
      return;
    }
    if (e.defaultPrevented || isTypingTarget(e.target) || isControl(e.target)) return;
    e.preventDefault();
    if (this.spaceHeld) return;
    this.spaceHeld = true;
    this.root.classList.add('space-pan');
  };

  private readonly onWindowBlur = (): void => {
    this.spaceHeld = false;
    this.root.classList.remove('space-pan');
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Buttons and menu items handle Space themselves. */
export function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a[href], [role="menuitem"]') !== null;
}

const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const rectFrom = (a: Vec, b: Vec): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});
