const scrollerIds = new WeakMap<HTMLElement, number>()
let nextScrollerId = 1

/** A stable key per scroll box, for remounting a rail when its box changes. */
export function scrollerIdentity(scroller: HTMLElement | null): string {
  if (!scroller) return 'none'
  let id = scrollerIds.get(scroller)
  if (id === undefined) {
    id = nextScrollerId++
    scrollerIds.set(scroller, id)
  }
  return String(id)
}
