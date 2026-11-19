import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { AccordionCount, AccordionDivider, AccordionGroup, AccordionSection } from '@thockdown/interaction/AccordionSection'
import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { IconPicker } from '@thockdown/interaction/iconPicker/IconPicker'
import { HoverActions } from '../components/HoverActions'
import { DEFAULT_DICTIONARY_ICON, type SpellCheckDictionary } from '../shared/spellCheck'
import { groupDictionaryWords } from '../shared/dictionaryWordList'
import {
  addDictionaryText, installDictionaries, loadDictionaryWords, readDictionaries, removeDictionaryWords,
  renameDictionary, resetDictionary, setDictionaryIcon, subscribeDictionaries,
} from '../spellCheck/dictionaryStore'
import { closeIconPick, isPickingIconFor, readIconPick, subscribeIconPick, toggleIconPick } from './iconPicker/iconPick'
import { closeDictionary, openDictionary, readOpenDictionary, subscribeOpenDictionary } from './dictionaryView'

/** The dictionary the sidebar is open on (dictionaryView.ts), while it exists. */
function useOpenDictionary(): { dictionary: SpellCheckDictionary | undefined; words: readonly string[] | undefined } {
  const { dictionaries, words } = useSyncExternalStore(subscribeDictionaries, readDictionaries)
  const id = useSyncExternalStore(subscribeOpenDictionary, readOpenDictionary)
  const dictionary = dictionaries.find((entry) => entry.id === id)
  useEffect(() => { if (dictionary) loadDictionaryWords(dictionary.id) }, [dictionary])
  return { dictionary, words: dictionary ? words.get(dictionary.id) : undefined }
}

/** A dictionary's mark: its icon, or the default one. */
export function DictionaryMark({ dictionary }: { dictionary: SpellCheckDictionary }) {
  return <span className={`fa-solid ${dictionary.icon ?? DEFAULT_DICTIONARY_ICON}`} aria-hidden="true" />
}

/**
 * THE DICTIONARY VIEW: the open dictionary's words, listed as the Music
 * Library lists a set's songs. A section per first letter, and in a list of
 * `DICTIONARY_DIVIDER_THRESHOLD` words or more a divider per second letter
 * (shared/dictionaryWordList.ts). Both are built when first unfolded, so the
 * 49,000 words of a bundled dictionary cost only the letters opened. A word
 * is removed by holding its row's cross. `filter` is the sidebar's search
 * field.
 */
export function DictionaryPanel({ filter }: { filter: string }) {
  const { dictionary, words } = useOpenDictionary()
  const groups = useMemo(() => groupDictionaryWords(words ?? [], filter), [words, filter])
  // A dictionary that is gone (deleted from its dock) closes the view.
  const { dictionaries } = useSyncExternalStore(subscribeDictionaries, readDictionaries)
  const openId = useSyncExternalStore(subscribeOpenDictionary, readOpenDictionary)
  useEffect(() => {
    if (openId !== null && !dictionaries.some((entry) => entry.id === openId)) closeDictionary()
  }, [dictionaries, openId])
  if (!dictionary) return <div className="options-content sidebar-options-content" aria-label="Dictionary" />
  const filtering = filter.trim() !== ''
  const removeAction = (word: string) => ({
    icon: 'fa-xmark',
    label: `Remove ${word} from ${dictionary.label}`,
    onHold: () => { void removeDictionaryWords(dictionary.id, [word]) },
  })
  const rows = (list: readonly string[]) => (
    <div className="options-curve-rows">
      {list.map((word) => (
        <div key={word} className="options-curve-row options-music-song-row">
          <div className="options-curve-cell options-curve-display options-music-set-name" data-hover-host="">
            <span className="options-music-song-title">{word}</span>
            <HoverActions rest={null} actions={[removeAction(word)]} />
          </div>
        </div>
      ))}
    </div>
  )
  return (
    <div className="options-content sidebar-options-content" aria-label={`Words in ${dictionary.label}`}>
      {/* Keyed on the dictionary and on whether a filter is typed, so a new
          list starts folded and a filtered one starts with its dividers open. */}
      <AccordionGroup key={`${dictionary.id}:${filtering}`}>
        {groups.map((group) => (
          <AccordionSection
            lazy
            key={group.key}
            heading={<span className="options-music-song-heading">{group.label}</span>}
            ariaLabel={group.label}
            iconClass="fa-font"
            marker={<AccordionCount count={group.count} />}
          >
            {group.dividers ? (
              <AccordionGroup>
                {group.dividers.map((divider) => (
                  <AccordionDivider key={divider.key} label={divider.label} lazy defaultOpen={filtering}
                    marker={<AccordionCount count={divider.words.length} />}
                  >
                    {rows(divider.words)}
                  </AccordionDivider>
                ))}
              </AccordionGroup>
            ) : rows(group.words)}
          </AccordionSection>
        ))}
      </AccordionGroup>
    </div>
  )
}

