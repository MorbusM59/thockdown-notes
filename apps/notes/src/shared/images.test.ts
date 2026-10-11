import { describe, expect, it } from 'vitest'
import { imageReferencesIn, renameImageReferences } from './images'

describe('renameImageReferences', () => {
  it('rewrites every reference to the id, in any case and bracket form, and nothing else', () => {
    expect(renameImageReferences('![a](&logo "12em") ![b](<&LOGO>) ![c](&LOGO-2) &LOGO', '&LOGO', '&BRAND'))
      .toBe('![a](&BRAND "12em") ![b](<&BRAND>) ![c](&LOGO-2) &LOGO')
    expect(renameImageReferences('![a](&OTHER)', '&LOGO', '&BRAND')).toBeNull()
  })
})

describe('imageReferencesIn', () => {
  it('ignores references written inside inline code', () => {
    expect(imageReferencesIn('It is inserted as `![name](&1)`, see ![x](&2) and ``![y](&3)``.')).toEqual(['&2'])
    expect(renameImageReferences('`![a](&1)` ![b](&1)', '&1', '&X')).toBe('`![a](&1)` ![b](&X)')
  })
})
