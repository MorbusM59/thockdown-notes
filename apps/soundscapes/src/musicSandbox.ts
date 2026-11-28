/**
 * The music renderer as a self-contained script for the bare JavaScript
 * engine the app's native service runs (MusicRenderer.java), beside the
 * soundscape's (packages/soundscape/soundscapeSandbox.ts): the render-ahead
 * engine (@thockdown/audio/renderAhead.ts) over a music voice
 * (@thockdown/audio/musicVoice.ts), driven by calls instead of messages.
 *
 * Songs are decoded natively and handed over as they are needed, at the
 * file's own rate; they are resampled here (@thockdown/audio/resampler.ts)
 * to the output's. Calls exchange strings only, so audio crosses as base64
 * (halfScalePcm.ts): 16-bit full scale in, half scale out.
 *
 * Built by apps/soundscapes/vite.music-renderer.config.ts into one IIFE in
 * the Android app's assets.
 *
 * The functions it defines on globalThis:
 * - musicInit(json): `{ sampleRate, spliceMarginSec }`; the EQ bands are the
 *   desktop's (musicEqCurve.ts's EQ_BAND_FREQUENCIES_HZ at EQ_BAND_Q);
 * - musicConfigure(json): MusicSettings (the soundstage; `cut` for a skip or
 *   a seek, which drops the stream from the splice on);
 * - musicSong(songId, sourceRate, offsetFrames): the audio appended next is
 *   that song, from `offsetFrames` (output frames) into it;
 * - musicAppend(base64): the current song's next decoded samples;
 * - musicEnd(): nothing more follows what was appended (the queue is empty);
 * - musicCatalog(json) / musicRotation(json): the library's two documents
 *   (musicLibrary.ts), the catalog whenever the page changes it, the
 *   rotation as stored;
 * - musicPoolSet(setId): the song set the schedule plays, the pool while
 *   it is set (-1 for none: the catalog's own sets);
 * - musicNext(previousId): NEXT, the song to play after `previousId` (-1 at
 *   the start), which goes back into the queue (musicLibrary.ts's
 *   `nextSong`), as `{ "id", "uri" }` or null;
 * - musicChoose(songId, currentId): the same for a song chosen from the
 *   list (`chooseSong`), `currentId` (-1 for none) going back in as NEXT
 *   would put it;
 * - musicJump(currentId, direction): NEXT from `currentId` (1), or
 *   PREVIOUS (-1): the song before it in the history of what this renderer
 *   played (musicPlayHistory.ts, the desktop's), null when there is none;
 * - musicRotationJson(): the rotation, for the service to store after a
 *   musicNext, musicJump or musicChoose;
 * - musicStep(playedFrame, maxChunks, spliceMarginSec?, heardFrame?): report
 *   how far the output has played (and, when given, its committed margin,
 *   as the soundscape's step takes it, and the frame its device is playing,
 *   which `at` describes), render what the lead allows (at most
 *   `maxChunks`), and return `{ "chunks": [{ "s", "d" }], "ahead": frames
 *   of input held past the playhead, "at": { "songId", "offsetFrames" } |
 *   null, "next": output frame the next queued song is heard from, or -1 }`,
 *   `at` being what is heard at `heardFrame` (else the playhead), and, while the spectrum is on, `"spectrum"`:
 *   the frames computed from those chunks, `[{ "from", "first", "hop",
 *   "l" }]` (spectrumFrames.ts's SpectrumFrameBatch, `l` its levels in
 *   base64);
 * - musicSpectrum(bands): compute the visualizer's spectrum in `bands` log
 *   bands (0 stops it). Turning it on re-renders from a splice margin past
 *   the playhead with nothing changed (renderAhead.ts's `rerender`), which reproduces the audio
 *   already queued sample for sample (renderAhead.ts's rewind), so the
 *   frames start there rather than a render lead later.
 */
