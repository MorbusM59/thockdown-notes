// Procedurally generates one of several monochrome vignette scenes (synthwave
// sunset, night city skyline, desert highway, alpine ridge, ocean horizon,
// starfield, pine forest, rolling dunes) as an SVG, used purely as a CSS mask
// shape -- the visible "ink" is always whatever background sits behind it
// (the empty-state card's diagonal stripe texture), this file only decides
// where that texture is allowed to show through. Punched-out details (window
// panes, moon craters, road-marking dashes) are cut with fill-rule="evenodd"
// compound paths, which reads as smooth card-background peeking through the
// textured silhouette. Seeded off a stable string (the section id) so a
// given empty slot keeps the same scene -- and the same archetype -- across
// renders instead of reshuffling on every repaint.

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

// ---------------------------------------------------------------------------
// Low-level path helpers
// ---------------------------------------------------------------------------

function rectPathD(x: number, y: number, w: number, h: number): string {
  return `M ${x.toFixed(1)},${y.toFixed(1)} H ${(x + w).toFixed(1)} V ${(y + h).toFixed(1)} H ${x.toFixed(1)} Z`
}

function circlePathD(cx: number, cy: number, r: number): string {
  return `M ${(cx + r).toFixed(1)},${cy.toFixed(1)} A ${r.toFixed(1)},${r.toFixed(1)} 0 1,0 ${(cx - r).toFixed(1)},${cy.toFixed(1)} A ${r.toFixed(1)},${r.toFixed(1)} 0 1,0 ${(cx + r).toFixed(1)},${cy.toFixed(1)} Z`
}

// ---------------------------------------------------------------------------
// Shared celestial body: the sun/moon/planet in every scene share one
// builder so "punch a hole in a circle" (crescent, craters) lives in a
// single place. `variants` is the pool a given scene is allowed to draw from.
// ---------------------------------------------------------------------------

type OrbVariant = 'plain' | 'striped' | 'crescent' | 'ringed' | 'cratered'

function buildOrb(rand: () => number, cx: number, cy: number, r: number, variants: OrbVariant[]): string {
  const variant = variants[Math.floor(rand() * variants.length)]

  if (variant === 'striped') {
    // Classic retro-sun cut lines: a handful of horizontal gaps punched
    // through the lower band of the disc.
    const stripeCount = 3 + Math.floor(rand() * 3)
    let path = circlePathD(cx, cy, r)
    const bandTop = cy - r * 0.1
    const bandBottom = cy + r * 1.05
    const unit = (bandBottom - bandTop) / (stripeCount * 2 - 1)
    for (let i = 0; i < stripeCount; i += 1) {
      const gapY = bandTop + unit * (i * 2 + 0.5)
      const gapH = unit * (0.55 + rand() * 0.3)
      path += ' ' + rectPathD(cx - r * 1.05, gapY, r * 2.1, gapH)
    }
    return `<path fill-rule="evenodd" d="${path}" />`
  }

  if (variant === 'crescent') {
    const offset = r * (0.3 + rand() * 0.35)
    const dir = rand() < 0.5 ? -1 : 1
    const path = circlePathD(cx, cy, r) + ' ' + circlePathD(cx + dir * offset, cy - r * 0.05, r * 0.94)
    return `<path fill-rule="evenodd" d="${path}" />`
  }

  if (variant === 'ringed') {
    const rx = r * (1.7 + rand() * 0.3)
    const ry = r * (0.4 + rand() * 0.15)
    const tilt = -22 + rand() * 10
    const strokeW = r * (0.16 + rand() * 0.08)
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" /><ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${tilt.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="none" stroke="black" stroke-width="${strokeW.toFixed(2)}" />`
  }

  if (variant === 'cratered') {
    const craterCount = 2 + Math.floor(rand() * 3)
    let path = circlePathD(cx, cy, r)
    for (let i = 0; i < craterCount; i += 1) {
      const angle = rand() * Math.PI * 2
      const dist = rand() * r * 0.55
      const craterR = r * (0.12 + rand() * 0.15)
      path += ' ' + circlePathD(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, craterR)
    }
    return `<path fill-rule="evenodd" d="${path}" />`
  }

  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" />`
}

