import { pickConnectTarget } from '../core/actions';
import type { Editor } from '../core/editor';
import { navigate, type Direction } from '../geometry/layout';
import type { NodeId } from '../model/types';
import type { Scene } from '../view/scene';

const ARROWS: Partial<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Keys that act on "the current bubble" and so should adopt the focused one. */
const ACTS_ON_BUBBLE = new Set(['Enter', 'F2', 'Delete', 'Backspace', ' ']);

export interface BubbleKeyHooks {
  connected(ok: boolean): void;
  reveal(id: NodeId): void;
}

/**
 * Makes keyboard focus and selection agree. A bubble can hold focus without
 * being selected (Tab onto the canvas, or after Escape); keys pressed on it
 * then act on it instead of falling through to "nothing selected" behaviour.
 * In connect mode, arrows move focus between bubbles and Enter/Space picks
 * the source and then the target — so connecting needs no pointer.
 *
 * Runs on the bubble layer, before the window-level shortcut dispatcher.
 */
export function bindBubbleKeys(scene: Scene, editor: Editor, hooks: BubbleKeyHooks): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('.bubble') : null;
    const id = el?.dataset.id;
    if (id === undefined || !editor.map.nodes.has(id) || editor.state.editing !== null) return;

    if (editor.state.connect.active) {
      const direction = ARROWS[e.key];
      if (direction) {
        e.preventDefault();
        e.stopPropagation();
        const next = navigate(editor.map, id, direction);
        if (next !== null) {
          scene.focusBubble(next);
          hooks.reveal(next);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        const pick = pickConnectTarget(editor, id);
        if (pick === 'connected' || pick === 'exists') hooks.connected(pick === 'connected');
      }
      return;
    }

    // Nothing selected yet: the focused bubble becomes the selection, and the
    // event continues to the shortcut dispatcher, which now acts on it.
    // (Arrows then hop onwards from it: selection follows focus.)
    if (editor.state.selection.nodes.size === 0 && (ACTS_ON_BUBBLE.has(e.key) || ARROWS[e.key])) {
      editor.select([id]);
    }
  };

  scene.bubbleLayer.addEventListener('keydown', onKeyDown);
  return () => scene.bubbleLayer.removeEventListener('keydown', onKeyDown);
}
