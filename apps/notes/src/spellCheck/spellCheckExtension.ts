/*
 * Spell checking in the editor: misspelled words on screen get an outline on
 * the grid lines around their boxes, in the layout's Spell Checking Outline
 * Color (`--color-spell-check`).
 *
 * WHAT IS CHECKED is what is on screen: CM6's `visibleRanges`, recomputed on
 * every update that can change them (an edit, a scroll, a caret move, a
 * layout change). Words come from `spellCheckWords.ts`; answers from the
 * shared cache in `spellCheckClient.ts`, so a recompute is a tokenizer pass
 * over a screenful of text plus a Map read per word. A word not yet known is
 * queued to the worker and drawn once its answer arrives. The word being
 * TYPED is left alone: the caret is in or touching it and the latest edit
 * was made there by the reader's own typing (`editedAt`), since it would be
 * wrong after every letter but the last. The caret leaving that word ends
 * it, so coming back into a word later changes nothing: an outlined word
 * stays outlined until it is edited, and is checked again once left.
 *
 * Fenced code blocks: whether the first visible line is inside one depends on
 * everything above it, so that answer is cached per visible range start
 * until an edit lands above it (`startsInFence`); the lines below it follow
 * the fences they cross.
 *
 * WHERE IT IS DRAWN is not a CM6 decoration. A mark would style the text's
 * inline box, which is the font's height rather than the grid's row, and
 * would sit under the grid lines the editor paints above its text. The
 * outlines are boxes in the scroll-following overlay layer the typing trail
 * lives in (`host`), placed with the same grid quantization as the caret and
 * the trail, one element per marked range, reused between draws.
 *
 * WHAT IS OUTLINED is the whole misspelled word, or, once the worker has
 * a suggestion that locates the typo (the top one when it is one edit away,
 * or the only one), only the letters that differ from it
 * (`typoMarks.ts`), so a typo is pinpointed rather than its word.
 *
 * TAKING A SUGGESTION (Shift+Space, `spellSuggest`) swaps the nearest
 * misspelled word before the caret, among the words on screen, for its best
 * suggestion, and enters SUGGESTION MODE: the word and the space on either
 * side of it are outlined (`is-suggestion`), and each further Shift+Space
 * puts the next suggestion in its place, the original coming back after the
 * last. Any other key, any press of a mouse button anywhere, and any change
 * to the note or the caret that is not a swap ends the mode, leaving the
 * word as it stands. A swap is its own undo step and is not typing, so it
 * neither exempts the word nor is exempted.
 */
