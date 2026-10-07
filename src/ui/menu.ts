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
      }
    });
    menu.addEventListener('keydown', this.onMenuKey);
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
    if (focusItem) this.items.at(index)?.focus();
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

  private readonly onMenuKey = (e: KeyboardEvent): void => {
    const index = this.items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number): void => {
      e.preventDefault();
      this.items.at(to % this.items.length)?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(-1);
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