/** The icon picker for the open dictionary (iconPicker/iconPick.ts). */
export function DictionaryIconPicker({ query }: { query: string }) {
  const { dictionary } = useOpenDictionary()
  if (!dictionary) return null
  return (
    <IconPicker
      label={dictionary.label}
      current={dictionary.icon}
      query={query}
      onPick={(icon) => {
        closeIconPick()
        void setDictionaryIcon(dictionary.id, icon)
      }}
    />
  )
}

/** What the dock's reset button does to each kind of dictionary (`SpellCheckApi.resetDictionary`). */
const RESET = {
  user: { icon: 'fa-xmark', verb: 'Empty' },
  bundled: { icon: 'fa-arrow-rotate-left', verb: 'Restore' },
  custom: { icon: 'fa-trash-can', verb: 'Delete' },
} as const

/**
 * The dictionary view's dock, as the Music Library docks its set: the open
 * dictionary's row (its mark, its name, its word count, importing
 * dictionaries and resetting this one), then a field adding the words typed
 * into it.
 */
export function DictionaryDock() {
  const { dictionary, words } = useOpenDictionary()
  const { dictionaries } = useSyncExternalStore(subscribeDictionaries, readDictionaries)
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const [draft, setDraft] = useState('')
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])
  if (!dictionary) return null
  const count = words?.length ?? 0
  const reset = RESET[dictionary.kind]
  const commitDraft = () => {
    if (draft.trim()) void addDictionaryText(dictionary.id, draft)
    setDraft('')
  }
  return (
    <div className="options-curve-rows options-music-set-list-dock" style={{ '--set-count-digits': String(count).length } as CSSProperties}>
      <DockEntryRow
        className="options-dictionary-dock-row"
        name={dictionary.label}
        takenNames={dictionaries.filter((other) => other.id !== dictionary.id).map((other) => other.label)}
        onRename={(label) => renameDictionary(dictionary.id, label)}
        mark={<DictionaryMark dictionary={dictionary} />}
        picking={isPickingIconFor(pick, { kind: 'dictionary', id: dictionary.id })}
        onTogglePicker={() => toggleIconPick({ kind: 'dictionary', id: dictionary.id })}
        onResetMark={() => { void setDictionaryIcon(dictionary.id, null) }}
      >
        <div
          className="options-curve-cell options-curve-display options-music-set-count"
          data-tooltip={`${count} words`}
          aria-label={`${dictionary.label}: ${count} words`}
        >
          {count}
        </div>
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip="Import dictionaries"
          aria-label="Import dictionaries"
          onClick={() => {
            void installDictionaries().then((installed) => { if (installed[0]) openDictionary(installed[0].id) })
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="fa-solid fa-file-import" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={`${reset.verb} ${dictionary.label}`}
          aria-label={`${reset.verb} ${dictionary.label}`}
          data-secondary-press="none"
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.button !== 0) return
            cancelHold()
            cancelHoldRef.current = armHold(() => {
              cancelHoldRef.current = null
              void resetDictionary(dictionary.id)
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
          <span className={`fa-solid ${reset.icon}`} aria-hidden="true" />
        </button>
      </DockEntryRow>
      <div className="options-curve-row options-dictionary-add-row">
        <input
          className="options-curve-cell options-curve-field"
          aria-label={`Add words to ${dictionary.label}`}
          data-tooltip="Add words"
          placeholder="Add words..."
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') { event.preventDefault(); commitDraft() }
            if (event.key === 'Escape') { event.preventDefault(); setDraft(''); event.currentTarget.blur() }
          }}
        />
      </div>
    </div>
  )
}
