import {
  addChild,
  clearMap,
  createBubbleAt,
  deleteSelection,
  duplicateSelection,
  selectAll,
  setColor,
  tidyPositions,
} from '../core/actions';
import type { Editor } from '../core/editor';
import { renderSvg } from '../export/svg';
import { svgToPng } from '../export/png';
import { centerOn, fitRect, screenToWorld, worldToScreen, zoomAt } from '../geometry/viewport';
import type { Command, CommandId, CommandMap } from '../interaction/keyboard';
import { bounds, clampDiameter, setPositions, updateBubbles } from '../model/map';
import { COLOR_IDS, PALETTE } from '../model/palette';
import { deserialize, stringify } from '../model/serialize';
import type { NodeId, Vec, Viewport } from '../model/types';
import { welcomeMap } from '../model/welcome';
import { downloadBlob, pickTextFile, suggestFilename } from '../persistence/files';
import type { ColorPopover } from '../ui/color-popover';
import type { HelpDialog } from '../ui/help-dialog';
import type { StatusBar } from '../ui/status';
import { animate, type Animation } from '../view/animate';
import type { Scene } from '../view/scene';

export interface AppContext {
  editor: Editor;
  scene: Scene;
  status: StatusBar;
  help: HelpDialog;
  colors: ColorPopover;
}

/** Room for the toolbar and zoom controls when framing content (tighter on phones). */
const fitPadding = (width: number): number => Math.round(Math.min(72, Math.max(20, width * 0.06)));
const ZOOM_STEP = 1.25;

export interface Commands {
  map: CommandMap;
  /** Instantly completes any running animation (before other input). */
  settle(): void;
  /** Smoothly pans so a bubble is comfortably on screen. */
  reveal(id: NodeId): void;
  fitToContent(animated?: boolean): void;
  popBubble(id: NodeId): void;
  cutLink(id: string): void;
}

