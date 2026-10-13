import { describe, expect, it } from 'vitest'
import { localImagePath, localImageSrc } from './localImages'

describe('local image paths', () => {
  it('reads Windows, UNC, POSIX and file: forms', () => {
    expect(localImagePath('C:\\Users\\a b\\x.jpeg')).toBe('C:\\Users\\a b\\x.jpeg')
    expect(localImagePath('\\\\nas\\photos\\x.png')).toBe('\\\\nas\\photos\\x.png')
    expect(localImagePath('/home/a/x.png')).toBe('/home/a/x.png')
    expect(localImagePath('file:///C:/a%20b/x.png')).toBe('C:/a b/x.png')
    expect(localImagePath('file:///home/a/x.png')).toBe('/home/a/x.png')
  })

  it('leaves web addresses, ids and relative paths alone', () => {
    expect(localImagePath('https://example.com/x.png')).toBeNull()
    expect(localImagePath('&LOGO')).toBeNull()
    expect(localImagePath('pics/x.png')).toBeNull()
  })

  it('addresses the file on the image scheme, the whole path as one segment', () => {
    expect(localImageSrc('C:\\a\\x.png')).toBe('thockdown-image://file/C%3A%5Ca%5Cx.png')
  })
})