// ---------------------------------------------------------------------------
// Ground / skyline silhouettes
// ---------------------------------------------------------------------------

/** Jagged (mountains) or smooth (dunes) horizon fill, from `baseY` down to the bottom edge. */
function buildRidge(rand: () => number, baseY: number, amplitudeFraction: number, segments: number, smooth: boolean): string {
  const points: Array<[number, number]> = []
  for (let i = 0; i <= segments; i += 1) {
    const x = (VIEWBOX / segments) * i
    const y = baseY - rand() * VIEWBOX * amplitudeFraction
    points.push([x, y])
  }

  let d = `M 0,${VIEWBOX} L 0,${points[0][1].toFixed(1)}`
  if (smooth) {
    for (let i = 1; i < points.length; i += 1) {
      const [px, py] = points[i - 1]
      const [x, y] = points[i]
      d += ` Q ${px.toFixed(1)},${py.toFixed(1)} ${((px + x) / 2).toFixed(1)},${((py + y) / 2).toFixed(1)}`
    }
    const [lastX, lastY] = points[points.length - 1]
    d += ` L ${lastX.toFixed(1)},${lastY.toFixed(1)}`
  } else {
    for (const [x, y] of points) d += ` L ${x.toFixed(1)},${y.toFixed(1)}`
  }
  d += ` L ${VIEWBOX},${baseY.toFixed(1)} L ${VIEWBOX},${VIEWBOX} Z`
  return `<path d="${d}" />`
}

/** A row of buildings, each its own evenodd path so its lit/unlit window grid can punch clean holes. */
function buildCitySkyline(rand: () => number, baseY: number): string {
  const parts: string[] = []
  let x = 0
  while (x < VIEWBOX) {
    const w = VIEWBOX * (0.05 + rand() * 0.09)
    const heightRatio = 0.12 + Math.pow(rand(), 1.4) * 0.5
    const h = VIEWBOX * heightRatio
    const y = baseY - h
    let path = rectPathD(x, y, w, h)

    if (rand() < 0.85) {
      const winW = w * 0.16
      const winGapX = w * 0.12
      const cols = Math.max(1, Math.floor(w / (winW + winGapX)))
      const rowH = VIEWBOX * 0.032
      const rowGap = VIEWBOX * 0.02
      const rows = Math.max(1, Math.floor((h * 0.78) / (rowH + rowGap)))
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (rand() < 0.32) continue
          const wx = x + winGapX * 0.7 + c * (winW + winGapX)
          const wy = y + rowH * 1.3 + r * (rowH + rowGap)
          if (wy + rowH < baseY - h * 0.06) {
            path += ' ' + rectPathD(wx, wy, winW, rowH)
          }
        }
      }
    }

    parts.push(`<path fill-rule="evenodd" d="${path}" />`)

    if (rand() < 0.22) {
      const spireX = x + w * 0.5
      const spireH = VIEWBOX * (0.03 + rand() * 0.05)
      parts.push(`<rect x="${(spireX - 0.6).toFixed(1)}" y="${(y - spireH).toFixed(1)}" width="1.2" height="${spireH.toFixed(1)}" />`)
    }

    x += w + VIEWBOX * 0.012
  }
  return parts.join('')
}

/** Perspective road converging toward a vanishing point near the horizon, with punched dash marks down the centerline. */
function buildRoad(rand: () => number, baseY: number): string {
  const vanishX = VIEWBOX * (0.42 + rand() * 0.16)
  const vanishY = baseY - VIEWBOX * (0.04 + rand() * 0.05)
  const bottomHalfWidth = VIEWBOX * (0.3 + rand() * 0.12)
  const topHalfWidth = VIEWBOX * 0.014

  let path = `M ${(vanishX - bottomHalfWidth).toFixed(1)},${VIEWBOX.toFixed(1)} L ${(vanishX - topHalfWidth).toFixed(1)},${vanishY.toFixed(1)} L ${(vanishX + topHalfWidth).toFixed(1)},${vanishY.toFixed(1)} L ${(vanishX + bottomHalfWidth).toFixed(1)},${VIEWBOX.toFixed(1)} Z`

  const dashCount = 5 + Math.floor(rand() * 3)
  for (let i = 0; i < dashCount; i += 1) {
    const t = (i + 0.5) / dashCount
    const halfW = topHalfWidth + (bottomHalfWidth - topHalfWidth) * t * t
    const yPos = vanishY + (VIEWBOX - vanishY) * t
    const dashH = ((VIEWBOX - vanishY) / dashCount) * 0.4 * (0.5 + t)
    const dashW = Math.max(0.8, halfW * 0.07)
    path += ' ' + rectPathD(vanishX - dashW / 2, yPos - dashH / 2, dashW, dashH)
  }
  return `<path fill-rule="evenodd" d="${path}" />`
}

