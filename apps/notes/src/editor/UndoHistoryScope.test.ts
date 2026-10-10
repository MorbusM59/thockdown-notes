import { describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { redo, undo, undoDepth } from '@codemirror/commands';
import {
  UNDO_HISTORY_ARCHIVE_LIMIT,
  attachUndoHistory,
  createUndoHistoryScope,
  detachUndoHistory,
  readOnlyExtension,
  undoHistoryExtension,
  type UndoHistoryScope,
} from './UndoHistoryScope';
import { Compartment } from '@codemirror/state';

/**
 * A stand-in for one editor slot, driven the way CM6Editor's hydration
 * effect drives the real one: a document switch detaches the history in the
 * replace transaction and attaches the next document's afterwards.
 */
function createSlot(firstKey: string, firstText: string, readOnly = false) {
  const scope: UndoHistoryScope = createUndoHistoryScope();
  const readOnlyCompartment = new Compartment();
  let key = firstKey;
  // A clock a second apart per transaction, so no two edits share an undo group.
  let clock = 0;
  const tick = () => Transaction.time.of((clock += 1000));
  let state = EditorState.create({
    doc: firstText,
    extensions: [undoHistoryExtension(scope), readOnlyCompartment.of(readOnlyExtension(readOnly))],
  });
  return {
    get text() { return state.doc.toString(); },
    get depth() { return undoDepth(state); },
    type(insert: string) {
      // Distinct timestamps so every keystroke is its own undo group.
      state = state.update({
        changes: { from: state.doc.length, insert },
        annotations: tick(),
      }).state;
    },
    show(nextKey: string, nextText: string, nextReadOnly = false) {
      const detach = detachUndoHistory(scope, state, key);
      state = state.update({
        changes: { from: 0, to: state.doc.length, insert: nextText },
        // No addToHistory annotation: removing the field is what keeps the
        // replace out of the history, and this test is what checks that.
        effects: [detach, readOnlyCompartment.reconfigure(readOnlyExtension(nextReadOnly))],
        annotations: tick(),
      }).state;
      key = nextKey;
      state = state.update({ effects: attachUndoHistory(scope, state, key) }).state;
    },
    /** The store moved on (the same note edited in another slot): text appended, as the minimal change. */
    catchUp(appended: string) {
      state = state.update({
        changes: { from: state.doc.length, insert: appended },
        annotations: [Transaction.addToHistory.of(false), tick()],
      }).state;
    },
    undo() { return undo({ state, dispatch: (tr) => { state = tr.state; } }); },
    redo() { return redo({ state, dispatch: (tr) => { state = tr.state; } }); },
  };
}

const GUIDE = '# User Guide\nWelcome.';

function undoAll(slot: ReturnType<typeof createSlot>): void {
  for (let i = 0; i < 100 && slot.undo(); i++) { /* drain */ }
}

describe('UndoHistoryScope', () => {
  it('never undoes into another document (the reported note <-> guide sequence)', () => {
    const slot = createSlot('note', 'mine');
    slot.type('!');
    slot.show('guide', GUIDE, true);
    slot.show('note', 'mine!');
    slot.type('?');
    // Every intermediate step, not only the end: draining a contaminated
    // history walks through the guide and back out again.
    const seen: string[] = [];
    while (slot.undo()) seen.push(slot.text);
    while (slot.redo()) seen.push(slot.text);
    expect(seen).toEqual(['mine!', 'mine', 'mine!', 'mine!?']);
  });

  it('starts a document that was never shown with an empty history', () => {
    const slot = createSlot('a', 'aaa');
    slot.type('1');
    slot.show('b', 'bbb');
    expect(slot.depth).toBe(0);
    expect(slot.undo()).toBe(false);
    expect(slot.text).toBe('bbb');
  });

  it('brings a document its own history back when its text is unchanged', () => {
    const slot = createSlot('a', 'aaa');
    slot.type('1');
    slot.type('2');
    slot.show('b', 'bbb');
    slot.type('x');
    slot.show('a', 'aaa12');
    expect(slot.depth).toBe(2);
    undoAll(slot);
    expect(slot.text).toBe('aaa');
  });

  it('drops a set-aside history when the text changed elsewhere meanwhile', () => {
    const slot = createSlot('a', 'aaa');
    slot.type('1');
    slot.show('b', 'bbb');
    slot.show('a', 'edited elsewhere');
    expect(slot.depth).toBe(0);
    expect(slot.undo()).toBe(false);
    expect(slot.text).toBe('edited elsewhere');
  });

  it('keeps a snapshot and the live note apart under one note id', () => {
    const slot = createSlot('n', 'live');
    slot.type('+');
    slot.show('n@snapshot:3', 'old version', true);
    expect(slot.undo()).toBe(false);
    expect(slot.text).toBe('old version');
    slot.show('n', 'live+');
    undoAll(slot);
    expect(slot.text).toBe('live');
  });

  it('refuses undo and redo on a read-only document', () => {
    const slot = createSlot('note', 'abc');
    slot.type('d');
    slot.show('guide', GUIDE, true);
    expect(slot.undo()).toBe(false);
    expect(slot.redo()).toBe(false);
    expect(slot.text).toBe(GUIDE);
  });

  it('does not make a same-document catch-up undoable', () => {
    const slot = createSlot('note', 'abc');
    slot.type('d');
    slot.catchUp(' and text from another slot');
    undoAll(slot);
    expect(slot.text).toBe('abc and text from another slot');
  });

  it('bounds the set-aside histories, dropping the least recently left', () => {
    const slot = createSlot('k0', 't0');
    slot.type('x');
    for (let i = 1; i <= UNDO_HISTORY_ARCHIVE_LIMIT + 1; i++) {
      slot.show(`k${i}`, `t${i}`);
      slot.type('x');
    }
    slot.show('k0', 't0x');
    expect(slot.depth).toBe(0);
    // Showing k0 set k17's history aside, which pushed k2 out after k1.
    slot.show('k3', 't3x');
    expect(slot.depth).toBe(1);
  });
});
