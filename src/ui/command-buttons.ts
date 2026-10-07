import type { Editor } from '../core/editor';
import { shortcutFor, type CommandId, type CommandMap } from '../interaction/keyboard';

const isCommandId = (commands: CommandMap, id: string | undefined): id is CommandId =>
  id !== undefined && Object.hasOwn(commands, id);

/**
 * Wires every `[data-command]` button under `root` to the command registry
 * and keeps `disabled` / `aria-pressed` in sync with editor state.
 *
 * A focused button that becomes disabled (Clear after clearing, Undo at the
 * end of history) would drop focus to `<body>`; `fallbackFocus` catches it.
 */
export function bindCommandButtons(
  root: ParentNode,
  commands: CommandMap,
  editor: Editor,
  fallbackFocus: () => void = () => undefined,
): () => void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-command]')].filter(
    (b) => isCommandId(commands, b.dataset.command),
  );

  for (const button of buttons) {
    const id = button.dataset.command as CommandId;
    const { label } = commands[id];
    const shortcut = shortcutFor(id);
    button.title = shortcut ? `${label} (${shortcut})` : label;
    // Visible labels collapse to icons on narrow screens; keep the name stable.
    if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', label);
    if (shortcut) button.setAttribute('aria-keyshortcuts', shortcut.replaceAll('Ctrl', 'Control'));
    const kbd = button.querySelector('kbd');
    if (kbd) kbd.textContent = shortcut ?? '';
    button.addEventListener('click', () => {
      const command = commands[id];
      if (!command.enabled || command.enabled()) command.run();
    });
  }

  const sync = (): void => {
    let lostFocus = false;
    for (const button of buttons) {
      const command = commands[button.dataset.command as CommandId];
      if (command.enabled) {
        const disabled = !command.enabled();
        if (disabled && !button.disabled && document.activeElement === button) lostFocus = true;
        button.disabled = disabled;
      }
      if (command.active) button.setAttribute('aria-pressed', String(command.active()));
    }
    if (lostFocus) fallbackFocus();
  };
  sync();
  return editor.subscribe(sync);
}
