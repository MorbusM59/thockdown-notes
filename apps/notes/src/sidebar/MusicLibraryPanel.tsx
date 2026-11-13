import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { TextButton } from '../components/TextButton'
import { AccordionDivider, AccordionGroup, AccordionSection } from '@thockdown/interaction/AccordionSection'
import { isFactoryMusicSet, PLAYLIST_SLOT_ICONS, songListTitleText, type MusicSet, type MusicSongEntry, type PlaylistSlot, musicSetMark } from '../shared/audioPlayer'
import {
  groupMusicSetList, type MusicSetListGrouping,
} from '../shared/musicSetList'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { MusicSetRow } from './MusicSetsOptions'
import { SelectorRows } from './SelectorRows'
import { useSelectorReorder } from './useSelectorReorder'
import { readMusicLibrarySlot, selectMusicLibrarySet, subscribeMusicLibrarySlot } from './musicLibraryView'

/** A set's mark: a factory set's icon, anyone else's initials (musicSetMark). */
function SetMark({ slot, name }: { slot: PlaylistSlot; name: string }) {
  return isFactoryMusicSet(slot)
    ? <span className={PLAYLIST_SLOT_ICONS[slot]} aria-hidden="true" />
    : <span aria-hidden="true">{musicSetMark(name)}</span>
}

/**
 * The selector bar: every set, six to a row, in a window of whole rows
 * (SelectorRows), reordered by dragging (useSelectorReorder), then a button
 * creating a set, as the Soundscapes view's presets end in theirs. The order is
 * the sets' one order, the music player's buttons included.
 */
function SetSelector({ slot }: { slot: PlaylistSlot }) {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const sets = nowPlaying.musicSets
  const reorder = useSelectorReorder('music-set', (dragged, target) => nowPlaying.moveMusicSet(Number(dragged), Number(target)))
  return (
    <SelectorRows>
    <div className="options-loadout-grid options-section-selector-grid" role="radiogroup" aria-label="Music sets">
      {sets.map((candidate) => {
        const cell = reorder(String(candidate.slot))
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
            onPointerDown={cell.onPointerDown}
            {...cell.props}
          >
            <SetMark slot={candidate.slot} name={candidate.name} />
          </button>
        )
      })}
      <button
        type="button"
        className="btn-icon options-color-swatch options-loadout-btn options-loadout-plus"
        data-tooltip="Create a music set"
        aria-label="Create a music set"
        onClick={nowPlaying.createMusicSet}
      >
        <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
      </button>
    </div>
    </SelectorRows>
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

/** The set the library is open on: the one last picked, or the first set when none was or that one is gone. */
function useOpenMusicSet(): MusicSet | undefined {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const pickedSlot = useSyncExternalStore(subscribeMusicLibrarySlot, readMusicLibrarySlot)
  return nowPlaying.musicSets.find((candidate) => candidate.slot === pickedSlot) ?? nowPlaying.musicSets[0]
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
  const set = useOpenMusicSet()
  if (!set) return <div className="options-content sidebar-options-content" aria-label="Songs" />
  return <MusicLibrarySet set={set} grouping={grouping} filter={filter} />
}

function MusicLibrarySet({ set, grouping, filter }: { set: MusicSet; grouping: MusicSetListGrouping; filter: string }) {
  const { slot, name } = set
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
            count={group.dividers.reduce((total, divider) => total + divider.songs.length, 0)}
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
 * the open set's row (MusicSetRow), then the two groupings of its songs.
 */
export function MusicLibraryDock({ grouping, onGroupingChange }: { grouping: MusicSetListGrouping; onGroupingChange: (grouping: MusicSetListGrouping) => void }) {
  const set = useOpenMusicSet()
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  return (
    <div
      className="options-curve-rows options-music-set-list-dock"
      style={{ '--set-count-digits': String(set ? nowPlaying.pool?.counts[set.slot] ?? 0 : 0).length } as CSSProperties}
    >
      {set ? <MusicSetRow set={set} inLibrary /> : null}
      <div className="options-curve-row options-music-set-list-dock-row" role="radiogroup" aria-label="Song grouping">
        {(['folder', 'artist'] as const).map((option) => (
          <TextButton
            key={option}
            role="radio"
            aria-checked={grouping === option}
            isActive={grouping === option}
            data-tooltip={option === 'folder' ? 'Group the songs by folder' : 'Group the songs by artist'}
            onClick={() => onGroupingChange(option)}
          >
            {option === 'folder' ? 'By folder...' : 'By artist...'}
          </TextButton>
        ))}
      </div>
    </div>
  )
}