/** Flat-topped desert butte. */
function buildMesa(rand: () => number, x: number, baseY: number, w: number, h: number): string {
  const topW = w * (0.5 + rand() * 0.3)
  const topY = baseY - h
  return `<path d="M ${(x - w / 2).toFixed(1)},${baseY.toFixed(1)} L ${(x - topW / 2).toFixed(1)},${topY.toFixed(1)} L ${(x + topW / 2).toFixed(1)},${topY.toFixed(1)} L ${(x + w / 2).toFixed(1)},${baseY.toFixed(1)} Z" />`
}

// ---------------------------------------------------------------------------
// Foreground props
// ---------------------------------------------------------------------------

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

/** Stacked-triangle conifer, rooted at the horizon like the palm so the trunk never buries in ground fill. */
function buildPine(rand: () => number, x: number, baseY: number, scale: number): string {
  const trunkH = 5 * scale
  const trunkW = 2.6 * scale
  let out = `<rect x="${(x - trunkW / 2).toFixed(1)}" y="${(baseY - trunkH).toFixed(1)}" width="${trunkW.toFixed(1)}" height="${trunkH.toFixed(1)}" />`

  const tiers = 2 + Math.floor(rand() * 2)
  const totalH = (30 + rand() * 22) * scale
  const tierH = totalH / tiers
  let topY = baseY - trunkH
  const width = 22 * scale
  for (let i = 0; i < tiers; i += 1) {
    const y0 = topY
    const y1 = topY - tierH * 1.2
    const w = width * (1 - i * 0.2)
    out += `<path d="M ${(x - w / 2).toFixed(1)},${y0.toFixed(1)} L ${x.toFixed(1)},${y1.toFixed(1)} L ${(x + w / 2).toFixed(1)},${y0.toFixed(1)} Z" />`
    topY = y0 - tierH * 0.65
  }
  return out
}

/** Saguaro cactus: a rounded trunk plus one or two elbowed arms, built from pill-shaped rects. */
function buildCactus(rand: () => number, x: number, baseY: number, scale: number): string {
  const trunkW = 7 * scale
  const trunkH = (34 + rand() * 22) * scale
  const topY = baseY - trunkH
  const tr = trunkW / 2
  let out = `<rect x="${(x - tr).toFixed(1)}" y="${topY.toFixed(1)}" width="${trunkW.toFixed(1)}" height="${trunkH.toFixed(1)}" rx="${tr.toFixed(1)}" />`

  const armCount = rand() < 0.55 ? 1 : 2
  const sides = armCount === 2 ? [-1, 1] : [rand() < 0.5 ? -1 : 1]
  for (const side of sides) {
    const elbowY = topY + trunkH * (0.28 + rand() * 0.3)
    const armW = trunkW * 0.78
    const ar = armW / 2
    const reach = trunkW * (1.6 + rand() * 1.5)
    const riserH = trunkH * (0.2 + rand() * 0.2)
    const outerX = x + side * (tr + reach)
    const elbowX = side > 0 ? x + side * tr : outerX
    const elbowW = reach + ar
    out += `<rect x="${elbowX.toFixed(1)}" y="${(elbowY - ar).toFixed(1)}" width="${elbowW.toFixed(1)}" height="${armW.toFixed(1)}" rx="${ar.toFixed(1)}" />`
    out += `<rect x="${(outerX - ar).toFixed(1)}" y="${(elbowY - riserH).toFixed(1)}" width="${armW.toFixed(1)}" height="${(riserH + ar).toFixed(1)}" rx="${ar.toFixed(1)}" />`
  }
  return out
}

