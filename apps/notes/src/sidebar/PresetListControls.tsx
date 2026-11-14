import { useEffect, useRef, useSyncExternalStore } from 'react'

import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { PresetMark } from '@thockdown/interaction/PresetMark'
import {
  activePreset,
  createPreset,
  defaultPresetIcon,
  deletePreset,
  editActivePreset,
  isEditedFactoryPreset,
  isFactoryPreset,
  newPresetId,
  presetsOf,
  renamePreset,
  restoreFactoryPreset,
  selectPreset,
  setPresetIcon,
  type PresetKind,
  type PresetList,
} from '@thockdown/interaction/presetList'

import { IconPicker } from './iconPicker/IconPicker'
import { closeIconPick, isPickingIconFor, readIconPick, subscribeIconPick, toggleIconPick } from './iconPicker/iconPick'

/** The icon picker target kinds whose entries are a PRESET LIST in Options. */
export type PresetPickKind = 'soundstage' | 'keystrokeSound' | 'flashing'

/**
 * One preset list's controls in Options (`packages/interaction/presetList.ts`),
 * the same for every list that uses the model: the GRID (every entry, the
 * active one marked, then the plus that copies the active one), the DOCK
 * (the active entry's mark and name, a reset, and a hold that trashes one of
 * the reader's own or restores a factory one as shipped) and the ICON PICKER
 * the dock's mark opens. A list hands over its kind and a few words; how
 * the list behaves is the model's, never a copy per list.
 */
interface PresetListHostProps<S> {
  kind: PresetKind<S>
  list: PresetList<S>
  /** Every change to the list; the owner plays the active entry when it changed. */
  onChange: (list: PresetList<S>) => void
}

export function PresetGrid<S>({ kind, list, onChange, idPrefix, label, plural }: PresetListHostProps<S> & {
  /** Prefix of a new entry's id. */
  idPrefix: string
  /** What the list is called, for its accessible name. */
  label: string
  /** "a soundstage", "a keystroke sound": what the plus creates. */
  plural: string
}) {
  const canCreate = list.custom.length < kind.maxCustom
  return (
    <div className="options-loadout-grid" role="group" aria-label={label}>
      {presetsOf(kind, list).map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${list.activeId === preset.id ? ' is-active' : ''}`}
          data-tooltip={preset.name}
          aria-label={preset.name}
          aria-pressed={list.activeId === preset.id}
          onClick={() => onChange(selectPreset(kind, list, preset.id))}
        >
          <PresetMark preset={preset} />
        </button>
      ))}
      <button
        type="button"
        className="btn-icon options-color-swatch options-loadout-btn options-loadout-plus"
        aria-label={`Create ${plural}`}
        data-tooltip={canCreate ? `Create ${plural}\nA copy of the one in use.` : `No room for another ${kind.noun.toLowerCase()}.`}
        disabled={!canCreate}
        onClick={() => {
          const created = createPreset(kind, list, newPresetId(idPrefix))
          if (created) onChange(created)
        }}
      >
        <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
      </button>
    </div>
  )
}

/** The icon picker for the active entry of a preset list (iconPicker/iconPick.ts). */
export function PresetIconPicker<S>({ kind, list, onChange, pickKind, query }: PresetListHostProps<S> & { pickKind: PresetPickKind; query: string }) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const id = pick?.target.kind === pickKind ? pick.target.id : null
  const preset = presetsOf(kind, list).find((candidate) => candidate.id === id)
  if (!preset) return null
  return (
    <IconPicker
      label={preset.name}
      current={preset.icon}
      query={query}
      onPick={(icon) => {
        closeIconPick()
        onChange(setPresetIcon(kind, list, preset.id, icon))
      }}
    />
  )
}

/**
 * The active entry's dock. `resetTo` is what the reset writes into it (as an
 * edit like any other), and `resetTooltip` says what that is in words.
 */
export function PresetDock<S>({ kind, list, onChange, pickKind, resetTo, resetTooltip }: PresetListHostProps<S> & {
  pickKind: PresetPickKind
  resetTo: S
  resetTooltip: string
}) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const preset = activePreset(kind, list)
  const factory = isFactoryPreset(kind, preset.id)
  const unchanged = factory && !isEditedFactoryPreset(list, preset.id)
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])
  const target = { kind: pickKind, id: preset.id }
  return (
    <div className="options-curve-rows options-dock-rows">
      <DockEntryRow
        className="preset-dock-row"
        name={preset.name}
        takenNames={presetsOf(kind, list).filter((other) => other.id !== preset.id).map((other) => other.name)}
        onRename={(name) => onChange(renamePreset(kind, list, preset.id, name))}
        mark={<PresetMark preset={preset} />}
        picking={isPickingIconFor(pick, target)}
        onTogglePicker={() => toggleIconPick(target)}
        onResetMark={() => onChange(setPresetIcon(kind, list, preset.id, defaultPresetIcon(kind, preset.id)))}
      >
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={`Reset ${preset.name}: ${resetTooltip}`}
          aria-label={`Reset ${preset.name}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onChange(editActivePreset(kind, list, resetTo))}
        >
          <span className="fa-solid fa-rotate-left" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={factory ? `Hold to restore ${preset.name} as shipped` : `Hold to trash ${preset.name}`}
          aria-label={factory ? `Restore ${preset.name} as shipped` : `Trash ${preset.name}`}
          data-secondary-press="none"
          disabled={unchanged}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.button !== 0) return
            cancelHold()
            cancelHoldRef.current = armHold(() => {
              cancelHoldRef.current = null
              onChange(factory ? restoreFactoryPreset(list, preset.id) : deletePreset(kind, list, preset.id))
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
