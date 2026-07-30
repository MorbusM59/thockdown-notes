import { useEffect, useRef } from 'react';
import { EditorState, EditorSelection, Prec, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, drawSelection, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { buildTokenPresentation } from '../editor/MarkdownLineClassification';
import { typingSoundManager } from '../sound/TypingSoundManager';
import type {
  EditorAdapter,
  EditorBindings,
  EditorSelectionState,
  EditorSnapshot,
  EditorSnapshotApplyRequest,
  EditorTextChangeEvent,
  EditorViewportState,
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
 * Slices so far: mount, initial-text hydration, typing/selection tracking,
 * Tab/Enter/markdown-shortcut transforms, typing sounds, and (this slice)
 * scroll/viewport reporting + restore. topBoundaryPx/bottomBoundaryPx are
 * still hardcoded to 0 -- the fixed-focus caging system's boundary UI
 * (padding zones, drag handles) and BlockCaretPlugin/BlockSelectionPlugin's
 * pixel-matched grid caret are the remaining, larger slices.
 */
export interface CM6EditorProps {
  bindings?: EditorBindings;
  adapterRef?: React.MutableRefObject<EditorAdapter | null>;
  noteId?: string | null;
  initialText?: string;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  cellWidthPx?: number;
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

/** Replaces the whole document with `next.text` and sets the selection to `next.selection` in one transaction -- the CM6 equivalent of ContractBridgePlugin.tsx's replaceEditorTextFromCanonical + scheduleTransformSelectionReplay, collapsed into a single atomic dispatch since CM6 (unlike Lexical) applies a change and its selection together without a deferred-DOM-commit race to work around. */
function applyTransformResult(view: EditorView, next: { text: string; selection: EditorSelectionState }): void {
  const anchor = Math.max(0, Math.min(next.text.length, next.selection.anchor));
  const focus = Math.max(0, Math.min(next.text.length, next.selection.focus));
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next.text },
    selection: EditorSelection.single(anchor, focus),
  });
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
  cellWidthPx = 0,
  editorReadOnly = false,
  spellCheckEnabled = false,
}: CM6EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const bindingsRef = useRef(bindings);
  const previousTextRef = useRef('');
  const previousSelectionRef = useRef<EditorSelectionState>({ anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true });
  const lastHydratedNoteIdRef = useRef<string | null>(null);
  const lineHeightPxRef = useRef(lineHeightPx);
  const cellWidthPxRef = useRef(cellWidthPx);

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    lineHeightPxRef.current = lineHeightPx;
    cellWidthPxRef.current = cellWidthPx;
  }, [lineHeightPx, cellWidthPx]);

  // topBoundaryPx/bottomBoundaryPx are hardcoded 0 here -- the boundary UI
  // itself (padding zones, drag handles) is a later slice. Every other
  // field is real, matching Editor.tsx's own buildViewport shape.
  const buildViewport = (view: EditorView): EditorViewportState => ({
    topBoundaryPx: 0,
    bottomBoundaryPx: 0,
    scrollTopPx: view.scrollDOM.scrollTop,
    lineHeightPx: lineHeightPxRef.current,
    cellWidthPx: cellWidthPxRef.current,
    scrollHeightPx: view.scrollDOM.scrollHeight,
    clientHeightPx: view.scrollDOM.clientHeight,
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      lineTokenPlugin,
      EditorView.lineWrapping,
      EditorView.editable.of(!editorReadOnly),
      // The app's own CSS sets `caret-color: transparent` on `.editor-text`
      // (index.css, "Hide the native OS caret") so BlockCaretPlugin's custom
      // grid-aligned overlay can render instead -- but that overlay depends
      // on the viewport/boundary system (topBoundaryPx/lineHeightPx/
      // cellWidthPx), not yet ported here. drawSelection() renders CM6's own
      // cursor via decorations rather than the native caret, so it stays
      // visible despite inheriting that CSS rule -- a real interim fix, not
      // the final pixel-matched block-grid caret (a later slice, once the
      // viewport system lands).
      drawSelection(),
      // `editor-text` matches the class app-level code outside this
      // component (e.g. App.tsx's "click anywhere near the editor refocuses
      // the real editable surface" affordance) already queries for -- found
      // via live testing, not assumed: without it, every click here gets
      // preventDefault()'d because that code only recognizes Lexical's own
      // `.editor-text[contenteditable]` DOM shape. This is the correct
      // target class going forward, not a workaround -- this element really
      // is "the editor text surface" other app code should find.
      EditorView.contentAttributes.of({ class: 'editor-text', spellcheck: String(spellCheckEnabled) }),
      // CM6's own base theme sets `.cm-scroller { height: 100% }`, which
      // resolves against `.cm-editor`'s height -- and `.cm-editor` itself
      // has no explicit height in that base theme, so by default it just
      // grows to fit its content instead of filling this component's
      // container. Found live, not assumed: without this, `.cm-scroller`
      // (view.scrollDOM, what every viewport/scroll/caret computation in
      // this file targets) never actually overflows -- confirmed via
      // scrollHeight === clientHeight on a 50,000-character note -- and the
      // container div ends up doing the real scrolling "by accident" via
      // its own overflow, which view.scrollDOM never sees. This theme
      // constrains `.cm-editor` to 100% of the container so `.cm-scroller`
      // becomes the genuine scrolling element, matching CM6's own intended
      // integration contract.
      EditorView.theme({
        '&': { height: '100%' },
      }),
      // Tab/Enter/markdown-shortcut transforms -- ported verbatim from
      // ContractBridgePlugin.tsx's KEY_TAB_COMMAND/KEY_DOWN_COMMAND/
      // KEY_ENTER_COMMAND handlers (same conditional logic, same pure
      // transform callbacks from EditorBindings). Registered as a
      // Prec.highest keymap using the `any` handler (fires for every key,
      // gets the raw KeyboardEvent) rather than domEventHandlers.keydown --
      // found live, not assumed: @codemirror/commands' defaultKeymap binds
      // Enter to its own insertNewlineAndIndent, and CM6's internal keymap
      // dispatch runs at higher precedence than a plain domEventHandlers
      // registration, so Enter (and any other defaultKeymap-bound key) never
      // reached a domEventHandlers.keydown handler at all -- confirmed by
      // instrumenting keydown directly: every character logged except
      // Enter, while a plain (uncontinuing) newline still appeared, proving
      // CM6's own default binding was silently winning. Prec.highest here
      // guarantees this layer is checked before defaultKeymap regardless of
      // registration order.
      //
      // Deliberately Ctrl (not Cmd/Mod) for the markdown shortcuts, matching
      // the original exactly: `!event.ctrlKey || event.metaKey` rejects the
      // shortcut, so Ctrl+B (not Cmd+B) is what this app has always bound,
      // even on Mac -- preserved rather than "corrected" to platform
      // convention, since that's a deliberate product choice, not a bug.
      Prec.highest(keymap.of([{
        any: (view, event) => {
          if (event.key === 'Tab') {
            // Same click sound/echo as ContractBridgePlugin.tsx's own
            // KEY_TAB_COMMAND handler -- played unconditionally like the
            // original, not gated on the transform actually changing
            // anything.
            const tabKeyId = event.shiftKey ? 'key:Shift:Tab' : 'key:Tab';
            if (event.shiftKey) {
              void typingSoundManager.playRandomClick({
                keyId: tabKeyId,
                reverse: true,
                gain: 0.7,
                echo: { count: 2, delayMs: 80, decay: 0.4 },
                detune: 600,
              });
            } else {
              void typingSoundManager.playRandomClick({
                keyId: tabKeyId,
                gain: 0.7,
                echo: { count: 2, delayMs: 80, decay: 0.4 },
              });
            }

            const text = view.state.doc.toString();
            const selection = toSelectionState(view.state.selection.main);
            const transformCallback = bindingsRef.current?.onTabIndentTransform;
            if (transformCallback) {
              const next = transformCallback({ shiftKey: event.shiftKey, text, selection });
              if (next) {
                event.preventDefault();
                applyTransformResult(view, next);
                return true;
              }
            }
            bindingsRef.current?.onTabIndent?.({ shiftKey: event.shiftKey });
            // Never let Tab escape the editor to focus/menu navigation,
            // matching ContractBridgePlugin's own unconditional
            // preventDefault/stopPropagation for this key.
            event.preventDefault();
            return true;
          }

          if (event.key === 'Enter') {
            const callback = bindingsRef.current?.onEnterTransform;
            if (!callback) return false;
            const text = view.state.doc.toString();
            const selection = toSelectionState(view.state.selection.main);
            const next = callback({
              shiftKey: event.shiftKey,
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              text,
              selection,
            });
            if (!next) return false;
            event.preventDefault();
            applyTransformResult(view, next);
            return true;
          }

          const shortcutCallback = bindingsRef.current?.onMarkdownShortcutTransform;
          if (shortcutCallback && event.ctrlKey && !event.metaKey && !event.altKey) {
            let shortcut: 'bold' | 'italic' | 'strikethrough' | 'heading-toggle' | 'unordered-list' | 'ordered-list' | null = null;
            const key = event.key.toLowerCase();
            if (!event.shiftKey && key === 'b') shortcut = 'bold';
            else if (!event.shiftKey && key === 'i') shortcut = 'italic';
            else if (!event.shiftKey && key === 'j') shortcut = 'strikethrough';
            else if (!event.shiftKey && key === 't') shortcut = 'heading-toggle';
            else if (!event.shiftKey && event.key === '-') shortcut = 'unordered-list';
            else if ((event.shiftKey && event.key === '3') || event.key === '#') shortcut = 'ordered-list';

            if (shortcut) {
              const text = view.state.doc.toString();
              const selection = toSelectionState(view.state.selection.main);
              const next = shortcutCallback({ shortcut, text, selection });
              if (next) {
                event.preventDefault();
                applyTransformResult(view, next);
                return true;
              }
            }
          }

          return false;
        },
      }])),
      // Arrow-key/undo/redo click sounds -- ported verbatim from
      // Editor.tsx's handleEditorKeyDown. A domEventObservers registration
      // (not domEventHandlers) deliberately, since this is a pure side
      // effect that must always fire and never claim the event or affect
      // precedence -- exactly matching the original, which was a plain
      // React onKeyDown prop with no preventDefault. Plain typing/backspace
      // and Enter sounds need no separate wiring here: those already live
      // inside the EditorBindings themselves (onTextChange's text-length-
      // delta detection, onEnterTransform's own unconditional click), which
      // CM6Editor already calls -- so they work automatically.
      EditorView.domEventObservers({
        keydown: (event) => {
          const modifiers = [
            event.shiftKey ? 'Shift' : null,
            event.ctrlKey ? 'Control' : null,
            event.altKey ? 'Alt' : null,
            event.metaKey ? 'Meta' : null,
          ].filter(Boolean).join('+');
          const keyId = modifiers ? `key:${modifiers}:${event.key}` : `key:${event.key}`;
          switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'ArrowUp':
            case 'ArrowDown':
              void typingSoundManager.playRandomClick({ keyId, detune: 1200, gain: 0.3 });
              break;
            case 'z':
              if (event.ctrlKey || event.metaKey) {
                void typingSoundManager.playRandomClick({ keyId, reverse: true, detune: -1200, gain: 0.7 });
              }
              break;
            case 'y':
              if (event.ctrlKey || event.metaKey) {
                void typingSoundManager.playRandomClick({ keyId, detune: -1200, gain: 0.7 });
              }
              break;
            default:
              break;
          }
        },
      }),
      // Character-insert transform (e.g. checklist typeover) -- uses CM6's
      // inputHandler rather than keydown so this only ever fires for a
      // genuine committed single-character insertion (matches Lexical's own
      // `event.key.length === 1 && !event.isComposing` gate without needing
      // to reimplement IME-composition detection by hand).
      EditorView.inputHandler.of((view, from, to, insertedText) => {
        const callback = bindingsRef.current?.onCharacterInsertTransform;
        if (!callback) return false;
        if (insertedText.length !== 1 || from !== to) return false;

        const text = view.state.doc.toString();
        const selection = toSelectionState(view.state.selection.main);
        const next = callback({ char: insertedText, text, selection });
        if (!next) return false;

        applyTransformResult(view, next);
        return true;
      }),
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
    bindingsRef.current?.onViewportChange?.({
      source: 'programmatic',
      origin: 'programmatic',
      viewport: buildViewport(view),
    });

    // Scroll reporting -- mirrors Editor.tsx's own scroller 'scroll'
    // listener + buildViewport. isProgrammaticScrollRef-style origin
    // disambiguation (drag vs. real user scroll) isn't needed yet since
    // there's no drag-handle UI here to originate a 'viewport-drag' event.
    const handleScroll = () => {
      bindingsRef.current?.onViewportChange?.({
        source: 'user-input',
        origin: 'scroll',
        viewport: buildViewport(view),
      });
    };
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      view.scrollDOM.removeEventListener('scroll', handleScroll);
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
          viewportEvents: true,
          snapshotRead: true,
          // Not `true`: topBoundaryPx/bottomBoundaryPx aren't real yet (the
          // boundary UI is a later slice), so a full round-trip snapshot
          // write can't be claimed -- only the granular flags below that are
          // genuinely implemented.
          snapshotWrite: false,
          snapshotWriteText: false,
          snapshotWriteSelection: true,
          snapshotWriteViewport: true,
        };
      },
      getSnapshot(): EditorSnapshot | null {
        const view = viewRef.current;
        if (!view) return null;
        return {
          text: view.state.doc.toString(),
          selection: toSelectionState(view.state.selection.main),
          viewport: buildViewport(view),
        };
      },
      applySnapshot(snapshot: EditorSnapshotApplyRequest) {
        const view = viewRef.current;
        if (!view) return;

        // Line-count-based restore is the preferred path (see
        // EditorViewportLines's own doc comment in EditorContract.ts) --
        // topBoundaryLines/bottomBoundaryLines are ignored here (0 until the
        // boundary UI lands), only scrollTopLines is applied.
        if (snapshot.viewportLines) {
          view.scrollDOM.scrollTo({ top: Math.max(0, Math.round(snapshot.viewportLines.scrollTopLines) * lineHeightPxRef.current), behavior: 'auto' });
        } else if (snapshot.viewport && typeof snapshot.viewport.scrollTopPx === 'number') {
          view.scrollDOM.scrollTo({ top: Math.max(0, snapshot.viewport.scrollTopPx), behavior: 'auto' });
        }

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
    // lineHeightPx/cellWidthPx read via refs (kept current by the effect
    // above), not closed over directly, so they're deliberately not deps.
  }, [adapterRef]);

  return (
    <div
      ref={containerRef}
      className="cm6-editor-root"
      style={{
        position: 'absolute',
        inset: 0,
        // No overflow of its own -- the EditorView.theme() above makes
        // .cm-editor fill this container, so .cm-scroller (a child of
        // .cm-editor) is the one real scrolling element, per CM6's own
        // integration contract. This container previously had its own
        // `overflow: auto`, which was silently doing the real scrolling
        // instead of CM6's own scroller ever since slice 1 -- see the
        // EditorView.theme() comment above for how this was found.
        overflow: 'hidden',
        fontFamily,
        fontSize: fontSizePx,
        lineHeight: `${lineHeightPx}px`,
      }}
    />
  );
}