function buildRoadSign(x: number, baseY: number, scale: number): string {
  const postH = 20 * scale
  const postW = 1.6 * scale
  const signW = 13 * scale
  const signH = 8 * scale
  return `<rect x="${(x - postW / 2).toFixed(1)}" y="${(baseY - postH).toFixed(1)}" width="${postW.toFixed(1)}" height="${postH.toFixed(1)}" />` +
    `<rect x="${(x - signW / 2).toFixed(1)}" y="${(baseY - postH - signH * 0.75).toFixed(1)}" width="${signW.toFixed(1)}" height="${signH.toFixed(1)}" rx="1.4" />`
}

function buildBoat(x: number, baseY: number, scale: number): string {
  const hullW = 17 * scale
  const hullH = 4.5 * scale
  const hull = `M ${(x - hullW / 2).toFixed(1)},${(baseY - hullH).toFixed(1)} L ${(x + hullW / 2).toFixed(1)},${(baseY - hullH).toFixed(1)} L ${(x + hullW * 0.32).toFixed(1)},${baseY.toFixed(1)} L ${(x - hullW * 0.32).toFixed(1)},${baseY.toFixed(1)} Z`
  const mastH = 20 * scale
  const sail = `M ${x.toFixed(1)},${(baseY - hullH).toFixed(1)} L ${x.toFixed(1)},${(baseY - hullH - mastH).toFixed(1)} L ${(x + mastH * 0.5).toFixed(1)},${(baseY - hullH).toFixed(1)} Z`
  return `<path d="${hull}" /><path d="${sail}" />`
}

// ---------------------------------------------------------------------------
// Ambient details
// ---------------------------------------------------------------------------

function buildStars(rand: () => number, count: number, xMin: number, xMax: number, yMin: number, yMax: number): string {
  const stars: string[] = []
  for (let i = 0; i < count; i += 1) {
    const x = xMin + rand() * (xMax - xMin)
    const y = yMin + rand() * (yMax - yMin)
    const r = 0.45 + rand() * rand() * 1.7
    stars.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" />`)
  }
  return stars.join('')
}

function buildWaveLine(rand: () => number, y: number, amplitude: number): string {
  const segs = 5 + Math.floor(rand() * 2)
  let d = `M 0,${y.toFixed(1)}`
  let prevX = 0
  let prevY = y
  for (let i = 1; i <= segs; i += 1) {
    const x = (VIEWBOX / segs) * i
    const yy = y + (rand() - 0.5) * 2 * amplitude
    const cx = (prevX + x) / 2
    const cy = prevY + (rand() - 0.5) * amplitude * 0.6
    d += ` Q ${cx.toFixed(1)},${cy.toFixed(1)} ${x.toFixed(1)},${yy.toFixed(1)}`
    prevX = x
    prevY = yy
  }
  return `<path d="${d}" fill="none" stroke="black" stroke-width="${(1 + rand() * 0.7).toFixed(2)}" stroke-linecap="round" />`
}

function buildBirdChevron(x: number, y: number, scale: number): string {
  const w = 6 * scale
  const h = w * 0.55
  return `<path d="M ${(x - w).toFixed(1)},${y.toFixed(1)} Q ${(x - w / 2).toFixed(1)},${(y - h).toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)} Q ${(x + w / 2).toFixed(1)},${(y - h).toFixed(1)} ${(x + w).toFixed(1)},${y.toFixed(1)}" fill="none" stroke="black" stroke-width="${(0.9 + scale * 0.3).toFixed(2)}" stroke-linecap="round" />`
}

function buildShootingStar(rand: () => number): string {
  const x1 = VIEWBOX * (0.08 + rand() * 0.28)
  const y1 = VIEWBOX * (0.06 + rand() * 0.16)
  const len = VIEWBOX * (0.16 + rand() * 0.12)
  const angle = Math.PI * (0.15 + rand() * 0.1)
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const headX = x1 + dx * len
  const headY = y1 + dy * len
  const px = -dy * 1.4
  const py = dx * 1.4
  const d = `M ${x1.toFixed(1)},${y1.toFixed(1)} L ${(headX + px).toFixed(1)},${(headY + py).toFixed(1)} L ${(headX - px).toFixed(1)},${(headY - py).toFixed(1)} Z`
  return `<path d="${d}" /><circle cx="${headX.toFixed(1)}" cy="${headY.toFixed(1)}" r="1.7" />`
}