import { MusicVoice, type MusicSettings } from '@thockdown/audio/musicVoice';
import { RenderAheadEngine, type RenderedChunk } from '@thockdown/audio/renderAhead';
import { StreamResampler } from '@thockdown/audio/resampler';
import { EQ_BAND_FREQUENCIES_HZ, EQ_BAND_Q } from '@thockdown/visualizer/shared/musicEqCurve';
import { chooseSong, EMPTY_CATALOG, nextSong, sanitizeCatalog, sanitizeRotation, settleRotation, stepBackRotation, type MusicCatalog, type MusicRotation, type RotationMove } from './musicLibrary';
import { currentHistorySongId, emptyPlayHistory, forgetSong, pushPlayed, stepBack as stepBackHistory } from '@thockdown/visualizer/shared/musicPlayHistory';
import { decodeFullScaleStereo, encodeHalfScaleStereo, toBase64 } from '@thockdown/soundscape/halfScalePcm';
import { SpectrumFrames } from '@thockdown/visualizer/visualizer/spectrumFrames';
import { logBandEdges } from '@thockdown/visualizer/visualizer/spectrumBands';

let engine: RenderAheadEngine<MusicSettings> | null = null;
let voice: MusicVoice | null = null;
let resampler: StreamResampler | null = null;
let outputRate = 48000;
let catalog: MusicCatalog = EMPTY_CATALOG;
let rotation: MusicRotation = [];
const tasks: Array<() => void> = [];
const rendered: RenderedChunk[] = [];
let spectrum: SpectrumFrames | null = null;

const scope = globalThis as unknown as Record<string, unknown>;

scope.musicInit = (json: string): string => {
  const { sampleRate, spliceMarginSec } = JSON.parse(json) as { sampleRate: number; spliceMarginSec: number };
  const bands = EQ_BAND_FREQUENCIES_HZ.map((frequencyHz) => ({ frequencyHz, q: EQ_BAND_Q }));
  outputRate = sampleRate;
  voice = new MusicVoice(sampleRate, bands);
  resampler = null;
  spectrum = null;
  tasks.length = 0;
  rendered.length = 0;
  engine = new RenderAheadEngine<MusicSettings>(voice, sampleRate, spliceMarginSec, (chunk) => rendered.push(chunk), (work) => tasks.push(work));
  return 'ok';
};

scope.musicConfigure = (json: string): string => {
  const settings = JSON.parse(json) as MusicSettings;
  // A cut drops the stream from the splice on: what the old song's resampler still holds goes with it.
  if (settings.cut) resampler = null;
  engine?.configure(settings);
  return 'ok';
};

/** What the current song's resampler still holds, into the stream. */
function finishSong(): void {
  if (!voice || !resampler) return;
  const [left, right] = resampler.finish();
  voice.input.append(left, right);
  resampler = null;
}

scope.musicSong = (songId: number, sourceRate: number, offsetFrames: number): string => {
  if (!voice) return 'ok';
  finishSong();
  voice.input.cue(songId, offsetFrames);
  resampler = new StreamResampler(sourceRate, outputRate);
  return 'ok';
};

scope.musicAppend = (base64: string): string => {
  if (!voice || !resampler) return 'ok';
  const [left, right] = resampler.push(...decodeFullScaleStereo(base64));
  voice.input.append(left, right);
  engine?.poke();
  return 'ok';
};

scope.musicEnd = (): string => {
  if (!voice) return 'ok';
  finishSong();
  voice.input.ended = true;
  engine?.poke();
  return 'ok';
};

