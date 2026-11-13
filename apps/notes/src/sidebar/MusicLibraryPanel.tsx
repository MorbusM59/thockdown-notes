import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { TextButton } from '../components/TextButton'
import { AccordionDivider, AccordionGroup, AccordionSection } from '@thockdown/interaction/AccordionSection'
import { isFactoryMusicSet, PLAYLIST_SLOT_ICONS, songListTitleText, type MusicSet, type MusicSongEntry, type PlaylistSlot, musicSetMark } from '../shared/audioPlayer'
import {
  groupMusicSetList, type MusicSetListGrouping,
} from '../shared/musicSetList'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { HoldToDeleteButton, HoldToDeleteCount } from './HoldToDeleteButton'
import { MusicSetRow } from './MusicSetRow'
import { SelectorRows } from './SelectorRows'
import { useSelectorReorder } from './useSelectorReorder'
import { MUSIC_SET_DROP_NEW_ATTRIBUTE, MUSIC_SET_DROP_SLOT_ATTRIBUTE, readMusicLibrarySlot, selectMusicLibrarySet, subscribeMusicLibrarySlot } from './musicLibraryView'

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
  const active = nowPlaying.pool?.active ?? []
  // Sets join and leave the music pool the way soundscape channels are
  // enabled and disabled (SoundscapeOptions.tsx): a left hold puts an
  // inactive set into the pool, a right hold takes an active one out, and a
  // right click (released before any hold completed) plays from that set
  // alone, as soloing a channel does. A plain left click opens the set here.
  const holdRef = useRef<{ pointerId: number; cancel: () => void } | null>(null)
  const rightPressRef = useRef<{ pointerId: number; slot: PlaylistSlot } | null>(null)
  /** Set when a hold completes; the click its release dispatches then opens nothing. */
  const holdClaimedRef = useRef(false)
  useEffect(() => () => holdRef.current?.cancel(), [])
  const startHold = (slot: PlaylistSlot, isActive: boolean, button: number, pointerId: number) => {
    if (button === 2) rightPressRef.current = { pointerId, slot }
    if ((button === 0 && isActive) || (button === 2 && !isActive) || (button !== 0 && button !== 2)) return
    holdRef.current?.cancel()
    const cancel = armHold(() => {
      holdRef.current = null
      holdClaimedRef.current = true
      if (button === 2) {
        rightPressRef.current = null
        void nowPlaying.leaveMusicSet(slot)
      } else {
        nowPlaying.selectSlot(slot, true)
      }
    }, HOLD_CONFIRM_MS)
    holdRef.current = { pointerId, cancel }
  }
  /** `released` is a real release on the button; a cancel or the pointer leaving decides nothing. */
  const endHold = (pointerId: number, released: boolean) => {
    const hold = holdRef.current
    if (hold && hold.pointerId === pointerId) {
      hold.cancel()
      holdRef.current = null
    }
    const rightPress = rightPressRef.current
    if (rightPress && rightPress.pointerId === pointerId) {
      rightPressRef.current = null
      if (released) nowPlaying.selectSlot(rightPress.slot, false)
    }
  }
  return (
    <SelectorRows>
    <div className="options-loadout-grid options-section-selector-grid" role="radiogroup" aria-label="Music sets" {...{ [MUSIC_SET_DROP_NEW_ATTRIBUTE]: '' }}>
      {sets.map((candidate) => {
        const cell = reorder(String(candidate.slot))
        const isActive = active.includes(candidate.slot)
        const isSolo = isActive && active.length === 1
        return (
          <button
            key={candidate.slot}
            {...{ [MUSIC_SET_DROP_SLOT_ATTRIBUTE]: candidate.slot }}
            type="button"
            role="radio"
            className={`btn-icon options-color-swatch options-loadout-btn soundscape-channel-selector-btn${candidate.slot === slot ? ' is-active' : ''}${isActive ? ' is-enabled' : ' is-disabled'}${isSolo ? ' is-solo' : ''}`}
            data-tooltip={`${candidate.name}: ${nowPlaying.pool?.counts[candidate.slot] ?? 0} songs`}
            aria-label={`${candidate.name}, ${isActive ? 'playing in the pool' : 'not in the pool'}`}
            aria-checked={candidate.slot === slot}
            data-secondary-press="action"
            onClick={() => { if (!holdClaimedRef.current) selectMusicLibrarySet(candidate.slot) }}
            onPointerDown={(event) => {
              holdClaimedRef.current = false
              cell.onPointerDown(event)
              startHold(candidate.slot, isActive, event.button, event.pointerId)
            }}
            onPointerUp={(event) => endHold(event.pointerId, true)}
            onPointerCancel={(event) => endHold(event.pointerId, false)}
            onPointerLeave={(event) => endHold(event.pointerId, false)}
            onContextMenu={(event) => {
              // The solo itself is decided on the release (endHold).
              event.preventDefault()
              event.stopPropagation()
            }}
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
function useSetSongs(slot: PlaylistSlot, count: number | undefined): { slot: PlaylistSlot; songs: MusicSongEntry[] } | null {
  const [songs, setSongs] = useState<{ slot: PlaylistSlot; songs: MusicSongEntry[] } | null>(null)
  useEffect(() => {
    let current = true
    void window.thockdownAudioPlayer?.getPlaylist(slot).then((loaded) => {
      if (current) setSongs({ slot, songs: loaded })
    })
    return () => { current = false }
  }, [slot, count])
  // The LAST LOADED set, not the one asked for: a switch of set keeps showing
  // the old list until the new one has arrived and then swaps in one frame,
  // where answering with nothing in between drew an empty list for the frames
  // the read took and the sidebar's layout jumped twice.
  return songs
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
  const loaded = useSetSongs(slot, nowPlaying.pool?.counts[slot])
  const shownSlot = loaded?.slot ?? slot
  const groups = useMemo(() => groupMusicSetList(loaded?.songs ?? [], grouping, filter), [loaded, grouping, filter])

  return (
    <div className="options-content sidebar-options-content" aria-label={`Songs in ${name}`}>
      <div className="preset-section">
        <SetSelector slot={slot} />
      </div>
      {/* Keyed on the set shown and the grouping, so a new list starts folded. */}
      <AccordionGroup key={`${shownSlot}:${grouping}`}>
        {groups.map((group) => (
          <AccordionSection
            key={group.key}
            heading={<span className="options-music-song-heading">{group.label}</span>}
            ariaLabel={group.label}
            iconClass={grouping === 'folder' ? 'fa-folder' : 'fa-user'}
            marker={
              <HoldToDeleteCount
                count={group.dividers.reduce((total, divider) => total + divider.songs.length, 0)}
                label={`remove them all from ${name}`}
                onHold={() => { void nowPlaying.removeFromMusicSet(shownSlot, group.dividers.flatMap((divider) => divider.songs.map((song) => song.id))) }}
              />
            }
          >
            <AccordionGroup>
            {group.dividers.map((divider) => (
              <AccordionDivider key={divider.label} label={divider.label} defaultOpen
                marker={
                  <HoldToDeleteCount
                    count={divider.songs.length}
                    label={`remove them all from ${name}`}
                    onHold={() => { void nowPlaying.removeFromMusicSet(shownSlot, divider.songs.map((song) => song.id)) }}
                  />
                }
              >
                <div className="options-curve-rows">
                  {divider.songs.map((song) => {
                    const title = songListTitleText(song)
                    return (
                      <div key={song.id} className="options-curve-row options-music-song-row">
                        <button
                          type="button"
                          className="options-curve-cell options-curve-display options-music-set-name"
                          data-tooltip={song.filePath}
                          onClick={() => nowPlaying.playFromPool(song.id, song)}
                        >
                          {title}
                        </button>
                        <HoldToDeleteButton
                          className="options-music-song-remove"
                          label={`remove ${title} from ${name}`}
                          onHold={() => { void nowPlaying.removeFromMusicSet(shownSlot, [song.id]) }}
                        />
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
      {set ? <MusicSetRow set={set} /> : null}
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
