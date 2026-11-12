import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AccordionDivider, AccordionGroup, AccordionSection } from '@thockdown/interaction/AccordionSection'
import { useNonPassiveWheel } from '@thockdown/interaction/useNonPassiveWheel'

import { createWheelNotchState, resolveWheelEventUnits } from '../editor/wheelNotch'

import { isFactoryMusicSet, PLAYLIST_SLOT_ICONS, songListTitleText, type MusicSongEntry, type PlaylistSlot } from '../shared/audioPlayer'
import {
  groupMusicSetList, maxMusicSetSelectorOffset, musicSetSelectorCells, musicSetSelectorOffsetShowing, type MusicSetListGrouping,
} from '../shared/musicSetList'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { readMusicLibrarySlot, selectMusicLibrarySet, subscribeMusicLibrarySlot } from './musicLibraryView'

/** A set's mark: a factory set's icon, anyone else's first two letters (as in Music > Sets). */
function SetMark({ slot, name }: { slot: PlaylistSlot; name: string }) {
  return isFactoryMusicSet(slot)
    ? <span className={PLAYLIST_SLOT_ICONS[slot]} aria-hidden="true" />
    : <span aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
}

/**
 * The selector bar: six cells over the sets. With more sets than cells, an
 * end cell with sets beyond it is a step that way (one set per click) instead
 * of its set, and the wheel over the bar steps the same way, up towards the
 * beginning and down towards the end.
 */
function SetSelector({ slot }: { slot: PlaylistSlot }) {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const sets = nowPlaying.musicSets
  const [offset, setOffset] = useState(0)
  const step = useCallback((direction: -1 | 1) => {
    const max = maxMusicSetSelectorOffset(readNowPlaying().musicSets.length)
    setOffset((current) => Math.min(Math.max(0, Math.min(current, max) + direction), max))
  }, [])

  // The open set is brought into the window when the library opens on it or
  // the sets change; stepping afterwards may take it out of sight again.
  const openIndex = sets.findIndex((candidate) => candidate.slot === slot)
  useEffect(() => {
    if (openIndex >= 0) setOffset((current) => musicSetSelectorOffsetShowing(sets.length, current, openIndex))
  }, [openIndex, sets.length])

  // One notch is one step, whatever its size: the dial's rule
  // (EscapeHoldPanel.tsx), through the app's one notch resolver.
  const barRef = useRef<HTMLDivElement | null>(null)
  const wheelNotchStateRef = useRef(createWheelNotchState())
  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    const units = resolveWheelEventUnits(event, wheelNotchStateRef.current, performance.now())
    if (units !== 0) step(units < 0 ? -1 : 1)
  }, [step])
  useNonPassiveWheel(barRef, handleWheel)

  return (
    <div ref={barRef} className="options-loadout-grid options-section-selector-grid" role="radiogroup" aria-label="Music sets">
      {musicSetSelectorCells(sets.length, offset).map((cell) => {
        if (cell.kind !== 'set') {
          const earlier = cell.kind === 'earlier'
          return (
            <button
              key={cell.kind}
              type="button"
              className="btn-icon options-color-swatch options-loadout-btn"
              data-tooltip={earlier ? 'Earlier sets' : 'Later sets'}
              aria-label={earlier ? 'Earlier sets' : 'Later sets'}
              onClick={() => step(earlier ? -1 : 1)}
            >
              <span className={earlier ? 'fa-solid fa-caret-left' : 'fa-solid fa-caret-right'} aria-hidden="true" />
            </button>
          )
        }
        const candidate = sets[cell.index]
        return (
          <button
            key={candidate.slot}
            type="button"
            role="radio"
            className={`btn-icon options-color-swatch options-loadout-btn${candidate.slot === slot ? ' is-active' : ''}`}
            data-tooltip={`${candidate.name}: ${nowPlaying.pool?.counts[candidate.slot] ?? 0} songs`}
            aria-label={candidate.name}
            aria-checked={candidate.slot === slot}
            onClick={() => selectMusicLibrarySet(candidate.slot)}
          >
            <SetMark slot={candidate.slot} name={candidate.name} />
          </button>
        )
      })}
    </div>
  )
}

/**
 * The songs of the set the library is open on, read from the database, and read
 * again whenever that set's count changes (a song added or removed, here or
 * anywhere else).
 */
