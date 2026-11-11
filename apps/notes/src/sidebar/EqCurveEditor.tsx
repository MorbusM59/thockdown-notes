import { useCallback, useMemo } from 'react'

import type { CurvePoint } from '../shared/drawnCurve'
import {
  EQ_DB_MAX,
  EQ_DB_STEP,
  EQ_DEFAULT_HANDLE,
  EQ_HANDLE_STEP,
  EQ_PLANE,
  EQ_SEMITONE_STEP,
  EQ_SPAN_SEMITONES,
  eqFromPlane,
  eqToPlane,
  hzAtSemitones,
  semitonesOf,
  type EqPoint,
} from '../shared/musicEqCurve'
import { CurveEditor, type CurveAxisFormat, type CurveGridLine } from './CurveEditor'

/** One dotted line per octave above 20 Hz, and a dashed one at 0 dB. */
const VERTICALS: readonly CurveGridLine[] = Array.from({ length: Math.floor(EQ_SPAN_SEMITONES / 12) }, (_, k) => ({ at: (k + 1) * 12, kind: 'dotted' }))
const HORIZONTALS: readonly CurveGridLine[] = [{ at: 0, kind: 'dashed' }]

function formatHz(hz: number): string {
  return hz < 1000 ? String(Math.round(hz)) : `${Math.round(hz / 1000)}k`
}

const FREQUENCY: CurveAxisFormat = {
  display: (semitones) => formatHz(hzAtSemitones(semitones)),
  raw: (semitones) => String(Math.round(hzAtSemitones(semitones))),
  parse: (hz) => (hz > 0 ? semitonesOf(hz) : NaN),
  noun: 'frequency in Hz',
}

const GAIN: CurveAxisFormat = {
  display: (db) => `${db > 0 ? '+' : ''}${db.toFixed(1)}`,
  raw: (db) => String(db),
  parse: (db) => db,
  noun: 'gain in dB',
}

const HANDLE: Pick<CurveAxisFormat, 'display' | 'raw' | 'parse'> = {
  display: (value) => String(Math.round(value * 100)),
  raw: (value) => String(Math.round(value * 100)),
  parse: (value) => value / 100,
}

/** The music EQ curve (`shared/musicEqCurve.ts`): the shared curve editor on the EQ's plane of semitones by dB. */
export function EqCurveEditor({ curve, onChange }: { curve: EqPoint[]; onChange: (next: EqPoint[]) => void }) {
  const points = useMemo(() => eqToPlane(curve), [curve])
  const change = useCallback((next: CurvePoint[]) => onChange(eqFromPlane(next)), [onChange])
  return (
    <CurveEditor
      plane={EQ_PLANE}
      curve={points}
      onChange={change}
      xStep={EQ_SEMITONE_STEP}
      yStep={EQ_DB_STEP}
      handleStep={EQ_HANDLE_STEP}
      defaultHandle={EQ_DEFAULT_HANDLE}
      verticals={VERTICALS}
      horizontals={HORIZONTALS}
      x={FREQUENCY}
      y={GAIN}
      columnHeaders={['#', 'Hz', 'dB', '%']}
      pointLabel={(index) => String(index)}
      handleFormat={HANDLE}
      ariaLabel="Music EQ curve"
      tooltip={`EQ curve: 20 Hz to 20 kHz, -${EQ_DB_MAX} to +${EQ_DB_MAX} dB`}
    />
  )
}
