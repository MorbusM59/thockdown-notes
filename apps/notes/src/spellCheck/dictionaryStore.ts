/*
 * The renderer's one view of the spell checker's dictionaries: what there is
 * (`list`), the words of each dictionary somebody is looking at, and every
 * change to them. Options > Spell Checking, the sidebar's dictionary view and
 * its dock, and Ctrl+D in the editor all read and change dictionaries through
 * here, so a word added in one place is listed in every other, and the
 * checker (`spellCheckClient.ts`) is told once.
 *
 * A dictionary's words are read from the main process when first asked for
 * and then kept here, edited in place by every change made through this
 * module rather than read again: English alone is 49,000 words, and adding
 * one should not cost a reread of all of them.
 */
import {
  BUNDLED_DICTIONARIES, USER_DICTIONARY_ID, USER_DICTIONARY_LABEL, wordsFromText, type SpellCheckDictionary,
} from '../shared/spellCheck';
import { spellCheckClient } from './spellCheckClient';

type Snapshot = {
  /** False until the main process has listed them; until then `dictionaries` are the ones every install has. */
  listed: boolean;
  dictionaries: readonly SpellCheckDictionary[];
  /** id -> its words, unsorted, for the dictionaries whose words have been asked for. */
  words: ReadonlyMap<string, readonly string[]>;
};

let snapshot: Snapshot = {
  listed: false,
  dictionaries: [
    { id: USER_DICTIONARY_ID, label: USER_DICTIONARY_LABEL, icon: null, kind: 'user' },
    ...BUNDLED_DICTIONARIES.map((entry) => ({ ...entry, icon: null, kind: 'bundled' as const })),
  ],
  words: new Map(),
};
const listeners = new Set<() => void>();
const wordsAsked = new Set<string>();
let listed = false;

const api = () => window.thockdownSpellCheck;

function publish(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function setWords(id: string, words: readonly string[] | null): void {
  const next = new Map(snapshot.words);
  if (words) next.set(id, words);
  else next.delete(id);
  publish({ words: next });
}

export function readDictionaries(): Snapshot {
  if (!listed) {
    listed = true;
    void refreshDictionaries();
  }
  return snapshot;
}

export function subscribeDictionaries(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function refreshDictionaries(): Promise<void> {
  const dictionaries = await api()?.listDictionaries().catch(() => null);
  if (dictionaries) publish({ dictionaries, listed: true });
}

/** Reads a dictionary's words, once; they are then in the snapshot. */
export function loadDictionaryWords(id: string): void {
  if (wordsAsked.has(id)) return;
  wordsAsked.add(id);
  void api()?.listWords(id).then((words) => setWords(id, words), () => { wordsAsked.delete(id); });
}

/** Adds words to a dictionary, and to its listed words when they have been read. */
export async function addDictionaryWords(id: string, words: readonly string[]): Promise<void> {
  if (words.length === 0 || !await api()?.addWords(id, [...words]).catch(() => false)) return;
  const known = snapshot.words.get(id);
  if (known) {
    const present = new Set(known);
    setWords(id, [...known, ...words.filter((word) => !present.has(word))]);
  }
  spellCheckClient.dictionaryChanged(id, { add: words, remove: [] });
}

/** Adds every word in `text` (split on white space): what the dock's field takes. */
export function addDictionaryText(id: string, text: string): Promise<void> {
  return addDictionaryWords(id, wordsFromText(text));
}

/** Ctrl+D: words the checker did not recognise, into the user dictionary. */
export function addToUserDictionary(words: readonly string[]): Promise<void> {
  return addDictionaryWords(USER_DICTIONARY_ID, words);
}

export async function removeDictionaryWords(id: string, words: readonly string[]): Promise<void> {
  if (words.length === 0 || !await api()?.removeWords(id, [...words]).catch(() => false)) return;
  const known = snapshot.words.get(id);
  if (known) {
    const removed = new Set(words);
    setWords(id, known.filter((word) => !removed.has(word)));
  }
  spellCheckClient.dictionaryChanged(id, { add: [], remove: words });
}

export async function createDictionary(): Promise<SpellCheckDictionary | null> {
  const created = await api()?.createDictionary().catch(() => null) ?? null;
  await refreshDictionaries();
  return created;
}

export async function installDictionaries(): Promise<SpellCheckDictionary[]> {
  const installed = await api()?.installDictionary().catch(() => null) ?? [];
  if (installed.length > 0) await refreshDictionaries();
  return installed;
}

export async function renameDictionary(id: string, label: string): Promise<void> {
  publish({ dictionaries: snapshot.dictionaries.map((entry) => (entry.id === id ? { ...entry, label } : entry)) });
  await api()?.renameDictionary(id, label).catch(() => false);
  await refreshDictionaries();
}

export async function setDictionaryIcon(id: string, icon: string | null): Promise<void> {
  publish({ dictionaries: snapshot.dictionaries.map((entry) => (entry.id === id ? { ...entry, icon } : entry)) });
  await api()?.setDictionaryIcon(id, icon).catch(() => false);
  await refreshDictionaries();
}

/** Empties the user dictionary, restores a bundled one, deletes a custom one (`SpellCheckApi.resetDictionary`). */
export async function resetDictionary(id: string): Promise<void> {
  if (!await api()?.resetDictionary(id).catch(() => false)) return;
  wordsAsked.delete(id);
  setWords(id, null);
  spellCheckClient.dictionaryChanged(id, 'reload');
  await refreshDictionaries();
}
