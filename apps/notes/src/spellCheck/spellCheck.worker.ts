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

type ConfigureMessage = {
  type: 'configure';
  generation: number;
  dictionaries: Array<{ id: string; aff?: Uint8Array; dic?: Uint8Array }>;
};
type CheckMessage = { type: 'check'; generation: number; words: string[] };

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

function check(message: CheckMessage): void {
  const misspelled: string[] = [];
  if (loaded.size > 0) {
    for (const word of message.words) {
      let known = false;
      for (const entry of loaded.values()) {
        if (entry.hunspell.spell(word)) { known = true; break; }
      }
      if (!known) misspelled.push(word);
    }
  }
  postMessage({ type: 'checked', generation: message.generation, misspelled, words: message.words });
}

self.onmessage = (event: MessageEvent<ConfigureMessage | CheckMessage>) => {
  const message = event.data;
  queue = queue.then(async () => {
    const factory = await factoryPromise;
    if (message.type === 'configure') configure(factory, message);
    else check(message);
  }).catch((error) => console.warn('Spell check worker failed', error));
};
