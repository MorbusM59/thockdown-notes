import type { InvokeChannels } from './ipcContract';

/**
 * The spell checker's dictionaries, as the main process serves them.
 *
 * Spell checking is the app's own (`spellCheck/`): Hunspell, compiled to
 * WebAssembly, run in a worker, fed dictionaries that are files on this
 * machine. Four ship with the app (`BUNDLED_DICTIONARIES`, read from the
 * `dictionary-*` packages); the reader can install more, each one a Hunspell
 * `.aff` and `.dic` pair, copied into the app's data folder. Which of them
 * take part is a setting (`PersistedMenuState.spellCheckDictionaries`): a
 * word is correct when ANY active dictionary accepts it, which is what lets
 * a note mix languages.
 */
export type SpellCheckDictionary = {
  /** Stable id: the language code of a bundled dictionary, the file name of an installed one. */
  id: string;
  /** Its name in the options panel: the reader's, or derived from the file it came from (`dictionaryLabelFor`). */
  label: string;
  bundled: boolean;
};

export type SpellCheckDictionaryFiles = {
  aff: Uint8Array;
  dic: Uint8Array;
};

export const BUNDLED_DICTIONARIES: readonly SpellCheckDictionary[] = [
  { id: 'en', label: 'EN US', bundled: true },
  { id: 'es', label: 'ES', bundled: true },
  { id: 'fr', label: 'FR', bundled: true },
  { id: 'de', label: 'DE DE', bundled: true },
];

/** What is active before the reader has chosen. */
export const DEFAULT_SPELL_CHECK_DICTIONARIES: readonly string[] = ['en'];

export const SPELL_CHECK_CHANNELS = {
  listDictionaries: 'spellcheck:dictionaries:list',
  readDictionary: 'spellcheck:dictionaries:read',
  installDictionary: 'spellcheck:dictionaries:install',
  removeDictionary: 'spellcheck:dictionaries:remove',
  renameDictionary: 'spellcheck:dictionaries:rename',
} as const satisfies InvokeChannels<SpellCheckApi>;

export interface SpellCheckApi {
  listDictionaries(): Promise<SpellCheckDictionary[]>;
  /** The dictionary's two files, or null when there is no such dictionary. */
  readDictionary(id: string): Promise<SpellCheckDictionaryFiles | null>;
  /**
   * Asks for dictionary files and copies in every `.dic`/`.aff` pair found:
   * a `.dic` (its `.aff` picked with it or beside it), or an `.oxt`, `.xpi`
   * or `.zip` archive holding pairs. The dictionaries installed; empty when
   * cancelled or nothing was usable.
   */
  installDictionary(): Promise<SpellCheckDictionary[]>;
  /** Names a dictionary, bundled or installed. An empty name puts a bundled one back to its own and leaves an installed one as it was. */
  renameDictionary(id: string, label: string): Promise<boolean>;
  /** Removes an installed dictionary. A bundled one cannot be removed. */
  removeDictionary(id: string): Promise<boolean>;
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
