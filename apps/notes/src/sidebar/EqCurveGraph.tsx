import { useMemo } from 'react'

import { EQ_AMOUNT_MAX, EQ_GRID_POINTS, eqBankResponseDb, fitEqBandGains, type EqCurveParams } from '../shared/musicEqCurve'

/** The drawing's own units: x 0..WIDTH across 20 Hz to 20 kHz on a log axis, y -EQ_AMOUNT_MAX..+EQ_AMOUNT_MAX dB. */
const WIDTH = 240
const HEIGHT = 32
/** Where the decades fall on the log axis (100 Hz, 1 kHz, 10 kHz), as shares of the 20 Hz..20 kHz window. */
const DECADES = [100, 1000, 10000].map((hz) => Math.log(hz / 20) / Math.log(1000))

/**
 * The music EQ as it is HEARD: the response of the fitted filter bank, not the
 * target curve, so what is drawn is what plays. One row of the options grid,
 * all six columns; no labels in the panel, the axes are in the tooltip.
 */
export function EqCurveGraph({ curve }: { curve: EqCurveParams }) {
  const path = useMemo(() => {
    const response = eqBankResponseDb(fitEqBandGains(curve))
    let d = ''
    for (let k = 0; k < EQ_GRID_POINTS; k += 1) {
      const x = (k / (EQ_GRID_POINTS - 1)) * WIDTH
      const db = Math.max(-EQ_AMOUNT_MAX, Math.min(EQ_AMOUNT_MAX, response[k]))
      const y = (HEIGHT / 2) - ((db / EQ_AMOUNT_MAX) * (HEIGHT / 2))
      d += `${k === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    }
    return d
  }, [curve])
  return (
    <div
      className="options-eq-graph"
      data-tooltip={'EQ curve\n20 Hz to 20 kHz, -15 to +15 dB'}
      role="img"
      aria-label="Music EQ curve, 20 Hz to 20 kHz, -15 to +15 dB"
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {DECADES.map((share) => (
          <line key={share} className="options-eq-graph-grid" x1={share * WIDTH} x2={share * WIDTH} y1={0} y2={HEIGHT} />
        ))}
        <line className="options-eq-graph-grid" x1={0} x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} />
        <path className="options-eq-graph-curve" d={path} />
      </svg>
    </div>
  )
}
