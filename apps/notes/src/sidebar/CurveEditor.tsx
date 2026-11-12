import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import { HOLD_GRACE_PX } from '@thockdown/interaction/holdTiming'
import { useGracedWheel } from '@thockdown/interaction/useGracedWheel'

import {
  curvePath,
  curvePointXRange,
  editCurvePoint,
  insertCurvePoint,
  insertCurvePointAfter,
  removeCurvePoint,
  setCurvePointX,
  type CurvePlane,
  type CurvePoint,
  type CurvePointChange,
} from '../shared/drawnCurve'
import { useHoldToAdjust, type HoldToAdjustKeyboardController } from '../shared/useHoldToAdjust'

/** A grid line across the drawing: dotted, dashed or solid. */
export interface CurveGridLine {
  at: number
  kind: 'dotted' | 'dashed' | 'solid'
}

/** How one axis is shown in the point rows: the value as read, as put in the field to type over, and a typed value back into the plane's units (NaN refuses it). */
export interface CurveAxisFormat {
  display: (value: number) => string
  raw: (value: number) => string
  parse: (typed: number) => number
  /** Names the field, for its accessible label: "frequency in Hz". */
  noun: string
}

export interface CurveEditorProps {
  plane: CurvePlane
  curve: CurvePoint[]
  onChange: (next: CurvePoint[]) => void
  /** One arrow press, wheel notch or drag step, in the plane's units. */
  xStep: number
  yStep: number
  handleStep: number
  /** The handle a point placed by the reader starts with. */
  defaultHandle: number
  /** Grid lines at an x (vertical) or a y (horizontal), in the plane's units. */
  verticals: readonly CurveGridLine[]
  horizontals: readonly CurveGridLine[]
  x: CurveAxisFormat
  y: CurveAxisFormat
  /** What the two end points are called in the rows. */
  endLabels?: readonly [string, string]
  /** Optional non-interactive labels for the four value columns. */
  columnHeaders?: readonly [string, string, string, string]
  /** Optional replacement for the default endpoint labels. */
  pointLabel?: (index: number, isLast: boolean) => string
  ariaLabel: string
  /** The graph's tooltip: what the plane is, then how it is operated. */
  tooltip: string
}

/** The drawing's own units: x 0..WIDTH across the plane, y 0..HEIGHT from its top down to its bottom. */
const WIDTH = 1000
const HEIGHT = 1000

const snap = (value: number, step: number) => Math.round(value / step) * step

interface Drag {
  index: number
  mode: 'move' | 'handle'
  pointerId: number
  startX: number
  startY: number
  startHandle: number
  /** Whether the pointer has left the grace radius; a right press that never does removes the point. */
  moved: boolean
}

/**
 * A drawn curve (`shared/drawnCurve.ts`), drawn and edited directly: a graph
 * two rows of the options grid tall, and a row of fields per point below it.
 * Every edit goes through the model's pure operations, so the rules (ends
 * fixed on the axis, points kept apart and in order, the cap, a wrapping
 * curve's seam) hold whichever control made it. The music EQ and the
 * flashing curve are both this editor on their own plane.
 */
