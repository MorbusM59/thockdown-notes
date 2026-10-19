/**
 * The word count panel's two faces: the word count, and while the reader is
 * typing (with the flow meter on) their typing rate in characters per second
 * (`flowMeter.subscribeRate`), one decimal, as a bare figure: the unit is in
 * the tooltip and the User Guide, never on screen. A figure for the reader's own
 * reference rather than words per minute, which assumes a word length and a
 * controlled text and invites comparison with others.
 *
 * The rate changes on every character, so it is written straight into the
 * DOM rather than through React state, and the two faces are swapped with the
 * `hidden` attribute. Only the ACTIVE slot shows it: the meter is one for the
 * window and the keys go to the active slot's editor.
 *
 * A third face is speed reading's pace (`speedReading/speedReadingStore.ts`),
 * in words per minute, while a session runs in the active slot: the session
 * holds the keyboard, so the typing rate cannot be showing at the same time,
 * and Left / Right change the figure this is where the reader sees it.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { flowMeter } from './flowMeter'
import { getSpeedReadingDisplay, subscribeSpeedReadingDisplay } from '../speedReading/speedReadingStore'

export function TypingRateOrWordCount({ active, children }: { active: boolean; children: ReactNode }) {
  const countRef = useRef<HTMLSpanElement>(null)
  const rateRef = useRef<HTMLSpanElement>(null)
  const figureRef = useRef<HTMLElement>(null)
  const paceRef = useRef<HTMLSpanElement>(null)
  const paceFigureRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!active) return
    const show = (rate: number | null) => {
      const count = countRef.current
      const rateFace = rateRef.current
      if (!count || !rateFace) return
      if (rate === null) {
        count.hidden = paceRef.current?.hidden === false
        rateFace.hidden = true
        return
      }
      if (figureRef.current) figureRef.current.textContent = rate.toFixed(1)
      count.hidden = true
      rateFace.hidden = false
    }
    const unsubscribe = flowMeter.subscribeRate(show)
    return () => {
      unsubscribe()
      show(null)
    }
  }, [active])

  useEffect(() => {
    const pace = paceRef.current
    const count = countRef.current
    const rateFace = rateRef.current
    if (!active || !pace || !count) return
    const show = () => {
      const display = getSpeedReadingDisplay()
      if (display && paceFigureRef.current) paceFigureRef.current.textContent = String(display.wpm)
      pace.hidden = display === null
      count.hidden = display !== null || rateFace?.hidden === false
    }
    show()
    const unsubscribe = subscribeSpeedReadingDisplay(show)
    return () => {
      unsubscribe()
      pace.hidden = true
      if (rateFace?.hidden !== false) count.hidden = false
    }
  }, [active])

  return (
    <>
      <span ref={paceRef} hidden data-tooltip="Speed reading: words per minute (Left / Right)"><b ref={paceFigureRef} className="readout-figure" /></span>
      <span ref={countRef}>{children}</span>
      <span ref={rateRef} hidden data-tooltip="Letters per second, over your last ten"><b ref={figureRef} className="readout-figure" /></span>
    </>
  )
}
