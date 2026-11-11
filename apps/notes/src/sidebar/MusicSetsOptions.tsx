import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { isFactoryMusicSet, MUSIC_SET_QUICK_ACCESS_COUNT, PLAYLIST_SLOT_ICONS } from '../shared/audioPlayer'
import { armPointerDrag } from '../shared/pointerDrag'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'

function SetName({ slot, name, factory, onRename }: { slot: number; name: string; factory: boolean; onRename: (slot: number, name: string) => Promise<void> }) {
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
        title={error ?? undefined}
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
        <SetName slot={set.slot} name={set.name} factory={factory} onRename={nowPlaying.renameMusicSet} />
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip="Left-click to add files; right-click to add a folder"
          aria-label={`Add music to ${set.name}`}
          data-secondary-press="action"
          onClick={() => { void nowPlaying.addToMusicSet(set.slot, 'files') }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void nowPlaying.addToMusicSet(set.slot, 'folder')
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="fa-solid fa-folder-open" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`options-curve-cell options-curve-button${factory ? ' is-disabled' : ''}`}
          data-tooltip={factory ? 'Factory sets cannot be deleted' : 'Purge this set’s songs, then delete the set'}
          aria-label={factory ? `Cannot delete ${set.name}` : `Delete ${set.name}`}
          aria-disabled={factory}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => { if (!factory) void nowPlaying.deleteMusicSet(set.slot) }}
        >
          <span className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip="Add a music set"
          aria-label="Add a music set"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={nowPlaying.createMusicSet}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="options-curve-rows options-music-set-rows" role="group" aria-label="Music sets">
      {rows.map(renderSet)}
      <div className="options-curve-header options-music-set-divider" aria-hidden="true" />
      {laterSets.map(renderSet)}
    </div>
  )
}
