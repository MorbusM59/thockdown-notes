import { EditorSelection, EditorState, Transaction, type AnnotationType, type Extension } from '@codemirror/state'
import { isCanonicalInternalText, normalizeInternalText } from './TextPolicy'

/**
 * The document's canonical-text invariant, enforced at the one place every
 * ingress must pass through.
 *
 * The app's internal text model is canonical: no CR, no tab, no line/
 * paragraph separator, and every character exactly one cell of the grid
 * (`TextPolicy.ts`'s normalizeInternalText defines it). Note hydration already normalizes
 * (EditorSection.tsx), paste is sanitized (CM6Editor.tsx's paste handler),
 * and the save queue normalizes -- so the document was canonical in
 * practice, but only by the coincidence that every ingress had been handled
 * individually. CM6's own default drop handler was not, and neither would
 * be the next ingress someone adds.
 *
 * Enforcing it here makes canonicality a property of the document rather
 * than a habit of its callers, which is what lets every reader downstream
 * stop re-normalizing defensively. That mattered concretely: the five
 * EditorBindings transforms each ran normalizeInternalText over the WHOLE
 * document on every keystroke, and that call was not merely wasted work --
 * it was unsound. A transform is handed `selection` in *document*
 * coordinates; if normalization had ever changed anything before the caret
 * (a CRLF, a tab), every one of those offsets would have been stale against
 * the string the transform then read, so it would have edited the wrong
 * place. The call was only ever correct in exactly the case where it was a
 * no-op. EnterTransformPolicy.test.ts's old "normalizes tabs before
 * applying enter continuation semantics" case was that bug written down as
 * an expectation: it passed raw text containing a tab together with a
 * selection offset measured against the *normalized* string, and only
 * produced the asserted result because the mismatched offset happened to
 * clamp to the end of the line.
 *
 * Cost: one allocation-free regex scan per inserted fragment
 * (isCanonicalInternalText), i.e. proportional to what was typed or
 * dropped, never to the document. In the overwhelmingly common case -- a
 * canonical insert -- the transaction is returned untouched.
 *
 * When it does fire, the replacement selection is placed after the last
 * normalized insert. Deliberate: normalization changes lengths, so the
 * incoming transaction's own selection is meaningless against the rewritten
 * changes. Every realistic trigger is a single-range insertion (a drop, an
 * IME commit of non-canonical text), where "end of what was just inserted"
 * is exactly right.
 *
 * `hydrationAnnotation` is forwarded rather than imported because CM6
 * exposes no way to enumerate a transaction's annotations, so a filter that
 * rewrites a transaction has to re-attach by name whatever the app reads
 * back later. Only two are load-bearing here: CM6's own `userEvent` (undo
 * grouping, input handling) and the caller's programmatic-hydration marker.
 * Hydration text is normalized before dispatch, so a hydration transaction
 * cannot actually reach the rewrite branch today -- it is forwarded so that
 * stays true if that ever changes, not because it fires now.
 */
export function createCanonicalTextFilter(hydrationAnnotation: AnnotationType<true>): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr

    let needsNormalization = false
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (needsNormalization || inserted.length === 0) return
      if (!isCanonicalInternalText(inserted.toString())) {
        needsNormalization = true
      }
    })

    if (!needsNormalization) return tr

    const userEvent = tr.annotation(Transaction.userEvent)
    const isHydration = tr.annotation(hydrationAnnotation)

    const changes: { from: number; to: number; insert: string }[] = []
    let caret = tr.newSelection.main.head
    let delta = 0
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      // A BOM at the start of an inserted fragment is stripped too, not only
      // one at document offset 0. A deliberate widening of
      // normalizeInternalText's rule: a stray BOM arriving mid-document is
      // invisible junk in every case this app has, and preserving it would
      // mean carrying a second normalization variant to express that.
      const normalized = inserted.length === 0 ? '' : normalizeInternalText(inserted.toString())
      changes.push({ from: fromA, to: toA, insert: normalized })
      // fromA is in start-state coordinates; `delta` carries the length
      // change of every earlier range in this same transaction, which is
      // what maps it into the resulting document.
      caret = fromA + delta + normalized.length
      delta += normalized.length - (toA - fromA)
    })

    return {
      changes,
      selection: EditorSelection.cursor(caret),
      scrollIntoView: tr.scrollIntoView,
      effects: tr.effects,
      ...(userEvent ? { userEvent } : {}),
      ...(isHydration ? { annotations: hydrationAnnotation.of(true) } : {}),
    }
  })
}
