import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARET_BLINK_EASING_CONTROL_POINTS } from '@thockdown/look/caretSettings'

// The desktop stylesheet animates the caret with the curve the shared caret
// settings sample, so this check lives with the stylesheet, not the package.
describe('easing agreement with the stylesheet', () => {
  it('samples the same curve index.css animates with', () => {
    // The unquantized path leaves easing to the browser and the baked path
    // samples it here, so the two must be the same curve or the frame slider
    // would change the blink's shape as well as its smoothness.
    const css = readFileSync(path.join(__dirname, 'index.css'), 'utf8')
    const caretRule = css.slice(css.indexOf('.thockdown-block-caret {'))
    const animation = caretRule.slice(0, caretRule.indexOf('}')).match(/animation:[^;]+;/)![0]
    const [x1, y1, x2, y2] = CARET_BLINK_EASING_CONTROL_POINTS
    expect(animation).toContain(`cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`)
  })
})
