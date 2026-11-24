import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'

import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { isFactoryMusicSet, PLAYLIST_SLOT_THEMES, type MusicSet, musicSetMarkOf } from '@thockdown/visualizer/shared/audioPlayer'
import { isPickingIconFor, readIconPick, subscribeIconPick, toggleIconPick } from '@thockdown/interaction/iconPicker/iconPick'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { readNowPlaying, subscribeNowPlaying, type MusicAddSource } from '@thockdown/visualizer/sound/nowPlaying'

const ADD_SOURCE_LABELS: Record<MusicAddSource, string> = { files: 'Add songs', folder: 'Add a folder' }
const ADD_SOURCE_ICONS: Record<MusicAddSource, string> = { files: 'fa-file-audio', folder: 'fa-folder-open' }

/** A set's mark (musicSetMarkOf): its icon, or its initials. */
export function SetMark({ set }: { set: MusicSet }) {
  const mark = musicSetMarkOf(set)
  return 'iconClass' in mark
    ? <span className={mark.iconClass} aria-hidden="true" />
    : <span aria-hidden="true">{mark.letters}</span>
}

/**
 * The open set's row in the Music Library's dock, under its groupings: its
 * mark, its name with its song count, "Chill (42)" (renamed by right-click),
 * one add button for each source the platform's pickers offer
 * (NowPlaying.addSources), and deleting it. Sets are reordered in the
 * selector above, not here. `trailing` ends the row (the phone's help).
 */
export function MusicSetRow({ set, trailing }: { set: MusicSet; trailing?: ReactNode }) {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const sets = nowPlaying.musicSets
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])

  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const factory = isFactoryMusicSet(set.slot)
  // Back to the factory set as shipped: empty, and its own name and icon.
  // The name is kept when a set of the reader's own has taken it meanwhile.
  const restoreFactorySet = async () => {
    if (!isFactoryMusicSet(set.slot)) return
    await nowPlaying.purgeMusicSet(set.slot)
    await nowPlaying.setMusicSetIcon(set.slot, null)
    await nowPlaying.renameMusicSet(set.slot, PLAYLIST_SLOT_THEMES[set.slot]).catch(() => {})
  }
  return (
    <DockEntryRow
      className="preset-dock-row options-music-set-row"
      name={set.name}
      nameSuffix={`(${nowPlaying.pool?.counts[set.slot] ?? 0})`}
      takenNames={sets.filter((other) => other.slot !== set.slot).map((other) => other.name)}
      onRename={(name) => nowPlaying.renameMusicSet(set.slot, name)}
      mark={<SetMark set={set} />}
      picking={isPickingIconFor(pick, { kind: 'musicSet', slot: set.slot })}
      onTogglePicker={() => toggleIconPick({ kind: 'musicSet', slot: set.slot })}
      onResetMark={() => { void nowPlaying.setMusicSetIcon(set.slot, null) }}
    >
      {nowPlaying.addSources.map((source) => (
        <button
          key={source}
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={ADD_SOURCE_LABELS[source]}
          aria-label={ADD_SOURCE_LABELS[source]}
          onClick={() => { void nowPlaying.addToMusicSet(set.slot, source) }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className={`fa-solid ${ADD_SOURCE_ICONS[source]}`} aria-hidden="true" />
        </button>
      ))}
      {/* A factory set cannot be deleted, so the same hold restores it. */}
      <button
        type="button"
        className="options-curve-cell options-curve-button"
        data-tooltip={factory ? `Restore ${set.name}` : `Delete ${set.name}`}
        aria-label={factory ? `Restore ${set.name}` : `Delete ${set.name}`}
        data-secondary-press="none"
        onPointerDown={(event) => {
          event.stopPropagation()
          if (event.button !== 0) return
          cancelHold()
          cancelHoldRef.current = armHold(() => {
            cancelHoldRef.current = null
            void (factory ? restoreFactorySet() : nowPlaying.deleteMusicSet(set.slot))
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
        <span className={`fa-solid ${factory ? 'fa-arrow-rotate-left' : 'fa-trash-can'}`} aria-hidden="true" />
      </button>
      {trailing}
    </DockEntryRow>
  )
}
