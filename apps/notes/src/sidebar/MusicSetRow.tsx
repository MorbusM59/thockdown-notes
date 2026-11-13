import { useEffect, useRef, useSyncExternalStore } from 'react'

import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { isFactoryMusicSet, PLAYLIST_SLOT_THEMES, type MusicSet, musicSetMarkOf } from '../shared/audioPlayer'
import { isPickingIconFor, readIconPick, subscribeIconPick, toggleIconPick } from './iconPicker/iconPick'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'

/** A set's mark (musicSetMarkOf): its icon, or its initials. */
export function SetMark({ set }: { set: MusicSet }) {
  const mark = musicSetMarkOf(set)
  return 'iconClass' in mark
    ? <span className={mark.iconClass} aria-hidden="true" />
    : <span aria-hidden="true">{mark.letters}</span>
}

/**
 * The open set's row in the Music Library's dock, over its groupings: its
 * mark, its name (renamed by right-click), its song count as a plain figure
 * (the groupings below already list the songs), adding files or a folder, and
 * deleting it. Sets are reordered in the selector above it, not here.
 */
export function MusicSetRow({ set }: { set: MusicSet }) {
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
      className="options-music-set-row"
      name={set.name}
      takenNames={sets.filter((other) => other.slot !== set.slot).map((other) => other.name)}
      onRename={(name) => nowPlaying.renameMusicSet(set.slot, name)}
      mark={<SetMark set={set} />}
      picking={isPickingIconFor(pick, { kind: 'musicSet', slot: set.slot })}
      onTogglePicker={() => toggleIconPick({ kind: 'musicSet', slot: set.slot })}
      onResetMark={() => { void nowPlaying.setMusicSetIcon(set.slot, null) }}
    >
      <div
        className="options-curve-cell options-curve-display options-music-set-count"
        data-tooltip={`${nowPlaying.pool?.counts[set.slot] ?? 0} songs`}
        aria-label={`${set.name}: ${nowPlaying.pool?.counts[set.slot] ?? 0} songs`}
      >
        {nowPlaying.pool?.counts[set.slot] ?? 0}
      </div>
      <button
        type="button"
        className="options-curve-cell options-curve-button"
        data-tooltip={`Add audio files to ${set.name}`}
        aria-label={`Add audio files to ${set.name}`}
        onClick={() => { void nowPlaying.addToMusicSet(set.slot, 'files') }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="fa-solid fa-file-audio" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="options-curve-cell options-curve-button"
        data-tooltip={`Add a folder of audio files to ${set.name}`}
        aria-label={`Add a folder of audio files to ${set.name}`}
        onClick={() => { void nowPlaying.addToMusicSet(set.slot, 'folder') }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="fa-solid fa-folder-open" aria-hidden="true" />
      </button>
      {/* A factory set cannot be deleted, so the same hold restores it. */}
      <button
        type="button"
        className="options-curve-cell options-curve-button"
        data-tooltip={factory ? `Hold to restore ${set.name} as shipped: empty, with its own name and icon` : `Hold to delete ${set.name}`}
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
        <span className="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </DockEntryRow>
  )
}