// ---------------------------------------------------------------------------
// Scene archetypes -- one is picked per seed, each fully composed from the
// pieces above with its own randomized proportions.
// ---------------------------------------------------------------------------

function sceneSynthwave(rand: () => number): string {
  const horizonY = VIEWBOX * (0.6 + rand() * 0.08)
  const sunR = VIEWBOX * (0.13 + rand() * 0.07)
  const sunCx = VIEWBOX * (0.32 + rand() * 0.36)
  const sunCy = VIEWBOX * (0.22 + rand() * 0.12)
  const sun = buildOrb(rand, sunCx, sunCy, sunR, ['striped', 'plain'])
  const ridge = buildRidge(rand, horizonY, 0.05 + rand() * 0.06, 5 + Math.floor(rand() * 3), false)
  const horizonLine = `<rect x="0" y="${horizonY.toFixed(1)}" width="${VIEWBOX}" height="1.4" />`

  const palmCount = rand() < 0.3 ? 0 : 2 + Math.floor(rand() * 3)
  const palms: string[] = []
  for (let i = 0; i < palmCount; i += 1) {
    const x = VIEWBOX * (0.1 + rand() * 0.8)
    const scale = 0.7 + rand() * 0.9
    palms.push(buildPalm(rand, x, horizonY, scale))
  }

  const birdCount = rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 2)
  const birds: string[] = []
  for (let i = 0; i < birdCount; i += 1) {
    birds.push(buildBirdChevron(VIEWBOX * (0.1 + rand() * 0.8), VIEWBOX * (0.12 + rand() * 0.15), 0.8 + rand() * 0.6))
  }

  return sun + ridge + horizonLine + palms.join('') + birds.join('')
}

function sceneCityNight(rand: () => number): string {
  const horizonY = VIEWBOX * (0.68 + rand() * 0.06)
  const moonR = VIEWBOX * (0.07 + rand() * 0.05)
  const moonCx = VIEWBOX * (0.2 + rand() * 0.6)
  const moonCy = VIEWBOX * (0.14 + rand() * 0.12)
  const moon = buildOrb(rand, moonCx, moonCy, moonR, ['crescent', 'ringed', 'cratered', 'plain'])
  const stars = buildStars(rand, 4 + Math.floor(rand() * 8), 0, VIEWBOX, VIEWBOX * 0.05, horizonY * 0.7)
  const skyline = buildCitySkyline(rand, horizonY)
  const groundLine = `<rect x="0" y="${horizonY.toFixed(1)}" width="${VIEWBOX}" height="${(VIEWBOX - horizonY).toFixed(1)}" />`
  return moon + stars + skyline + groundLine
}

function sceneDesertHighway(rand: () => number): string {
  const horizonY = VIEWBOX * (0.62 + rand() * 0.06)
  const sunCx = VIEWBOX * (0.3 + rand() * 0.4)
  const sunCy = horizonY - VIEWBOX * (0.02 + rand() * 0.05)
  const sunR = VIEWBOX * (0.1 + rand() * 0.06)
  const sun = buildOrb(rand, sunCx, sunCy, sunR, ['striped', 'plain'])

  const mesaCount = Math.floor(rand() * 3)
  const mesas: string[] = []
  for (let i = 0; i < mesaCount; i += 1) {
    const x = VIEWBOX * (0.1 + rand() * 0.8)
    const w = VIEWBOX * (0.12 + rand() * 0.16)
    const h = VIEWBOX * (0.04 + rand() * 0.08)
    mesas.push(buildMesa(rand, x, horizonY, w, h))
  }

  const horizonLine = `<rect x="0" y="${horizonY.toFixed(1)}" width="${VIEWBOX}" height="1.2" />`
  const road = buildRoad(rand, horizonY + VIEWBOX * 0.01)

  const decorCount = 2 + Math.floor(rand() * 3)
  const decor: Array<{ depth: number; markup: string }> = []
  for (let i = 0; i < decorCount; i += 1) {
    const side = rand() < 0.5 ? -1 : 1
    const depth = rand()
    const baseYPos = horizonY + (VIEWBOX - horizonY) * (0.15 + depth * 0.85)
    const scale = 0.35 + depth * 0.85
    const x = VIEWBOX * 0.5 + side * (VIEWBOX * 0.16 + depth * VIEWBOX * 0.28)
    const markup = rand() < 0.7 ? buildCactus(rand, x, baseYPos, scale) : buildRoadSign(x, baseYPos, scale)
    decor.push({ depth, markup })
  }
  decor.sort((a, b) => a.depth - b.depth)

  return sun + mesas.join('') + horizonLine + road + decor.map(entry => entry.markup).join('')
}

