import { isSingleCellText, singleCellText } from '../shared/singleCellText';

/**
 * The app's canonical internal text: LF line endings, no tab, no line or
 * paragraph separator -- and every character exactly one cell of the
 * monospace grid (shared/singleCellText.ts), which also removes a BOM wherever
 * it stands, being a zero-width character. Tabs become spaces BEFORE the
 * single-cell rule runs, which would otherwise drop them as control
 * characters.
 */
export function normalizeInternalText(input: string): string {
  return singleCellText(input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\t/g, '   '));
}

/**
 * The characters normalizeInternalText rewrites before the single-cell rule;
 * everything that rule removes is checked by isSingleCellText.
 */
const NON_CANONICAL_CHARS = /[\r\t\u2028\u2029]/;

/**
 * True exactly when normalizeInternalText(input) === input -- i.e. when the
 * text is already in the app's canonical internal form.
 *
 * Exists so canonicality can be *enforced at ingress and then assumed*,
 * rather than re-established defensively on every read. A single native
 * regex scan with no allocation is what makes that affordable at the one
 * place it has to run (CM6Editor.tsx's canonical-text transaction filter);
 * normalizeInternalText itself runs four passes and allocates an
 * intermediate string per pass, so calling it "just in case" on a hot path
 * costs the whole document per keystroke to produce, almost always, a
 * character-for-character copy of its own input.
 */
export function isCanonicalInternalText(input: string): boolean {
  if (!input) return true;
  return !NON_CANONICAL_CHARS.test(input) && isSingleCellText(input);
}