import { Annotation, Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { matchShortcut } from '../shared/keyboardShortcuts';
import { isOffsetInFencedCodeBlock } from '../editor/MarkdownContext';
import { spellCheckClient } from './spellCheckClient';
import { inFenceAfter, isFenceLine, wordsOnLine } from './spellCheckWords';

export type SpellCheckGrid = { lineHeightPx: number; cellWidthPx: number };

export type SpellCheckExtensionOptions = {
  /** The editor's current row height and cell width. */
  readGrid: () => SpellCheckGrid;
  /** The element the outlines are drawn into, positioned in the scroller's content coordinates. */
  host: () => HTMLElement | null;
};

type Range = { from: number; to: number; suggestion?: boolean };
type Box = { left: number; top: number; width: number; height: number; suggestion: boolean };
type VisibleWord = { word: string; from: number; to: number };
/** The word in suggestion mode: where it is, what was typed, and which suggestion stands (-1: the original). */
type Suggesting = { from: number; to: number; original: string; suggestions: readonly string[]; index: number; caret: number };

/** Marks the transactions that swap a suggestion in, which do not end suggestion mode. */
const suggestionSwap = Annotation.define<true>();
/** How many words not yet checked are asked about, nearest first, before giving up. */
const MAX_UNKNOWN_ASKED = 6;

const quantizeToPhase = (value: number, unit: number, phase: number) => phase + Math.round((value - phase) / unit) * unit;

export function spellCheckExtension(options: SpellCheckExtensionOptions): Extension {
  const plugin = ViewPlugin.fromClass(class {
    misspelled: Range[] = [];
    suggesting: Suggesting | null = null;
    /** Bumped by everything that ends the mode or starts a search, so a search answered late is dropped. */
    suggestTicket = 0;
    endOnInput = (event: Event) => {
      if (event instanceof KeyboardEvent && (event.key === 'Shift' || matchShortcut(event, 'spellSuggest'))) return;
      this.endSuggesting();
    };
    /** Where the latest edit left the caret: the word around it is the one being typed. */
    editedAt = -1;
    /** Visible range start -> whether that line is inside a fenced code block. */
    fenceAt = new Map<number, boolean>();
    unsubscribe: () => void;
    boxes: HTMLElement[] = [];
    readonly measureKey = {};

    constructor(readonly view: EditorView) {
      spellCheckClient.ensureStarted();
      this.unsubscribe = spellCheckClient.subscribe(() => this.recompute(false));
      this.recompute(true);
    }

    update(update: ViewUpdate) {
      // The editor re-dispatches the selection after an edit, so a selection
      // only ends the mode when it moves the caret off where the swap left it.
      if (this.suggesting && update.transactions.some((tr) => !tr.annotation(suggestionSwap)
        && (tr.docChanged || (tr.selection && tr.selection.main.head !== this.suggesting?.caret)))) {
        this.endSuggesting();
      }
      if (update.docChanged) {
        let firstChange = Infinity;
        update.changes.iterChangedRanges((fromA) => { firstChange = Math.min(firstChange, fromA); });
        for (const lineFrom of [...this.fenceAt.keys()]) {
          if (lineFrom >= firstChange) this.fenceAt.delete(lineFrom);
        }
      }
      // Only the reader's own typing makes a word "being typed"; any other
      // change (another slot's edit, a transform) just moves the mark along.
      if (update.docChanged) {
        const typed = update.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'));
        this.editedAt = typed ? update.state.selection.main.head
          : this.editedAt < 0 ? -1 : update.changes.mapPos(this.editedAt);
      }
      // Leaving the word ends its exemption, so coming back to it later is a
      // revisit and not more typing.
      if (this.editedAt >= 0 && update.selectionSet && !this.inSameWord(update.state.selection.main.head, this.editedAt)) {
        this.editedAt = -1;
      }
      const moved = update.docChanged || update.viewportChanged || update.geometryChanged;
      // A caret move alone changes only which word is exempt as being typed.
      if (moved || update.selectionSet) this.recompute(moved);
    }

    /** True when nothing but letters and inner apostrophes lies between the two positions. */
    inSameWord(a: number, b: number): boolean {
      const { doc } = this.view.state;
      if (doc.lineAt(a).number !== doc.lineAt(b).number) return false;
      return /^[\p{L}\p{M}'’]*$/u.test(doc.sliceString(Math.min(a, b), Math.max(a, b)));
    }

    /**
     * Whether the line at `lineFrom` starts inside a fenced code block. The
     * first answer reads the document above it; later ones walk forward from
     * the nearest line already answered above, so scrolling through a note
     * costs the lines scrolled past rather than the whole prefix each time.
     */
    startsInFence(lineFrom: number, lineTo: number): boolean {
      const cached = this.fenceAt.get(lineFrom);
      if (cached !== undefined) return cached;
      let nearest = -1;
      for (const key of this.fenceAt.keys()) {
        if (key < lineFrom && key > nearest) nearest = key;
      }
      let inFence: boolean;
      if (nearest < 0) {
        inFence = lineFrom > 0 && isOffsetInFencedCodeBlock(this.view.state.doc.sliceString(0, lineTo), lineFrom, null);
      } else {
        const { doc } = this.view.state;
        const from = doc.lineAt(nearest).number;
        const to = doc.lineAt(lineFrom).number;
        inFence = inFenceAfter(this.fenceAt.get(nearest)!, (function* () {
          for (let number = from; number < to; number += 1) yield doc.line(number).text;
        })());
      }
      this.fenceAt.set(lineFrom, inFence);
      return inFence;
    }

    /** The checkable words on screen, in document order (code, links and the like left out). */
    *visibleWords(): Generator<VisibleWord> {
      const { state } = this.view;
      for (const { from, to } of this.view.visibleRanges) {
        const first = state.doc.lineAt(from);
        let inFence = this.startsInFence(first.from, first.to);
        for (let pos = first.from; pos <= to;) {
          const line = state.doc.lineAt(pos);
          if (isFenceLine(line.text)) {
            inFence = !inFence;
          } else if (!inFence) {
            for (const word of wordsOnLine(line.text)) yield { word: word.word, from: line.from + word.from, to: line.from + word.to };
          }
          pos = line.to + 1;
        }
      }
    }

    /** Shift+Space: the next suggestion when in suggestion mode, else the nearest misspelled word before the caret. */
    takeSuggestion() {
      if (this.suggesting) {
        const { suggestions, index } = this.suggesting;
        this.swapTo(index + 1 < suggestions.length ? index + 1 : -1);
        return;
      }
      void this.startSuggesting();
    }

    async startSuggesting() {
      const ticket = ++this.suggestTicket;
      const { doc } = this.view.state;
      const caret = this.view.state.selection.main.head;
      const before = [...this.visibleWords()].filter((word) => word.from < caret).reverse();
      let unknownAsked = 0;
      for (const candidate of before) {
        const known = spellCheckClient.lookup(candidate.word);
        if (known === false) continue;
        if (known === undefined && ++unknownAsked > MAX_UNKNOWN_ASKED) return;
        const answer = await spellCheckClient.suggestionsFor(candidate.word);
        // Anything the reader did meanwhile wins over a late answer.
        if (ticket !== this.suggestTicket || this.view.state.doc !== doc) return;
        if (!answer.misspelled || answer.suggestions.length === 0) continue;
        this.suggesting = { from: candidate.from, to: candidate.to, original: candidate.word, suggestions: answer.suggestions, index: -1, caret: -1 };
        window.addEventListener('keydown', this.endOnInput, true);
        window.addEventListener('pointerdown', this.endOnInput, true);
        this.swapTo(0);
        return;
      }
    }

    /** Puts suggestion `index` (-1: the original) in the word's place. */
    swapTo(index: number) {
      const mode = this.suggesting;
      if (!mode) return;
      const text = index < 0 ? mode.original : mode.suggestions[index];
      const head = this.view.state.selection.main.head;
      const to = mode.from + text.length;
      const delta = to - mode.to;
      // A caret after the word keeps its place in the text; one inside it goes to its end.
      const anchor = head >= mode.to ? head + delta : head > mode.from ? to : head;
      this.suggesting = { ...mode, to, index, caret: anchor };
      this.view.dispatch({
        changes: { from: mode.from, to: mode.to, insert: text },
        selection: { anchor },
        annotations: suggestionSwap.of(true),
        userEvent: 'spellSuggest',
      });
    }

    endSuggesting() {
      this.suggestTicket += 1;
      if (!this.suggesting) return;
      this.suggesting = null;
      window.removeEventListener('keydown', this.endOnInput, true);
      window.removeEventListener('pointerdown', this.endOnInput, true);
      this.recompute(false);
    }

    /** `moved`: the boxes' positions may have changed even where the misspelled ranges did not. */
    recompute(moved: boolean) {
      const { state } = this.view;
      const selection = state.selection.main;
      const caret = selection.empty ? selection.head : -1;
      const misspelled: Range[] = [];
      for (const { word, from: wordFrom, to: wordTo } of this.visibleWords()) {
        if (caret >= wordFrom && caret <= wordTo && this.editedAt >= wordFrom && this.editedAt <= wordTo) continue;
        if (spellCheckClient.lookup(word) !== true) continue;
        const letters = spellCheckClient.marksFor(word);
        if (!letters) misspelled.push({ from: wordFrom, to: wordTo });
        else for (const mark of letters) misspelled.push({ from: wordFrom + mark.from, to: wordFrom + mark.to });
      }
      if (this.suggesting) {
        const line = state.doc.lineAt(this.suggesting.from);
        misspelled.push({
          from: Math.max(line.from, this.suggesting.from - 1),
          to: Math.min(line.to, this.suggesting.to + 1),
          suggestion: true,
        });
      }
      const unchanged = misspelled.length === this.misspelled.length
        && misspelled.every((range, index) => range.from === this.misspelled[index].from && range.to === this.misspelled[index].to
          && range.suggestion === this.misspelled[index].suggestion);
      this.misspelled = misspelled;
      // Positions can move without the ranges changing (an edit above, a
      // scroll, a resize), so an unchanged list is redrawn on those too, and
      // only on those: a caret move that exempts no other word draws nothing.
      if (unchanged && (!moved || (misspelled.length === 0 && this.boxes.length === 0))) return;
      this.view.requestMeasure({ key: this.measureKey, read: () => this.measure(), write: (boxes) => this.draw(boxes) });
    }

    measure(): Box[] {
      const { view } = this;
      const { lineHeightPx, cellWidthPx: rawCellWidth } = options.readGrid();
      if (lineHeightPx <= 0) return [];
      const cellWidthPx = Math.max(1, rawCellWidth);
      const scroller = view.scrollDOM;
      const scrollerRect = scroller.getBoundingClientRect();
      const boxes: Box[] = [];
      for (const range of this.misspelled) {
        const { from, to } = range;
        const start = view.coordsAtPos(from, 1);
        const end = view.coordsAtPos(to, -1);
        if (!start || !end) continue;
        // A word broken across two rows by wrapping is not outlined.
        if (Math.abs(end.top - start.top) > lineHeightPx / 2) continue;
        const left = quantizeToPhase(start.left - scrollerRect.left, cellWidthPx, Math.round(cellWidthPx / 2));
        const right = quantizeToPhase(end.right - scrollerRect.left, cellWidthPx, Math.round(cellWidthPx / 2));
        const top = quantizeToPhase(start.top - scrollerRect.top + scroller.scrollTop, lineHeightPx, Math.round(lineHeightPx / 2));
        // One pixel past the far cell edge, so the border lands on the grid
        // line on both sides rather than inside the last cell.
        boxes.push({ left, top, width: right - left + 1, height: lineHeightPx + 1, suggestion: range.suggestion === true });
      }
      return boxes;
    }

    draw(boxes: Box[]) {
      const host = options.host();
      if (!host) return;
      while (this.boxes.length < boxes.length) {
        const element = document.createElement('div');
        element.className = 'thockdown-spell-outline';
        host.appendChild(element);
        this.boxes.push(element);
      }
      while (this.boxes.length > boxes.length) this.boxes.pop()?.remove();
      boxes.forEach((box, index) => {
        const element = this.boxes[index];
        element.classList.toggle('is-suggestion', box.suggestion);
        const { style } = element;
        style.transform = `translate(${box.left}px, ${box.top}px)`;
        style.width = `${box.width}px`;
        style.height = `${box.height}px`;
      });
    }

    destroy() {
      this.endSuggesting();
      this.unsubscribe();
      for (const element of this.boxes) element.remove();
      this.boxes = [];
    }
  });
  return [
    plugin,
    Prec.highest(EditorView.domEventHandlers({
      keydown(event, view) {
        if (!matchShortcut(event, 'spellSuggest')) return false;
        event.preventDefault();
        view.plugin(plugin)?.takeSuggestion();
        return true;
      },
    })),
  ];
}