scope.musicStep = (playedFrame: number, maxChunks: number, spliceMarginSec?: number, heardFrame?: number): string => {
  if (!engine || !voice) return '{"chunks":[],"ahead":0,"at":null,"next":-1}';
  if (spliceMarginSec !== undefined) engine.setMargin(spliceMarginSec);
  engine.played(playedFrame);
  // The stream frame heard at the playhead: the voice reads the stream in
  // order, one chunk per chunk rendered, so the two differ by a constant
  // (musicVoice.ts), which changes only where the engine resumed after the
  // output ran dry (renderAhead.ts's `played`).
  const heard = voice.position - (engine.written - playedFrame);
  // What is HEARD, which a deep device buffer puts seconds behind the
  // playhead: the song the lock screen names, and its position.
  const heardNow = heard - (playedFrame - Math.min(heardFrame ?? playedFrame, playedFrame));
  // Nothing before what is heard is asked about again (nothing before the
  // playhead is read again). Forgetting up to the playhead dropped the cue
  // of the song still heard behind it, so `at` named no song for the
  // seconds the device held past a song's end, and PREVIOUS, with no song
  // heard, stepped back to the song playing.
  voice.input.forget(Math.min(heardNow, voice.position));
  while (tasks.length > 0 && rendered.length < maxChunks) tasks.shift()!();
  const done = rendered.splice(0);
  const chunks = done.map((chunk) => ({ s: chunk.startFrame, d: encodeHalfScaleStereo(chunk.left, chunk.right) }));
  const at = voice.input.at(heardNow);
  // The output frame the next song is heard from, so the output can report
  // exactly then rather than by polling (-1: none queued).
  const cue = voice.input.nextCue(heard);
  const next = cue === null ? -1 : playedFrame + (cue - heard);
  if (!spectrum) return JSON.stringify({ chunks, ahead: voice.input.end - heard, at, next });
  const frames = [];
  for (const chunk of done) {
    const batch = spectrum.push(chunk.startFrame, chunk.left, chunk.right);
    if (batch) frames.push({ from: batch.from, first: batch.first, hop: batch.hop, l: toBase64(batch.levels) });
  }
  return JSON.stringify({ chunks, ahead: voice.input.end - heard, at, next, spectrum: frames });
};

scope.musicSpectrum = (bands: number): string => {
  spectrum = bands > 0 ? new SpectrumFrames(outputRate, logBandEdges(bands)) : null;
  if (spectrum) engine?.rerender();
  return 'ok';
};

scope.musicCatalog = (json: string): string => {
  catalog = sanitizeCatalog(JSON.parse(json));
  return 'ok';
};

scope.musicRotation = (json: string): string => {
  rotation = sanitizeRotation(JSON.parse(json));
  return 'ok';
};

scope.musicRotationJson = (): string => JSON.stringify(rotation);

/**
 * The song set the SCHEDULE plays (schedule.ts's music channel), or -1 for
 * none. While one is set the pool is that set alone, unfiltered, without
 * touching the listener's own choice of sets in the catalog.
 */
let poolSet = -1;
scope.musicPoolSet = (setId: number): string => {
  poolSet = setId;
  return 'ok';
};

const poolCatalog = (): MusicCatalog => (poolSet < 0 ? catalog : { ...catalog, activeSetIds: [poolSet], filter: EMPTY_CATALOG.filter });

/**
 * What this renderer played, for PREVIOUS: kept for as long as the renderer
 * lives, as the desktop keeps its for a session.
 */
let history = emptyPlayHistory();

/** The rotation with every catalog song placed, before any move reads it. */
function settle(): void {
  rotation = settleRotation(catalog, rotation);
}

/** A move's rotation kept and its song recorded as playing. */
function played(move: RotationMove): string {
  rotation = move.rotation;
  if (!move.song) return 'null';
  history = pushPlayed(history, move.song.id);
  return JSON.stringify({ id: move.song.id, uri: move.song.filePath });
}

scope.musicNext = (previousId: number): string => {
  settle();
  return played(nextSong(poolCatalog(), rotation, previousId < 0 ? null : previousId));
};

scope.musicJump = (currentId: number, direction: number): string => {
  settle();
  const current = currentId < 0 ? null : currentId;
  if (direction > 0) return played(nextSong(poolCatalog(), rotation, current));
  // The renderer picks the next song as soon as the current one is decoded,
  // so the history can already hold a song not yet heard: back is measured
  // from the song heard, so those are stepped past first.
  const heardAt = current === null ? -1 : history.entries.lastIndexOf(current);
  if (heardAt >= 0 && currentHistorySongId(history) !== current) history = { entries: history.entries, cursor: heardAt };
  // Back through the history; a song no longer in the catalog is stepped over.
  for (;;) {
    const step = stepBackHistory(history);
    if (!step) return 'null';
    const song = catalog.songs.find((entry) => entry.id === step.songId);
    if (!song) {
      history = forgetSong(history, step.songId);
      continue;
    }
    history = step.history;
    rotation = stepBackRotation(poolCatalog(), rotation, current, song.id);
    return JSON.stringify({ id: song.id, uri: song.filePath });
  }
};

scope.musicChoose = (songId: number, currentId: number): string => {
  settle();
  return played(chooseSong(poolCatalog(), rotation, currentId < 0 ? null : currentId, songId));
};
