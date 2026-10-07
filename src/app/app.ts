import { createBubbleAt, nudgeSelection, setColor } from '../core/actions';
import { Editor, type EditorState } from '../core/editor';
import { navigate } from '../geometry/layout';
import { panBy } from '../geometry/viewport';
import { InlineEditor } from '../interaction/inline-editor';
import { KeyboardController, shortcutFor, type CommandMap } from '../interaction/keyboard';
import { PointerController } from '../interaction/pointer';
import { welcomeMap } from '../model/welcome';
import { Autosave, loadStoredMap } from '../persistence/storage';
import { ColorPopover } from '../ui/color-popover';
import { bindCommandButtons } from '../ui/command-buttons';
import { HelpDialog } from '../ui/help-dialog';
import { MenuButton } from '../ui/menu';
import { StatusBar } from '../ui/status';
import { hydrateIcons } from '../view/icons';
import { installPaletteStyles } from '../view/palette-styles';
import { Scene } from '../view/scene';
import { createCommands } from './commands';

const IDLE_HINT = 'Double-tap to blow a bubble · drag to pan · press ? for help';

function required<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Aero Bubbles: missing ${selector} in the page markup.`);
  return el;
}

/** Composition root: builds every piece and wires them together. */
export function mountApp(doc: Document = document): Editor {
  installPaletteStyles(doc);
  hydrateIcons(doc.body);

  const editor = new Editor();
  const status = new StatusBar(required(doc, '#status'));

  const stored = loadStoredMap();
  let restoredViewport = false;
  if (stored.status === 'ok') {
    editor.reset(stored.data.map, stored.data.viewport ?? undefined);
    restoredViewport = stored.data.viewport !== null;
  } else {
    editor.reset(welcomeMap(preferredOrientation()));
    if (stored.status === 'corrupt') {
      status.toast(`Your saved map couldn't be read (${stored.error}). A backup was kept.`, {
        duration: 8000,
      });
    }
  }

  const scene = new Scene(required(doc, '#canvas'), editor);
  const colors = new ColorPopover(doc.body);
  let commandMap: CommandMap | null = null;
  const help = new HelpDialog((id) => commandMap?.[id].label ?? id, doc.body);
  const commands = createCommands({ editor, scene, status, colors, help });
  commandMap = commands.map;

  new InlineEditor(editor, scene);

  new PointerController(scene, editor, {
    interaction: () => {
      colors.close();
      commands.settle();
    },
    createAt: (world) => createBubbleAt(editor, world),
    pop: (id) => commands.popBubble(id),
    cut: (id) => commands.cutLink(id),
    pickColor: (id, anchor) => {
      const bubble = editor.map.nodes.get(id);
      if (bubble) colors.open(anchor, bubble.color, (color) => setColor(editor, [id], color));
    },
    connected: (ok) => status.toast(ok ? 'Connected!' : 'Those bubbles are already connected'),
    sprouted: () => undefined,
  });

  new KeyboardController(commands.map, (direction, { shift }) => {
    commands.settle();
    const { selection, viewport } = editor.state;
    const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[direction] as [
      number,
      number,
    ];
    if (selection.nodes.size === 0) {
      editor.setViewport(panBy(viewport, -dx * 80, -dy * 80));
      return true;
    }
    if (shift) {
      nudgeSelection(editor, dx * 10, dy * 10);
      return true;
    }
    const from = [...selection.nodes].at(-1)!;
    const next = navigate(editor.map, from, direction);
    if (next !== null) {
      editor.select([next]);
      scene.focusBubble(next);
      commands.reveal(next);
    }
    return true;
  });

  bindCommandButtons(doc.body, commands.map, editor);
  new MenuButton(required(doc, '#file-button'), required(doc, '#file-menu'));
  bindToolbarArrows(required(doc, '.toolbar'));
  syncZoomLabel(editor, required(doc, '[data-command="zoom-reset"]'));
  syncHints(editor, status);

  new Autosave(editor, {
    onError: () =>
      status.toast("Couldn't autosave — storage may be full or blocked. Use File → Save."),
    onExternalChange: ({ map }) => {
      editor.reset(map);
      status.toast('Updated with changes from another tab');
    },
  });

  if (!restoredViewport) {
    // Wait for layout so the canvas has its real size.
    requestAnimationFrame(() => commands.fitToContent(false));
  }
  return editor;
}

const preferredOrientation = (): 'portrait' | 'landscape' =>
  window.innerWidth < 600 && window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';

/** Hint text follows connect mode; the idle tip fades after a while. */
function syncHints(editor: Editor, status: StatusBar): void {
  let idle: string | null = IDLE_HINT;
  const idleTimer = setTimeout(() => {
    idle = null;
    if (!editor.state.connect.active) status.hint(null);
  }, 12_000);

  const update = (state: EditorState): void => {
    const { active, source } = state.connect;
    if (!active) return status.hint(idle);
    status.hint(
      source === null
        ? `Connect mode: tap the first bubble · ${shortcutFor('escape') ?? 'Esc'} to finish`
        : 'Now tap the bubble to connect it to',
    );
  };
  update(editor.state);
  editor.subscribe((state, prev) => {
    if (state.connect !== prev.connect) update(state);
    if (state.map.nodes.size > prev.map.nodes.size && idle !== null) {
      idle = null; // they've figured it out
      clearTimeout(idleTimer);
      update(state);
    }
  });
}

function syncZoomLabel(editor: Editor, button: HTMLElement): void {
  const render = (zoom: number): void => {
    const percent = `${Math.round(zoom * 100)}%`;
    button.textContent = percent;
    button.setAttribute('aria-label', `Zoom ${percent} — reset to 100%`);
  };
  render(editor.state.viewport.zoom);
  editor.subscribe((state, prev) => {
    if (state.viewport.zoom !== prev.viewport.zoom) render(state.viewport.zoom);
  });
}

/** ARIA toolbar pattern: arrow keys move focus between its buttons. */
function bindToolbarArrows(toolbar: HTMLElement): void {
  toolbar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    buttons.at((index + step) % buttons.length)?.focus();
  });
}
