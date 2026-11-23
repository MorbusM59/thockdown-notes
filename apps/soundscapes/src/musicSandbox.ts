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
 * - musicStep(playedFrame, maxChunks): report how far the output has played,
 *   render what the lead allows (at most `maxChunks`), and return
 *   `{ "chunks": [{ "s", "d" }], "ahead": frames of input held past the
 *   playhead, "at": { "songId", "offsetFrames" } | null }`, `at` being what
 *   is heard at the playhead.
 */
import { MusicVoice, type MusicSettings } from '@thockdown/audio/musicVoice';
import { RenderAheadEngine, type RenderedChunk } from '@thockdown/audio/renderAhead';
import { StreamResampler } from '@thockdown/audio/resampler';
import { EQ_BAND_FREQUENCIES_HZ, EQ_BAND_Q } from '@thockdown/visualizer/shared/musicEqCurve';
import { decodeFullScaleStereo, encodeHalfScaleStereo } from '@thockdown/soundscape/halfScalePcm';

let engine: RenderAheadEngine<MusicSettings> | null = null;
let voice: MusicVoice | null = null;
let resampler: StreamResampler | null = null;
let outputRate = 48000;
const tasks: Array<() => void> = [];
const rendered: RenderedChunk[] = [];

const scope = globalThis as unknown as Record<string, unknown>;

scope.musicInit = (json: string): string => {
  const { sampleRate, spliceMarginSec } = JSON.parse(json) as { sampleRate: number; spliceMarginSec: number };
  const bands = EQ_BAND_FREQUENCIES_HZ.map((frequencyHz) => ({ frequencyHz, q: EQ_BAND_Q }));
  outputRate = sampleRate;
  voice = new MusicVoice(sampleRate, bands);
  resampler = null;
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

scope.musicStep = (playedFrame: number, maxChunks: number): string => {
  if (!engine || !voice) return '{"chunks":[],"ahead":0,"at":null}';
  engine.played(playedFrame);
  // Stream frames are output frames (musicVoice.ts): nothing before the playhead is read again.
  voice.input.forget(Math.min(playedFrame, voice.position));
  while (tasks.length > 0 && rendered.length < maxChunks) tasks.shift()!();
  const chunks = rendered.splice(0).map((chunk) => ({ s: chunk.startFrame, d: encodeHalfScaleStereo(chunk.left, chunk.right) }));
  return JSON.stringify({ chunks, ahead: voice.input.end - playedFrame, at: voice.input.at(playedFrame) });
};
