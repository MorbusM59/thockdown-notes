/*
 * The renderer's side of the spell checker: one worker for the whole window
 * (spellCheck.worker.ts), one answer cache shared by every editor, and the
 * set of active dictionaries.
 *
 * The cache is the point. An editor asks about the words it is showing on
 * every update that could change them (an edit, a scroll, a caret move), so
 * the question has to be answerable synchronously for every word it has
 * seen: `lookup` is a Map read. A word not yet known is queued, the queue is
 * sent as one batch at the end of the task, and when the answer arrives every
 * subscriber is told once so it can redraw. Each distinct word therefore
 * crosses to the worker once per set of dictionaries, however often it
 * appears and however often it is redrawn.
 *
 * Changing the active dictionaries empties the cache and bumps `generation`;
 * an answer computed for an older generation is dropped rather than cached,
 * since it may say a word is wrong that a newly active dictionary accepts.
 *
 * Nothing is loaded until an editor first asks (`ensureStarted`): with spell
 * checking off, neither the worker nor any dictionary exists.
 */
import type { SpellCheckApi } from '../shared/spellCheck';
import { typoMarks, type MarkRange } from './typoMarks';

type Listener = () => void;

let worker: Worker | null = null;
let generation = 0;
let activeIds: string[] = [];
/** The ids whose files the worker already holds, so a reconfigure sends only what is new. */
const sentToWorker = new Set<string>();
/** word -> true when misspelled, false when correct. */
let answers = new Map<string, boolean>();
/** misspelled word -> the letters to mark, when a suggestion one edit away locates the typo. */
let marks = new Map<string, MarkRange[]>();
const pending = new Set<string>();
export type SuggestionAnswer = { misspelled: boolean; suggestions: readonly string[] };
/** word -> its suggestions, asked for when the reader takes one (Shift+Space). */
let suggestionAnswers = new Map<string, Promise<SuggestionAnswer>>();
const suggestionWaiters = new Map<string, (answer: SuggestionAnswer) => void>();
let queued: string[] = [];
let flushScheduled = false;
const listeners = new Set<Listener>();
let configureChain: Promise<void> = Promise.resolve();
let started = false;

function api(): SpellCheckApi | undefined {
  return window.thockdownSpellCheck;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./spellCheck.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<
    | { type: 'checked'; generation: number; misspelled: string[]; words: string[] }
    | { type: 'suggested'; generation: number; targets: Array<[string, string]> }
    | { type: 'suggestions'; generation: number; word: string; misspelled: boolean; suggestions: string[] }
  >) => {
    const message = event.data;
    if (message.type === 'suggestions') {
      const key = `${message.generation}\n${message.word}`;
      suggestionWaiters.get(key)?.({ misspelled: message.misspelled, suggestions: message.suggestions });
      suggestionWaiters.delete(key);
      if (message.generation === generation) answers.set(message.word, message.misspelled);
      return;
    }
    if (message.type === 'suggested') {
      if (message.generation !== generation) return;
      for (const [word, target] of message.targets) marks.set(word, typoMarks(word, target));
      notify();
      return;
    }
    for (const word of message.words) pending.delete(word);
    if (message.generation !== generation) return;
    const misspelled = new Set(message.misspelled);
    for (const word of message.words) answers.set(word, misspelled.has(word));
    // Only a misspelling changes what is drawn: a correct word was drawn as
    // correct while it was unknown.
    if (misspelled.size > 0) notify();
  };
  return worker;
}

/**
 * Sends the active set to the worker, fetching the files of any dictionary it
 * does not hold yet. Serialized, so two quick toggles cannot interleave their
 * fetches and leave the worker configured for the first.
 */
function configure(): void {
  const ids = [...activeIds];
  const myGeneration = ++generation;
  answers = new Map();
  marks = new Map();
  suggestionAnswers = new Map();
  pending.clear();
  queued = [];
  configureChain = configureChain.then(async () => {
    const bridge = api();
    const target = ensureWorker();
    const dictionaries: Array<{ id: string; aff?: Uint8Array; dic?: Uint8Array }> = [];
    for (const id of ids) {
      if (sentToWorker.has(id)) { dictionaries.push({ id }); continue; }
      const files = bridge ? await bridge.readDictionary(id).catch(() => null) : null;
      if (!files) continue;
      dictionaries.push({ id, aff: files.aff, dic: files.dic });
    }
    // The worker disposes whatever is not in this list.
    sentToWorker.clear();
    for (const entry of dictionaries) sentToWorker.add(entry.id);
    target.postMessage({ type: 'configure', generation: myGeneration, dictionaries });
  });
  void configureChain.then(() => { if (myGeneration === generation) notify(); });
}

function flush(): void {
  flushScheduled = false;
  if (queued.length === 0) return;
  const words = queued;
  queued = [];
  const myGeneration = generation;
  // After any configure in flight, so the batch is checked against it.
  void configureChain.then(() => {
    if (myGeneration !== generation) {
      for (const word of words) pending.delete(word);
      return;
    }
    ensureWorker().postMessage({ type: 'check', generation: myGeneration, words });
  });
}

export const spellCheckClient = {
  /** Starts the worker with the active dictionaries, once. */
  ensureStarted(): void {
    if (started) return;
    started = true;
    configure();
  },

  /** Replaces the active dictionaries. A no-op when the set is unchanged. */
  setActiveDictionaries(ids: readonly string[]): void {
    if (ids.length === activeIds.length && ids.every((id, index) => id === activeIds[index])) return;
    activeIds = [...ids];
    if (started) configure();
  },

  /**
   * True when `word` is known to be misspelled, false when known to be
   * correct, undefined when not yet known (it is then queued for checking).
   */
  lookup(word: string): boolean | undefined {
    const answer = answers.get(word);
    if (answer !== undefined) return answer;
    if (!pending.has(word)) {
      pending.add(word);
      queued.push(word);
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
      }
    }
    return undefined;
  },

  /** The letters of a misspelled word to mark (offsets in it), or undefined to mark the whole word. */
  marksFor(word: string): readonly MarkRange[] | undefined {
    return marks.get(word);
  },

  /**
   * Whether `word` is misspelled and its suggestions, best first. Kept per
   * set of dictionaries, so cycling through a word's suggestions asks once.
   */
  suggestionsFor(word: string): Promise<SuggestionAnswer> {
    const cached = suggestionAnswers.get(word);
    if (cached) return cached;
    const myGeneration = generation;
    const answer = new Promise<SuggestionAnswer>((resolve) => {
      suggestionWaiters.set(`${myGeneration}\n${word}`, resolve);
      void configureChain.then(() => ensureWorker().postMessage({ type: 'suggest', generation: myGeneration, word }));
    });
    suggestionAnswers.set(word, answer);
    return answer;
  },

  /** Called whenever an answer could change what is drawn. Returns the unsubscribe. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
