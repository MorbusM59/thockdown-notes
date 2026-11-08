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
  /** What the options panel shows. */
  label: string;
  bundled: boolean;
  /** The region a bundled dictionary's spelling follows (en is US English), when it follows one. */
  region?: string;
};

export type SpellCheckDictionaryFiles = {
  aff: Uint8Array;
  dic: Uint8Array;
};

export const BUNDLED_DICTIONARIES: readonly SpellCheckDictionary[] = [
  { id: 'en', label: 'English', bundled: true, region: 'US' },
  { id: 'es', label: 'Español', bundled: true },
  { id: 'fr', label: 'Français', bundled: true },
  { id: 'de', label: 'Deutsch', bundled: true, region: 'DE' },
];

/** What is active before the reader has chosen. */
export const DEFAULT_SPELL_CHECK_DICTIONARIES: readonly string[] = ['en'];

export const SPELL_CHECK_CHANNELS = {
  listDictionaries: 'spellcheck:dictionaries:list',
  readDictionary: 'spellcheck:dictionaries:read',
  installDictionary: 'spellcheck:dictionaries:install',
  removeDictionary: 'spellcheck:dictionaries:remove',
} as const satisfies InvokeChannels<SpellCheckApi>;

export interface SpellCheckApi {
  listDictionaries(): Promise<SpellCheckDictionary[]>;
  /** The dictionary's two files, or null when there is no such dictionary. */
  readDictionary(id: string): Promise<SpellCheckDictionaryFiles | null>;
  /** Asks for a `.dic` file (its `.aff` must sit beside it) and copies the pair in. Null when cancelled or unusable. */
  installDictionary(): Promise<SpellCheckDictionary | null>;
  /** Removes an installed dictionary. A bundled one cannot be removed. */
  removeDictionary(id: string): Promise<boolean>;
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
