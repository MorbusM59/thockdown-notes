// Procedurally generates a monochrome retro-synthwave skyline (sun, ridge,
// palms, horizon) as an SVG, used purely as a CSS mask shape -- the visible
// "ink" is always whatever background sits behind it (the empty-state
// card's diagonal stripe texture), this file only decides where that
// texture is allowed to show through. Seeded off a stable string (the
// section id) so a given empty slot keeps the same scene across renders
// instead of reshuffling on every repaint.

function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStringToSeed(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0
  }
  return hash
}

const VIEWBOX = 200

function buildSun(rand: () => number): string {
  const cx = VIEWBOX * (0.32 + rand() * 0.36)
  const cy = VIEWBOX * (0.24 + rand() * 0.1)
  const r = VIEWBOX * (0.14 + rand() * 0.06)
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" />`
}

function buildRidge(rand: () => number, baseY: number): string {
  const points = [`0,${VIEWBOX}`, `0,${baseY.toFixed(1)}`]
  const segments = 5 + Math.floor(rand() * 3)
  for (let i = 0; i <= segments; i += 1) {
    const x = (VIEWBOX / segments) * i
    const y = baseY - rand() * VIEWBOX * 0.24
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  points.push(`${VIEWBOX},${baseY.toFixed(1)}`, `${VIEWBOX},${VIEWBOX}`)
  return `<polygon points="${points.join(' ')}" />`
}

function buildPalm(rand: () => number, x: number, baseY: number, scale: number): string {
  const trunkHeight = 58 * scale
  const lean = (rand() - 0.5) * 8 * scale
  const topX = x + lean
  const topY = baseY - trunkHeight
  const trunkWidth = 3.5 * scale
  const midX = x + lean * 0.5
  const midY = baseY - trunkHeight * 0.5

  const trunk = `<path d="M ${(x - trunkWidth / 2).toFixed(1)},${baseY.toFixed(1)}
    Q ${midX.toFixed(1)},${midY.toFixed(1)} ${topX.toFixed(1)},${topY.toFixed(1)}
    L ${(topX + trunkWidth).toFixed(1)},${topY.toFixed(1)}
    Q ${(midX + trunkWidth).toFixed(1)},${midY.toFixed(1)} ${(x + trunkWidth / 2).toFixed(1)},${baseY.toFixed(1)} Z" />`

  const frondCount = 5 + Math.floor(rand() * 3)
  const fronds: string[] = []
  for (let i = 0; i < frondCount; i += 1) {
    const spread = Math.PI * 0.85
    const angle = -Math.PI / 2 + ((i / (frondCount - 1)) - 0.5) * spread + (rand() - 0.5) * 0.2
    const length = (20 + rand() * 12) * scale
    const width = (5 + rand() * 3) * scale
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    const tipX = topX + dirX * length
    const tipY = topY + dirY * length
    const perpX = -dirY * width * 0.5
    const perpY = dirX * width * 0.5
    const droopX = topX + dirX * length * 0.6
    const droopY = topY + dirY * length * 0.6 + length * 0.15
    fronds.push(`<path d="M ${(topX - perpX).toFixed(1)},${(topY - perpY).toFixed(1)}
      Q ${droopX.toFixed(1)},${droopY.toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)}
      Q ${droopX.toFixed(1)},${droopY.toFixed(1)} ${(topX + perpX).toFixed(1)},${(topY + perpY).toFixed(1)} Z" />`)
  }

  return trunk + fronds.join('')
}

function generateSceneSvg(seed: string): string {
  const rand = mulberry32(hashStringToSeed(seed))
  const horizonY = VIEWBOX * 0.66

  const sun = buildSun(rand)
  const ridge = buildRidge(rand, horizonY)
  const horizonLine = `<rect x="0" y="${horizonY.toFixed(1)}" width="${VIEWBOX}" height="1.5" />`

  // Palms plant their base right on the horizon and grow upward into the
  // sky, standing out in silhouette against the open area above the
  // ground/ridge fill -- rooting them below the horizon would bury the
  // trunk in that same solid fill and leave only the frond tips visible.
  const palmCount = 2 + Math.floor(rand() * 2)
  const palms: string[] = []
  for (let i = 0; i < palmCount; i += 1) {
    const x = VIEWBOX * (0.15 + rand() * 0.7)
    const scale = 0.8 + rand() * 0.6
    palms.push(buildPalm(rand, x, horizonY, scale))
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}"><g fill="black">${sun}${ridge}${horizonLine}${palms.join('')}</g></svg>`
}

const maskUrlCache = new Map<string, string>()

/** CSS `mask-image`-ready `url(...)` for a scene seeded off `seed` -- cached so repeated lookups for the same seed (e.g. re-renders) don't regenerate or re-encode the SVG. */
export function getEmptyStateSceneMaskUrl(seed: string): string {
  const cached = maskUrlCache.get(seed)
  if (cached) return cached

  const svg = generateSceneSvg(seed)
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')
  const url = `url("data:image/svg+xml,${encoded}")`
  maskUrlCache.set(seed, url)
  return url
}
