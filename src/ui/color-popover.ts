import { COLOR_IDS, PALETTE, type ColorId } from '../model/palette';

/** Floating swatch picker anchored to the colour chip. */
export class ColorPopover {
  private readonly el: HTMLDivElement;
  private readonly swatches: HTMLButtonElement[];
  private onPick: ((color: ColorId) => void) | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(host: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.className = 'popover palette';
    this.el.setAttribute('role', 'radiogroup');
    this.el.setAttribute('aria-label', 'Bubble colour');
    this.el.hidden = true;
    this.swatches = COLOR_IDS.map((id, i) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.dataset.color = id;
      swatch.setAttribute('role', 'radio');
      swatch.setAttribute('aria-label', `${PALETTE[id].label} (${i + 1})`);
      swatch.title = `${PALETTE[id].label} (${i + 1})`;
      swatch.style.setProperty('--swatch', PALETTE[id].swatch);
      swatch.addEventListener('click', () => this.pick(id));
      return swatch;
    });
    this.el.append(...this.swatches);
    this.el.addEventListener('keydown', this.onKey);
    host.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(anchor: HTMLElement, current: ColorId, onPick: (color: ColorId) => void): void {
    this.onPick = onPick;
    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    for (const swatch of this.swatches) {
      const checked = swatch.dataset.color === current;
      swatch.setAttribute('aria-checked', String(checked));
      swatch.tabIndex = checked ? 0 : -1;
    }
    this.el.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = this.el;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), innerWidth - w - 8);
    const below = rect.bottom + 8;
    const top = below + h > innerHeight - 8 ? rect.top - h - 8 : below;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
    document.addEventListener('pointerdown', this.onOutside, true);
    (this.swatches.find((s) => s.tabIndex === 0) ?? this.swatches[0])?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.onPick = null;
    document.removeEventListener('pointerdown', this.onOutside, true);
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  private pick(color: ColorId): void {
    const onPick = this.onPick;
    this.close();
    onPick?.(color);
  }

  private readonly onOutside = (e: PointerEvent): void => {
    if (!this.el.contains(e.target as Node)) this.close();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const index = this.swatches.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      const next = this.swatches.at((index + step) % this.swatches.length);
      next?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };
}
