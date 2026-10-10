import { Compartment, EditorState, type Extension, type StateEffect, type Text } from '@codemirror/state';
import { history, historyField } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';

/**
 * One undo history per DOCUMENT, not per editor.
 *
 * An editor (one per slot) is mounted once and shows many documents in turn:
 * notes, the User Guide's chapters, Time Machine snapshots. CM6 keeps a
 * single history per editor state, so without this the history outlived the
 * document it described. Loading the next document was itself a recorded,
 * undoable full-document replace, and undoing past the reader's own typing
 * reverted it: the previous document's text (the User Guide, in the report
 * that found this) was written into the current note and then saved.
 *
 * The rule here: a history is bound to a key naming the document it was
 * recorded against. Switching documents removes the history field for the
 * replace itself (so loading is never an undo step), sets the old history
 * aside under the old key, and installs the new document's own history --
 * the one it had when it was left, if its text is exactly what it was then,
 * otherwise an empty one.
 */
export interface UndoHistoryScope {
  readonly compartment: Compartment;
  readonly archive: Map<string, ArchivedUndoHistory>;
}

/**
 * A set-aside history and the text it was recorded against. Restored only
 * onto identical text: history events are position-based, and replayed over
 * different text (the note edited in another slot since, or restored from a
 * snapshot) an undo would splice fragments into the wrong places.
 */
export interface ArchivedUndoHistory {
  doc: Text;
  history: unknown;
}

/**
 * How many set-aside histories one editor keeps. Each holds its document's
 * text and every deleted fragment, so this bounds memory; the least recently
 * left document is dropped first and comes back with an empty history.
 */
export const UNDO_HISTORY_ARCHIVE_LIMIT = 16;

export function createUndoHistoryScope(): UndoHistoryScope {
  return { compartment: new Compartment(), archive: new Map() };
}

/** The history extension an editor is created with. */
export function undoHistoryExtension(scope: UndoHistoryScope): Extension {
  return scope.compartment.of(history());
}

/**
 * Step one of a document switch, read from the state BEFORE the new text is
 * dispatched: sets the outgoing history aside under `previousKey` and returns
 * the effect that removes the history field. Dispatch it in the same
 * transaction as the replace, so the replace is not recorded at all.
 */
export function detachUndoHistory(scope: UndoHistoryScope, state: EditorState, previousKey: string | null): StateEffect<unknown> {
  const recorded = state.field(historyField, false);
  if (previousKey !== null && recorded !== undefined) {
    scope.archive.delete(previousKey);
    scope.archive.set(previousKey, { doc: state.doc, history: recorded });
    while (scope.archive.size > UNDO_HISTORY_ARCHIVE_LIMIT) {
      const oldest = scope.archive.keys().next().value;
      if (oldest === undefined) break;
      scope.archive.delete(oldest);
    }
  }
  return scope.compartment.reconfigure([]);
}

/**
 * Step two, read from the state AFTER the new text is in: the effect that
 * installs `nextKey`'s history -- the archived one if it was recorded against
 * exactly this text, otherwise an empty one.
 */
export function attachUndoHistory(scope: UndoHistoryScope, state: EditorState, nextKey: string | null): StateEffect<unknown> {
  const archived = nextKey === null ? undefined : scope.archive.get(nextKey);
  if (nextKey !== null) scope.archive.delete(nextKey);
  const restored = archived && archived.doc.eq(state.doc) ? archived.history : undefined;
  return scope.compartment.reconfigure(
    restored === undefined ? history() : [historyField.init(() => restored), history()],
  );
}

/**
 * What makes a document read-only. `editable` alone stops typing but not
 * commands: CM6's undo/redo (and every editing command) check
 * `EditorState.readOnly`, so without it Ctrl+Z still rewrote a read-only
 * document such as the User Guide.
 */
export function readOnlyExtension(readOnly: boolean): Extension {
  return [EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)];
}
