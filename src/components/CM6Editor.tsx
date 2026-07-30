import { useEffect, useRef } from 'react';
import { EditorState, EditorSelection, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { buildTokenPresentation } from '../editor/MarkdownLineClassification';
import type {
  EditorAdapter,
  EditorBindings,
  EditorSelectionState,
  EditorSnapshot,
  EditorSnapshotApplyRequest,
  EditorTextChangeEvent,
} from '../editor/EditorContract';

/**
 * Phase 2, slice 1 of the CM6 migration spike (see
 * docs/document-scale-performance-philosophy.md and the large-document
 * performance handover doc's own history): a CodeMirror 6-backed
 * implementation of the SAME EditorAdapter/EditorBindings contract
 * Editor.tsx (Lexical) implements, built alongside it rather than replacing
 * it -- exactly what EditorContract.ts's "implementations may be partial
 * while the rewrite is in flight" rule exists for.
 *
 * Deliberately scoped to slice 1 only: mount, initial-text hydration, plain
 * typing -> onTextChange, selection -> onSelectionChange, and
 * getSnapshot/applySnapshot for text + selection. NOT yet implemented:
 * viewport/boundary events, Tab/Enter/markdown-shortcut transforms, the
 * custom block-caret/selection overlay, typing sounds, the custom
 * scrollbar. Those are later slices per the migration plan, each needing
 * their own verification before being added here.
 */
export interface CM6EditorProps {
  bindings?: EditorBindings;
  adapterRef?: React.MutableRefObject<EditorAdapter | null>;
  noteId?: string | null;
  initialText?: string;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  editorReadOnly?: boolean;
  spellCheckEnabled?: boolean;
}

function toSelectionState(range: { anchor: number; head: number; from: number; to: number; empty: boolean }): EditorSelectionState {
  return {
    anchor: range.anchor,
    focus: range.head,
    start: range.from,
    end: range.to,
    isCollapsed: range.empty,
  };
}

const lineTokenPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }
  update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }
  buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos);
        const presentation = buildTokenPresentation(line.text);
        if (presentation) {
          builder.add(line.from, line.from, Decoration.line({ class: presentation.classes.join(' ') }));
        }
        pos = line.to + 1;
      }
    }
    return builder.finish();
  }
}, {
  decorations: (pluginValue) => pluginValue.decorations,
});

