/**
 * The flow's and the beat pulse's CSS variables (`--flow-trail-source`,
 * `--flow-trail-source-saturation`, `--flow-caret-effect`, `--beat-caret`,
 * `--beat-edge`, `--beat-pane`), written onto the elements that read them rather than onto
 * `<html>`.
 *
 * They change on every frame the meter moves. A custom property is inherited
 * by every element below the one it is set on, so setting it on `<html>`
 * made the browser recompute the style of the whole document once a frame
 * while the reader typed -- measured at 16ms a frame on a 3,000-element page
 * against 0.1ms for the same write on the one element that uses it. The
 * readers are a few leaves per editor (the caret, the trail's source, the
 * beat edge, and the beat pane's grid copy and wash), so
 * each registers itself (`flowStyleTarget`) and receives the current values
 * on registration and every change after it.
 *
 * Each target names the variables it READS and receives only those. Every
 * variable on every target was the first version, and it made each target
 * restyle on every other target's change: the beat pane's copy of the grid
 * took the caret's --beat-caret once a frame, an inherited custom property,
 * so its masked ring pattern recomputed and repainted the page every frame.
 */

const values = new Map<string, string>()
const targets = new Map<HTMLElement, ReadonlySet<string>>()

/** Sets a flow variable on every registered element; null removes it. */
export function setFlowStyle(name: string, value: string | null): void {
  if (value === null) {
    if (!values.delete(name)) return
    for (const [el, reads] of targets) if (reads.has(name)) el.style.removeProperty(name)
    return
  }
  if (values.get(name) === value) return
  values.set(name, value)
  for (const [el, reads] of targets) if (reads.has(name)) el.style.setProperty(name, value)
}

/** The variable's current value, or null when it is not set. */
export function readFlowStyle(name: string): string | null {
  return values.get(name) ?? null
}

/** Registers an element to receive the flow variables it `reads`; returns the unregister. */
export function registerFlowStyleTarget(el: HTMLElement, reads: readonly string[]): () => void {
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
export function flowStyleTarget<T extends HTMLElement>(ref: { current: T | null }, reads: readonly string[]): (el: T | null) => void {
  let unregister: (() => void) | null = null
  return (el) => {
    unregister?.()
    unregister = el ? registerFlowStyleTarget(el, reads) : null
    ref.current = el
  }
}
