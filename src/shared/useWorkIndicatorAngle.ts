import { useEffect, useRef, useState } from 'react'
import { subscribeToBackgroundWork } from './backgroundWork'
import {
  WORK_INDICATOR_AT_REST,
  advanceWorkIndicator,
  resolveWorkIndicatorTiming,
  type WorkIndicatorState,
} from './workIndicatorSpin'

/**
 * The angle the work indicator should be drawn at, in degrees.
 *
 * Rendering state per frame is deliberate here and cheap: the wheel is one
 * small element, the value is a transform, and the alternative -- writing
 * `style.transform` from the loop onto a ref -- would put the animation
 * outside React's knowledge of it for no gain at this size.
 *
 * The loop RUNS ONLY WHILE THE WHEEL IS MOVING. An idle app schedules no
 * frames at all: the subscription wakes it when work begins, and it stops
 * itself once the wheel has come back to rest. An indicator that costs a
 * frame a second forever to say "nothing is happening" would be the app
 * doing exactly what it is claiming not to.
 */
export function useWorkIndicatorAngle(speedX: number, ramp: number, skew: number): number {
  const [angleDeg, setAngleDeg] = useState(0)
  const isWorkingRef = useRef(false)
  const stateRef = useRef<WorkIndicatorState>(WORK_INDICATOR_AT_REST)
  const frameRef = useRef<number | null>(null)

  const timingRef = useRef(resolveWorkIndicatorTiming(speedX, ramp, skew))
  useEffect(() => {
    // Recomputed when the reader moves a slider, not per frame: solving the
    // phase durations integrates two curves.
    timingRef.current = resolveWorkIndicatorTiming(speedX, ramp, skew)
  }, [speedX, ramp, skew])

  useEffect(() => {
    let lastFrameMs: number | null = null

    const step = (nowMs: number) => {
      const deltaSec = lastFrameMs === null ? 0 : Math.max(0, (nowMs - lastFrameMs) / 1000)
      lastFrameMs = nowMs
      const next = advanceWorkIndicator(stateRef.current, deltaSec, isWorkingRef.current, timingRef.current)
      stateRef.current = next
      setAngleDeg(next.angleDeg % 360)
      if (next.phase === 'idle' && !isWorkingRef.current) {
        frameRef.current = null
        lastFrameMs = null
        return
      }
      frameRef.current = requestAnimationFrame(step)
    }

    const ensureRunning = () => {
      if (frameRef.current !== null) return
      lastFrameMs = null
      frameRef.current = requestAnimationFrame(step)
    }

    const unsubscribe = subscribeToBackgroundWork((state) => {
      isWorkingRef.current = state.pending > 0
      if (state.pending > 0) ensureRunning()
    })

    return () => {
      unsubscribe()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  return angleDeg
}
