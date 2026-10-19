/**
 * The flow's and the beat pulse's CSS variables (`--flow-trail-source`,
 * `--flow-trail-source-saturation`, `--flow-caret-effect`, `--beat-caret`,
 * `--beat-shade`), written onto the elements that read them rather than onto
 * `<html>`.
 *
 * They change on every frame the meter moves. A custom property is inherited
 * by every element below the one it is set on, so setting it on `<html>`
 * made the browser recompute the style of the whole document once a frame
 * while the reader typed -- measured at 16ms a frame on a 3,000-element page
 * against 0.1ms for the same write on the one element that uses it. The
 * readers are three leaves per editor (the caret, the trail's source and the
 * beat shade), so
 * each registers itself (`flowStyleTarget`) and receives the current values
 * on registration and every change after it.
 */

const values = new Map<string, string>()
const targets = new Set<HTMLElement>()

/** Sets a flow variable on every registered element; null removes it. */
export function setFlowStyle(name: string, value: string | null): void {
  if (value === null) {
    if (!values.delete(name)) return
    for (const el of targets) el.style.removeProperty(name)
    return
  }
  if (values.get(name) === value) return
  values.set(name, value)
  for (const el of targets) el.style.setProperty(name, value)
}

/** The variable's current value, or null when it is not set. */
export function readFlowStyle(name: string): string | null {
  return values.get(name) ?? null
}

/** Registers an element to receive the flow variables; returns the unregister. */
export function registerFlowStyleTarget(el: HTMLElement): () => void {
  targets.add(el)
  for (const [name, value] of values) el.style.setProperty(name, value)
  return () => {
    targets.delete(el)
  }
}

/**
 * A callback ref that keeps `ref` pointing at the element and registers it
 * while it is mounted. Create it once per component (it holds the
 * unregister of the element it last saw).
 */
export function flowStyleTarget<T extends HTMLElement>(ref: { current: T | null }): (el: T | null) => void {
  let unregister: (() => void) | null = null
  return (el) => {
    unregister?.()
    unregister = el ? registerFlowStyleTarget(el) : null
    ref.current = el
  }
}
