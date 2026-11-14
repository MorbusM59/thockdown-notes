import { useEffect, useRef, useSyncExternalStore } from 'react'

import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { PresetMark } from '@thockdown/interaction/PresetMark'
import { idKind, type UiLoadoutApi, type UiLoadoutEntry, type UiLoadoutListResult } from '@thockdown/look/loadouts'
import { factoryLayoutIcon } from '@thockdown/look/presets'

import { IconPicker } from './iconPicker/IconPicker'
import { closeIconPick, isPickingIconFor, readIconPick, subscribeIconPick, toggleIconPick } from './iconPicker/iconPick'

/** Runs a layout action and applies whatever it leaves active (App.tsx's `changeLoadouts`). */
type ChangeLoadouts = (action: (api: UiLoadoutApi) => Promise<UiLoadoutListResult>) => Promise<void>

interface LayoutHostProps {
  /** The current mode's layouts, factory first. */
  entries: readonly UiLoadoutEntry[]
  change: ChangeLoadouts
}

/** The icon picker for the layout in use (iconPicker/iconPick.ts). */
export function LayoutIconPicker({ entries, change, query }: LayoutHostProps & { query: string }) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const id = pick?.target.kind === 'layout' ? pick.target.id : null
  const entry = entries.find((candidate) => candidate.id === id)
  if (!entry) return null
  return (
    <IconPicker
      label={entry.name}
      current={entry.icon}
      query={query}
      onPick={(icon) => {
        closeIconPick()
        void change((api) => api.setIcon(entry.id, icon))
      }}
    />
  )
}

/**
 * Layouts' dock, the soundscapes' in shape: the layout in use, its mark (the
 * icon picker) and name, then resetting it to NEUTRAL_BASE (an edit like any
 * other), and a hold that trashes one of the reader's own or restores a
 * factory one as shipped.
 */
export function LayoutDock({ entries, change, onReset }: LayoutHostProps & { onReset: () => void }) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const entry = entries.find((candidate) => candidate.isActive) ?? null
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])
  if (!entry) return null
  const factory = idKind(entry.id) === 'factory'
  const target = { kind: 'layout', id: entry.id } as const
  return (
    <div className="options-curve-rows options-dock-rows">
      <DockEntryRow
        className="preset-dock-row"
        name={entry.name}
        takenNames={entries.filter((other) => other.id !== entry.id).map((other) => other.name)}
        onRename={(name) => change((api) => api.rename(entry.id, name))}
        mark={<PresetMark preset={entry} />}
        picking={isPickingIconFor(pick, target)}
        onTogglePicker={() => toggleIconPick(target)}
        onResetMark={() => void change((api) => api.setIcon(entry.id, factory ? factoryLayoutIcon(entry.id) : null))}
      >
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={`Reset ${entry.name} to the neutral layout`}
          aria-label={`Reset ${entry.name}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onReset}
        >
          <span className="fa-solid fa-rotate-left" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={factory ? `Hold to restore ${entry.name} as shipped` : `Hold to trash ${entry.name}`}
          aria-label={factory ? `Restore ${entry.name} as shipped` : `Trash ${entry.name}`}
          data-secondary-press="none"
          disabled={factory && !entry.edited}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.button !== 0) return
            cancelHold()
            cancelHoldRef.current = armHold(() => {
              cancelHoldRef.current = null
              void change((api) => (factory ? api.restoreFactory(entry.id) : api.deleteCustom(entry.id)))
            }, HOLD_CONFIRM_MS)
          }}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onMouseLeave={cancelHold}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <span className={`fa-solid ${factory ? 'fa-clock-rotate-left' : 'fa-trash-can'}`} aria-hidden="true" />
        </button>
      </DockEntryRow>
    </div>
  )
}
