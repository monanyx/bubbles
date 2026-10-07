import { isControl, isTypingTarget } from './pointer';

export type CommandId =
  | 'new-bubble'
  | 'add-child'
  | 'edit'
  | 'delete'
  | 'connect'
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'duplicate'
  | 'tidy'
  | 'clear'
  | 'tutorial'
  | 'open'
  | 'save'
  | 'export-png'
  | 'export-svg'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'zoom-fit'
  | 'grow'
  | 'shrink'
  | 'help'
  | 'escape'
  | `color-${1 | 2 | 3 | 4 | 5 | 6}`;

export interface Command {
  readonly label: string;
  readonly enabled?: () => boolean;
  /** For toggles: whether the command is currently "on". */
  readonly active?: () => boolean;
  readonly run: () => void;
}

export type CommandMap = Record<CommandId, Command>;

export interface Binding {
  /** Combos like `mod+shift+z`; `mod` is ⌘ on Apple platforms, Ctrl elsewhere. */
  readonly keys: readonly string[];
  readonly command: CommandId;
  /** Whether holding the key down should repeat the command. */
  readonly repeat?: boolean;
}

export const BINDINGS: readonly Binding[] = [
  { keys: ['n'], command: 'new-bubble' },
  { keys: ['Tab'], command: 'add-child' },
  { keys: ['Enter', 'F2'], command: 'edit' },
  { keys: ['Delete', 'Backspace'], command: 'delete' },
  { keys: ['c'], command: 'connect' },
  { keys: ['mod+z'], command: 'undo', repeat: true },
  { keys: ['mod+shift+z', 'mod+y'], command: 'redo', repeat: true },
  { keys: ['mod+a'], command: 'select-all' },
  { keys: ['mod+d'], command: 'duplicate' },
  { keys: ['t'], command: 'tidy' },
  { keys: ['mod+s'], command: 'save' },
  { keys: ['mod+o'], command: 'open' },
  { keys: ['=', '+'], command: 'zoom-in', repeat: true },
  { keys: ['-'], command: 'zoom-out', repeat: true },
  { keys: ['0'], command: 'zoom-reset' },
  { keys: ['f'], command: 'zoom-fit' },
  { keys: [']'], command: 'grow', repeat: true },
  { keys: ['['], command: 'shrink', repeat: true },
  { keys: ['?'], command: 'help' },
  { keys: ['Escape'], command: 'escape' },
  ...([1, 2, 3, 4, 5, 6] as const).map((n) => ({
    keys: [String(n)],
    command: `color-${n}` as const,
  })),
];

export const isApple = (): boolean =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** Normalises a keyboard event into the combo syntax used by {@link BINDINGS}. */
export function comboOf(e: KeyboardEvent, apple = isApple()): string {
  const parts: string[] = [];
  if (apple ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  let key = e.key;
  if (key.length === 1) {
    // For punctuation, Shift is part of producing the character ("?" is shift+/).
    if (/[a-z]/i.test(key)) {
      if (e.shiftKey) parts.push('shift');
      key = key.toLowerCase();
    }
  } else if (e.shiftKey) {
    parts.push('shift');
  }
  parts.push(key);
  return parts.join('+');
}

/** Human-readable label for a combo, e.g. `mod+shift+z` → `Ctrl+Shift+Z`. */
export function displayCombo(combo: string, apple = isApple()): string {
  const names: Record<string, string> = apple
    ? { mod: '⌘', shift: '⇧', alt: '⌥' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' };
  const keyNames: Record<string, string> = {
    Escape: 'Esc',
    Delete: 'Del',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ' ': 'Space',
  };
  return splitCombo(combo)
    .map((part) => names[part] ?? keyNames[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(apple ? '' : '+');
}

/** Splits on "+", treating a trailing "+" as the plus key itself. */
function splitCombo(combo: string): string[] {
  if (combo === '+') return ['+'];
  if (combo.endsWith('++')) return [...combo.slice(0, -2).split('+'), '+'];
  return combo.split('+');
}

export function shortcutFor(command: CommandId): string | undefined {
  const combo = BINDINGS.find((b) => b.command === command)?.keys[0];
  return combo === undefined ? undefined : displayCombo(combo);
}

export interface ArrowHandler {
  (direction: 'left' | 'right' | 'up' | 'down', modifiers: { shift: boolean }): boolean;
}

/**
 * Global shortcut dispatcher. Skips events aimed at text fields (the inline
 * editor handles its own keys), at buttons (Enter/Space activate them) and
 * while a modal dialog is open.
 */
export class KeyboardController {
  private readonly lookup = new Map<string, Binding>();

  constructor(
    private readonly commands: CommandMap,
    private readonly onArrow: ArrowHandler,
  ) {
    for (const binding of BINDINGS) {
      for (const key of binding.keys) this.lookup.set(key, binding);
    }
    window.addEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return;
    if (document.querySelector('dialog[open]')) return;
    // Controls keep their native keys: Enter/Space activate them, and Tab must
    // always move focus (never sprout a bubble from a focused toolbar button).
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') && isControl(e.target)) return;

    const arrow = ARROWS[e.key];
    if (arrow && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (this.onArrow(arrow, { shift: e.shiftKey })) e.preventDefault();
      return;
    }

    const binding = this.lookup.get(comboOf(e));
    if (!binding) return;
    const command = this.commands[binding.command];
    // Disabled commands let the key fall through (e.g. Tab moves focus when
    // nothing is selected, so the canvas is never a keyboard trap).
    if (command.enabled && !command.enabled()) return;
    e.preventDefault();
    if (e.repeat && !binding.repeat) return;
    command.run();
  };
}

const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down' | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
