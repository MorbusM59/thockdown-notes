/**
 * Collapses the blank-line run left behind at a cut seam down to at most one
 * blank line (matching normal paragraph spacing) -- cutting a paragraph that
 * had a blank line on both sides would otherwise leave two blank lines
 * stacked where it used to sit. Never invents a separator where the
 * surrounding text had none, and drops the seam entirely when one side is
 * empty (cutting to the very start or end of the document).
 */
export function collapseSurgerySite(before: string, after: string): { text: string; seamPos: number } {
  const trailingNewlines = before.match(/\n*$/)?.[0].length ?? 0
  const leadingNewlines = after.match(/^\n*/)?.[0].length ?? 0
  const trimmedBefore = before.slice(0, before.length - trailingNewlines)
  const trimmedAfter = after.slice(leadingNewlines)

  if (trimmedBefore.length === 0 || trimmedAfter.length === 0) {
    return { text: trimmedBefore + trimmedAfter, seamPos: trimmedBefore.length }
  }

  const seamNewlines = Math.min(trailingNewlines + leadingNewlines, 2)
  const seam = '\n'.repeat(seamNewlines)
  return { text: trimmedBefore + seam + trimmedAfter, seamPos: trimmedBefore.length + seam.length }
}
