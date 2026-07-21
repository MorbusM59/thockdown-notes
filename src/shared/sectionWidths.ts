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
 * `sourceSectionId`. When the source section is larger than twice
 * `minWidthPx`, it's split evenly in half (minus the new divider) between
 * itself and the new section -- visually "splitting the pane." Otherwise,
 * falls back to funding the new section (plus the one new divider it
 * introduces) entirely from the source section first; only spills over to
 * the other sections, proportionally, if the source alone can't cover it
 * without dropping below `minWidthPx`. If rounding overshoots the exact
 * amount needed, the new section simply ends up a few px larger rather than
 * shorting any existing section below its measured give -- total width is
 * always conserved exactly.
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

  if (source.widthPx >= 2 * minWidthPx + dividerWidthPx) {
    const splittableInnerPx = source.widthPx - dividerWidthPx
    const newSectionWidthPx = Math.floor(splittableInnerPx / 2)
    const sourceNewWidthPx = splittableInnerPx - newSectionWidthPx

    const updatedWidths = currentWidthsPx.map((entry) => (
      entry.id === sourceSectionId ? { id: entry.id, widthPx: sourceNewWidthPx } : entry
    ))

    return { updatedWidths, newSectionWidthPx }
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

export interface SectionWidthWeight {
  id: string
  widthFraction: number | null
}

/**
 * Deterministically resolves each section slot's exact pixel width for the
 * current row width. This is the single sizing authority: slots render with
 * `flex: 0 0 <px>` from this result instead of letting the flex container
 * improvise, so structural changes (create/close/drag) and window resizes
 * all reduce to "recompute this pure function."
 *
 * Policy:
 * - `widthFraction` entries are proportional weights (they need not sum to 1;
 *   they're normalized). Missing (`null`) weights get the average of the known
 *   ones, or an even share when none are known.
 * - Every section is kept at or above `minWidthPx` for as long as the row can
 *   afford it: sections whose proportional share would fall below the minimum
 *   are pinned to `minWidthPx` and the remaining space is redistributed across
 *   the rest — so as a window shrinks, the smallest sections bottom out first
 *   and the larger ones keep absorbing the shrink.
 * - Once the row cannot fit `count * minWidthPx`, all sections share the row
 *   equally (below minimum) rather than ever overflowing/clipping the row.
 * - Widths are returned as exact floats that sum to the available width
 *   (row width minus the fixed dividers); no pixel is invented or lost.
 */
export function computeSlotWidthsPx(
  weights: SectionWidthWeight[],
  rowWidthPx: number,
  dividerWidthPx: number,
  minWidthPx: number,
): Map<string, number> {
  const result = new Map<string, number>()
  const count = weights.length
  if (count === 0) return result

  const availablePx = Math.max(0, rowWidthPx - (count - 1) * dividerWidthPx)

  if (availablePx <= count * minWidthPx) {
    const equalPx = availablePx / count
    for (const entry of weights) {
      result.set(entry.id, equalPx)
    }
    return result
  }

  const known = weights.filter((entry) => entry.widthFraction !== null && entry.widthFraction! > 0)
  const fallbackWeight = known.length > 0
    ? known.reduce((sum, entry) => sum + (entry.widthFraction ?? 0), 0) / known.length
    : 1
  const weightById = new Map(weights.map((entry) => [
    entry.id,
    entry.widthFraction !== null && entry.widthFraction > 0 ? entry.widthFraction : fallbackWeight,
  ]))

  let unpinnedIds = new Set(weights.map((entry) => entry.id))
  let remainingPx = availablePx

  // Iteratively pin below-minimum sections to the minimum and redistribute the
  // rest proportionally. Terminates in <= count passes; because
  // availablePx > count * minWidthPx, the unpinned pool always has more than
  // minWidthPx per member available, so the loop can't pin everyone.
  for (let pass = 0; pass < count; pass += 1) {
    const unpinned = weights.filter((entry) => unpinnedIds.has(entry.id))
    const weightSum = unpinned.reduce((sum, entry) => sum + (weightById.get(entry.id) ?? 0), 0)
    if (weightSum <= 0) {
      const equalPx = remainingPx / unpinned.length
      for (const entry of unpinned) {
        result.set(entry.id, equalPx)
      }
      return result
    }

    const nextUnpinnedIds = new Set<string>()
    let pinnedThisPassPx = 0
    for (const entry of unpinned) {
      const sharePx = ((weightById.get(entry.id) ?? 0) / weightSum) * remainingPx
      if (sharePx < minWidthPx) {
        result.set(entry.id, minWidthPx)
        pinnedThisPassPx += minWidthPx
      } else {
        result.set(entry.id, sharePx)
        nextUnpinnedIds.add(entry.id)
      }
    }

    if (nextUnpinnedIds.size === unpinned.length) {
      return result
    }

    remainingPx -= pinnedThisPassPx
    unpinnedIds = nextUnpinnedIds
  }

  return result
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
