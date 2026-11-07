/**
 * CSS variables that change every frame -- the beat pulse's (`--beat-caret`,
 * `--beat-edge`, `--beat-pane`, `--beat-wash`) and the caret's typing hold
 * (`--caret-typing-hold`, `typingTrail/typingTrail.ts`) -- written onto the
 * elements that read them rather than onto `<html>`.
 *
 * A custom property is inherited by every element below the one it is set
 * on, so setting one on `<html>` made the browser recompute the style of the
 * whole document once a frame -- measured at 16ms a frame on a 3,000-element
 * page against 0.1ms for the same write on the one element that uses it. The
 * readers are a few leaves per editor (the caret, the beat edge, and the beat
 * pane's grid copy and wash), so each registers itself (`liveStyleTarget`)
 * and receives the current values on registration and every change after it.
 *
 * Each target names the variables it READS and receives only those. Every
 * variable on every target was the first version, and it made each target
 * restyle on every other target's change: the beat pane's copy of the grid
 * took the caret's --beat-caret once a frame, an inherited custom property,
 * so its masked ring pattern recomputed and repainted the page every frame.
 */

const values = new Map<string, string>()
const targets = new Map<HTMLElement, ReadonlySet<string>>()

/** Sets a live variable on every registered element; null removes it. */
export function setLiveStyle(name: string, value: string | null): void {
  if (value === null) {
    if (!values.delete(name)) return
    for (const [el, reads] of targets) if (reads.has(name)) el.style.removeProperty(name)
    return
  }
  if (values.get(name) === value) return
  values.set(name, value)
  for (const [el, reads] of targets) if (reads.has(name)) el.style.setProperty(name, value)
}

/** Registers an element to receive the live variables it `reads`; returns the unregister. */
export function registerLiveStyleTarget(el: HTMLElement, reads: readonly string[]): () => void {
  const names = new Set(reads)
  targets.set(el, names)
  for (const [name, value] of values) if (names.has(name)) el.style.setProperty(name, value)
  return () => {
    targets.delete(el)
  }
}

/**
 * A callback ref that keeps `ref` pointing at the element and registers it
 * while it is mounted. Create it once per component (it holds the
 * unregister of the element it last saw).
 */
export function liveStyleTarget<T extends HTMLElement>(ref: { current: T | null }, reads: readonly string[]): (el: T | null) => void {
  let unregister: (() => void) | null = null
  return (el) => {
    unregister?.()
    unregister = el ? registerLiveStyleTarget(el, reads) : null
    ref.current = el
  }
}
