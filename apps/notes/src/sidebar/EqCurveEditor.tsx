import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import { useGracedWheel } from '@thockdown/interaction/useGracedWheel'

import {
  EQ_DB_MAX,
  EQ_DB_STEP,
  EQ_HANDLE_STEP,
  EQ_SEMITONE_STEP,
  EQ_SPAN_SEMITONES,
  editEqPoint,
  eqPointSemitoneRange,
  eqSegment,
  insertEqPoint,
  insertEqPointAfter,
  setEqPointFrequency,
  removeEqPoint,
  semitonesOf,
  type EqPoint,
} from '../shared/musicEqCurve'
import { useHoldToAdjust, type HoldToAdjustKeyboardController } from '../shared/useHoldToAdjust'

interface EqCurveEditorProps {
  curve: EqPoint[]
  onChange: (next: EqPoint[]) => void
}

/** The drawing's own units: x 0..WIDTH across the frequency axis, y 0..HEIGHT from +EQ_DB_MAX down to -EQ_DB_MAX. */
const WIDTH = 1000
const HEIGHT = 1000
const xOf = (semitones: number) => (semitones / EQ_SPAN_SEMITONES) * WIDTH
const yOf = (db: number) => (0.5 - (db / (2 * EQ_DB_MAX))) * HEIGHT
/** One dotted line per octave above 20 Hz. */
const OCTAVES = Array.from({ length: Math.floor(EQ_SPAN_SEMITONES / 12) }, (_, k) => xOf((k + 1) * 12))

function formatHz(hz: number): string {
  return hz < 1000 ? `${Math.round(hz)}Hz` : `${(hz / 1000).toFixed(1)}kHz`
}