function useSetSongs(slot: PlaylistSlot, count: number | undefined): MusicSongEntry[] {
  const [songs, setSongs] = useState<{ slot: PlaylistSlot; songs: MusicSongEntry[] }>({ slot, songs: [] })
  useEffect(() => {
    let current = true
    void window.thockdownAudioPlayer?.getPlaylist(slot).then((loaded) => {
      if (current) setSongs({ slot, songs: loaded })
    })
    return () => { current = false }
  }, [slot, count])
  return songs.slot === slot ? songs.songs : []
}

/**
 * The MUSIC LIBRARY, the sidebar's Songs view (`shared/musicSetList.ts`), in
 * the options panel's own structure. The selector bar holds the sets, as the
 * view's sections; each folder or artist of the open set is a subsection and
 * each file type or album a divider; a song is a row of the curve editor's
 * kind, its name and a button taking it out of the set. `filter` is the
 * sidebar's search field (the visualizer's pool-filter syntax).
 *
 * The open set is the one last picked (musicLibraryView.ts), or the first set
 * when none was or that one is gone.
 */
export function MusicLibraryPanel({ grouping, filter }: { grouping: MusicSetListGrouping; filter: string }) {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const pickedSlot = useSyncExternalStore(subscribeMusicLibrarySlot, readMusicLibrarySlot)
  const set = nowPlaying.musicSets.find((candidate) => candidate.slot === pickedSlot) ?? nowPlaying.musicSets[0]
  if (!set) return <div className="options-content sidebar-options-content" aria-label="Songs" />
  return <MusicLibrarySet slot={set.slot} name={set.name} grouping={grouping} filter={filter} />
}

function MusicLibrarySet({ slot, name, grouping, filter }: { slot: PlaylistSlot; name: string; grouping: MusicSetListGrouping; filter: string }) {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const songs = useSetSongs(slot, nowPlaying.pool?.counts[slot])
  const groups = useMemo(() => groupMusicSetList(songs, grouping, filter), [songs, grouping, filter])

  return (
    <div className="options-content sidebar-options-content" aria-label={`Songs in ${name}`}>
      <div className="preset-section">
        <SetSelector slot={slot} />
      </div>
      {/* Keyed on the set and the grouping, so a new list starts folded. */}
      <AccordionGroup key={`${slot}:${grouping}`}>
        {groups.map((group) => (
          <AccordionSection
            key={group.key}
            heading={<span className="options-music-song-heading">{group.label}</span>}
            ariaLabel={group.label}
            iconClass={grouping === 'folder' ? 'fa-folder' : 'fa-user'}
          >
            <AccordionGroup>
            {group.dividers.map((divider) => (
              <AccordionDivider key={divider.label} label={divider.label} count={divider.songs.length} defaultOpen>
                <div className="options-curve-rows">
                  {divider.songs.map((song) => {
                    const name = songListTitleText(song)
                    return (
                      <div key={song.id} className="options-curve-row options-music-song-row">
                        <div className="options-curve-cell options-curve-display options-music-set-name" data-tooltip={song.filePath}>{name}</div>
                        <button
                          type="button"
                          className="options-curve-cell options-curve-button"
                          data-tooltip={`Remove from ${name}`}
                          aria-label={`Remove ${name} from ${name}`}
                          onClick={() => { void nowPlaying.removeFromMusicSet(slot, song.id) }}
                        >
                          <span className="fa-solid fa-xmark" aria-hidden="true" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </AccordionDivider>
            ))}
            </AccordionGroup>
          </AccordionSection>
        ))}
      </AccordionGroup>
    </div>
  )
}

/**
 * The Music Library's dock, below the sidebar where the colour picker docks:
 * the two groupings of a set's songs.
 */
export function MusicLibraryDock({ grouping, onGroupingChange }: { grouping: MusicSetListGrouping; onGroupingChange: (grouping: MusicSetListGrouping) => void }) {
  return (
    <div className="options-curve-rows options-music-set-list-dock" role="radiogroup" aria-label="Song grouping">
      <div className="options-curve-row options-music-set-list-dock-row">
        {(['folder', 'artist'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={grouping === option}
            className={`options-curve-cell options-curve-button${grouping === option ? ' is-active' : ''}`}
            data-tooltip={option === 'folder' ? 'By folder' : 'By artist'}
            aria-label={option === 'folder' ? 'Group by folder' : 'Group by artist'}
            onClick={() => onGroupingChange(option)}
          >
            <span className={option === 'folder' ? 'fa-solid fa-folder' : 'fa-solid fa-user'} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}
