/**
 * The visualizer hides the mouse cursor once it has been still for
 * `IDLE_MS`: `is-cursor-idle` goes on the root, and visualizer.css fades the
 * custom cursor out and then hides it and the native one. Any pointer
 * movement brings it back.
 */

import { useEffect } from 'react'

const IDLE_MS = 5000

export function CursorIdle() {
  useEffect(() => {
    const root = document.documentElement
    let timer = 0
    const arm = () => {
      root.classList.remove('is-cursor-idle')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => root.classList.add('is-cursor-idle'), IDLE_MS)
    }
    arm()
    window.addEventListener('pointermove', arm, true)
    window.addEventListener('pointerdown', arm, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', arm, true)
      window.removeEventListener('pointerdown', arm, true)
      root.classList.remove('is-cursor-idle')
    }
  }, [])
  return null
}
