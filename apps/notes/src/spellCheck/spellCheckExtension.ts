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
 * queued to the worker and drawn once its answer arrives. The word the caret
 * is in or touching is left alone while it is being typed: it would be wrong
 * after every letter but the last.
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
 */
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
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

type Range = { from: number; to: number };
type Box = { left: number; top: number; width: number; height: number };

const quantizeToPhase = (value: number, unit: number, phase: number) => phase + Math.round((value - phase) / unit) * unit;

export function spellCheckExtension(options: SpellCheckExtensionOptions): Extension {
  return ViewPlugin.fromClass(class {
    misspelled: Range[] = [];
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
      if (update.docChanged) {
        let firstChange = Infinity;
        update.changes.iterChangedRanges((fromA) => { firstChange = Math.min(firstChange, fromA); });
        for (const lineFrom of [...this.fenceAt.keys()]) {
          if (lineFrom >= firstChange) this.fenceAt.delete(lineFrom);
        }
      }
      const moved = update.docChanged || update.viewportChanged || update.geometryChanged;
      // A caret move alone changes only which word is exempt as being typed.
      if (moved || update.selectionSet) this.recompute(moved);
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

    /** `moved`: the boxes' positions may have changed even where the misspelled ranges did not. */
    recompute(moved: boolean) {
      const { state } = this.view;
      const selection = state.selection.main;
      const caret = selection.empty ? selection.head : -1;
      const misspelled: Range[] = [];
      for (const { from, to } of this.view.visibleRanges) {
        const first = state.doc.lineAt(from);
        let inFence = this.startsInFence(first.from, first.to);
        for (let pos = first.from; pos <= to;) {
          const line = state.doc.lineAt(pos);
          if (isFenceLine(line.text)) {
            inFence = !inFence;
          } else if (!inFence) {
            for (const word of wordsOnLine(line.text)) {
              const wordFrom = line.from + word.from;
              const wordTo = line.from + word.to;
              if (caret >= wordFrom && caret <= wordTo) continue;
              if (spellCheckClient.lookup(word.word) !== true) continue;
              const letters = spellCheckClient.marksFor(word.word);
              if (!letters) misspelled.push({ from: wordFrom, to: wordTo });
              else for (const mark of letters) misspelled.push({ from: wordFrom + mark.from, to: wordFrom + mark.to });
            }
          }
          pos = line.to + 1;
        }
      }
      const unchanged = misspelled.length === this.misspelled.length
        && misspelled.every((range, index) => range.from === this.misspelled[index].from && range.to === this.misspelled[index].to);
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
      for (const { from, to } of this.misspelled) {
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
        boxes.push({ left, top, width: right - left + 1, height: lineHeightPx + 1 });
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
        const { style } = this.boxes[index];
        style.transform = `translate(${box.left}px, ${box.top}px)`;
        style.width = `${box.width}px`;
        style.height = `${box.height}px`;
      });
    }

    destroy() {
      this.unsubscribe();
      for (const element of this.boxes) element.remove();
      this.boxes = [];
    }
  });
}
