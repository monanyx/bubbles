import { createBubbleAt, nudgeSelection, setColor } from '../core/actions';
import { Editor, type EditorState } from '../core/editor';
import { navigate } from '../geometry/layout';
import { panBy } from '../geometry/viewport';
import { bindBubbleKeys } from '../interaction/bubble-keys';
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

export interface App {
  readonly editor: Editor;
  /** Removes every listener, timer and element the app added (tests, HMR). */
  destroy(): void;
}

/** Composition root: builds every piece and wires them together. */
export function mountApp(doc: Document = document): App {
  installPaletteStyles(doc);
  hydrateIcons(doc.body);
  const disposers: (() => void)[] = [];

  const editor = new Editor();
  const status = new StatusBar(required(doc, '#status'), () =>
    required<HTMLElement>(doc, '#canvas').focus({ preventScroll: true }),
  );

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
  disposers.push(
    () => scene.destroy(),
    () => colors.destroy(),
    () => help.el.remove(),
  );
  const commands = createCommands({ editor, scene, status, colors, help });
  commandMap = commands.map;

  const announceConnect = (ok: boolean): void =>
    status.toast(ok ? 'Connected!' : 'Those bubbles are already connected');
  // A toast's Undo must not outlive the edit it announces: withdraw it on the
  // next change, or as soon as a label edit starts (typing isn't committed yet).
  disposers.push(
    editor.subscribe((state, prev) => {
      const startedEditing = state.editing !== null && prev.editing === null;
      if (state.map !== prev.map || startedEditing) status.dropAction();
    }),
  );

  // Before Autosave (below): it must commit a half-typed label on pagehide
  // before Autosave flushes.
  const inline = new InlineEditor(editor, scene, (id) => commands.reveal(id));
  disposers.push(() => inline.destroy());

  disposers.push(
    bindBubbleKeys(scene, editor, {
      connected: announceConnect,
      reveal: (id) => commands.reveal(id),
      settle: () => commands.settle(),
    }),
  );

  const pointer = new PointerController(scene, editor, {
    interaction: () => {
      colors.close();
      // Animations only: settling gestures here would commit a drag that a
      // second finger is about to turn into a pinch.
      commands.settleAnimations();
    },
    createAt: (world) => createBubbleAt(editor, world),
    pop: (id) => commands.popBubble(id),
    cut: (id) => commands.cutLink(id),
    pickColor: (id, anchor) => {
      const bubble = editor.map.nodes.get(id);
      if (!bubble) return;
      colors.open(anchor, bubble.color, (color) => {
        commands.settle(); // a tidy in flight would otherwise overwrite the change
        setColor(editor, [id], color);
      });
    },
    connected: announceConnect,
    sprouted: () => undefined,
  });
  disposers.push(() => pointer.destroy());

  // Any command first finishes a drag/resize in progress, as its own undo step.
  commands.onSettle(() => pointer.settle());

  const keyboard = new KeyboardController(commands.map, (direction, { shift }) => {
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
  disposers.push(() => keyboard.destroy());

  const menu = new MenuButton(required(doc, '#file-button'), required(doc, '#file-menu'));
  disposers.push(
    bindCommandButtons(doc.body, commands.map, editor, () =>
      scene.root.focus({ preventScroll: true }),
    ),
    () => menu.close(),
    bindToolbarArrows(required(doc, '.toolbar')),
    syncZoomLabel(editor, required(doc, '[data-command="zoom-reset"]')),
    syncHints(editor, status),
  );

  const autosave = new Autosave(editor, {
    onError: () =>
      status.toast("Couldn't autosave — storage may be full or blocked. Use File → Save."),
    onExternalChange: ({ map }) => {
      editor.reset(map);
      status.toast('Updated with changes from another tab');
    },
  });
  disposers.push(() => autosave.destroy());

  if (!restoredViewport) {
    // Wait for layout so the canvas has its real size.
    const frame = requestAnimationFrame(() => commands.fitToContent(false));
    disposers.push(() => cancelAnimationFrame(frame));
  }

  return {
    editor,
    destroy: () => {
      commands.settle();
      // Reverse construction order (Autosave first: it flushes pending saves).
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}

const preferredOrientation = (): 'portrait' | 'landscape' =>
  window.innerWidth < 600 && window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';

/** Hint text follows connect mode; the idle tip fades after a while. */
function syncHints(editor: Editor, status: StatusBar): () => void {
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
  const unsubscribe = editor.subscribe((state, prev) => {
    if (state.connect !== prev.connect) update(state);
    if (state.map.nodes.size > prev.map.nodes.size && idle !== null) {
      idle = null; // they've figured it out
      clearTimeout(idleTimer);
      update(state);
    }
  });
  return () => {
    clearTimeout(idleTimer);
    unsubscribe();
  };
}

function syncZoomLabel(editor: Editor, button: HTMLElement): () => void {
  const render = (zoom: number): void => {
    const percent = `${Math.round(zoom * 100)}%`;
    button.textContent = percent;
    button.setAttribute('aria-label', `Zoom ${percent} — reset to 100%`);
  };
  render(editor.state.viewport.zoom);
  return editor.subscribe((state, prev) => {
    if (state.viewport.zoom !== prev.viewport.zoom) render(state.viewport.zoom);
  });
}

/** ARIA toolbar pattern: arrow keys move focus between its buttons. */
function bindToolbarArrows(toolbar: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    buttons.at((index + step) % buttons.length)?.focus();
  };
  toolbar.addEventListener('keydown', onKeyDown);
  return () => toolbar.removeEventListener('keydown', onKeyDown);
}
