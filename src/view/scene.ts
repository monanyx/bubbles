import type { Editor, EditorState } from '../core/editor';
import { linkGeometry, type Circle } from '../geometry/link-path';
import { screenToWorld } from '../geometry/viewport';
import type { LinkId, NodeId, Rect, Vec, Viewport } from '../model/types';
import { BubbleView } from './bubble-view';
import { popBubble } from './effects';
import { icon } from './icons';
import { LinkView } from './link-view';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Removing more than this many bubbles at once skips the droplet spray. */
const DROPLET_LIMIT = 30;

export interface SceneOptions {
  /** Defaults to the user's `prefers-reduced-motion` setting. */
  reducedMotion?: boolean;
}

/**
 * Renders editor state into the canvas and owns the animation loop.
 *
 * Rendering is keyed by id and diffed by object identity (the document is
 * immutable), so a drag only touches the moved bubbles and their wires.
 * Updates are batched into one animation frame; {@link flush} renders
 * synchronously when a caller needs the DOM immediately (e.g. to focus a new
 * bubble inside the same user gesture so mobile keyboards open).
 */
export class Scene {
  readonly root: HTMLElement;
  readonly bubbleLayer: HTMLDivElement;
  readonly adornment: HTMLDivElement;
  readonly cutButton: HTMLButtonElement;
  private readonly sceneEl: HTMLDivElement;
  private readonly linkLayer: SVGGElement;
  private readonly tempWire: SVGPathElement;
  private readonly overlay: HTMLDivElement;
  private readonly marquee: HTMLDivElement;

  private readonly bubbles = new Map<NodeId, BubbleView>();
  private readonly links = new Map<LinkId, LinkView>();
  private rendered: EditorState | null = null;
  private frame = 0;
  private dirty = true;
  private lastTime = 0;
  private motion: boolean;
  private readonly unsubscribe: () => void;
  private readonly motionQuery: MediaQueryList | null;

  private dragging: ReadonlySet<NodeId> = new Set();
  private dropTarget: NodeId | null = null;
  private wire: { source: NodeId; to: Vec } | null = null;

