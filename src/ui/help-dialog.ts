import { BINDINGS, displayCombo, type CommandId } from '../interaction/keyboard';
import { icon } from '../view/icons';

const SECTIONS: { title: string; commands: CommandId[] }[] = [
  {
    title: 'Bubbles',
    commands: ['new-bubble', 'add-child', 'edit', 'delete', 'duplicate', 'grow', 'shrink'],
  },
  { title: 'Connections & layout', commands: ['connect', 'tidy', 'select-all', 'escape'] },
  { title: 'History & files', commands: ['undo', 'redo', 'save', 'open'] },
  { title: 'View', commands: ['zoom-in', 'zoom-out', 'zoom-reset', 'zoom-fit', 'help'] },
];

const GESTURES: [string, string][] = [
  ['Double-tap / double-click', 'Blow a new bubble'],
  ['Tap a bubble, tap again', 'Select, then edit its text'],
  ['Drag a bubble', 'Move it (and everything selected)'],
  ['Drag the 🔗 chip', 'Connect to another bubble — or drop on empty space to sprout a new one'],
  ['Drag empty space', 'Pan around'],
  ['Scroll / two-finger swipe', 'Pan around'],
  ['Ctrl + scroll / pinch', 'Zoom'],
  ['Shift + drag', 'Select several bubbles'],
  ['Shift + click', 'Add to / remove from selection'],
  ['Hold Space + drag', 'Pan while hovering bubbles'],
];

/** The "?" window, generated from the live key bindings. */
export class HelpDialog {
  readonly el: HTMLDialogElement;
  private built = false;

  /** `labelFor` is read lazily, on first open, so commands can be wired later. */
  constructor(
    private readonly labelFor: (id: CommandId) => string,
    host: HTMLElement = document.body,
  ) {
    this.el = document.createElement('dialog');
    this.el.className = 'aero-window';
    this.el.setAttribute('aria-labelledby', 'help-title');
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close(); // backdrop click
    });
    host.append(this.el);
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  open(): void {
    if (!this.built) this.build();
    if (!this.el.open) this.el.showModal();
  }

  close(): void {
    this.el.close();
  }

  private build(): void {
    this.built = true;
    const keysFor = (id: CommandId): string =>
      BINDINGS.filter((b) => b.command === id)
        .flatMap((b) => b.keys)
        .map((k) => `<kbd>${escapeHtml(displayCombo(k))}</kbd>`)
        .join(' ');

    const extraRows: Record<string, string> = {
      Bubbles:
        '<dt><kbd>1</kbd>–<kbd>6</kbd></dt><dd>Colour the selected bubbles</dd>' +
        '<dt><kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd></dt><dd>Hop between bubbles (Shift: nudge)</dd>',
      'Connections & layout':
        '<dt><kbd>C</kbd>, then <kbd>←</kbd> <kbd>→</kbd> and <kbd>Enter</kbd></dt>' +
        '<dd>Connect without a mouse: move to a bubble, press Enter, move to its partner, press Enter</dd>',
    };

    const shortcutRows = SECTIONS.map(
      ({ title, commands }) => `
        <h3>${title}</h3>
        <dl class="shortcuts">
          ${commands.map((id) => `<dt>${keysFor(id)}</dt><dd>${escapeHtml(this.labelFor(id))}</dd>`).join('')}
          ${extraRows[title] ?? ''}
        </dl>`,
    ).join('');

    this.el.innerHTML = `
      <div class="window-titlebar">
        <h2 class="window-title" id="help-title">Aero Bubbles — Help</h2>
        <button type="button" class="window-close" aria-label="Close help">${icon('close')}</button>
      </div>
      <div class="window-body">
        <p>Ideas float as soap bubbles. Blow one, type a thought, and wire it to others.
           Everything saves automatically in this browser.</p>
        <h3>Gestures</h3>
        <dl class="shortcuts">
          ${GESTURES.map(([g, d]) => `<dt>${escapeHtml(g)}</dt><dd>${escapeHtml(d)}</dd>`).join('')}
        </dl>
        ${shortcutRows}
      </div>`;
    this.el.querySelector('.window-close')?.addEventListener('click', () => this.close());
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
