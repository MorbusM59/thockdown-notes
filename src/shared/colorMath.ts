export type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

export type HsvaColor = {
  h: number
  s: number
  v: number
  a: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampColorChannel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function clampAlphaChannel(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

export function parseCssColorToRgba(color: string): RgbaColor | null {
  const raw = color.trim()
  if (!raw) return null

  const hexMatch = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  if (hexMatch) {
    const value = hexMatch[1]
    if (value.length === 3 || value.length === 4) {
      const r = Number.parseInt(value[0] + value[0], 16)
      const g = Number.parseInt(value[1] + value[1], 16)
      const b = Number.parseInt(value[2] + value[2], 16)
      const a = value.length === 4 ? Number.parseInt(value[3] + value[3], 16) / 255 : 1
      return { r, g, b, a }
    }

    const r = Number.parseInt(value.slice(0, 2), 16)
    const g = Number.parseInt(value.slice(2, 4), 16)
    const b = Number.parseInt(value.slice(4, 6), 16)
    const a = value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }

  const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/i)
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim())
    if (parts.length !== 3 && parts.length !== 4) return null

    const r = clampColorChannel(Number.parseFloat(parts[0]))
    const g = clampColorChannel(Number.parseFloat(parts[1]))
    const b = clampColorChannel(Number.parseFloat(parts[2]))
    const a = parts.length === 4 ? clampAlphaChannel(Number.parseFloat(parts[3])) : 1
    return { r, g, b, a }
  }

  return null
}

export function rgbaToCssColor(color: RgbaColor): string {
  const alpha = Number(clampAlphaChannel(color.a).toFixed(3))
  return `rgba(${clampColorChannel(color.r)}, ${clampColorChannel(color.g)}, ${clampColorChannel(color.b)}, ${alpha})`
}

export function rgbaToHex(color: RgbaColor): string {
  const r = clampColorChannel(color.r).toString(16).padStart(2, '0').toUpperCase()
  const g = clampColorChannel(color.g).toString(16).padStart(2, '0').toUpperCase()
  const b = clampColorChannel(color.b).toString(16).padStart(2, '0').toUpperCase()
  const a = clampColorChannel(Math.round(clampAlphaChannel(color.a) * 255)).toString(16).padStart(2, '0').toUpperCase()
  return `#${r}${g}${b}${a}`
}

export function invertRgbaColor(color: RgbaColor, alphaScale = 1): RgbaColor {
  return {
    r: 255 - clampColorChannel(color.r),
    g: 255 - clampColorChannel(color.g),
    b: 255 - clampColorChannel(color.b),
    a: clamp(color.a * alphaScale, 0, 1),
  }
}

export function rgbaToHsva(color: RgbaColor): HsvaColor {
  const r = clampColorChannel(color.r) / 255
  const g = clampColorChannel(color.g) / 255
  const b = clampColorChannel(color.b) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  const s = max === 0 ? 0 : delta / max
  const v = max

  return {
    h,
    s,
    v,
    a: clampAlphaChannel(color.a),
  }
}

export function hsvaToRgba(color: HsvaColor): RgbaColor {
  const h = ((color.h % 360) + 360) % 360
  const s = Math.max(0, Math.min(1, color.s))
  const v = Math.max(0, Math.min(1, color.v))

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let rPrime = 0
  let gPrime = 0
  let bPrime = 0

  if (h < 60) {
    rPrime = c
    gPrime = x
  } else if (h < 120) {
    rPrime = x
    gPrime = c
  } else if (h < 180) {
    gPrime = c
    bPrime = x
  } else if (h < 240) {
    gPrime = x
    bPrime = c
  } else if (h < 300) {
    rPrime = x
    bPrime = c
  } else {
    rPrime = c
    bPrime = x
  }

  return {
    r: clampColorChannel((rPrime + m) * 255),
    g: clampColorChannel((gPrime + m) * 255),
    b: clampColorChannel((bPrime + m) * 255),
    a: clampAlphaChannel(color.a),
  }
}
