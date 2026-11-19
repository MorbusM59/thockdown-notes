import type { InvokeChannels } from './ipcContract';

/**
 * The spell checker's dictionaries, as the main process serves them.
 *
 * Spell checking is the app's own (`spellCheck/`): Hunspell, compiled to
 * WebAssembly, run in a worker, fed dictionaries that are files on this
 * machine. Four ship with the app (`BUNDLED_DICTIONARIES`, read from the
 * `dictionary-*` packages); the reader can install more, each one a Hunspell
 * `.aff` and `.dic` pair, copied into the app's data folder, or create one
 * blank. Every dictionary also carries the reader's own edits (words added
 * and removed), and the USER DICTIONARY is nothing but those: where Ctrl+D
 * puts a word. Which dictionaries take part is a setting
 * (`PersistedMenuState.spellCheckDictionaries`), the user dictionary always
 * with them: a word is correct when ANY active dictionary accepts it, which
 * is what lets a note mix languages.
 */
export type SpellCheckDictionary = {
  /** Stable id: `user`, the language code of a bundled dictionary, or made up when one is created or installed. */
  id: string;
  /** Its name: the reader's, or its default (`BUNDLED_DICTIONARIES`, `dictionaryLabelFor`). */
  label: string;
  /** A solid Font Awesome icon (`fa-...`) chosen by the reader, or null for the default (`DEFAULT_DICTIONARY_ICON`). */
  icon: string | null;
  kind: SpellCheckDictionaryKind;
};

/**
 * `user`: the reader's own words (Ctrl+D), always checked alongside the
 * active dictionaries, never removed; resetting it empties it.
 * `bundled`: one of the four that ship; resetting restores it as shipped.
 * `custom`: created blank or installed from files; resetting deletes it.
 */
export type SpellCheckDictionaryKind = 'user' | 'bundled' | 'custom';

/**
 * What the worker loads for a dictionary: its Hunspell pair (absent for one
 * created blank, and for the user dictionary) and the reader's edits on top,
 * applied as Hunspell's run-time additions and removals.
 */
export type SpellCheckDictionaryFiles = {
  aff: Uint8Array | null;
  dic: Uint8Array | null;
  added: string[];
  removed: string[];
};

export const USER_DICTIONARY_ID = 'user';
export const USER_DICTIONARY_LABEL = 'User Dictionary';
export const DEFAULT_DICTIONARY_ICON = 'fa-book';

export const BUNDLED_DICTIONARIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'en', label: 'English (US)' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
];

/** What is active before the reader has chosen. The user dictionary is not listed: it is always active. */
export const DEFAULT_SPELL_CHECK_DICTIONARIES: readonly string[] = ['en'];

export const SPELL_CHECK_CHANNELS = {
  listDictionaries: 'spellcheck:dictionaries:list',
  readDictionary: 'spellcheck:dictionaries:read',
  listWords: 'spellcheck:dictionaries:words',
  addWords: 'spellcheck:dictionaries:add-words',
  removeWords: 'spellcheck:dictionaries:remove-words',
  createDictionary: 'spellcheck:dictionaries:create',
  installDictionary: 'spellcheck:dictionaries:install',
  renameDictionary: 'spellcheck:dictionaries:rename',
  setDictionaryIcon: 'spellcheck:dictionaries:icon',
  resetDictionary: 'spellcheck:dictionaries:reset',
} as const satisfies InvokeChannels<SpellCheckApi>;

export interface SpellCheckApi {
  /** The user dictionary first, then the bundled ones, then the reader's own by name. */
  listDictionaries(): Promise<SpellCheckDictionary[]>;
  /** What the worker loads for a dictionary, or null when there is no such dictionary. */
  readDictionary(id: string): Promise<SpellCheckDictionaryFiles | null>;
  /** Its words: the pair's stems (affix flags left out) without the removed ones, plus the added ones. Unsorted. */
  listWords(id: string): Promise<string[]>;
  addWords(id: string, words: string[]): Promise<boolean>;
  removeWords(id: string, words: string[]): Promise<boolean>;
  /** A new, empty dictionary of the reader's own. */
  createDictionary(): Promise<SpellCheckDictionary | null>;
  /**
   * Asks for dictionary files and copies in every `.dic`/`.aff` pair found:
   * a `.dic` (its `.aff` picked with it or beside it), or an `.oxt`, `.xpi`
   * or `.zip` archive holding pairs. The dictionaries installed; empty when
   * cancelled or nothing was usable.
   */
  installDictionary(): Promise<SpellCheckDictionary[]>;
  /** Names a dictionary. An empty name is refused. */
  renameDictionary(id: string, label: string): Promise<boolean>;
  setDictionaryIcon(id: string, icon: string | null): Promise<boolean>;
  /** Per kind (`SpellCheckDictionaryKind`): empties the user dictionary, restores a bundled one, deletes a custom one. */
  resetDictionary(id: string): Promise<boolean>;
}

/** The words typed into a field or picked from a note: split on white space, each trimmed, empty ones and repeats left out. */
export function wordsFromText(text: string): string[] {
  return [...new Set(text.split(/\s+/u).map((word) => word.trim()).filter((word) => word.length > 0 && word.length <= 100))];
}

/**
 * A `.dic` file's words: every line after the count, cut at its first
 * unescaped `/` (the affix flags) and at white space (morphological fields).
 */
export function stemsOfDic(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const stems: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.startsWith('\t')) continue;
    let end = line.length;
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at];
      if (char === '/' && (at === 0 || line[at - 1] !== '\\')) { end = at; break; }
      if (char === ' ' || char === '\t') { end = at; break; }
    }
    const stem = line.slice(0, end).replace(/\\\//g, '/');
    if (stem) stems.push(stem);
  }
  return stems;
}

/**
 * The name a dictionary file gets by default: its name without extension,
 * underscores as spaces, in capitals (`pt_BR.dic` is "PT BR"). A file called
 * `index` says nothing (wooorm/dictionaries names every one so), so its
 * folder's name stands in for it, and an archive's own name for its contents.
 */
export function dictionaryLabelFor(stem: string): string {
  return stem.replace(/_/g, ' ').trim().toUpperCase();
}

/** The active list as saved, or the default when there is none. Duplicates and non-strings are dropped. */
export function sanitizeSpellCheckDictionaries(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0 && entry.length <= 128 && !ids.includes(entry)) ids.push(entry);
  }
  return ids;
}
