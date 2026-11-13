import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { isFactoryMusicSet, type MusicSet, musicSetMarkOf } from '../shared/audioPlayer'
import { readMusicSetIconPick, subscribeMusicSetIconPick, toggleMusicSetIconPick } from './iconPicker/musicSetIconPicker'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'

function SetName({ slot, name, factory, takenNames, onRename }: { slot: number; name: string; factory: boolean; takenNames: readonly string[]; onRename: (slot: number, name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  const commit = async () => {
    const next = draft.trim()
    if (!next) {
      setEditing(false)
      return
    }
    // Names are unique (the database enforces it too); a clash is answered
    // here, in words, rather than by the database's error across IPC.
    if (next !== name && takenNames.includes(next)) {
      setError('A set with that name already exists.')
      inputRef.current?.focus()
      return
    }
    try {
      await onRename(slot, next)
      setError(null)
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename this set.')
      inputRef.current?.focus()
    }
  }

  if (factory) {
    return <div className="options-curve-cell options-curve-display options-music-set-name">{name}</div>
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="options-curve-cell options-curve-display options-curve-input options-music-set-name"
        aria-label={`Name of set ${name}`}
        aria-invalid={error !== null}
        data-tooltip={error ?? undefined}
        maxLength={64}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { void commit() }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(name)
            setError(null)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className="options-curve-cell options-curve-display options-music-set-name"
      data-tooltip="Right-click to rename this set"
      aria-label={`${name}; right-click to rename`}
      data-secondary-press="action"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setDraft(name)
        setError(null)
        setEditing(true)
      }}
    >
      {name}
    </button>
  )
}

/** A set's mark (musicSetMarkOf): its icon, or its initials. */
export function SetMark({ set }: { set: MusicSet }) {
  const mark = musicSetMarkOf(set)
  return 'iconClass' in mark
    ? <span className={mark.iconClass} aria-hidden="true" />
    : <span aria-hidden="true">{mark.letters}</span>
}

/**
 * The set's mark as a button: a click opens the icon picker for the set (and
 * closes it again), a held click gives the set back its default mark.
 */
function SetIconButton({ set }: { set: MusicSet }) {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const pick = useSyncExternalStore(subscribeMusicSetIconPick, readMusicSetIconPick)
  const cancelHoldRef = useRef<(() => void) | null>(null)
  /** Set when the hold completes; the click its release dispatches then opens nothing. */
  const holdClaimedRef = useRef(false)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])
  const picking = pick?.slot === set.slot
  return (
    <button
      type="button"
      className={`options-curve-cell options-curve-button options-music-set-icon${picking ? ' is-active' : ''}`}
      data-tooltip={`Pick an icon for ${set.name}; hold for its default`}
      aria-label={`Pick an icon for ${set.name}`}
      aria-pressed={picking}
      data-secondary-press="none"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        holdClaimedRef.current = false
        cancelHold()
        cancelHoldRef.current = armHold(() => {
          cancelHoldRef.current = null
          holdClaimedRef.current = true
          void nowPlaying.setMusicSetIcon(set.slot, null)
        }, HOLD_CONFIRM_MS)
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onMouseLeave={cancelHold}
      onClick={() => {
        if (holdClaimedRef.current) {
          holdClaimedRef.current = false
          return
        }
        toggleMusicSetIconPick(set.slot)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <SetMark set={set} />
    </button>
  )
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

  const factory = isFactoryMusicSet(set.slot)
  return (
    <div className="options-curve-row options-music-set-row">
      <SetIconButton set={set} />
      <SetName slot={set.slot} name={set.name} factory={factory} takenNames={sets.map((other) => other.name)} onRename={nowPlaying.renameMusicSet} />
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
      {/* A factory set cannot be deleted, so the same hold empties it. */}
      <button
        type="button"
        className="options-curve-cell options-curve-button"
        data-tooltip={factory ? `Hold to empty ${set.name}` : `Hold to delete ${set.name}`}
        aria-label={factory ? `Empty ${set.name}` : `Delete ${set.name}`}
        data-secondary-press="none"
        onPointerDown={(event) => {
          event.stopPropagation()
          if (event.button !== 0) return
          cancelHold()
          cancelHoldRef.current = armHold(() => {
            cancelHoldRef.current = null
            void (factory ? nowPlaying.purgeMusicSet(set.slot) : nowPlaying.deleteMusicSet(set.slot))
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
    </div>
  )
}