function formatDb(db: number): string {
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

const snap = (value: number, step: number) => Math.round(value / step) * step

interface Drag {
  index: number
  mode: 'move' | 'handle'
  pointerId: number
  startY: number
  startHandle: number
}

/**
 * The music EQ curve, drawn and edited directly (`shared/musicEqCurve.ts`): a
 * graph two rows of the options grid tall, and a row of fields per point
 * below it. Every edit goes through the model's pure operations, so the rules
 * (ends fixed on the axis, points kept apart and in order, the cap) hold
 * whichever control made it.
 */
export function EqCurveEditor({ curve, onChange }: EqCurveEditorProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const graphRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const curveRef = useRef(curve)
  curveRef.current = curve
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const keysDownRef = useRef(new Set<string>())

  const active = selected !== null && selected < curve.length ? selected : null

  // Clicking anywhere outside the editor lets go of the point.
  useEffect(() => {
    if (active === null) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && editorRef.current?.contains(event.target)) return
      setSelected(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [active])

  const edit = useCallback((index: number, change: { semitones?: number; db?: number; handle?: number }) => {
    onChange(editEqPoint(curveRef.current, index, change))
  }, [onChange])

  // Arrow keys: one semitone or half a dB a press, accelerating while held,
  // through the app's one hold-to-adjust curve.
  const xController = useRef<HoldToAdjustKeyboardController | null>(null)
  const yController = useRef<HoldToAdjustKeyboardController | null>(null)
  const [xLow, xHigh] = active === null ? [0, 0] : eqPointSemitoneRange(curve, active)
  useHoldToAdjust({
    getValue: () => (selectedRef.current === null ? 0 : semitonesOf(curveRef.current[selectedRef.current].hz)),
    onChange: (value) => { if (selectedRef.current !== null) edit(selectedRef.current, { semitones: value }) },
    min: xLow,
    max: xHigh,
    step: EQ_SEMITONE_STEP,
  }, xController)
  useHoldToAdjust({
    getValue: () => (selectedRef.current === null ? 0 : curveRef.current[selectedRef.current].db),
    onChange: (value) => { if (selectedRef.current !== null) edit(selectedRef.current, { db: value }) },
    min: -EQ_DB_MAX,
    max: EQ_DB_MAX,
    step: EQ_DB_STEP,
  }, yController)

  const pointerValues = (event: { clientX: number; clientY: number }) => {
    const rect = plotRef.current!.getBoundingClientRect()
    const semitones = ((event.clientX - rect.left) / rect.width) * EQ_SPAN_SEMITONES
    const db = (0.5 - ((event.clientY - rect.top) / rect.height)) * 2 * EQ_DB_MAX
    return { semitones: snap(semitones, EQ_SEMITONE_STEP), db: snap(db, EQ_DB_STEP), height: rect.height }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 2) return
    event.preventDefault()
    graphRef.current?.focus({ preventScroll: true })
    const pointElement = (event.target as Element).closest('[data-eq-point]')
    let index = pointElement ? Number(pointElement.getAttribute('data-eq-point')) : null
    if (index === null) {
      if (event.button !== 0) return
      // With a point selected, a click on empty space only lets go of it.
      if (active !== null) {
        setSelected(null)
        return
      }
      const { semitones, db } = pointerValues(event)
      const added = insertEqPoint(curveRef.current, semitones, db)
      if (!added) return
      onChange(added.curve)
      index = added.index
    }
    setSelected(index)
    dragRef.current = {
      index,
      mode: event.button === 2 ? 'handle' : 'move',
      pointerId: event.pointerId,
      startY: event.clientY,
      startHandle: curveRef.current[index]?.handle ?? 0,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const { semitones, db, height } = pointerValues(event)
    if (drag.mode === 'move') {
      edit(drag.index, { semitones, db })
    } else {
      // Up lengthens the handles, down shortens them: the graph's height is the whole range.
      edit(drag.index, { handle: snap(drag.startHandle + ((drag.startY - event.clientY) / height), EQ_HANDLE_STEP) })
    }
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
  }

  const removeSelected = () => {
    if (active === null || active === 0 || active === curve.length - 1) return
    onChange(removeEqPoint(curve, active))
    setSelected(null)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (active === null) return
    const controllers: Record<string, [typeof xController, 0 | 2]> = {
      ArrowLeft: [xController, 0],
      ArrowRight: [xController, 2],
      ArrowDown: [yController, 0],
      ArrowUp: [yController, 2],
    }
    if (event.key in controllers) {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat || keysDownRef.current.has(event.key)) return
      keysDownRef.current.add(event.key)
      const [controller, button] = controllers[event.key]
      controller.current?.start(button)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
      removeSelected()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setSelected(null)
    }
  }

  const onKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!keysDownRef.current.delete(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') xController.current?.end()
    else yController.current?.end()
  }

  const path = useMemo(() => {
    let d = `M${xOf(0)} ${yOf(curve[0].db)}`
    for (let index = 0; index < curve.length - 1; index += 1) {
      const [, c1, c2, end] = eqSegment(curve, index)
      d += `C${xOf(c1[0])} ${yOf(c1[1])} ${xOf(c2[0])} ${yOf(c2[1])} ${xOf(end[0])} ${yOf(end[1])}`
    }
    return d
  }, [curve])

  return (
    <div className="options-eq-editor" ref={editorRef}>
      <div className="options-loadout-grid">
        <div
          className="options-eq-graph"
          ref={graphRef}
          tabIndex={0}
          role="group"
          aria-label="Music EQ curve"
          data-tooltip={'EQ curve: 20 Hz to 20 kHz, -15 to +15 dB\nClick to add a point, drag to move it, right-drag up or down to round it.\nArrows move the selected point, Delete removes it.'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => {
            keysDownRef.current.clear()
            xController.current?.cancel()
            yController.current?.cancel()
          }}
          data-secondary-press="action"
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="utility-setting-scrollbar-rail" aria-hidden="true" />
          <div className="options-eq-plot" ref={plotRef}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            {OCTAVES.map((x) => (
              <line key={x} className="options-eq-graph-octave" x1={x} x2={x} y1={0} y2={HEIGHT} />
            ))}
            <line className="options-eq-graph-centre" x1={0} x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} />
            <path className="options-eq-graph-curve" d={path} />
          </svg>
          {curve.map((point, index) => (
            <span
              key={index}
              data-eq-point={index}
              className={`utility-setting-scrollbar-thumb options-eq-point${index === active ? ' is-active' : ''}`}
              style={{ left: `${(xOf(semitonesOf(point.hz)) / WIDTH) * 100}%`, top: `${(yOf(point.db) / HEIGHT) * 100}%` }}
            />
          ))}
          </div>
        </div>
      </div>
      <div className="options-eq-rows" role="group" aria-label="Music EQ points">
        {curve.map((_, index) => (
          <EqPointRow
            key={index}
            curve={curve}
            index={index}
            isActive={index === active}
            onSelect={() => setSelected(index)}
            onEdit={(change) => edit(index, change)}
            onSetHz={(hz) => {
              const moved = setEqPointFrequency(curve, index, hz)
              if (!moved) return
              onChange(moved.curve)
              setSelected(moved.index)
            }}
            onRemove={() => {
              onChange(removeEqPoint(curve, index))
              setSelected(null)
            }}
            onAdd={() => {
              const added = insertEqPointAfter(curve, index)
              if (!added) return
              onChange(added.curve)
              setSelected(added.index)
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface EqPointRowProps {
  curve: EqPoint[]
  index: number
  isActive: boolean
  onSelect: () => void
  onEdit: (change: { semitones?: number; db?: number; handle?: number }) => void
  onSetHz: (hz: number) => void
  onRemove: () => void
  onAdd: () => void
}

function EqPointRow({ curve, index, isActive, onSelect, onEdit, onSetHz, onRemove, onAdd }: EqPointRowProps) {
  const point = curve[index]
  const isLast = index === curve.length - 1
  const isEnd = index === 0 || isLast
  const label = index === 0 ? 'min' : index === curve.length - 1 ? 'max' : String(index)
  const at = semitonesOf(point.hz)
  return (
    <div className={`options-eq-row${isActive ? ' is-active' : ''}`}>
      <span className="options-eq-cell options-eq-index">{label}</span>
      <EqField
        ariaLabel={`Point ${label} frequency in Hz`}
        display={formatHz(point.hz)}
        raw={String(Math.round(point.hz))}
        readOnly={isEnd}
        onFocus={onSelect}
        onType={onSetHz}
        onStep={(direction) => onEdit({ semitones: at + (direction * EQ_SEMITONE_STEP) })}
      />
      <EqField
        ariaLabel={`Point ${label} gain in dB`}
        display={formatDb(point.db)}
        raw={String(point.db)}
        onFocus={onSelect}
        onType={(value) => onEdit({ db: value })}
        onStep={(direction) => onEdit({ db: snap(point.db, EQ_DB_STEP) + (direction * EQ_DB_STEP) })}
      />
      <EqField
        ariaLabel={`Point ${label} handle, 0 to 2`}
        display={point.handle.toFixed(2)}
        raw={String(point.handle)}
        onFocus={onSelect}
        onType={(value) => onEdit({ handle: value })}
        onStep={(direction) => onEdit({ handle: snap(point.handle, EQ_HANDLE_STEP) + (direction * EQ_HANDLE_STEP) })}
      />
      <button
        type="button"
        className={`options-eq-cell options-eq-button${isEnd ? ' is-disabled' : ''}`}
        data-tooltip={isEnd ? 'The first and last points cannot be removed' : `Remove point ${label}`}
        aria-label={`Remove point ${label}`}
        aria-disabled={isEnd}
        onClick={() => { if (!isEnd) onRemove() }}
      >
        <span className="fa-solid fa-xmark" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`options-eq-cell options-eq-button${isLast ? ' is-disabled' : ''}`}
        data-tooltip={isLast ? 'No point can follow the last one' : 'Add a point after this one'}
        aria-label={`Add a point after point ${label}`}
        aria-disabled={isLast}
        onClick={() => { if (!isLast) onAdd() }}
      >
        <span className="fa-solid fa-plus" aria-hidden="true" />
      </button>
    </div>
  )
}

interface EqFieldProps {
  ariaLabel: string
  /** Shown while the field is not being typed in. */
  display: string
  /** Put in the field to type over. */
  raw: string
  readOnly?: boolean
  onFocus: () => void
  onType: (value: number) => void
  /** One wheel notch: +1 up, -1 down. */
  onStep: (direction: 1 | -1) => void
}

/** A number field drawn as a slider track: type a value, or wheel over it one step at a time. */
function EqField({ ariaLabel, display, raw, readOnly, onFocus, onType, onStep }: EqFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const onWheel = useCallback((event: WheelEvent) => {
    if (readOnly || event.deltaY === 0) return
    event.preventDefault()
    event.stopPropagation()
    onStep(event.deltaY < 0 ? 1 : -1)
  }, [onStep, readOnly])
  useGracedWheel(ref, onWheel)
  const commit = () => {
    if (draft !== null) {
      const value = Number.parseFloat(draft.replace(',', '.'))
      if (Number.isFinite(value)) onType(value)
    }
    setDraft(null)
  }
  return (
    <input
      ref={ref}
      className="options-eq-cell options-eq-field"
      aria-label={ariaLabel}
      inputMode="decimal"
      spellCheck={false}
      readOnly={readOnly}
      value={draft ?? display}
      onFocus={(event) => {
        onFocus()
        if (readOnly) return
        setDraft(raw)
        requestAnimationFrame(() => event.target.select())
      }}
      onChange={(event) => setDraft(event.target.value.replace(/[^0-9.,-]/g, ''))}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(null)
          requestAnimationFrame(() => ref.current?.blur())
        }
      }}
    />
  )
}
