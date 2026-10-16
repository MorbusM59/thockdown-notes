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
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { flowMeter } from './flowMeter'

export function TypingRateOrWordCount({ active, children }: { active: boolean; children: ReactNode }) {
  const countRef = useRef<HTMLSpanElement>(null)
  const rateRef = useRef<HTMLSpanElement>(null)
  const figureRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!active) return
    const show = (rate: number | null) => {
      const count = countRef.current
      const rateFace = rateRef.current
      if (!count || !rateFace) return
      if (rate === null) {
        count.hidden = false
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

  return (
    <>
      <span ref={countRef}>{children}</span>
      <span ref={rateRef} hidden data-tooltip="Letters per second, over your last ten"><b ref={figureRef} className="readout-figure" /></span>
    </>
  )
}
