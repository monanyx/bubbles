import { addChild, setText } from '../core/actions';
import type { Editor, EditorState } from '../core/editor';
import { clipText, MAX_TEXT_LENGTH, normalizeText, updateBubble } from '../model/map';
import type { MindMap, NodeId } from '../model/types';
import type { Scene } from '../view/scene';

/**
 * Turns a bubble label into an editable field while `state.editing` points at
 * it, and writes the text back into the document (one undo step) when editing
 * ends — however it ends: Enter, Escape, Tab, a click elsewhere, or blur.
 * Text typed so far is also saved if the page is hidden or closed mid-edit.
 *
 * Construct it before {@link Autosave}: its pagehide/visibilitychange
 * listeners must commit the draft before Autosave's listeners flush.
 */
export class InlineEditor {
  private active: {
    id: NodeId;
    label: HTMLElement;
    /** The text when editing began: only a change from it is the user's. */
    original: string;
    /**
     * Saved-but-unconfirmed text (page hidden mid-edit), shown as a preview so
     * it autosaves without adding undo steps. `base` is the map before it.
     */
    draft: { base: MindMap; last: MindMap } | null;
  } | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly editor: Editor,
    private readonly scene: Scene,
    /** Called with each child sprouted by Tab, e.g. to scroll it into view. */
    private readonly onSprout: (id: NodeId) => void = () => undefined,
  ) {
    this.unsubscribe = editor.subscribe((state, prev) => {
      if (state.editing !== prev.editing) this.sync(state);
    });
    window.addEventListener('pagehide', this.commitDraft);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  destroy(): void {
    this.end();
    this.unsubscribe();
    window.removeEventListener('pagehide', this.commitDraft);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * Saves what has been typed so far without leaving edit mode or adding an
   * undo step: it is previewed (so Autosave writes it) and folded into the
   * single step recorded when editing ends.
   */
  private readonly commitDraft = (): void => {
    const active = this.active;
    if (!active?.label.isConnected) return;
    const text = normalizeText(active.label.innerText);
    const map = this.editor.map;
    const current = map.nodes.get(active.id);
    if (!current || text === active.original || text === current.text) return;
    const last = updateBubble(map, active.id, { text });
    active.draft = { base: active.draft?.last === map ? active.draft.base : map, last };
    this.editor.preview(last);
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.commitDraft();
  };

  private sync(state: EditorState): void {
    this.end();
    if (state.editing !== null) this.begin(state.editing);
  }

  private begin(id: NodeId): void {
    // Render synchronously so focus happens inside the current user gesture
    // (iOS only raises the keyboard for focus calls made during a gesture).
    this.scene.flush();
    const view = this.scene.bubbleView(id);
    if (!view) return;
    const { label } = view;
    this.active = { id, label, original: view.bubble.text, draft: null };

    try {
      label.contentEditable = 'plaintext-only';
    } catch {
      label.contentEditable = 'true'; // older engines; paste is sanitised below
    }
    label.setAttribute('role', 'textbox');
    label.setAttribute('aria-label', 'Bubble text');
    label.setAttribute('aria-multiline', 'true');
    label.addEventListener('keydown', this.onKeyDown);
    label.addEventListener('input', this.onInput);
    label.addEventListener('beforeinput', this.onBeforeInput);
    label.addEventListener('paste', this.onPaste);
    label.addEventListener('blur', this.onBlur);
    label.focus({ preventScroll: true });
    placeCaretAtEnd(label);
  }

  /** Commits the active label (if any) and makes it read-only again. */
  private end(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    const { id, label } = active;

    label.removeEventListener('keydown', this.onKeyDown);
    label.removeEventListener('input', this.onInput);
    label.removeEventListener('beforeinput', this.onBeforeInput);
    label.removeEventListener('paste', this.onPaste);
    label.removeEventListener('blur', this.onBlur);
    label.removeAttribute('contenteditable');
    label.removeAttribute('role');
    label.removeAttribute('aria-label');
    label.removeAttribute('aria-multiline');

    const bubble = this.editor.map.nodes.get(id);
    if (!bubble) return;
    const text = normalizeText(label.innerText);
    const { draft, original } = active;
    if (draft?.last === this.editor.map) {
      // Fold any saved drafts and the final text into one undo step.
      this.editor.preview(updateBubble(draft.base, id, { text }));
      this.editor.commitFrom(draft.base);
    } else if (text !== original && text !== bubble.text) {
      // Only what the user typed: an untouched label must not overwrite text
      // that changed meanwhile (e.g. adopted from another tab).
      setText(this.editor, id, text);
    }
    // Normalisation may differ from what was typed (e.g. trailing spaces).
    label.textContent = this.editor.map.nodes.get(id)?.text ?? text;
    this.scene.bubbleView(id)?.refit();
    if (document.activeElement === label || document.activeElement === document.body) {
      this.scene.focusBubble(id);
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active || e.isComposing) return;
    const { id } = this.active;
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.editor.stopEditing();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.editor.stopEditing();
      const child = addChild(this.editor, id);
      if (child !== null) this.onSprout(child);
    }
  };

  private readonly onInput = (): void => {
    if (!this.active) return;
    this.scene.bubbleView(this.active.id)?.refit(this.active.label.innerText);
  };

  private readonly onBeforeInput = (e: InputEvent): void => {
    if (!this.active || !e.inputType.startsWith('insert')) return;
    const incoming = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    const selected = window.getSelection()?.toString().length ?? 0;
    const length = this.active.label.innerText.length - selected + Math.max(1, incoming.length);
    if (length > MAX_TEXT_LENGTH) e.preventDefault();
  };

  private readonly onPaste = (e: ClipboardEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
    // The pasted text replaces the selection, so that doesn't count as used.
    const selected = window.getSelection()?.toString().length ?? 0;
    const room = MAX_TEXT_LENGTH - (this.active.label.innerText.length - selected);
    const fitted = clipText(text, Math.max(0, room));
    if (fitted || selected) insertText(fitted);
  };

  private readonly onBlur = (): void => {
    // Focus left the label (toolbar click, window switch…): finish editing.
    // Deferred so a click that moves editing elsewhere is processed first.
    const id = this.active?.id;
    queueMicrotask(() => {
      if (id !== undefined && this.editor.state.editing === id) this.editor.stopEditing();
    });
  };
}

function placeCaretAtEnd(el: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertText(text: string): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  node.parentElement?.dispatchEvent(new Event('input', { bubbles: true }));
}
