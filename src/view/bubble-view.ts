import { fontSizeFor } from '../geometry/text-fit';
import type { Bubble } from '../model/types';
import { floatOffset, REST, rhythmFor, type FloatOffset, type FloatRhythm } from './float';

export interface BubbleFlags {
  selected: boolean;
  editing: boolean;
  linkSource: boolean;
  dropTarget: boolean;
  dragging: boolean;
}

/** DOM for one bubble. Purely presentational: no event handling lives here. */
export class BubbleView {
  readonly el: HTMLDivElement;
  readonly label: HTMLDivElement;
  private readonly floaty: HTMLDivElement;
  private readonly rhythm: FloatRhythm;
  private data: Bubble;
  private amplitude = 1;
  private targetAmplitude = 1;
  offset: FloatOffset = REST;

  constructor(bubble: Bubble) {
    this.data = bubble;
    this.rhythm = rhythmFor(bubble.id);

    this.el = document.createElement('div');
    this.el.className = 'bubble';
    this.el.dataset.id = bubble.id;
    this.el.setAttribute('role', 'option');
    this.el.setAttribute('aria-roledescription', 'bubble');
    this.el.tabIndex = -1;

    this.floaty = document.createElement('div');
    this.floaty.className = 'floaty';
    const skin = document.createElement('div');
    skin.className = 'skin';
    const gloss = document.createElement('div');
    gloss.className = 'gloss';
    this.label = document.createElement('div');
    this.label.className = 'label';
    this.label.spellcheck = false;
    this.floaty.append(skin, gloss, this.label);
    this.el.append(this.floaty);

    this.apply(bubble, null);
  }

  get bubble(): Bubble {
    return this.data;
  }

  update(bubble: Bubble, { editing }: { editing: boolean }): void {
    if (bubble === this.data) return;
    const previous = this.data;
    this.data = bubble;
    this.apply(bubble, previous, editing);
  }

  setFlags(flags: BubbleFlags): void {
    const { classList } = this.el;
    classList.toggle('is-selected', flags.selected);
    classList.toggle('is-editing', flags.editing);
    classList.toggle('is-link-source', flags.linkSource);
    classList.toggle('is-drop-target', flags.dropTarget);
    classList.toggle('is-dragging', flags.dragging);
    this.el.setAttribute('aria-selected', String(flags.selected));
    // Held bubbles settle so their chips and caret make for steady targets.
    this.targetAmplitude =
      flags.selected || flags.editing || flags.linkSource || flags.dragging ? 0 : 1;
  }

  /** Re-fits the font while the user types, before the model is updated. */
  refit(text = this.label.textContent): void {
    this.label.style.setProperty('--fs', `${fontSizeFor(this.data.d, text)}px`);
  }

  /** Advances the drift animation; returns true while still moving. */
  step(time: number, dt: number): boolean {
    const ease = Math.min(1, dt * 5);
    this.amplitude += (this.targetAmplitude - this.amplitude) * ease;
    if (Math.abs(this.targetAmplitude - this.amplitude) < 0.001) {
      this.amplitude = this.targetAmplitude;
    }
    this.offset = floatOffset(this.rhythm, time, this.amplitude);
    const { x, y, rotate } = this.offset;
    this.floaty.style.transform =
      this.offset === REST
        ? ''
        : `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) rotate(${rotate.toFixed(3)}deg)`;
    return this.amplitude > 0;
  }

  /** Snaps to rest (reduced motion). */
  rest(): void {
    this.amplitude = 0;
    this.offset = REST;
    this.floaty.style.transform = '';
  }

  private apply(bubble: Bubble, previous: Bubble | null, editing = false): void {
    const { el } = this;
    if (previous?.x !== bubble.x || previous.y !== bubble.y) {
      el.style.translate = `${bubble.x}px ${bubble.y}px`;
    }
    if (previous?.d !== bubble.d) el.style.setProperty('--d', `${bubble.d}px`);
    if (previous?.color !== bubble.color) el.dataset.color = bubble.color;
    if (previous?.text !== bubble.text) {
      // Never clobber what the user is typing.
      if (!editing) this.label.textContent = bubble.text;
      el.setAttribute('aria-label', bubble.text || 'Empty bubble');
    }
    if (previous?.text !== bubble.text || previous.d !== bubble.d) {
      this.refit(editing ? this.label.textContent : bubble.text);
    }
  }
}
