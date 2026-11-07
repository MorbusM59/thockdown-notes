/**
 * The word count panel's two faces: the word count, and speed reading's pace
 * (`speedReading/speedReadingStore.ts`), in words per minute, while a session
 * runs in the active slot. The session holds the keyboard and Left / Right
 * change the figure, so this is where the reader sees it. The pace is a bare
 * figure: the unit is in the tooltip and the User Guide, never on screen.
 * Beside it, the time left in the note at that pace, as `hh:mm:ss`
 * (`SpeedReadingDisplay.secondsLeft`).
 * The faces are swapped with the `hidden` attribute, outside React state.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { getSpeedReadingDisplay, subscribeSpeedReadingDisplay } from '../speedReading/speedReadingStore'
import { formatClock } from '../speedReading/speedReadingPace'

export function WordCountOrPace({ active, children }: { active: boolean; children: ReactNode }) {
  const countRef = useRef<HTMLSpanElement>(null)
  const paceRef = useRef<HTMLSpanElement>(null)
  const paceFigureRef = useRef<HTMLElement>(null)
  const timeLeftRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const pace = paceRef.current
    const count = countRef.current
    if (!active || !pace || !count) return
    const show = () => {
      const display = getSpeedReadingDisplay()
      if (display && paceFigureRef.current) paceFigureRef.current.textContent = String(display.wpm)
      if (display && timeLeftRef.current) timeLeftRef.current.textContent = formatClock(display.secondsLeft)
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
      <span ref={paceRef} hidden data-tooltip="Speed reading: words per minute (Left / Right) | time left in the note at this pace">
        <b ref={paceFigureRef} className="readout-figure" /> | <b ref={timeLeftRef} className="readout-figure" />
      </span>
      <span ref={countRef}>{children}</span>
    </>
  )
}
