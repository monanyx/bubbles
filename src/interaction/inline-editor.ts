import { addChild, setText } from '../core/actions';
import type { Editor, EditorState } from '../core/editor';
import { MAX_TEXT_LENGTH, normalizeText } from '../model/map';
import type { NodeId } from '../model/types';
import type { Scene } from '../view/scene';

/**
 * Turns a bubble label into an editable field while `state.editing` points at
 * it, and writes the text back into the document (one undo step) when editing
 * ends — however it ends: Enter, Escape, Tab, a click elsewhere, or blur.
 */
export class InlineEditor {
  private active: { id: NodeId; label: HTMLElement } | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly editor: Editor,
    private readonly scene: Scene,
  ) {
    this.unsubscribe = editor.subscribe((state, prev) => {
      if (state.editing !== prev.editing) this.sync(state);
    });
  }

  destroy(): void {
    this.end();
    this.unsubscribe();
  }

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
    this.active = { id, label };

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
    if (text !== bubble.text) setText(this.editor, id, text);
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
      addChild(this.editor, id);
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
    const room = MAX_TEXT_LENGTH - this.active.label.innerText.length;
    insertText(text.slice(0, Math.max(0, room)));
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
