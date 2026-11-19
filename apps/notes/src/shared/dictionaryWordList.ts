/**
 * A dictionary's words as the sidebar's dictionary view lists them
 * (sidebar/DictionaryPanel.tsx), the way the Music Library lists a set's
 * songs: a section per first letter and, once the list is long enough that a
 * section would be hundreds of rows, a divider per second letter inside it.
 *
 * Letters are compared without case or accents, so "Éclair" sits with
 * "eclipse" under E; a word that does not start with a letter is under `#`.
 * The filter is the sidebar's search field, matched anywhere in a word with
 * the same leniency.
 */
export type DictionaryWordDivider = { key: string; label: string; words: string[] };
export type DictionaryWordGroup = {
  key: string;
  label: string;
  count: number;
  /** Null for a short list, whose sections hold their words directly. */
  dividers: DictionaryWordDivider[] | null;
  words: string[];
};

/** From this many words listed, sections are divided by second letter. */
export const DICTIONARY_DIVIDER_THRESHOLD = 500;

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** A word's comparison form: no accents, upper case. */
function folded(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLocaleUpperCase();
}

export function groupDictionaryWords(words: readonly string[], filter: string): DictionaryWordGroup[] {
  const needle = folded(filter.trim());
  const shown = words
    .map((word) => ({ word, key: folded(word) }))
    .filter((entry) => needle === '' || entry.key.includes(needle))
    .sort((a, b) => collator.compare(a.word, b.word) || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  const divided = shown.length >= DICTIONARY_DIVIDER_THRESHOLD;
  const groups: DictionaryWordGroup[] = [];
  const byLetter = new Map<string, DictionaryWordGroup>();
  for (const { word, key } of shown) {
    const first = [...key][0] ?? '';
    const letter = /\p{L}/u.test(first) ? first : '#';
    let group = byLetter.get(letter);
    if (!group) {
      group = { key: letter, label: letter, count: 0, dividers: divided ? [] : null, words: [] };
      byLetter.set(letter, group);
      groups.push(group);
    }
    group.count += 1;
    if (!group.dividers) {
      group.words.push(word);
      continue;
    }
    const second = letter === '#' ? '' : ([...key][1] ?? '');
    const label = second && /\p{L}/u.test(second) ? letter + second.toLocaleLowerCase() : letter;
    const last = group.dividers[group.dividers.length - 1];
    if (last && last.key === label) last.words.push(word);
    else group.dividers.push({ key: label, label, words: [word] });
  }
  // Sorted by the collator, a section's dividers can repeat a label once a
  // non-letter second character sorts between two runs of it; merged here.
  for (const group of groups) {
    if (!group.dividers) continue;
    const merged = new Map<string, DictionaryWordDivider>();
    for (const divider of group.dividers) {
      const existing = merged.get(divider.key);
      if (existing) existing.words.push(...divider.words);
      else merged.set(divider.key, divider);
    }
    group.dividers = [...merged.values()];
  }
  return groups;
}
