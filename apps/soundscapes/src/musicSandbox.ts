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
 * - musicNext(previousId): the song to play after `previousId` (-1 at the
 *   start), counting it as played, as `{ "id", "uri" }` or null;
 * - musicChoose(songId): the same for a song chosen from the list, which
 *   rotates the pool to it rather than counting anything as played;
 * - musicRotationJson(): the rotation, for the service to store after a
 *   musicNext or musicChoose;
 * - musicStep(playedFrame, maxChunks): report how far the output has played,
 *   render what the lead allows (at most `maxChunks`), and return
 *   `{ "chunks": [{ "s", "d" }], "ahead": frames of input held past the
 *   playhead, "at": { "songId", "offsetFrames" } | null }`, `at` being what
 *   is heard at the playhead, and, while the spectrum is on, `"spectrum"`:
 *   the frames computed from those chunks, `[{ "from", "first", "hop",
 *   "l" }]` (spectrumFrames.ts's SpectrumFrameBatch, `l` its levels in
 *   base64);
 * - musicSpectrum(bands): compute the visualizer's spectrum in `bands` log
 *   bands (0 stops it). Turning it on re-renders from a splice margin past
 *   the playhead with the soundstage unchanged, which reproduces the audio
 *   already queued sample for sample (renderAhead.ts's rewind), so the
 *   frames start there rather than a render lead later.
 */
import { MusicVoice, type MusicSettings } from '@thockdown/audio/musicVoice';
import { RenderAheadEngine, type RenderedChunk } from '@thockdown/audio/renderAhead';
import { StreamResampler } from '@thockdown/audio/resampler';
import { EQ_BAND_FREQUENCIES_HZ, EQ_BAND_Q } from '@thockdown/visualizer/shared/musicEqCurve';
import { chooseSong, EMPTY_CATALOG, nextSong, type MusicCatalog, type MusicRotation } from './musicLibrary';
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
/** The soundstage last configured, re-sent to re-render when the spectrum is turned on. */
let stage: MusicSettings['stage'] | null = null;

const scope = globalThis as unknown as Record<string, unknown>;

scope.musicInit = (json: string): string => {
  const { sampleRate, spliceMarginSec } = JSON.parse(json) as { sampleRate: number; spliceMarginSec: number };
  const bands = EQ_BAND_FREQUENCIES_HZ.map((frequencyHz) => ({ frequencyHz, q: EQ_BAND_Q }));
  outputRate = sampleRate;
  voice = new MusicVoice(sampleRate, bands);
  resampler = null;
  spectrum = null;
  stage = null;
  tasks.length = 0;
  rendered.length = 0;
  engine = new RenderAheadEngine<MusicSettings>(voice, sampleRate, spliceMarginSec, (chunk) => rendered.push(chunk), (work) => tasks.push(work));
  return 'ok';
};

scope.musicConfigure = (json: string): string => {
  const settings = JSON.parse(json) as MusicSettings;
  // A cut drops the stream from the splice on: what the old song's resampler still holds goes with it.
  if (settings.cut) resampler = null;
  stage = settings.stage;
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

scope.musicStep = (playedFrame: number, maxChunks: number): string => {
  if (!engine || !voice) return '{"chunks":[],"ahead":0,"at":null}';
  engine.played(playedFrame);
  // Stream frames are output frames (musicVoice.ts): nothing before the playhead is read again.
  voice.input.forget(Math.min(playedFrame, voice.position));
  while (tasks.length > 0 && rendered.length < maxChunks) tasks.shift()!();
  const done = rendered.splice(0);
  const chunks = done.map((chunk) => ({ s: chunk.startFrame, d: encodeHalfScaleStereo(chunk.left, chunk.right) }));
  const at = voice.input.at(playedFrame);
  if (!spectrum) return JSON.stringify({ chunks, ahead: voice.input.end - playedFrame, at });
  const frames = [];
  for (const chunk of done) {
    const batch = spectrum.push(chunk.startFrame, chunk.left, chunk.right);
    if (batch) frames.push({ from: batch.from, first: batch.first, hop: batch.hop, l: toBase64(batch.levels) });
  }
  return JSON.stringify({ chunks, ahead: voice.input.end - playedFrame, at, spectrum: frames });
};

scope.musicSpectrum = (bands: number): string => {
  spectrum = bands > 0 ? new SpectrumFrames(outputRate, logBandEdges(bands)) : null;
  if (spectrum && engine && stage) engine.configure({ stage });
  return 'ok';
};

scope.musicCatalog = (json: string): string => {
  catalog = JSON.parse(json) as MusicCatalog;
  return 'ok';
};

scope.musicRotation = (json: string): string => {
  rotation = JSON.parse(json) as MusicRotation;
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

const poolCatalog = (): MusicCatalog => (poolSet < 0 ? catalog : { ...catalog, activeSetIds: [poolSet], filter: { query: '' } });

scope.musicNext = (previousId: number): string => {
  const next = nextSong(poolCatalog(), rotation, previousId < 0 ? null : previousId);
  rotation = next.rotation;
  return JSON.stringify(next.song ? { id: next.song.id, uri: next.song.filePath } : null);
};

scope.musicChoose = (songId: number): string => {
  rotation = chooseSong(catalog, rotation, songId);
  const song = catalog.songs.find((entry) => entry.id === songId);
  return JSON.stringify(song ? { id: song.id, uri: song.filePath } : null);
};
