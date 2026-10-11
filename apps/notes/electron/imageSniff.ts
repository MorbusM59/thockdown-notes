// WHAT AN IMAGE IS, read from its bytes: the format and the intrinsic size.
//
// The bytes decide, never a file extension or a server's content type: an
// image is stored only if its first bytes say it is one of the formats a
// browser draws in an <img>, and that is also the type it is served with.
// The size is read here so the preview can reserve the image's box before it
// loads (0 when the format does not say, e.g. an SVG with neither width,
// height nor viewBox).
//
// SVG is accepted because an SVG drawn through <img> runs no script and
// loads nothing; it must never be inlined into the page as markup.

export interface SniffedImage {
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif' | 'image/svg+xml'
  width: number
  height: number
}

const ascii = (bytes: Uint8Array, from: number, length: number) =>
  String.fromCharCode(...bytes.subarray(from, from + length))

function u16be(b: Uint8Array, i: number) { return (b[i] << 8) | b[i + 1] }
function u16le(b: Uint8Array, i: number) { return b[i] | (b[i + 1] << 8) }
function u24le(b: Uint8Array, i: number) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) }
function u32be(b: Uint8Array, i: number) { return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) }

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length >= 24 && u32be(bytes, 0) === 0x89504e47 && ascii(bytes, 12, 4) === 'IHDR') {
    return { mime: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ...jpegSize(bytes) }
  }
  if (bytes.length >= 10 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    return { mime: 'image/gif', width: u16le(bytes, 6), height: u16le(bytes, 8) }
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { mime: 'image/webp', ...webpSize(bytes) }
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp' && /^avi[fs]$/.test(ascii(bytes, 8, 4))) {
    return { mime: 'image/avif', ...avifSize(bytes) }
  }
  return svgOf(bytes)
}

const NO_SIZE = { width: 0, height: 0 }

function jpegSize(b: Uint8Array): { width: number; height: number } {
  let i = 2
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) return NO_SIZE
    const marker = b[i + 1]
    if (marker === 0xff) { i += 1; continue }
    // Start-of-frame markers carry the size; C4, C8 and CC are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) }
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue }
    i += 2 + u16be(b, i + 2)
  }
  return NO_SIZE
}

function webpSize(b: Uint8Array): { width: number; height: number } {
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8X') return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) }
  if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  if (chunk === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
  }
  return NO_SIZE
}

function avifSize(b: Uint8Array): { width: number; height: number } {
  // The image spatial extents property: 'ispe', 4 bytes of version and
  // flags, then width and height. The first one is the primary image's in
  // every encoder in use; reading the item graph for it is not worth it for
  // a box that is only a reservation.
  for (let i = 0; i + 16 <= b.length && i < 4096; i += 1) {
    if (b[i] === 0x69 && ascii(b, i, 4) === 'ispe') return { width: u32be(b, i + 8), height: u32be(b, i + 12) }
  }
  return NO_SIZE
}

function svgOf(bytes: Uint8Array): SniffedImage | null {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, '').trimStart()
  if (!head.startsWith('<')) return null
  const tag = /<svg\b[^>]*>/i.exec(head)
  if (!tag) return null
  // Only an XML prolog, comments and a doctype may come before the <svg>.
  const before = head.slice(0, tag.index).replace(/<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/gi, '').trim()
  if (before.length > 0) return null
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag[0])?.[1] ?? null
  const pixels = (value: string | null) => {
    const match = value ? /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(value) : null
    return match ? Math.round(Number(match[1])) : 0
  }
  let width = pixels(attribute('width'))
  let height = pixels(attribute('height'))
  const viewBox = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (viewBox && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    if (!width && !height) { width = Math.round(viewBox[2]); height = Math.round(viewBox[3]) }
    else if (!height) height = Math.round((width * viewBox[3]) / viewBox[2])
    else if (!width) width = Math.round((height * viewBox[2]) / viewBox[3])
  }
  if (!width || !height) return { mime: 'image/svg+xml', width: 0, height: 0 }
  return { mime: 'image/svg+xml', width, height }
}
