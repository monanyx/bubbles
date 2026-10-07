export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds before the toast gives way to the current hint. */
  duration?: number;
}

/**
 * The glass bar at the bottom: a persistent contextual hint (e.g. connect-mode
 * instructions) plus short-lived toasts, optionally with an action such as
 * "Undo". It is an ARIA live region, so messages are announced too.
 */
export class StatusBar {
  private readonly text: HTMLElement;
  private readonly button: HTMLButtonElement;
  private hintText: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private action: ToastAction | undefined;

  constructor(
    private readonly el: HTMLElement,
    /** Where focus goes if the action button is hidden while focused. */
    private readonly fallbackFocus: () => void = () => undefined,
  ) {
    el.classList.add('status');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    this.text = document.createElement('span');
    this.text.className = 'status-text';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'status-action';
    this.button.hidden = true;
    this.button.addEventListener('click', () => {
      const action = this.action;
      this.restore();
      action?.run();
    });
    el.replaceChildren(this.text, this.button);
    this.restore();
  }

  /** Sets (or clears) the persistent hint shown when no toast is active. */
  hint(text: string | null): void {
    this.hintText = text;
    if (this.timer === undefined) this.restore();
  }

  toast(message: string, { action, duration = action ? 6000 : 3500 }: ToastOptions = {}): void {
    clearTimeout(this.timer);
    this.action = action;
    this.render(message, action?.label, true);
    this.timer = setTimeout(() => this.restore(), duration);
  }

  /**
   * Withdraws the current toast's action (e.g. "Undo") once it no longer
   * applies — after a later edit it would undo something else.
   */
  dropAction(): void {
    if (!this.action) return;
    this.action = undefined;
    this.hideButton();
  }

  get message(): string {
    return this.text.textContent;
  }

  private restore(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.action = undefined;
    this.hideButton();
    this.render(this.hintText, undefined, false);
  }

  /** Hides the action button without dropping keyboard focus to <body>. */
  private hideButton(): void {
    const hadFocus = document.activeElement === this.button;
    this.button.hidden = true;
    if (hadFocus) this.fallbackFocus();
  }

  private render(message: string | null, actionLabel: string | undefined, toast: boolean): void {
    this.text.textContent = message ?? '';
    this.button.hidden = actionLabel === undefined;
    this.button.textContent = actionLabel ?? '';
    this.el.classList.toggle('is-toast', toast);
    this.el.classList.toggle('is-hidden', !message);
  }
}