export function CurveEditor(props: CurveEditorProps) {
  const { plane, curve, onChange, xStep, yStep, handleStep, defaultHandle, verticals, horizontals, ariaLabel, tooltip } = props
  const xOf = (x: number) => (x / plane.xMax) * WIDTH
  const yOf = (y: number) => ((plane.yMax - y) / (plane.yMax - plane.yMin)) * HEIGHT
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

  const edit = useCallback((index: number, change: CurvePointChange) => {
    onChange(editCurvePoint(plane, curveRef.current, index, change))
  }, [onChange, plane])

  // Arrow keys: one step a press, accelerating while held, through the app's
  // one hold-to-adjust curve.
  const xController = useRef<HoldToAdjustKeyboardController | null>(null)
  const yController = useRef<HoldToAdjustKeyboardController | null>(null)
  const [xLow, xHigh] = active === null ? [0, 0] : curvePointXRange(plane, curve, active)
  useHoldToAdjust({
    getValue: () => (selectedRef.current === null ? 0 : curveRef.current[selectedRef.current].x),
    onChange: (value) => { if (selectedRef.current !== null) edit(selectedRef.current, { x: value }) },
    min: xLow,
    max: xHigh,
    step: xStep,
  }, xController)
  useHoldToAdjust({
    getValue: () => (selectedRef.current === null ? 0 : curveRef.current[selectedRef.current].y),
    onChange: (value) => { if (selectedRef.current !== null) edit(selectedRef.current, { y: value }) },
    min: plane.yMin,
    max: plane.yMax,
    step: yStep,
  }, yController)

  const pointerValues = (event: { clientX: number; clientY: number }) => {
    const rect = plotRef.current!.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * plane.xMax
    const y = plane.yMax - (((event.clientY - rect.top) / rect.height) * (plane.yMax - plane.yMin))
    return { x: snap(x, xStep), y: snap(y, yStep), height: rect.height }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 2) return
    event.preventDefault()
    graphRef.current?.focus({ preventScroll: true })
    const pointElement = (event.target as Element).closest('[data-curve-point]')
    let index = pointElement ? Number(pointElement.getAttribute('data-curve-point')) : null
    if (index === null) {
      if (event.button !== 0) return
      // With a point selected, a click on empty space only lets go of it.
      if (active !== null) {
        setSelected(null)
        return
      }
      const { x, y } = pointerValues(event)
      const added = insertCurvePoint(plane, curveRef.current, x, y, defaultHandle)
      if (!added) return
      onChange(added.curve)
      index = added.index
    }
    setSelected(index)
    dragRef.current = {
      index,
      mode: event.button === 2 ? 'handle' : 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      startHandle: curveRef.current[index]?.handle ?? 0,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < HOLD_GRACE_PX) return
      drag.moved = true
    }
    const { x, y, height } = pointerValues(event)
    if (drag.mode === 'move') {
      edit(drag.index, { x, y })
    } else {
      // Up lengthens the handles, down shortens them: the graph's height is the whole range.
      edit(drag.index, { handle: snap(drag.startHandle + ((drag.startY - event.clientY) / height), handleStep) })
    }
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId !== event.pointerId) return
    dragRef.current = null
    // A right press released without dragging removes the point (the end points stay).
    const curve = curveRef.current
    if (event.type === 'pointerup' && drag.mode === 'handle' && !drag.moved && drag.index > 0 && drag.index < curve.length - 1) {
      onChange(removeCurvePoint(curve, drag.index))
      setSelected(null)
    }
  }

  const removeSelected = () => {
    if (active === null || active === 0 || active === curve.length - 1) return
    onChange(removeCurvePoint(curve, active))
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

  const path = useMemo(() => curvePath(plane, curve, (x) => (x / plane.xMax) * WIDTH, (y) => ((plane.yMax - y) / (plane.yMax - plane.yMin)) * HEIGHT), [plane, curve])

  return (
    <div className="options-curve-editor" ref={editorRef}>
      <div className="options-loadout-grid">
        <div
          className="options-curve-graph"
          ref={graphRef}
          tabIndex={0}
          role="group"
          aria-label={ariaLabel}
          data-tooltip={`${tooltip}\nClick to add a point, drag to move it, right-drag up or down to round it, right-click to remove it.\nArrows move the selected point, Delete removes it.`}
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
          <div className="options-curve-plot" ref={plotRef}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            {verticals.map((line) => (
              <line key={`v${line.at}`} className={`options-curve-grid-${line.kind}`} x1={xOf(line.at)} x2={xOf(line.at)} y1={0} y2={HEIGHT} />
            ))}
            {horizontals.map((line) => (
              <line key={`h${line.at}`} className={`options-curve-grid-${line.kind}`} x1={0} x2={WIDTH} y1={yOf(line.at)} y2={yOf(line.at)} />
            ))}
            <path className="options-curve-graph-curve" d={path} />
          </svg>
          {curve.map((point, index) => (
            <span
              key={index}
              data-curve-point={index}
              className={`utility-setting-scrollbar-thumb options-curve-point${index === active ? ' is-active' : ''}`}
              style={{ left: `${(xOf(point.x) / WIDTH) * 100}%`, top: `${(yOf(point.y) / HEIGHT) * 100}%` }}
            />
          ))}
          </div>
        </div>
      </div>
      <div className="options-curve-rows" role="group" aria-label={`${ariaLabel}: points`}>
        {props.columnHeaders ? (
          <div className="options-curve-cell options-curve-display options-curve-header" aria-hidden="true">
            {props.columnHeaders.map((header, index) => (
              <span key={index} className="options-curve-header-cell">{header}</span>
            ))}
            <span className="options-curve-header-cell" />
            <span className="options-curve-header-cell" />
          </div>
        ) : null}
        {curve.map((_, index) => (
          <CurvePointRow
            key={index}
            {...props}
            index={index}
            isActive={index === active}
            onSelect={() => setSelected(index)}
            onEdit={(change) => edit(index, change)}
            onSetX={(typed) => {
              const moved = setCurvePointX(plane, curve, index, props.x.parse(typed))
              if (!moved) return
              onChange(moved.curve)
              setSelected(moved.index)
            }}
            onRemove={() => {
              onChange(removeCurvePoint(curve, index))
              setSelected(null)
            }}
            onAdd={() => {
              const added = insertCurvePointAfter(plane, curve, index, xStep, yStep, defaultHandle)
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

interface CurvePointRowProps extends CurveEditorProps {
  index: number
  isActive: boolean
  onSelect: () => void
  onEdit: (change: CurvePointChange) => void
  onSetX: (typed: number) => void
  onRemove: () => void
  onAdd: () => void
}

function CurvePointRow({ curve, index, isActive, onSelect, onEdit, onSetX, onRemove, onAdd, x, y, xStep, yStep, handleStep, plane, endLabels, pointLabel }: CurvePointRowProps) {
  const point = curve[index]
  const isLast = index === curve.length - 1
  const isEnd = index === 0 || isLast
  const label = pointLabel
    ? pointLabel(index, isLast)
    : index === 0 ? endLabels?.[0] ?? String(index) : isLast ? endLabels?.[1] ?? String(index) : String(index)
  return (
    <div className={`options-curve-row${isActive ? ' is-active' : ''}`}>
      <span className="options-curve-cell options-curve-display options-curve-index">{label}</span>
      <CurveField
        ariaLabel={`Point ${label} ${x.noun}`}
        display={x.display(point.x)}
        raw={x.raw(point.x)}
        readOnly={isEnd}
        onFocus={onSelect}
        onType={onSetX}
        onStep={(direction) => onEdit({ x: point.x + (direction * xStep) })}
      />
      <CurveField
        ariaLabel={`Point ${label} ${y.noun}`}
        display={y.display(point.y)}
        raw={y.raw(point.y)}
        onFocus={onSelect}
        onType={(value) => { const parsed = y.parse(value); if (Number.isFinite(parsed)) onEdit({ y: parsed }) }}
        onStep={(direction) => onEdit({ y: snap(point.y, yStep) + (direction * yStep) })}
      />
      <CurveField
        ariaLabel={`Point ${label} handle, 0 to ${plane.handleMax}`}
        display={point.handle.toFixed(2)}
        raw={String(point.handle)}
        onFocus={onSelect}
        onType={(value) => onEdit({ handle: value })}
        onStep={(direction) => onEdit({ handle: snap(point.handle, handleStep) + (direction * handleStep) })}
      />
      <button
        type="button"
        className={`options-curve-cell options-curve-button${isEnd ? ' is-disabled' : ''}`}
        data-tooltip={isEnd ? 'The first and last points cannot be removed' : `Remove point ${label}`}
        aria-label={`Remove point ${label}`}
        aria-disabled={isEnd}
        onClick={() => { if (!isEnd) onRemove() }}
      >
        <span className="fa-solid fa-xmark" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`options-curve-cell options-curve-button${isLast ? ' is-disabled' : ''}`}
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

interface CurveFieldProps {
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
function CurveField({ ariaLabel, display, raw, readOnly, onFocus, onType, onStep }: CurveFieldProps) {
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
      className="options-curve-cell options-curve-field"
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
