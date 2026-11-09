/*
 * The spell checker's engine: Hunspell compiled to WebAssembly (hunspell-asm),
 * one instance per active dictionary, in a worker so neither loading a
 * dictionary nor checking a page of words is ever on the main thread.
 *
 * Messages in:
 *   { type: 'configure', generation, dictionaries: [{ id, aff, dic }] }
 *     The complete set of active dictionaries. Instances for ids no longer
 *     present are disposed; new ids are loaded. An id already loaded keeps its
 *     instance and its files are not sent again (`aff`/`dic` are then omitted).
 *   { type: 'check', generation, words: string[] }
 * Messages out:
 *   { type: 'checked', generation, misspelled: string[], words: string[] }
 *   { type: 'suggested', generation, targets: Array<[word, target]> }
 *     Sent after 'checked', for the misspelled words of that batch whose typo can
 *     be located: the word it is pinpointed against. That is a dictionary's top
 *     suggestion when it is one edit away (`isNearMiss`), or the only
 *     suggestion whatever its distance, since with one candidate there is no
 *     doubt which word was meant. Separate because suggesting costs 10-140ms a word where
 *     checking costs microseconds, so the outlines never wait for it.
 *   { type: 'suggestions', generation, word, misspelled, suggestions: string[] }
 *     The answer to { type: 'suggest', generation, word }, asked when the
 *     reader takes a suggestion (Shift+Space): whether the word is misspelled
 *     and every suggestion for it, best first (`ranked`).
 *
 * A word is correct when ANY active dictionary accepts it, so a note may mix
 * languages. With no dictionary active every word is correct. `generation`
 * comes back unchanged so the client can drop answers that were computed
 * against a set of dictionaries that has since changed.
 */
// The CommonJS build, not the package's ESM one: the ESM build calls two
// `import * as` namespaces as functions (its emscripten runtime and nanoid),
// which only a bundler with loose interop tolerates, and fails here with
// "t is not a function". The CommonJS build `require`s them, which the bundler
// converts correctly; the package's `browser` field still swaps in the
// browser runtime.
import { loadModule } from 'hunspell-asm/dist/cjs/index.js';
import type { Hunspell, HunspellFactory } from 'hunspell-asm';
import { isNearMiss } from './typoMarks';

type ConfigureMessage = {
  type: 'configure';
  generation: number;
  dictionaries: Array<{ id: string; aff?: Uint8Array; dic?: Uint8Array }>;
};
type CheckMessage = { type: 'check'; generation: number; words: string[] };
type SuggestMessage = { type: 'suggest'; generation: number; word: string };

type Loaded = { hunspell: Hunspell; affPath: string; dicPath: string };

const factoryPromise: Promise<HunspellFactory> = loadModule();
const loaded = new Map<string, Loaded>();
// Messages are handled strictly in order: a check must see the configuration
// sent before it, and loading the factory is asynchronous.
let queue: Promise<void> = Promise.resolve();

function configure(factory: HunspellFactory, message: ConfigureMessage): void {
  const wanted = new Set(message.dictionaries.map((entry) => entry.id));
  for (const [id, entry] of loaded) {
    if (wanted.has(id)) continue;
    entry.hunspell.dispose();
    factory.unmount(entry.affPath);
    factory.unmount(entry.dicPath);
    loaded.delete(id);
  }
  for (const entry of message.dictionaries) {
    if (loaded.has(entry.id) || !entry.aff || !entry.dic) continue;
    try {
      const affPath = factory.mountBuffer(entry.aff, `${loaded.size}-${entry.id}.aff`);
      const dicPath = factory.mountBuffer(entry.dic, `${loaded.size}-${entry.id}.dic`);
      loaded.set(entry.id, { hunspell: factory.create(affPath, dicPath), affPath, dicPath });
    } catch (error) {
      console.warn(`Spell check: dictionary "${entry.id}" could not be loaded`, error);
    }
  }
}

const isKnown = (word: string) => [...loaded.values()].some((entry) => entry.hunspell.spell(word));

/**
 * Every active dictionary's suggestions for `word`, and the one that locates
 * its typo (`target`, see the 'suggested' message). `ranked` lists the target
 * first, then the dictionaries' suggestions rank by rank (every first choice,
 * then every second), so no one dictionary's long tail comes before
 * another's best.
 */
function suggestionsFor(word: string): { target: string | undefined; ranked: string[] } {
  const lists: string[][] = [];
  let target: string | undefined;
  for (const entry of loaded.values()) {
    // Each dictionary ranks its own suggestions, so "the top one" is asked of
    // each: a German top suggestion for an English typo says nothing.
    const ranked = entry.hunspell.suggest(word);
    lists.push(ranked);
    if (target === undefined && ranked.length > 0 && isNearMiss(word, ranked[0])) target = ranked[0];
  }
  const all = new Set<string>();
  for (let rank = 0; lists.some((list) => rank < list.length); rank += 1) {
    for (const list of lists) if (rank < list.length) all.add(list[rank]);
  }
  if (target === undefined && all.size === 1) [target] = all;
  return { target, ranked: target === undefined ? [...all] : [target, ...[...all].filter((entry) => entry !== target)] };
}

function check(message: CheckMessage): void {
  const misspelled: string[] = [];
  if (loaded.size > 0) {
    for (const word of message.words) {
      if (!isKnown(word)) misspelled.push(word);
    }
  }
  postMessage({ type: 'checked', generation: message.generation, misspelled, words: message.words });
  if (misspelled.length === 0) return;
  const targets: Array<[string, string]> = [];
  for (const word of misspelled) {
    const { target } = suggestionsFor(word);
    if (target !== undefined) targets.push([word, target]);
  }
  if (targets.length > 0) postMessage({ type: 'suggested', generation: message.generation, targets });
}

function suggest(message: SuggestMessage): void {
  const misspelled = loaded.size > 0 && !isKnown(message.word);
  const suggestions = misspelled ? suggestionsFor(message.word).ranked : [];
  postMessage({ type: 'suggestions', generation: message.generation, word: message.word, misspelled, suggestions });
}

self.onmessage = (event: MessageEvent<ConfigureMessage | CheckMessage | SuggestMessage>) => {
  const message = event.data;
  queue = queue.then(async () => {
    const factory = await factoryPromise;
    if (message.type === 'configure') configure(factory, message);
    else if (message.type === 'check') check(message);
    else suggest(message);
  }).catch((error) => console.warn('Spell check worker failed', error));
};
