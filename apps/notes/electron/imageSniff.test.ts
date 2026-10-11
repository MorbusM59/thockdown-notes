import { describe, expect, it } from 'vitest'
import { sniffImage } from './imageSniff'

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part)))

describe('sniffImage', () => {
  it('reads a PNG header', () => {
    const png = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR', [0, 0, 1, 0, 0, 0, 0, 200])
    expect(sniffImage(png)).toEqual({ mime: 'image/png', width: 256, height: 200 })
  })
  it('reads a JPEG frame past an APP0 segment', () => {
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 50, 0, 80])
    expect(sniffImage(jpeg)).toEqual({ mime: 'image/jpeg', width: 80, height: 50 })
  })
  it('reads a GIF', () => {
    expect(sniffImage(bytes('GIF89a', [10, 0, 20, 0]))).toEqual({ mime: 'image/gif', width: 10, height: 20 })
  })
  it('reads an SVG size from its attributes or viewBox, and refuses text that is not one', () => {
    const svg = (s: string) => sniffImage(new TextEncoder().encode(s))
    expect(svg('<?xml version="1.0"?>\n<svg width="40" height="30"></svg>')).toEqual({ mime: 'image/svg+xml', width: 40, height: 30 })
    expect(svg('<svg viewBox="0 0 100 50"/>')).toEqual({ mime: 'image/svg+xml', width: 100, height: 50 })
    expect(svg('<html><svg/></html>')).toBeNull()
    expect(svg('# just a note')).toBeNull()
  })
  it('refuses anything else', () => {
    expect(sniffImage(bytes('%PDF-1.7 ...........................'))).toBeNull()
  })
})