function sceneAlpineRidge(rand: () => number): string {
  const isNight = rand() < 0.5
  const horizonY = VIEWBOX * (0.58 + rand() * 0.08)
  const orbR = VIEWBOX * (0.06 + rand() * 0.05)
  const orbCx = VIEWBOX * (0.25 + rand() * 0.5)
  const orbCy = VIEWBOX * (0.14 + rand() * 0.14)
  const orb = buildOrb(rand, orbCx, orbCy, orbR, isNight ? ['crescent', 'cratered', 'plain'] : ['striped', 'plain'])
  const stars = isNight ? buildStars(rand, 3 + Math.floor(rand() * 6), 0, VIEWBOX, VIEWBOX * 0.05, horizonY * 0.6) : ''

  const backRidge = buildRidge(rand, horizonY - VIEWBOX * 0.05, 0.14 + rand() * 0.05, 4 + Math.floor(rand() * 2), false)
  const frontRidge = buildRidge(rand, horizonY, 0.2 + rand() * 0.08, 4 + Math.floor(rand() * 2), false)

  const pineCount = 1 + Math.floor(rand() * 3)
  const pines: string[] = []
  for (let i = 0; i < pineCount; i += 1) {
    const x = VIEWBOX * (0.1 + rand() * 0.8)
    const scale = 0.6 + rand() * 1.1
    pines.push(buildPine(rand, x, horizonY + VIEWBOX * 0.02, scale))
  }

  return orb + stars + backRidge + frontRidge + pines.join('')
}

function sceneOceanHorizon(rand: () => number): string {
  const horizonY = VIEWBOX * (0.56 + rand() * 0.06)
  const isNight = rand() < 0.5
  const orbR = VIEWBOX * (0.11 + rand() * 0.06)
  const orbCx = VIEWBOX * (0.3 + rand() * 0.4)
  const orbCy = horizonY - VIEWBOX * (0.14 + rand() * 0.08)
  const orb = buildOrb(rand, orbCx, orbCy, orbR, isNight ? ['crescent', 'plain'] : ['striped', 'plain'])
  const horizonLine = `<rect x="0" y="${horizonY.toFixed(1)}" width="${VIEWBOX}" height="1.2" />`

  const shimmerCount = 4 + Math.floor(rand() * 3)
  const shimmer: string[] = []
  for (let i = 0; i < shimmerCount; i += 1) {
    const t = (i + 1) / (shimmerCount + 1)
    const y = orbCy + (horizonY - orbCy) * t + rand() * 2
    const w = 2 + (1 - t) * 6 + rand() * 2
    shimmer.push(`<rect x="${(orbCx - w / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="1.1" />`)
  }

  const waveCount = 2 + Math.floor(rand() * 2)
  const waves: string[] = []
  for (let i = 0; i < waveCount; i += 1) {
    const y = horizonY + VIEWBOX * (0.08 + i * 0.12 + rand() * 0.05)
    waves.push(buildWaveLine(rand, y, 1.5 + rand() * 1.5))
  }

  const boat = rand() < 0.55 ? buildBoat(VIEWBOX * (0.2 + rand() * 0.6), horizonY + VIEWBOX * 0.03, 0.8 + rand() * 0.7) : ''

  const birdCount = isNight ? 0 : (rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 2))
  const birds: string[] = []
  for (let i = 0; i < birdCount; i += 1) {
    birds.push(buildBirdChevron(VIEWBOX * (0.1 + rand() * 0.8), VIEWBOX * (0.1 + rand() * 0.15), 0.8 + rand() * 0.5))
  }

  return orb + horizonLine + shimmer.join('') + waves.join('') + boat + birds.join('')
}

