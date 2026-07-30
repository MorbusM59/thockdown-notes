// Phase 0 spike: is CodeMirror 6's viewport virtualization + rope document
// model enough, on its own, to hit near-instant keystroke latency on a
// multi-million-character markdown document -- BEFORE any app integration
// work. Deliberately outside src/, not wired into the app, throwaway.
//
// The line-classification logic below is a direct line-by-line port of
// src/plugins/SyntaxHighlightPlugin.tsx's buildTokenPresentation, so this
// spike's decoration cost is honestly representative of what the real app
// currently computes per line, not a simplified strawman.
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import { EditorView, Decoration, ViewPlugin, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

function isMarkdownThematicBreak(line) {
  const trimmed = line.trim()
  if (trimmed.length < 3) return false
  return /^([*_-])(?:\s*\1){2,}$/.test(trimmed)
}
const isMarkdownFence = (line) => /^\s{0,3}(?:`{3,}|~{3,})/.test(line)
const isMarkdownTableDivider = (line) => /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line)
const isMarkdownTableRow = (line) => {
  if (isMarkdownTableDivider(line)) return false
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.includes('|')
}
const isMarkdownSetextUnderline = (line) => /^\s{0,3}(?:=+|-+)\s*$/.test(line)

// Direct port of buildTokenPresentation -- returns a CSS class or null,
// same branch order/logic as the real classifier, minus the data-attribute
// bookkeeping (irrelevant to cost; the regex work is what's being measured).
function classifyLine(raw) {
  if (raw.length === 0) return 'tk-blank'
  if (isMarkdownThematicBreak(raw)) return 'tk-thematic-break'
  if (isMarkdownFence(raw)) return 'tk-code-fence'
  if (isMarkdownTableDivider(raw)) return 'tk-table-divider'
  if (isMarkdownTableRow(raw)) return 'tk-table-row'
  if (isMarkdownSetextUnderline(raw)) return 'tk-setext-underline'

  const leadingSpaceMatch = raw.match(/^(\s*)/)
  const leadingSpaces = leadingSpaceMatch ? leadingSpaceMatch[1].length : 0
  let rest = raw.slice(leadingSpaces)
  let quoteDepth = 0
  while (rest.startsWith('>')) {
    quoteDepth += 1
    rest = rest.slice(1)
    if (rest.startsWith(' ')) rest = rest.slice(1)
  }

  const headingMatch = rest.match(/^(#{1,6})\s+(.*)$/)
  if (headingMatch) return 'tk-heading'

  const taskMatch = rest.match(/^([-*+])\s+\[([ xX])\]\s+(.*)$/)
  if (taskMatch) return 'tk-list'

  const unorderedListMatch = rest.match(/^([-*+])\s+(.*)$/)
  if (unorderedListMatch) return 'tk-list'

  const orderedListMatch = rest.match(/^(\d+)([.)])\s+(.*)$/)
  if (orderedListMatch) return 'tk-list'

  if (quoteDepth > 0) return 'tk-blockquote'

  return null
}

// Only ever computes decorations for the currently visible viewport lines
// (plus whatever margin CM6's own viewport reporting includes) -- this is
// the specific claim being tested: that per-keystroke cost here is bound to
// the viewport, not the document.
const lineTokenPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.buildDecorations(view)
  }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view)
    }
  }
  buildDecorations(view) {
    const builder = new RangeSetBuilder()
    for (const { from, to } of view.visibleRanges) {
      let pos = from
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos)
        const cls = classifyLine(line.text)
        if (cls) {
          builder.add(line.from, line.from, Decoration.line({ class: cls }))
        }
        pos = line.to + 1
      }
    }
    return builder.finish()
  }
}, {
  decorations: (v) => v.decorations,
})

const view = new EditorView({
  state: EditorState.create({
    doc: '',
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      lineTokenPlugin,
      EditorView.lineWrapping,
    ],
  }),
  parent: document.getElementById('editor'),
})

// Driver-facing API -- mirrors the shape the app's own perf harness already
// expects (seed content, place caret, read stats) so the same measurement
// helpers (measureKeystrokeBurstMs, startCdpJsProfile, withCdpCategoryTrace)
// can drive this spike with zero changes.
window.__cm6Spike = {
  view,
  seed(text) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    })
  },
  placeCaretAtStart() {
    view.dispatch({ selection: { anchor: 0 } })
    view.scrollDOM.scrollTop = 0
    view.focus()
  },
  placeCaretAtEnd() {
    const end = view.state.doc.length
    view.dispatch({ selection: { anchor: end } })
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight
    view.focus()
  },
  docLength() {
    return view.state.doc.length
  },
}
