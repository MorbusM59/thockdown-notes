import { describe, expect, it } from 'vitest'
import { renameImageReferences } from './images'

describe('renameImageReferences', () => {
  it('rewrites every reference to the id, in any case and bracket form, and nothing else', () => {
    expect(renameImageReferences('![a](&logo "12em") ![b](<&LOGO>) ![c](&LOGO-2) &LOGO', '&LOGO', '&BRAND'))
      .toBe('![a](&BRAND "12em") ![b](<&BRAND>) ![c](&LOGO-2) &LOGO')
    expect(renameImageReferences('![a](&OTHER)', '&LOGO', '&BRAND')).toBeNull()
  })
})
