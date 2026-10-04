import { useRef } from 'react'

/**
 * `props` with every function replaced by a wrapper whose identity never
 * changes and which always calls the latest function passed under that name.
 * Everything that is not a function passes through unchanged.
 *
 * WHY: a component's memoized callbacks keep the render scope they were
 * created in, and that scope holds every value captured there -- including
 * a parent's callback props. A parent that passes a fresh arrow on every
 * render (`onClearSection={() => handleClearSection(entry.id)}`) therefore
 * hands each child render a closure over THAT parent render's scope, which
 * holds the parent's own view of the child (its section handle) and so the
 * child's older callbacks, which hold older parent closures... a chain across
 * the two components that grows with every render. Measured on EditorSection
 * and App: ~20KB per cycle of typing, with no end.
 *
 * A wrapper built here captures only a ref and a name, so a child's memoized
 * callbacks never reach a parent's render scope, whatever the parent passes.
 * The trade: a prop's identity is no longer a signal that it changed, so a
 * function prop that is MEANT to re-run an effect or a memo when it changes
 * must not go through this.
 */
export function useStableCallbacks<T extends object>(props: T): T {
  const latestRef = useRef(props)
  latestRef.current = props
  const wrappersRef = useRef(new Map<PropertyKey, (...args: unknown[]) => unknown>())
  const result = { ...props } as Record<PropertyKey, unknown>
  for (const key of Object.keys(props)) {
    if (typeof (props as Record<string, unknown>)[key] !== 'function') continue
    let wrapper = wrappersRef.current.get(key)
    if (!wrapper) {
      wrapper = forwardTo(latestRef as { current: Record<PropertyKey, unknown> }, key)
      wrappersRef.current.set(key, wrapper)
    }
    result[key] = wrapper
  }
  return result as T
}

// Module-level on purpose: a closure created inside the hook would share the
// hook's render scope, and with it the very props this exists to let go of.
function forwardTo(latestRef: { current: Record<PropertyKey, unknown> }, key: PropertyKey) {
  return (...args: unknown[]) => (latestRef.current[key] as (...a: unknown[]) => unknown)(...args)
}
