export interface SectionWidthPx {
  id: string
  widthPx: number
}

/**
 * Distributes `neededPx` across `pool` (each section's own, fixed, original
 * width -- never mutated across passes), proportionally by width, respecting
 * `minWidthPx` per section. A section that can't cover its proportional ask
 * without dropping below the minimum gives everything it has left instead
 * and drops out of the pool; whatever it couldn't cover (its own specific
 * shortfall, not the pool's overall remaining need) becomes the next pass's
 * target, redistributed across the remaining pool. Repeats until the need
 * is met or the pool is exhausted (not enough total space -- callers are
 * expected to have already checked there's room before calling this).
 */
function distributeAcrossPool(neededPx: number, pool: SectionWidthPx[], minWidthPx: number): Map<string, number> {
  const giveById = new Map<string, number>()
  let passTargetPx = neededPx
  let activeIds = new Set(pool.map((entry) => entry.id))

  while (passTargetPx > 0 && activeIds.size > 0) {
    const active = pool.filter((entry) => activeIds.has(entry.id))
    const poolTotalPx = active.reduce((sum, entry) => sum + entry.widthPx, 0)
    if (poolTotalPx <= 0) break

    const ratio = passTargetPx / poolTotalPx
    let shortfallPx = 0
    const nextActiveIds = new Set<string>()

    for (const entry of active) {
      const askPx = Math.ceil(entry.widthPx * ratio)
      const alreadyGivenPx = giveById.get(entry.id) ?? 0
      const capacityLeftPx = (entry.widthPx - minWidthPx) - alreadyGivenPx

      if (askPx >= capacityLeftPx) {
        const actualGivePx = Math.max(0, capacityLeftPx)
        giveById.set(entry.id, alreadyGivenPx + actualGivePx)
        shortfallPx += askPx - actualGivePx
      } else {
        giveById.set(entry.id, alreadyGivenPx + askPx)
        nextActiveIds.add(entry.id)
      }
    }

    activeIds = nextActiveIds
    passTargetPx = shortfallPx
  }

  return giveById
}

/**
 * Computes new widths for creating a section immediately to the right of
 * `sourceSectionId`. Tries to fund the new section (plus the one new
 * divider it introduces) entirely from the source section first; only
 * spills over to the other sections, proportionally, if the source alone
 * can't cover it without dropping below `minWidthPx`. If rounding overshoots
 * the exact amount needed, the new section simply ends up a few px larger
 * rather than shorting any existing section below its measured give --
 * total width is always conserved exactly.
 */
export function computeSectionWidthsForNewSection(
  currentWidthsPx: SectionWidthPx[],
  sourceSectionId: string,
  minWidthPx: number,
  dividerWidthPx: number,
): { updatedWidths: SectionWidthPx[]; newSectionWidthPx: number } {
  const source = currentWidthsPx.find((entry) => entry.id === sourceSectionId)
  if (!source) {
    return { updatedWidths: currentWidthsPx, newSectionWidthPx: minWidthPx }
  }

  // The new divider's fixed 8px comes out of the same pool as the new
  // section's own minimum content width -- both are space the existing
  // sections need to give up.
  const totalNeededPx = minWidthPx + dividerWidthPx

  const sourceGivePx = Math.max(0, Math.min(source.widthPx - minWidthPx, totalNeededPx))
  const remainingNeededPx = totalNeededPx - sourceGivePx

  const others = currentWidthsPx.filter((entry) => entry.id !== sourceSectionId)
  const giveById = remainingNeededPx > 0 ? distributeAcrossPool(remainingNeededPx, others, minWidthPx) : new Map<string, number>()

  const updatedWidths = currentWidthsPx.map((entry) => {
    if (entry.id === sourceSectionId) {
      return { id: entry.id, widthPx: entry.widthPx - sourceGivePx }
    }
    const givenPx = giveById.get(entry.id) ?? 0
    return { id: entry.id, widthPx: entry.widthPx - givenPx }
  })

  const totalGivenPx = sourceGivePx + [...giveById.values()].reduce((sum, value) => sum + value, 0)
  const newSectionWidthPx = Math.max(minWidthPx, totalGivenPx - dividerWidthPx)

  return { updatedWidths, newSectionWidthPx }
}

/**
 * Computes new widths for closing `closingSectionId`'s slot: its entire
 * width is handed to its immediate left neighbor, unchanged for everyone
 * else. The leftmost section is never closable via the UI, so a missing
 * left neighbor is defensive-only and just drops the closed section.
 */
export function computeSectionWidthsForClose(
  currentWidthsPx: SectionWidthPx[],
  closingSectionId: string,
): SectionWidthPx[] {
  const index = currentWidthsPx.findIndex((entry) => entry.id === closingSectionId)
  if (index < 0) return currentWidthsPx
  if (index === 0) return currentWidthsPx.filter((entry) => entry.id !== closingSectionId)

  const closing = currentWidthsPx[index]
  const leftNeighborId = currentWidthsPx[index - 1].id

  return currentWidthsPx
    .filter((entry) => entry.id !== closingSectionId)
    .map((entry) => (entry.id === leftNeighborId ? { id: entry.id, widthPx: entry.widthPx + closing.widthPx } : entry))
}