export function CM6Editor({
  bindings,
  adapterRef,
  noteId,
  initialText = '',
  fontFamily,
  fontSizePx,
  lineHeightPx,
  editorReadOnly = false,
  spellCheckEnabled = false,
}: CM6EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const bindingsRef = useRef(bindings);
  const previousTextRef = useRef('');
  const previousSelectionRef = useRef<EditorSelectionState>({ anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true });
  const lastHydratedNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      lineTokenPlugin,
      EditorView.lineWrapping,
      EditorView.editable.of(!editorReadOnly),
      // `editor-text` matches the class app-level code outside this
      // component (e.g. App.tsx's "click anywhere near the editor refocuses
      // the real editable surface" affordance) already queries for -- found
      // via live testing, not assumed: without it, every click here gets
      // preventDefault()'d because that code only recognizes Lexical's own
      // `.editor-text[contenteditable]` DOM shape. This is the correct
      // target class going forward, not a workaround -- this element really
      // is "the editor text surface" other app code should find.
      EditorView.contentAttributes.of({ class: 'editor-text', spellcheck: String(spellCheckEnabled) }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const nextText = update.state.doc.toString();
          const previousText = previousTextRef.current;
          const nextSelection = toSelectionState(update.state.selection.main);
          previousTextRef.current = nextText;
          previousSelectionRef.current = nextSelection;

          const event: EditorTextChangeEvent = {
            source: 'user-input',
            text: nextText,
            previousText,
            selection: nextSelection,
          };
          bindingsRef.current?.onTextChange?.(event);
        } else if (update.selectionSet) {
          const nextSelection = toSelectionState(update.state.selection.main);
          const previous = previousSelectionRef.current;
          const changed = nextSelection.anchor !== previous.anchor
            || nextSelection.focus !== previous.focus
            || nextSelection.start !== previous.start
            || nextSelection.end !== previous.end
            || nextSelection.isCollapsed !== previous.isCollapsed;
          if (changed) {
            previousSelectionRef.current = nextSelection;
            bindingsRef.current?.onSelectionChange?.({ source: 'user-input', selection: nextSelection });
          }
        }
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    lastHydratedNoteIdRef.current = noteId ?? null;

    previousTextRef.current = initialText;
    const initialSelection = toSelectionState(view.state.selection.main);
    previousSelectionRef.current = initialSelection;

    bindingsRef.current?.onLifecycle?.({ phase: 'mounted' });
    bindingsRef.current?.onLifecycle?.({ phase: 'ready' });
    bindingsRef.current?.onTextChange?.({
      source: 'initial-load',
      text: initialText,
      previousText: '',
      selection: initialSelection,
    });
    bindingsRef.current?.onSelectionChange?.({ source: 'initial-load', selection: initialSelection });

    return () => {
      bindingsRef.current?.onLifecycle?.({ phase: 'destroyed' });
      view.destroy();
      viewRef.current = null;
    };
    // Deliberately mount-once: noteId/initialText changes are handled by the
    // hydration effect below (matching NoteTextHydrationPlugin's own
    // "patch, don't remount" discipline), not by tearing this effect down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Note-switch hydration: replace the whole document when noteId changes.
  // Slice-1 simplification -- NOT yet the prefix/suffix patch
  // NoteTextHydrationPlugin does, since CM6's own Text.replace() already
  // avoids that function's entire reason for existing (see the Phase 1
  // audit: structural sharing means this is cheap without manual diffing).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (lastHydratedNoteIdRef.current === (noteId ?? null) && view.state.doc.toString() === initialText) return;
    lastHydratedNoteIdRef.current = noteId ?? null;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initialText },
      selection: EditorSelection.cursor(0),
    });
    previousTextRef.current = initialText;
  }, [noteId, initialText]);

  useEffect(() => {
    if (!adapterRef) return;

    adapterRef.current = {
      getCapabilities() {
        return {
          textEvents: true,
          selectionEvents: true,
          viewportEvents: false,
          snapshotRead: true,
          snapshotWrite: false,
          snapshotWriteText: false,
          snapshotWriteSelection: true,
          snapshotWriteViewport: false,
        };
      },
      getSnapshot(): EditorSnapshot | null {
        const view = viewRef.current;
        if (!view) return null;
        return {
          text: view.state.doc.toString(),
          selection: toSelectionState(view.state.selection.main),
          viewport: {
            topBoundaryPx: 0,
            bottomBoundaryPx: 0,
            scrollTopPx: view.scrollDOM.scrollTop,
            lineHeightPx,
            cellWidthPx: 0,
          },
        };
      },
      applySnapshot(snapshot: EditorSnapshotApplyRequest) {
        const view = viewRef.current;
        if (!view) return;
        if (snapshot.selection) {
          const docLength = view.state.doc.length;
          const anchor = Math.max(0, Math.min(docLength, snapshot.selection.anchor));
          const focus = Math.max(0, Math.min(docLength, snapshot.selection.focus));
          view.dispatch({ selection: EditorSelection.single(anchor, focus) });
        }
      },
    };

    return () => {
      if (adapterRef.current) {
        adapterRef.current = null;
      }
    };
  }, [adapterRef, lineHeightPx]);

  return (
    <div
      ref={containerRef}
      className="cm6-editor-root"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'auto',
        fontFamily,
        fontSize: fontSizePx,
        lineHeight: `${lineHeightPx}px`,
      }}
    />
  );
}
