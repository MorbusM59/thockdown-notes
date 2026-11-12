import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { armHold, HOLD_COMMIT_MS } from '@thockdown/interaction/holdTiming'

import { isFactoryMusicSet, MUSIC_SET_QUICK_ACCESS_COUNT, PLAYLIST_SLOT_ICONS } from '../shared/audioPlayer'
import { armPointerDrag } from '../shared/pointerDrag'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { openMusicSetList } from './musicSetListView'

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
    return <div className="options-curve-cell options-music-set-name">{name}</div>
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="options-curve-cell options-curve-field options-music-set-name"
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
      className="options-curve-cell options-curve-button options-music-set-name"
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

export function MusicSetsOptions() {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])

  const sets = nowPlaying.musicSets
  const rows = sets.slice(0, MUSIC_SET_QUICK_ACCESS_COUNT)
  const laterSets = sets.slice(MUSIC_SET_QUICK_ACCESS_COUNT)

  const renderSet = (set: (typeof sets)[number]) => {
    const factory = isFactoryMusicSet(set.slot)
    return (
      <div
        key={set.slot}
        className="options-curve-row options-music-set-row"
        data-drag-source=""
        onPointerDown={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('button, input')) return
          armPointerDrag(event)
        }}
        onDragStart={(event) => {
          event.dataTransfer?.setData('text/plain', String(set.slot))
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          const draggedSlot = Number(event.dataTransfer?.getData('text/plain'))
          if (Number.isSafeInteger(draggedSlot) && draggedSlot > 0) nowPlaying.moveMusicSet(draggedSlot, set.slot)
        }}
      >
        <div className="options-curve-cell options-music-set-icon" aria-label={factory ? set.name : undefined}>
          {factory
            ? <span className={PLAYLIST_SLOT_ICONS[set.slot as keyof typeof PLAYLIST_SLOT_ICONS]} aria-hidden="true" />
            : set.name.slice(0, 2).toUpperCase()}
        </div>
        <SetName slot={set.slot} name={set.name} factory={factory} takenNames={sets.map((other) => other.name)} onRename={nowPlaying.renameMusicSet} />
        <button
          type="button"
          className="options-curve-cell options-curve-button options-music-set-count"
          data-tooltip={`${nowPlaying.pool?.counts[set.slot] ?? 0} songs. Click to list them; hold right-click to empty ${set.name}.`}
          aria-label={`${set.name}: ${nowPlaying.pool?.counts[set.slot] ?? 0} songs`}
          data-secondary-press="action"
          onClick={() => openMusicSetList(set.slot)}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.button !== 2) return
            // Emptying a set cannot be undone, so it is a hold (HOLD_COMMIT_MS).
            event.preventDefault()
            cancelHold()
            cancelHoldRef.current = armHold(() => {
              cancelHoldRef.current = null
              void nowPlaying.purgeMusicSet(set.slot)
            }, HOLD_COMMIT_MS)
          }}
          onPointerUp={() => { cancelHold() }}
          onPointerCancel={() => { cancelHold() }}
          onMouseLeave={() => { cancelHold() }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          {nowPlaying.pool?.counts[set.slot] ?? 0}
        </button>
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
        <button
          type="button"
          className={`options-curve-cell options-curve-button options-loadout-btn${factory ? ' is-disabled' : ''}`}
          data-tooltip={
            factory
              ? 'Factory sets cannot be deleted'
              : `Hold to delete ${set.name}`
          }
          aria-label={factory ? `${set.name} cannot be deleted` : `Delete ${set.name}`}
          data-secondary-press="none"
          onPointerDown={(event) => {
            event.stopPropagation()
            // Deleting cannot be undone, so it is a hold (HOLD_COMMIT_MS).
            if (event.button !== 0 || factory) return
            cancelHold()
            cancelHoldRef.current = armHold(() => {
              cancelHoldRef.current = null
              void nowPlaying.deleteMusicSet(set.slot)
            }, HOLD_COMMIT_MS)
          }}
          onPointerUp={() => { cancelHold() }}
          onPointerCancel={() => { cancelHold() }}
          onMouseLeave={() => { cancelHold() }}
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

  return (
    <div className="options-curve-rows options-music-set-rows" role="group" aria-label="Music sets">
      {rows.map(renderSet)}
      <div className="options-music-set-divider" aria-hidden="true" />
      {laterSets.map(renderSet)}
      <div className="options-curve-row options-music-set-row options-music-set-add-row">
        <button
          type="button"
          className="options-curve-cell options-curve-button options-music-set-add"
          data-tooltip="Add a music set"
          aria-label="Add a music set"
          onClick={nowPlaying.createMusicSet}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
