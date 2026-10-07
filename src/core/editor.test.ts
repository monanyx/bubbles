import { describe, expect, it, vi } from 'vitest';
import { addBubble, addLink, createBubble, emptyMap, moveBubbles } from '../model/map';
import type { MindMap } from '../model/types';
import {
  addChild,
  clearMap,
  connect,
  createBubbleAt,
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  pickConnectTarget,
  selectAll,
  setColor,
  setText,
} from './actions';
import { Editor, type Listener } from './editor';

function seeded(): Editor {
  let map: MindMap = emptyMap();
  map = addBubble(map, createBubble({ x: 0, y: 0 }, { id: 'a' }));
  map = addBubble(map, createBubble({ x: 300, y: 0 }, { id: 'b' }));
  map = addLink(map, 'a', 'b', 'ab').map;
  return new Editor(map);
}

describe('Editor', () => {
  it('notifies subscribers with the previous state', () => {
    const editor = seeded();
    const listener = vi.fn<Listener>();
    const unsubscribe = editor.subscribe(listener);
    editor.select(['a']);
    expect(listener).toHaveBeenCalledOnce();
    const [next, prev] = listener.mock.calls[0]!;
    expect(next.selection.nodes.has('a')).toBe(true);
    expect(prev.selection.nodes.size).toBe(0);

    editor.select(['a']); // no-op
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    editor.clearSelection();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('delivers changes made by listeners in order, to every listener', () => {
    const editor = seeded();
    // First listener reacts to selection by committing a document change.
    editor.subscribe((state, prev) => {
      if (state.selection !== prev.selection && state.selection.nodes.has('a')) {
        editor.commit(moveBubbles(editor.map, ['a'], 5, 0));
      }
    });
    const seen: [boolean, boolean][] = [];
    editor.subscribe((state) => seen.push([state.selection.nodes.has('a'), state.canUndo]));
    editor.select(['a']);
    // The later listener must end on the newest state, never a stale one.
    expect(seen).toEqual([
      [true, false],
      [true, true],
    ]);
  });

  it('turns a previewed gesture into a single undo step', () => {
    const editor = seeded();
    const before = editor.map;
    for (let i = 1; i <= 10; i++) editor.preview(moveBubbles(before, ['a'], i, 0));
    expect(editor.state.canUndo).toBe(false);
    editor.commitFrom(before);
    expect(editor.state.canUndo).toBe(true);
    expect(editor.map.nodes.get('a')?.x).toBe(10);
    editor.undo();
    expect(editor.map).toBe(before);
    editor.redo();
    expect(editor.map.nodes.get('a')?.x).toBe(10);
  });

  it('prunes selection, editing and connect source after undo removes them', () => {
    const editor = seeded();
    const id = createBubbleAt(editor, { x: 0, y: 300 });
    expect(editor.state.editing).toBe(id);
    editor.setConnect(true, id);
    editor.undo();
    expect(editor.map.nodes.has(id)).toBe(false);
    expect(editor.state.connect.source).toBeNull();
    expect(editor.state.editing).toBeNull();
  });

  it('entering connect mode clears selection and editing', () => {
    const editor = seeded();
    editor.startEditing('a');
    editor.setConnect(true);
    expect(editor.state).toMatchObject({ editing: null, connect: { active: true } });
    expect(editor.state.selection.nodes.size).toBe(0);
  });

  it('reset forgets history', () => {
    const editor = seeded();
    clearMap(editor);
    expect(editor.state.canUndo).toBe(true);
    editor.reset(emptyMap());
    expect(editor.state.canUndo).toBe(false);
  });

  it('soleSelected only reports a single bubble', () => {
    const editor = seeded();
    expect(editor.soleSelected).toBeNull();
    editor.select(['a']);
    expect(editor.soleSelected).toBe('a');
    editor.toggleNode('b');
    expect(editor.soleSelected).toBeNull();
    editor.toggleNode('b');
    expect(editor.soleSelected).toBe('a');
  });
});

describe('actions', () => {
  it('addChild links a coloured child and starts editing it', () => {
    const editor = seeded();
    setColor(editor, ['b'], 'rose');
    const child = addChild(editor, 'b')!;
    expect(editor.map.nodes.get(child)?.color).toBe('rose');
    expect([...editor.map.links.values()].some((l) => l.a === 'b' && l.b === child)).toBe(true);
    expect(editor.state.editing).toBe(child);
    editor.undo();
    expect(editor.map.nodes.has(child)).toBe(false);
  });

  it('pickConnectTarget walks source → target and reports the outcome', () => {
    const editor = seeded();
    const c = createBubbleAt(editor, { x: 0, y: 400 });
    editor.setConnect(true);
    expect(pickConnectTarget(editor, 'a')).toBe('source');
    expect(editor.state.connect.source).toBe('a');
    expect(pickConnectTarget(editor, 'a')).toBe('cleared');
    expect(pickConnectTarget(editor, 'a')).toBe('source');
    expect(pickConnectTarget(editor, 'b')).toBe('exists'); // a–b already linked
    expect(pickConnectTarget(editor, 'a')).toBe('source');
    expect(pickConnectTarget(editor, c)).toBe('connected');
    expect(editor.state.connect).toEqual({ active: true, source: null });
  });

  it('connect refuses duplicates', () => {
    const editor = seeded();
    expect(connect(editor, 'b', 'a')).toBe(false);
    const c = createBubbleAt(editor, { x: 0, y: 400 });
    expect(connect(editor, 'a', c)).toBe(true);
  });

  it('deleteSelection pops bubbles and cuts links in one undo step', () => {
    const editor = seeded();
    editor.select(['a']);
    expect(deleteSelection(editor)).toEqual({ nodes: 1, links: 0 });
    expect(editor.map.links.size).toBe(0);
    editor.undo();
    expect(editor.map.nodes.size).toBe(2);

    editor.select([], ['ab']);
    expect(deleteSelection(editor)).toEqual({ nodes: 0, links: 1 });
    editor.clearSelection();
    expect(deleteSelection(editor)).toEqual({ nodes: 0, links: 0 });
  });

  it('setText normalises and is undoable', () => {
    const editor = seeded();
    setText(editor, 'a', '  hello  ');
    expect(editor.map.nodes.get('a')?.text).toBe('hello');
    editor.undo();
    expect(editor.map.nodes.get('a')?.text).toBe('');
  });

  it('coalesces bursts of nudges', () => {
    const editor = seeded();
    selectAll(editor);
    nudgeSelection(editor, 10, 0);
    nudgeSelection(editor, 10, 0);
    nudgeSelection(editor, 0, 10);
    expect(editor.map.nodes.get('a')).toMatchObject({ x: 20, y: 10 });
    editor.undo();
    expect(editor.map.nodes.get('a')).toMatchObject({ x: 0, y: 0 });
  });

  it('duplicates the selection and selects the copies', () => {
    const editor = seeded();
    selectAll(editor);
    const copies = duplicateSelection(editor);
    expect(copies).toHaveLength(2);
    expect(editor.map.nodes.size).toBe(4);
    expect(editor.map.links.size).toBe(2);
    expect([...editor.state.selection.nodes]).toEqual(copies);
  });

  it('clearMap is undoable', () => {
    const editor = seeded();
    expect(clearMap(editor)).toBe(2);
    expect(editor.map.nodes.size).toBe(0);
    expect(clearMap(editor)).toBe(0);
    editor.undo();
    expect(editor.map.nodes.size).toBe(2);
  });
});
