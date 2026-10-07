/**
 * A minimal accessible menu button: click or ArrowDown opens it, arrow keys
 * move between items, Escape / Tab / an outside click close it.
 */
export class MenuButton {
  private readonly items: HTMLElement[];

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly menu: HTMLElement,
  ) {
    this.items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    menu.hidden = true;

    button.addEventListener('click', () => (this.isOpen ? this.close() : this.open(false)));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.open(true, e.key === 'ArrowUp' ? -1 : 0);
      } else if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        e.stopPropagation(); // closing the menu shouldn't also clear the selection
        this.close();
      }
    });
    menu.addEventListener('keydown', this.onMenuKey);
    // Close when focus moves to another control (toolbar arrows, Tab from a
    // mouse-opened menu). A focus loss with no destination is left to the
    // outside-click handler: Safari doesn't focus clicked buttons, so treating
    // it as "left" would close the menu before a click on an item lands.
    const onFocusOut = (e: FocusEvent): void => {
      const next = e.relatedTarget as Node | null;
      if (next && !this.menu.contains(next) && !this.button.contains(next)) this.close();
    };
    menu.addEventListener('focusout', onFocusOut);
    button.addEventListener('focusout', (e) => {
      if (this.isOpen) onFocusOut(e);
    });
    menu.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('[role="menuitem"]')) this.close(true);
    });
  }

  get isOpen(): boolean {
    return !this.menu.hidden;
  }

  open(focusItem: boolean, index = 0): void {
    if (!this.isOpen) {
      const rect = this.button.getBoundingClientRect();
      this.menu.hidden = false;
      const width = this.menu.offsetWidth;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      this.menu.style.left = `${left}px`;
      this.menu.style.top = `${rect.bottom + 6}px`;
      this.button.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', this.onOutside, true);
    }
    if (focusItem) this.focusFrom(index, index < 0 ? -1 : 1);
  }

  close(restoreFocus = false): void {
    if (!this.isOpen) return;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onOutside, true);
    if (restoreFocus) this.button.focus();
  }

  private readonly onOutside = (e: PointerEvent): void => {
    const target = e.target as Node;
    if (!this.menu.contains(target) && !this.button.contains(target)) this.close();
  };

  /** Focuses the first enabled item from `start`, stepping (and wrapping) by `step`. */
  private focusFrom(start: number, step: 1 | -1): void {
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const item = this.items.at((start + step * i) % n);
      if (item && !(item instanceof HTMLButtonElement && item.disabled)) {
        item.focus();
        return;
      }
    }
  }

  private readonly onMenuKey = (e: KeyboardEvent): void => {
    // Keys pressed in an open menu belong to it: global shortcuts (Delete, N…)
    // must not act on the canvas behind it. Tab still moves focus normally.
    if (e.key !== 'Tab') e.stopPropagation();
    const index = this.items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number, step: 1 | -1): void => {
      e.preventDefault();
      this.focusFrom(to, step);
    };
    switch (e.key) {
      case 'ArrowDown':
        move(index + 1, 1);
        break;
      case 'ArrowUp':
        move(index - 1, -1);
        break;
      case 'Home':
        move(0, 1);
        break;
      case 'End':
        move(-1, -1);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        // Keep these inside the menu instead of panning or hopping bubbles.
        e.preventDefault();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
        break;
      case 'Tab':
        this.close();
        break;
    }
  };
}