function sceneStarfield(rand: () => number): string {
  const horizonY = VIEWBOX * (0.82 + rand() * 0.08)
  const stars = buildStars(rand, 20 + Math.floor(rand() * 24), 0, VIEWBOX, 0, horizonY * 0.92)
  const planetR = VIEWBOX * (0.09 + rand() * 0.06)
  const planetCx = VIEWBOX * (0.24 + rand() * 0.52)
  const planetCy = VIEWBOX * (0.18 + rand() * 0.18)
  const planet = buildOrb(rand, planetCx, planetCy, planetR, ['ringed', 'cratered', 'crescent'])
  const hill = buildRidge(rand, horizonY, 0.05 + rand() * 0.04, 4 + Math.floor(rand() * 2), true)
  const shooting = rand() < 0.6 ? buildShootingStar(rand) : ''
  return stars + planet + hill + shooting
}

function scenePineForest(rand: () => number): string {
  const horizonY = VIEWBOX * (0.72 + rand() * 0.06)
  const isNight = rand() < 0.5
  const orbR = VIEWBOX * (0.06 + rand() * 0.04)
  const orb = buildOrb(rand, VIEWBOX * (0.2 + rand() * 0.6), VIEWBOX * (0.12 + rand() * 0.14), orbR, isNight ? ['crescent', 'plain'] : ['plain', 'striped'])
  const stars = isNight ? buildStars(rand, 3 + Math.floor(rand() * 5), 0, VIEWBOX, VIEWBOX * 0.04, horizonY * 0.55) : ''
  const groundLine = `<rect x="0" y="${horizonY.toFixed(1)}" width="${VIEWBOX}" height="${(VIEWBOX - horizonY).toFixed(1)}" />`

  const treeCount = 4 + Math.floor(rand() * 4)
  const trees: Array<{ scale: number; markup: string }> = []
  for (let i = 0; i < treeCount; i += 1) {
    const x = VIEWBOX * (0.05 + rand() * 0.9)
    const scale = 0.35 + rand() * 1.3
    trees.push({ scale, markup: '' })
    trees[trees.length - 1].markup = buildPine(rand, x, horizonY, scale)
  }
  trees.sort((a, b) => a.scale - b.scale)

  return orb + stars + groundLine + trees.map(entry => entry.markup).join('')
}

function sceneRollingDunes(rand: () => number): string {
  const horizonY = VIEWBOX * (0.64 + rand() * 0.08)
  const sunCx = VIEWBOX * (0.28 + rand() * 0.44)
  const sunCy = VIEWBOX * (0.3 + rand() * 0.14)
  const sunR = VIEWBOX * (0.12 + rand() * 0.07)
  const sun = buildOrb(rand, sunCx, sunCy, sunR, ['striped', 'plain'])
  const backDune = buildRidge(rand, horizonY - VIEWBOX * 0.04, 0.05 + rand() * 0.03, 4, true)
  const frontDune = buildRidge(rand, horizonY, 0.07 + rand() * 0.04, 4, true)
  const cactus = rand() < 0.6 ? buildCactus(rand, VIEWBOX * (0.15 + rand() * 0.7), horizonY + VIEWBOX * 0.02, 0.5 + rand() * 0.7) : ''
  return sun + backDune + frontDune + cactus
}

const SCENE_BUILDERS: Array<(rand: () => number) => string> = [
  sceneSynthwave,
  sceneCityNight,
  sceneDesertHighway,
  sceneAlpineRidge,
  sceneOceanHorizon,
  sceneStarfield,
  scenePineForest,
  sceneRollingDunes,
]

function generateSceneSvg(seed: string): string {
  const rand = mulberry32(hashStringToSeed(seed))
  const sceneIndex = Math.floor(rand() * SCENE_BUILDERS.length)
  const content = SCENE_BUILDERS[sceneIndex](rand)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}"><g fill="black">${content}</g></svg>`
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