export function createCommands(ctx: AppContext): Commands {
  const { editor, scene, status, help, colors } = ctx;
  let tidyAnimation: Animation | null = null;
  let viewAnimation: Animation | null = null;

  const settle = (): void => {
    tidyAnimation?.finish();
    viewAnimation?.finish();
  };

  const center = (): Vec => {
    const { width, height } = scene.size;
    return { x: width / 2, y: height / 2 };
  };

  const animateViewport = (target: Viewport, duration = 220): void => {
    viewAnimation?.finish();
    const from = editor.state.viewport;
    viewAnimation = animate(
      duration,
      (t) =>
        editor.setViewport({
          x: from.x + (target.x - from.x) * t,
          y: from.y + (target.y - from.y) * t,
          zoom: from.zoom + (target.zoom - from.zoom) * t,
        }),
      () => (viewAnimation = null),
    );
  };

  const fitToContent = (animated = true): void => {
    const box = bounds(editor.map);
    const { width, height } = scene.size;
    const target = box
      ? fitRect(box, width, height, { padding: fitPadding(width), maxZoom: 1 })
      : centerOn({ x: 0, y: 0 }, width, height, 1);
    if (animated) animateViewport(target, 320);
    else editor.setViewport(target);
  };

  const reveal = (id: NodeId): void => {
    const bubble = editor.map.nodes.get(id);
    if (!bubble) return;
    const view = editor.state.viewport;
    const { width, height } = scene.size;
    const p = worldToScreen(view, bubble);
    const r = (bubble.d / 2) * view.zoom;
    const margin = 24;
    const inside =
      p.x - r >= margin && p.x + r <= width - margin && p.y - r >= 64 && p.y + r <= height - 64;
    if (!inside) animateViewport(centerOn(bubble, width, height, view.zoom));
  };

  const removeWithToast = (): void => {
    const removed = deleteSelection(editor);
    const parts: string[] = [];
    if (removed.nodes) parts.push(`Popped ${plural(removed.nodes, 'bubble')}`);
    if (removed.links) parts.push(`cut ${plural(removed.links, 'connection')}`);
    if (parts.length) status.toast(capitalize(parts.join(', ')), { action: undoAction() });
  };

  const undoAction = (): { label: string; run: () => void } => ({
    label: 'Undo',
    run: () => editor.undo(),
  });

  const hasNodes = (): boolean => editor.map.nodes.size > 0;
  const hasSelectedNodes = (): boolean => editor.state.selection.nodes.size > 0;

  const resizeSelection = (factor: number): void => {
    editor.commit(
      updateBubbles(editor.map, editor.state.selection.nodes, (b) => {
        const d = clampDiameter(b.d * factor);
        return d === b.d ? b : { ...b, d };
      }),
      { coalesce: 'resize' },
    );
  };

  const newBubbleSpot = (): Vec => {
    // Viewport centre, stepping diagonally off any bubble already sitting there.
    const { x, y } = screenToWorld(editor.state.viewport, center());
    for (let i = 0; i < 12; i++) {
      const spot = { x: x + i * 36, y: y + i * 36 };
      const taken = [...editor.map.nodes.values()].some(
        (b) => Math.hypot(b.x - spot.x, b.y - spot.y) < 40,
      );
      if (!taken) return spot;
    }
    return { x, y };
  };

  const exportImage = async (kind: 'png' | 'svg'): Promise<void> => {
    const rendered = renderSvg(editor.map);
    if (!rendered) return;
    const filename = suggestFilename(editor.map, kind);
    try {
      const blob =
        kind === 'svg'
          ? new Blob([rendered.svg], { type: 'image/svg+xml' })
          : await svgToPng(rendered.svg, rendered.width, rendered.height);
      downloadBlob(blob, filename);
      status.toast(`Exported ${filename}`);
    } catch (error) {
      console.error(error);
      status.toast(`Couldn't export the image: ${errorMessage(error)}`);
    }
  };

  const openFile = async (): Promise<void> => {
    const file = await pickTextFile('.json,application/json');
    if (!file) return;
    try {
      const { map, viewport } = deserialize(file.text);
      editor.commit(map);
      editor.clearSelection();
      if (viewport) animateViewport(viewport, 320);
      else fitToContent();
      status.toast(`Opened “${file.name}”`, { action: undoAction() });
    } catch (error) {
      status.toast(`Couldn't open “${file.name}”: ${errorMessage(error)}`, { duration: 6000 });
    }
  };

  const commands: Record<Exclude<CommandId, `color-${number}`>, Command> = {
    'new-bubble': {
      label: 'New bubble',
      run: () => {
        const id = createBubbleAt(editor, newBubbleSpot());
        reveal(id);
      },
    },
    'add-child': {
      label: 'Add connected bubble',
      enabled: () => editor.soleSelected !== null && !editor.state.connect.active,
      run: () => {
        const parent = editor.soleSelected;
        const id = parent === null ? null : addChild(editor, parent);
        if (id) reveal(id);
      },
    },
    edit: {
      label: 'Edit text',
      enabled: () => editor.soleSelected !== null,
      run: () => {
        const id = editor.soleSelected;
        if (id !== null) editor.startEditing(id);
      },
    },
    delete: {
      label: 'Pop selected',
      enabled: () => editor.state.selection.nodes.size + editor.state.selection.links.size > 0,
      run: removeWithToast,
    },
    connect: {
      label: 'Connect bubbles',
      active: () => editor.state.connect.active,
      run: () => {
        const { active } = editor.state.connect;
        editor.setConnect(!active, active ? null : editor.soleSelected);
      },
    },
    undo: { label: 'Undo', enabled: () => editor.state.canUndo, run: () => editor.undo() },
    redo: { label: 'Redo', enabled: () => editor.state.canRedo, run: () => editor.redo() },
    'select-all': { label: 'Select all', enabled: hasNodes, run: () => selectAll(editor) },
    duplicate: {
      label: 'Duplicate',
      enabled: hasSelectedNodes,
      run: () => {
        duplicateSelection(editor);
      },
    },
    tidy: {
      label: 'Tidy up layout',
      enabled: () => editor.map.nodes.size > 1,
      run: () => {
        const before = editor.map;
        const targets = tidyPositions(editor);
        tidyAnimation = animate(
          500,
          (t) => {
            const positions = new Map<NodeId, Vec>();
            for (const [id, b] of before.nodes) {
              const to = targets.get(id) ?? b;
              positions.set(id, { x: b.x + (to.x - b.x) * t, y: b.y + (to.y - b.y) * t });
            }
            editor.preview(setPositions(before, positions));
          },
          () => {
            tidyAnimation = null;
            editor.commitFrom(before);
            status.toast('Tidied up', { action: undoAction() });
          },
        );
      },
    },
    clear: {
      label: 'Clear canvas',
      enabled: hasNodes,
      run: () => {
        const count = clearMap(editor);
        status.toast(`Cleared ${plural(count, 'bubble')}`, { action: undoAction() });
      },
    },
    tutorial: {
      label: 'Show the welcome map',
      run: () => {
        const { width, height } = scene.size;
        editor.commit(welcomeMap(width < 600 && height > width ? 'portrait' : 'landscape'));
        editor.clearSelection();
        fitToContent();
        status.toast('Welcome map restored', { action: undoAction() });
      },
    },
    open: { label: 'Open…', run: () => void openFile() },
    save: {
      label: 'Save as JSON',
      run: () => {
        const filename = suggestFilename(editor.map, 'json');
        const { map, viewport } = editor.state;
        downloadBlob(new Blob([stringify(map, viewport)], { type: 'application/json' }), filename);
        status.toast(`Saved ${filename}`);
      },
    },
    'export-png': {
      label: 'Export PNG image',
      enabled: hasNodes,
      run: () => void exportImage('png'),
    },
    'export-svg': {
      label: 'Export SVG image',
      enabled: hasNodes,
      run: () => void exportImage('svg'),
    },
    'zoom-in': {
      label: 'Zoom in',
      run: () => animateViewport(zoomAt(editor.state.viewport, center(), ZOOM_STEP), 160),
    },
    'zoom-out': {
      label: 'Zoom out',
      run: () => animateViewport(zoomAt(editor.state.viewport, center(), 1 / ZOOM_STEP), 160),
    },
    'zoom-reset': {
      label: 'Reset zoom to 100%',
      run: () => {
        const view = editor.state.viewport;
        animateViewport(zoomAt(view, center(), 1 / view.zoom));
      },
    },
    'zoom-fit': { label: 'Fit map to screen', run: () => fitToContent() },
    grow: { label: 'Grow selected', enabled: hasSelectedNodes, run: () => resizeSelection(1.1) },
    shrink: {
      label: 'Shrink selected',
      enabled: hasSelectedNodes,
      run: () => resizeSelection(1 / 1.1),
    },
    help: { label: 'Help & shortcuts', run: () => help.open() },
    escape: {
      label: 'Finish connecting / deselect',
      enabled: () =>
        colors.isOpen ||
        editor.state.connect.active ||
        hasSelectedNodes() ||
        editor.state.selection.links.size > 0,
      run: () => {
        if (colors.isOpen) colors.close();
        else if (editor.state.connect.active) editor.setConnect(false);
        else editor.clearSelection();
      },
    },
  };

  const colorCommands = Object.fromEntries(
    COLOR_IDS.map((color, i) => [
      `color-${i + 1}`,
      {
        label: `Colour: ${PALETTE[color].label}`,
        enabled: hasSelectedNodes,
        run: () => setColor(editor, editor.state.selection.nodes, color),
      } satisfies Command,
    ]),
  );

  // Every command first settles running animations so input never races them.
  const map = Object.fromEntries(
    Object.entries({ ...commands, ...colorCommands }).map(([id, command]) => [
      id,
      { ...command, run: () => (settle(), command.run()) },
    ]),
  ) as CommandMap;

  return {
    map,
    settle,
    reveal,
    fitToContent,
    popBubble: (id) => {
      editor.select([id]);
      removeWithToast();
    },
    cutLink: (id) => {
      editor.select([], [id]);
      removeWithToast();
    },
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
