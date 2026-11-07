/**
 * The word count panel's two faces: the word count, and speed reading's pace
 * (`speedReading/speedReadingStore.ts`), in words per minute, while a session
 * runs in the active slot. The session holds the keyboard and Left / Right
 * change the figure, so this is where the reader sees it. The pace is a bare
 * figure: the unit is in the tooltip and the User Guide, never on screen.
 * The faces are swapped with the `hidden` attribute, outside React state.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { getSpeedReadingDisplay, subscribeSpeedReadingDisplay } from '../speedReading/speedReadingStore'

export function WordCountOrPace({ active, children }: { active: boolean; children: ReactNode }) {
  const countRef = useRef<HTMLSpanElement>(null)
  const paceRef = useRef<HTMLSpanElement>(null)
  const paceFigureRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const pace = paceRef.current
    const count = countRef.current
    if (!active || !pace || !count) return
    const show = () => {
      const display = getSpeedReadingDisplay()
      if (display && paceFigureRef.current) paceFigureRef.current.textContent = String(display.wpm)
      pace.hidden = display === null
      count.hidden = display !== null
    }
    show()
    const unsubscribe = subscribeSpeedReadingDisplay(show)
    return () => {
      unsubscribe()
      pace.hidden = true
      count.hidden = false
    }
  }, [active])

  return (
    <>
      <span ref={paceRef} hidden data-tooltip="Speed reading: words per minute (Left / Right)"><b ref={paceFigureRef} className="readout-figure" /></span>
      <span ref={countRef}>{children}</span>
    </>
  )
}
