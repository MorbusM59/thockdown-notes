/**
 * Holes in the visualizer's middle strip, for every plate drawn in the
 * letterbox colour inside it (the song list's current song, the bucket
 * list's active buckets). The strips' colours are translucent and sit side
 * by side on the stage, never stacked, so a letterbox plate laid OVER the
 * middle comes out a different colour from the top strip (in a dark layout
 * with a transparent letterbox, no colour at all). The middle therefore
 * leaves a hole under each plate, as one CSS mask: a full layer with every
 * hole excluded from it. Owners report their rectangles; the mask is
 * rewritten only when the set actually changes.
 *
 * Each hole also gets a filler in the middle's colour, in the unmasked layer
 * just before the middle (`.visualizer-strip.is-hole-fill`, same placement),
 * shown as the panels are hidden (panelsShown.ts) so the hole closes as its
 * plate fades out.
 */

export type HoleRect = { x: number; y: number; width: number; height: number }

const owners = new WeakMap<HTMLElement, Map<string, HoleRect[]>>()
const written = new WeakMap<HTMLElement, string>()

/** Set `owner`'s holes in `middle`, in px relative to it; an empty list removes them. */
export function setMiddleHoles(middle: HTMLElement, owner: string, holes: HoleRect[]): void {
  let byOwner = owners.get(middle)
  if (!byOwner) {
    byOwner = new Map()
    owners.set(middle, byOwner)
  }
  if (holes.length === 0) byOwner.delete(owner)
  else byOwner.set(owner, holes)
  const all = [...byOwner.values()].flat()
  const key = all.map((hole) => `${hole.x},${hole.y},${hole.width},${hole.height}`).join(';')
  if (written.get(middle) === key) return
  written.set(middle, key)
  const fill = middle.previousElementSibling
  if (fill instanceof HTMLElement && fill.classList.contains('is-hole-fill')) {
    fill.replaceChildren(...all.map((hole) => {
      const filler = document.createElement('div')
      filler.style.cssText = `left:${hole.x}px;top:${hole.y}px;width:${hole.width}px;height:${hole.height}px`
      return filler
    }))
  }
  if (all.length === 0) {
    for (const name of ['mask-image', 'mask-size', 'mask-position', 'mask-repeat', 'mask-composite']) middle.style.removeProperty(name)
    return
  }
  // Holes first, the full layer last: each layer is composited onto the ones
  // below it, so the full layer excludes every (non-overlapping) hole.
  const layers = [...all.map(() => 'linear-gradient(#000 0 0)'), 'linear-gradient(#000 0 0)']
  middle.style.setProperty('mask-image', layers.join(', '))
  middle.style.setProperty('mask-size', [...all.map((hole) => `${hole.width}px ${hole.height}px`), '100% 100%'].join(', '))
  middle.style.setProperty('mask-position', [...all.map((hole) => `${hole.x}px ${hole.y}px`), '0 0'].join(', '))
  middle.style.setProperty('mask-repeat', 'no-repeat')
  middle.style.setProperty('mask-composite', [...all.map(() => 'exclude'), 'add'].join(', '))
}

/** The scene's middle strip, from any element inside the scene. */
export function middleStripOf(element: HTMLElement): HTMLElement | null {
  return element.closest('.visualizer-scene')?.querySelector<HTMLElement>('.visualizer-strip.is-middle') ?? null
}
