import { useCallback, useRef, useState } from 'react'
import { beginCursorHold, endCursorHold } from '@thockdown/interaction/cursorHoldFeedback'
import { HOLD_COMMIT_MS } from '@thockdown/interaction/holdTiming'

// Right-click-and-hold gesture for "branch this snapshot into a new note".
// A plain right-click still opens the context menu / does nothing special --
// only a sustained hold (past HOLD_MS) fires onBranch. Releasing early, or
// the pointer leaving the element, cancels cleanly with no side effects.
//
// `progress` (0..1) is exposed so the mark can render a filling ring while
// held, giving the user feedback that something is about to happen before
// it's irreversible.

// Branching a snapshot into a new note, and merging two of them, are both
// "I know this is not undoable" -- the app's COMMIT threshold
// (`shared/holdTiming.ts`). Was 550 here and 1000 at the merge's call site.
const DEFAULT_HOLD_MS = HOLD_COMMIT_MS

export function useHoldToBranch(onBranch: () => void, holdMs = DEFAULT_HOLD_MS) {
  const [isHolding, setIsHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [lastFiredAt, setLastFiredAt] = useState<number | null>(null)

  const startedAtRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const firedRef = useRef(false)
  // The one hold in the app that does not run on a timer -- it drives a
  // filling ring off rAF -- so it keeps `armHold`'s pairing invariant itself:
  // exactly one end per begin, whichever way the gesture goes. `clear` is
  // both the abandon path and the last thing the fire path does, so without
  // this the completion would be followed by an abandon.
  const settledRef = useRef(true)

  const settle = useCallback((completed: boolean) => {
    if (settledRef.current) return
    settledRef.current = true
    endCursorHold(completed)
  }, [])

  const clear = useCallback(() => {
    settle(false)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    startedAtRef.current = null
    firedRef.current = false
    setIsHolding(false)
    setProgress(0)
  }, [settle])

  const tick = useCallback(() => {
    const startedAt = startedAtRef.current
    if (startedAt === null) return

    const elapsed = Date.now() - startedAt
    const ratio = Math.min(1, elapsed / holdMs)
    setProgress(ratio)

    if (ratio >= 1 && !firedRef.current) {
      firedRef.current = true
      // Same order as `armHold`: the gesture is acknowledged before the
      // action it triggered, which happened whatever that action then does.
      settle(true)
      onBranch()
      setLastFiredAt(Date.now())
      clear()
      return
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [clear, onBranch, holdMs, settle])

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    // Suppress the native context menu entirely -- right-click is repurposed.
    event.preventDefault()
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 2) return // right button only
    event.preventDefault()
    settledRef.current = false
    beginCursorHold(holdMs)
    startedAtRef.current = Date.now()
    firedRef.current = false
    setIsHolding(true)
    setProgress(0)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick, holdMs])

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (event.button !== 2) return
    clear()
  }, [clear])

  const onPointerLeave = useCallback(() => {
    clear()
  }, [clear])

  return {
    isHolding,
    progress,
    lastFiredAt,
    handlers: {
      onContextMenu,
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onPointerCancel: onPointerLeave,
      // The whole gesture is a right press, so it must look pressed for one
      // (see `shared/pressTracking.ts`). Declared in the bundle rather than
      // at the call site because it is a property of this behaviour, and
      // because the source-level check cannot see through a `{...spread}`.
      'data-secondary-press': 'action' as const,
    },
  }
}
