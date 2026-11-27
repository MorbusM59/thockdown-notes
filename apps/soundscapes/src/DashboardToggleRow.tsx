/**
 * The dashboard dock's TOGGLE ROW: one row of six cells, above the volumes.
 *
 * Each toggle is a button with a TAP of its own (the timer on and off, dark
 * mode, the EQ, the visualizer) and a HOLD that replaces the row with the
 * toggle's PICKER: up to five cells, then a return button in the sixth. A
 * toggle that is only a menu (the play mode) opens its picker on a tap too.
 * The row comes back when
 *
 * - an option is picked (the picker calls `close`),
 * - the return button is tapped,
 * - or a press lands anywhere outside the row.
 *
 * The finger that completed the hold is still down when the picker appears,
 * and its release would click whichever cell is now under it; the row
 * swallows that one click.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TapHoldButton } from './Dashboard'

export interface DashboardToggle {
  id: string
  label: string
  /** Pressed in. */
  active: boolean
  /** The button's face: an icon or a short value. */
  face: ReactNode
  /** Extra classes on the button (a text face's sizing). */
  className?: string
  /** What a tap does: its own action, or 'picker' to open the picker as a hold does; nothing without it. */
  onTap?: (() => void) | 'picker'
  /** The picker's cells, at most five; `close` returns to the row. */
  picker: (close: () => void) => ReactNode
}

export function DashboardToggleRow({ toggles }: { toggles: readonly DashboardToggle[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const swallowClickRef = useRef(false)
  const open = toggles.find((toggle) => toggle.id === openId) ?? null
  const close = () => setOpenId(null)

  // A press outside the row returns to it; the press itself goes on to whatever it landed on.
  useEffect(() => {
    if (openId === null) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setOpenId(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [openId])

  return (
    <div
      ref={rowRef}
      className="options-loadout-grid mobile-dashboard-toggles"
      role="group"
      aria-label={open ? open.label : 'Dashboard'}
      onPointerDownCapture={() => { swallowClickRef.current = false }}
      onClickCapture={(event) => {
        if (!swallowClickRef.current) return
        swallowClickRef.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {open ? (<>
        {/* Keyed by the picker, so no cell of the row is reused for an option. */}
        <PickerCells key={open.id}>{open.picker(close)}</PickerCells>
        <button
          type="button"
          className="btn-icon options-color-swatch options-loadout-btn mobile-dashboard-return"
          aria-label="Back"
          onClick={close}
        >
          <span className="fa-solid fa-circle-arrow-left" aria-hidden="true" />
        </button>
      </>) : toggles.map((toggle) => (
        <TapHoldButton
          key={toggle.id}
          label={toggle.label}
          active={toggle.active}
          className={toggle.className}
          onTap={() => {
            if (toggle.onTap === 'picker') setOpenId(toggle.id)
            else toggle.onTap?.()
          }}
          onHold={() => {
            swallowClickRef.current = true
            setOpenId(toggle.id)
          }}
        >
          {toggle.face}
        </TapHoldButton>
      ))}
    </div>
  )
}

function PickerCells({ children }: { children: ReactNode }) {
  return <>{children}</>
}
