import { useCallback, useRef, useState } from 'react'

// Right-click-and-hold gesture for "branch this snapshot into a new note".
// A plain right-click still opens the context menu / does nothing special --
// only a sustained hold (past HOLD_MS) fires onBranch. Releasing early, or
// the pointer leaving the element, cancels cleanly with no side effects.
//
// `progress` (0..1) is exposed so the mark can render a filling ring while
// held, giving the user feedback that something is about to happen before
// it's irreversible.

const DEFAULT_HOLD_MS = 550

export function useHoldToBranch(onBranch: () => void, holdMs = DEFAULT_HOLD_MS) {
  const [isHolding, setIsHolding] = useState(false)
  const [progress, setProgress] = useState(0)

  const startedAtRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const firedRef = useRef(false)

  const clear = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    startedAtRef.current = null
    firedRef.current = false
    setIsHolding(false)
    setProgress(0)
  }, [])

  const tick = useCallback(() => {
    const startedAt = startedAtRef.current
    if (startedAt === null) return

    const elapsed = Date.now() - startedAt
    const ratio = Math.min(1, elapsed / holdMs)
    setProgress(ratio)

    if (ratio >= 1 && !firedRef.current) {
      firedRef.current = true
      onBranch()
      clear()
      return
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [clear, onBranch, holdMs])

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    // Suppress the native context menu entirely -- right-click is repurposed.
    event.preventDefault()
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 2) return // right button only
    event.preventDefault()
    startedAtRef.current = Date.now()
    firedRef.current = false
    setIsHolding(true)
    setProgress(0)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

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
    handlers: {
      onContextMenu,
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onPointerCancel: onPointerLeave,
    },
  }
}