  constructor(
    root: HTMLElement,
    private readonly editor: Editor,
    options: SceneOptions = {},
  ) {
    this.root = root;
    root.classList.add('canvas');

    this.sceneEl = el('div', 'scene');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'wires');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <defs>
        <linearGradient id="wire-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="rgba(255,255,255,.9)"/>
          <stop offset=".5" stop-color="rgba(150,220,255,.85)"/>
          <stop offset="1" stop-color="rgba(255,255,255,.9)"/>
        </linearGradient>
        <linearGradient id="wire-gradient-selected" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="rgba(255,255,230,1)"/>
          <stop offset=".5" stop-color="rgba(255,225,110,1)"/>
          <stop offset="1" stop-color="rgba(255,255,230,1)"/>
        </linearGradient>
      </defs>`;
    this.linkLayer = document.createElementNS(SVG_NS, 'g');
    this.tempWire = document.createElementNS(SVG_NS, 'path');
    this.tempWire.setAttribute('class', 'temp-wire');
    this.tempWire.style.display = 'none';
    svg.append(this.linkLayer, this.tempWire);

    this.bubbleLayer = el('div', 'layer bubbles');
    this.bubbleLayer.setAttribute('role', 'listbox');
    this.bubbleLayer.setAttribute('aria-multiselectable', 'true');
    this.bubbleLayer.setAttribute('aria-label', 'Bubbles');

    this.overlay = el('div', 'layer overlay');
    this.adornment = el('div', 'adornment');
    this.adornment.hidden = true;
    this.adornment.innerHTML = [
      chip('pop', 'close', 'Pop bubble (Delete)'),
      chip('link', 'link', 'Connect: drag onto a bubble, or tap then pick one (C)'),
      chip('grow', 'resize', 'Drag to resize'),
      chip('color', 'palette', 'Change colour (1–6)'),
    ].join('');
    this.cutButton = el('button', 'chip link-cut');
    this.cutButton.type = 'button';
    this.cutButton.hidden = true;
    this.cutButton.dataset.chip = 'cut';
    this.cutButton.setAttribute('aria-label', 'Cut connection (Delete)');
    this.cutButton.title = 'Cut connection (Delete)';
    this.cutButton.innerHTML = icon('scissors');
    this.overlay.append(this.adornment, this.cutButton);

    this.sceneEl.append(svg, this.bubbleLayer, this.overlay);
    this.marquee = el('div', 'marquee');
    this.marquee.hidden = true;
    root.append(this.sceneEl, this.marquee);

    this.motionQuery =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.motion = !(options.reducedMotion ?? this.motionQuery?.matches ?? false);
    if (options.reducedMotion === undefined) {
      this.motionQuery?.addEventListener('change', this.onMotionChange);
    }

    this.unsubscribe = editor.subscribe(() => this.invalidate());
    this.invalidate();
  }

  destroy(): void {
    this.unsubscribe();
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    cancelAnimationFrame(this.frame);
    this.root.replaceChildren();
  }

  /* ------------------------------------------------------------- public API */

  get size(): { width: number; height: number } {
    return { width: this.root.clientWidth, height: this.root.clientHeight };
  }

  /** Canvas-relative point for a pointer event. */
  toCanvas(e: { clientX: number; clientY: number }): Vec {
    const rect = this.root.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  toWorld(screen: Vec): Vec {
    return screenToWorld(this.editor.state.viewport, screen);
  }

  bubbleView(id: NodeId): BubbleView | undefined {
    return this.bubbles.get(id);
  }

  /** Topmost bubble whose (drifting) circle contains a world point. */
  bubbleAt(world: Vec, exclude?: NodeId): NodeId | null {
    const views = [...this.bubbles.values()];
    for (let i = views.length - 1; i >= 0; i--) {
      const view = views[i]!;
      if (view.bubble.id === exclude) continue;
      const c = circleOf(view);
      if ((c.x - world.x) ** 2 + (c.y - world.y) ** 2 <= c.r * c.r) return view.bubble.id;
    }
    return null;
  }

  invalidate(): void {
    this.dirty = true;
    this.requestFrame();
  }

  /** Renders now instead of on the next frame. */
  flush(): void {
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
  }

  focusBubble(id: NodeId): void {
    this.flush();
    this.bubbles.get(id)?.el.focus({ preventScroll: true });
  }

  setDragging(ids: Iterable<NodeId>): void {
    this.dragging = new Set(ids);
    this.root.classList.toggle('is-dragging', this.dragging.size > 0);
    this.invalidate();
  }

  setDropTarget(id: NodeId | null): void {
    if (id === this.dropTarget) return;
    this.dropTarget = id;
    this.invalidate();
  }

  /** Dashed "rubber band" wire shown while dragging out a new connection. */
  setTempWire(source: NodeId | null, to: Vec | null = null): void {
    this.wire = source !== null && to ? { source, to } : null;
    if (!this.wire) this.tempWire.style.display = 'none';
    this.invalidate();
  }

  /** Marquee rectangle in canvas (screen) space, or null to hide it. */
  setMarquee(rect: Rect | null): void {
    this.marquee.hidden = !rect;
    if (!rect) return;
    this.marquee.style.translate = `${rect.x}px ${rect.y}px`;
    this.marquee.style.width = `${rect.width}px`;
    this.marquee.style.height = `${rect.height}px`;
  }

  /* --------------------------------------------------------------- internals */

  private readonly onMotionChange = (e: MediaQueryListEvent): void => {
    this.motion = !e.matches;
    if (!this.motion) for (const view of this.bubbles.values()) view.rest();
    this.invalidate();
  };

  private requestFrame(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.onFrame);
  }

  private readonly onFrame = (now: number): void => {
    this.frame = 0;
    this.flush();
    if (!this.motion || this.bubbles.size === 0) {
      this.lastTime = 0;
      return;
    }
    const t = now / 1000;
    const dt = this.lastTime ? Math.min(0.1, t - this.lastTime) : 1 / 60;
    this.lastTime = t;
    let moving = false;
    for (const view of this.bubbles.values()) moving = view.step(t, dt) || moving;
    this.updateGeometry();
    if (moving) this.requestFrame();
    else this.lastTime = 0;
  };

  private render(): void {
    const state = this.editor.state;
    const prev = this.rendered;
    this.rendered = state;

    if (state.viewport !== prev?.viewport) this.applyViewport(state.viewport);
    if (state.map.nodes !== prev?.map.nodes || state.editing !== prev.editing) {
      this.syncBubbles(state);
    }
    if (state.map.links !== prev?.map.links) this.syncLinks(state);
    this.syncFlags(state);
    this.updateGeometry();
  }

  private applyViewport(v: Viewport): void {
    this.sceneEl.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`;
    this.sceneEl.style.setProperty('--chip-scale', String(1 / v.zoom));
    const style = document.documentElement.style;
    style.setProperty('--pan-x', String(clamp(v.x, -2500, 2500)));
    style.setProperty('--pan-y', String(clamp(v.y, -2500, 2500)));
  }

  private syncBubbles(state: EditorState): void {
    for (const bubble of state.map.nodes.values()) {
      const view = this.bubbles.get(bubble.id);
      if (view) {
        view.update(bubble, { editing: state.editing === bubble.id });
        continue;
      }
      const created = new BubbleView(bubble);
      if (!this.motion) created.rest();
      this.bubbles.set(bubble.id, created);
      this.bubbleLayer.append(created.el);
    }

    const removed: BubbleView[] = [];
    for (const [id, view] of this.bubbles) {
      if (!state.map.nodes.has(id)) {
        this.bubbles.delete(id);
        removed.push(view);
      }
    }
    const droplets = this.motion && removed.length <= DROPLET_LIMIT;
    for (const view of removed) {
      if (this.motion) popBubble(view.el, view.bubble, this.overlay, { droplets });
      else view.el.remove();
    }
  }

  private syncLinks(state: EditorState): void {
    for (const link of state.map.links.values()) {
      // Links are immutable: the same object means the same endpoints. A new
      // object under a known id (a reopened file reusing ids) needs a new view.
      const existing = this.links.get(link.id);
      if (existing?.link === link) continue;
      existing?.group.remove();
      const view = new LinkView(link);
      this.links.set(link.id, view);
      this.linkLayer.append(view.group);
    }
    for (const [id, view] of this.links) {
      if (!state.map.links.has(id)) {
        view.group.remove();
        this.links.delete(id);
      }
    }
  }

  private syncFlags(state: EditorState): void {
    const { selection, editing, connect } = state;

    // Roving tabindex: exactly one bubble is reachable with Tab.
    const focusTarget = [...selection.nodes].at(-1) ?? state.map.nodes.keys().next().value ?? null;

    for (const [id, view] of this.bubbles) {
      view.setFlags({
        selected: selection.nodes.has(id),
        editing: editing === id,
        linkSource: connect.source === id,
        dropTarget: this.dropTarget === id,
        dragging: this.dragging.has(id),
      });
      view.el.tabIndex = id === focusTarget ? 0 : -1;
    }
    for (const [id, view] of this.links) view.setSelected(selection.links.has(id));

    this.root.classList.toggle('is-connecting', connect.active);
    this.adornment.hidden = this.editor.soleSelected === null || connect.active;
    this.cutButton.hidden = !(selection.links.size === 1 && selection.nodes.size === 0);
  }

  /** Recomputes wires and overlay positions from the bubbles' drifted spots. */
  private updateGeometry(): void {
    for (const view of this.links.values()) {
      const a = this.bubbles.get(view.link.a);
      const b = this.bubbles.get(view.link.b);
      if (a && b) view.setGeometry(linkGeometry(circleOf(a), circleOf(b)));
    }

    if (this.wire) {
      const source = this.bubbles.get(this.wire.source);
      const g = source ? linkGeometry(circleOf(source), { ...this.wire.to, r: 0 }) : null;
      this.tempWire.style.display = g?.visible ? '' : 'none';
      if (g?.visible) this.tempWire.setAttribute('d', g.path);
    }

    const sole = this.editor.soleSelected;
    const view = sole === null ? undefined : this.bubbles.get(sole);
    if (view && !this.adornment.hidden) {
      const c = circleOf(view);
      this.adornment.style.translate = `${c.x}px ${c.y}px`;
      this.adornment.style.setProperty('--d', `${c.r * 2}px`);
    }

    if (!this.cutButton.hidden) {
      const [linkId] = this.editor.state.selection.links;
      const link = linkId === undefined ? undefined : this.links.get(linkId);
      // Keep the -50% centring that the inline value would otherwise replace.
      if (link) {
        this.cutButton.style.translate = `calc(${link.mid.x}px - 50%) calc(${link.mid.y}px - 50%)`;
      }
    }
  }
}

function circleOf(view: BubbleView): Circle {
  const { bubble, offset } = view;
  return { x: bubble.x + offset.x, y: bubble.y + offset.y, r: bubble.d / 2 };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function chip(kind: string, iconName: Parameters<typeof icon>[0], label: string): string {
  return `<button type="button" class="chip chip-${kind}" data-chip="${kind}" aria-label="${label}" title="${label}">${icon(iconName)}</button>`;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
