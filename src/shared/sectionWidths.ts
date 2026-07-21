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
  /**
   * Set when the user has "pinned" this section by shrinking it via a divider
   * drag: the section holds exactly this width while the row can afford it,
   * and window resizes are absorbed by the flexible (non-fixed) sections.
   */
  fixedWidthPx?: number | null
}

/**
 * Proportionally distributes `availablePx` across `items` by weight, pinning
 * any item whose share would fall below `minWidthPx` to the minimum and
 * redistributing the rest. Returns exact floats summing to `availablePx`.
 */
function distributeProportionallyWithMinimum(
  items: { id: string; weight: number }[],
  availablePx: number,
  minWidthPx: number,
): Map<string, number> {
  const result = new Map<string, number>()
  const count = items.length
  if (count === 0) return result

  if (availablePx <= count * minWidthPx) {
    const equalPx = availablePx / count
    for (const item of items) {
      result.set(item.id, equalPx)
    }
    return result
  }

  let unpinnedIds = new Set(items.map((item) => item.id))
  let remainingPx = availablePx

  // Terminates in <= count passes; because availablePx > count * minWidthPx,
  // the unpinned pool always has more than minWidthPx per member available,
  // so the loop can't pin everyone.
  for (let pass = 0; pass < count; pass += 1) {
    const unpinned = items.filter((item) => unpinnedIds.has(item.id))
    const weightSum = unpinned.reduce((sum, item) => sum + item.weight, 0)
    if (weightSum <= 0) {
      const equalPx = remainingPx / unpinned.length
      for (const item of unpinned) {
        result.set(item.id, equalPx)
      }
      return result
    }

    const nextUnpinnedIds = new Set<string>()
    let pinnedThisPassPx = 0
    for (const item of unpinned) {
      const sharePx = (item.weight / weightSum) * remainingPx
      if (sharePx < minWidthPx) {
        result.set(item.id, minWidthPx)
        pinnedThisPassPx += minWidthPx
      } else {
        result.set(item.id, sharePx)
        nextUnpinnedIds.add(item.id)
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

/** Normalized proportional weights for a set of sections, from their persisted fractions. */
function resolveFractionWeights(entries: SectionWidthWeight[]): { id: string; weight: number }[] {
  const known = entries.filter((entry) => entry.widthFraction !== null && entry.widthFraction! > 0)
  const fallbackWeight = known.length > 0
    ? known.reduce((sum, entry) => sum + (entry.widthFraction ?? 0), 0) / known.length
    : 1
  return entries.map((entry) => ({
    id: entry.id,
    weight: entry.widthFraction !== null && (entry.widthFraction ?? 0) > 0 ? entry.widthFraction! : fallbackWeight,
  }))
}

/**
 * Deterministically resolves each section slot's exact pixel width for the
 * current row width. This is the single sizing authority: slots render with
 * `flex: 0 0 <px>` from this result instead of letting the flex container
 * improvise, so structural changes (create/close/drag) and window resizes
 * all reduce to "recompute this pure function."
 *
 * Policy, in priority order:
 * - Once the row cannot fit `count * minWidthPx`, all sections share the row
 *   equally (below minimum) rather than ever overflowing/clipping the row.
 * - Fixed sections (`fixedWidthPx` set) hold exactly their fixed width while
 *   the flexible sections can still cover the rest of the row at or above
 *   `minWidthPx`. Window resizes are therefore absorbed by the flexible
 *   sections only.
 * - Flexible sections share the leftover proportionally by `widthFraction`
 *   (weights need not sum to 1; they're normalized, and missing weights get
 *   the average of the known ones). Any flexible section whose share would
 *   fall below `minWidthPx` pins there while the rest keep absorbing.
 * - When every flexible section has bottomed out at the minimum, the fixed
 *   sections give up their pins and shrink proportionally to their fixed
 *   widths (still respecting `minWidthPx`). Their `fixedWidthPx` is state
 *   owned by the caller and is deliberately not mutated here, so growing the
 *   row again restores them to exactly their fixed widths.
 * - Widths are returned as exact floats that sum to the available width
 *   (row width minus the fixed dividers); no pixel is invented or lost.
 */
export function computeSlotWidthsPx(
  weights: SectionWidthWeight[],
  rowWidthPx: number,
  dividerWidthPx: number,
  minWidthPx: number,
): Map<string, number> {
  const count = weights.length
  if (count === 0) return new Map<string, number>()

  const availablePx = Math.max(0, rowWidthPx - (count - 1) * dividerWidthPx)

  if (availablePx <= count * minWidthPx) {
    const result = new Map<string, number>()
    const equalPx = availablePx / count
    for (const entry of weights) {
      result.set(entry.id, equalPx)
    }
    return result
  }

  const fixed = weights.filter((entry) => typeof entry.fixedWidthPx === 'number')
  const flexible = weights.filter((entry) => typeof entry.fixedWidthPx !== 'number')

  // Everything fixed: nothing is left to absorb resizes, so scale the fixed
  // widths proportionally (at the row width they were pinned at, this yields
  // exactly the pinned widths).
  if (flexible.length === 0) {
    return distributeProportionallyWithMinimum(
      fixed.map((entry) => ({ id: entry.id, weight: Math.max(1, entry.fixedWidthPx ?? minWidthPx) })),
      availablePx,
      minWidthPx,
    )
  }

  const fixedDesired = fixed.map((entry) => ({
    id: entry.id,
    widthPx: Math.max(minWidthPx, entry.fixedWidthPx ?? minWidthPx),
  }))
  const fixedDesiredSumPx = fixedDesired.reduce((sum, entry) => sum + entry.widthPx, 0)
  const flexibleAvailablePx = availablePx - fixedDesiredSumPx

  if (flexibleAvailablePx >= flexible.length * minWidthPx) {
    const result = distributeProportionallyWithMinimum(
      resolveFractionWeights(flexible),
      flexibleAvailablePx,
      minWidthPx,
    )
    for (const entry of fixedDesired) {
      result.set(entry.id, entry.widthPx)
    }
    return result
  }

  // Flexible sections have all bottomed out: they sit at the minimum and the
  // fixed sections absorb the remaining shrink relative to their fixed
  // widths. (availablePx > count * minWidthPx guarantees the fixed pool still
  // has more than minWidthPx per member here.)
  const result = distributeProportionallyWithMinimum(
    fixedDesired.map((entry) => ({ id: entry.id, weight: entry.widthPx })),
    availablePx - flexible.length * minWidthPx,
    minWidthPx,
  )
  for (const entry of flexible) {
    result.set(entry.id, minWidthPx)
  }
  return result
}

/**
 * Extracts `amountPx` from `pool` in equal parts per member, capping each
 * member's contribution so it never drops below `minWidthPx`; whatever a
 * capped member couldn't cover is re-split equally across the rest. Callers
 * are expected to have checked the pool's total capacity covers the amount.
 */
function extractEqualPartsWithMinimum(
  pool: SectionWidthPx[],
  amountPx: number,
  minWidthPx: number,
): Map<string, number> {
  const giveById = new Map<string, number>()
  let remainingPx = amountPx
  let activeIds = new Set(pool.map((entry) => entry.id))

  while (remainingPx > 0.5 && activeIds.size > 0) {
    const active = pool.filter((entry) => activeIds.has(entry.id))
    const sharePx = remainingPx / active.length
    const nextActiveIds = new Set<string>()
    let extractedPx = 0

    for (const entry of active) {
      const alreadyGivenPx = giveById.get(entry.id) ?? 0
      const capacityLeftPx = Math.max(0, entry.widthPx - minWidthPx - alreadyGivenPx)
      const givePx = Math.min(sharePx, capacityLeftPx)
      giveById.set(entry.id, alreadyGivenPx + givePx)
      extractedPx += givePx
      if (givePx < capacityLeftPx) {
        nextActiveIds.add(entry.id)
      }
    }

    if (extractedPx <= 0) break
    remainingPx -= extractedPx
    activeIds = nextActiveIds
  }

  return giveById
}

/**
 * Flex-aware variant of `computeSectionWidthsForNewSection`: funding for the
 * new slot deliberately spares fixed (user-pinned) sections.
 *
 * Policy, in priority order:
 * 1. Halve the flexible section adjacent to the new slot -- the source
 *    section (immediately left) first, then the source's old right neighbor
 *    -- when it's large enough to split and stay above `minWidthPx`.
 * 2. Otherwise consume space in equal parts from all flexible sections,
 *    wherever they sit: the new section targets `flexibleTotal / (k + 1)`
 *    (joining the flexible pool as an equal member -- with a single flexible
 *    section this degenerates to halving it), capped by what the pool can
 *    give without any member dropping below `minWidthPx`.
 * 3. If there are no flexible sections at all, or the pool can't fund even a
 *    minimum-width section, fall back to the legacy proportional split
 *    across ALL sections -- fixed ones included; the caller is responsible
 *    for updating any fixed widths it finds changed in the result.
 *
 * `currentWidthsPx` must be in visual left-to-right order.
 */
export function computeSectionWidthsForNewSectionFlexAware(
  currentWidthsPx: SectionWidthPx[],
  sourceSectionId: string,
  fixedSectionIds: ReadonlySet<string>,
  minWidthPx: number,
  dividerWidthPx: number,
): { updatedWidths: SectionWidthPx[]; newSectionWidthPx: number } {
  const sourceIndex = currentWidthsPx.findIndex((entry) => entry.id === sourceSectionId)
  if (sourceIndex < 0) {
    return { updatedWidths: currentWidthsPx, newSectionWidthPx: minWidthPx }
  }

  const canHalve = (entry: SectionWidthPx) => entry.widthPx >= 2 * minWidthPx + dividerWidthPx
  const source = currentWidthsPx[sourceIndex]
  const rightNeighbor = currentWidthsPx[sourceIndex + 1] ?? null

  const halveTarget =
    (!fixedSectionIds.has(source.id) && canHalve(source)) ? source
    : (rightNeighbor !== null && !fixedSectionIds.has(rightNeighbor.id) && canHalve(rightNeighbor)) ? rightNeighbor
    : null

  if (halveTarget !== null) {
    const splittableInnerPx = halveTarget.widthPx - dividerWidthPx
    const newSectionWidthPx = Math.floor(splittableInnerPx / 2)
    const targetNewWidthPx = splittableInnerPx - newSectionWidthPx

    const updatedWidths = currentWidthsPx.map((entry) => (
      entry.id === halveTarget.id ? { id: entry.id, widthPx: targetNewWidthPx } : entry
    ))
    return { updatedWidths, newSectionWidthPx }
  }

  const flexible = currentWidthsPx.filter((entry) => !fixedSectionIds.has(entry.id))
  if (flexible.length > 0) {
    const flexibleTotalPx = flexible.reduce((sum, entry) => sum + entry.widthPx, 0)
    const capacityPx = flexible.reduce((sum, entry) => sum + Math.max(0, entry.widthPx - minWidthPx), 0)
    const desiredNewWidthPx = Math.max(minWidthPx, Math.floor(flexibleTotalPx / (flexible.length + 1)))
    const affordablePx = Math.min(desiredNewWidthPx + dividerWidthPx, capacityPx)

    if (affordablePx - dividerWidthPx >= minWidthPx) {
      const giveById = extractEqualPartsWithMinimum(flexible, affordablePx, minWidthPx)
      const totalGivenPx = [...giveById.values()].reduce((sum, value) => sum + value, 0)

      const updatedWidths = currentWidthsPx.map((entry) => {
        const givenPx = giveById.get(entry.id) ?? 0
        return givenPx > 0 ? { id: entry.id, widthPx: entry.widthPx - givenPx } : entry
      })
      return { updatedWidths, newSectionWidthPx: totalGivenPx - dividerWidthPx }
    }
  }

  return computeSectionWidthsForNewSection(currentWidthsPx, sourceSectionId, minWidthPx, dividerWidthPx)
}

/**
 * Flex-aware variant of `computeSectionWidthsForClose`: the freed width goes
 * to an adjacent flexible section (left neighbor first, then right); when
 * neither neighbor is flexible it's split equally across all flexible
 * sections; when everything is fixed it falls back to the immediate left
 * (or right, for the leftmost slot) neighbor -- the caller is responsible
 * for updating that fixed neighbor's remembered width.
 *
 * `currentWidthsPx` must be in visual left-to-right order.
 */
export function computeSectionWidthsForCloseFlexAware(
  currentWidthsPx: SectionWidthPx[],
  closingSectionId: string,
  fixedSectionIds: ReadonlySet<string>,
): SectionWidthPx[] {
  const index = currentWidthsPx.findIndex((entry) => entry.id === closingSectionId)
  if (index < 0) return currentWidthsPx

  const closing = currentWidthsPx[index]
  const remaining = currentWidthsPx.filter((entry) => entry.id !== closingSectionId)
  if (remaining.length === 0) return remaining

  const leftNeighbor = index > 0 ? currentWidthsPx[index - 1] : null
  const rightNeighbor = index + 1 < currentWidthsPx.length ? currentWidthsPx[index + 1] : null

  const recipientId =
    (leftNeighbor !== null && !fixedSectionIds.has(leftNeighbor.id)) ? leftNeighbor.id
    : (rightNeighbor !== null && !fixedSectionIds.has(rightNeighbor.id)) ? rightNeighbor.id
    : null

  if (recipientId !== null) {
    return remaining.map((entry) => (
      entry.id === recipientId ? { id: entry.id, widthPx: entry.widthPx + closing.widthPx } : entry
    ))
  }

  const flexibleIds = new Set(remaining.filter((entry) => !fixedSectionIds.has(entry.id)).map((entry) => entry.id))
  if (flexibleIds.size > 0) {
    const sharePx = closing.widthPx / flexibleIds.size
    return remaining.map((entry) => (
      flexibleIds.has(entry.id) ? { id: entry.id, widthPx: entry.widthPx + sharePx } : entry
    ))
  }

  const fallbackId = (leftNeighbor ?? rightNeighbor)?.id ?? null
  return remaining.map((entry) => (
    entry.id === fallbackId ? { id: entry.id, widthPx: entry.widthPx + closing.widthPx } : entry
  ))
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
