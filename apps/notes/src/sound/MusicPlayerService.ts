import { LiveRoom } from '@thockdown/audio/liveRoom';
import { foliageNearCutoffHz } from '@thockdown/audio/room';
import { StereoWidth } from '@thockdown/audio/stereoWidth';
import { BRILLIANCE_NEUTRAL, LiveBrilliance } from '@thockdown/audio/liveBrilliance';
import { connectToOutput, outputContext } from '@thockdown/soundscape/audioOutputBus';

/**
 * MusicPlayerService — Web Audio API based music playback.
 *
 * Signal chain:
 *   HTMLAudioElement → MediaElementSourceNode → EQ → brilliance → foliage low-pass → GainNode ─┬→ dryGain ─────────┬→ StereoWidth → limiter → destination
 *                                                               └→ LiveRoom → wetGain ┘
 *
 * The limiter is the app's shared output stage (audioOutputBus.ts), which the
 * soundscape engine joins as well, so music and ambience are limited
 * together rather than each clipping on its own.
 *
 * The reverb is the family's one ROOM (@thockdown/audio/room.ts, played by
 * liveRoom.ts): the room slider is its SIZE and `reverbFoliage` its FOLIAGE,
 * the same two numbers the soundscape's space is made of. WIDTH
 * BRILLIANCE (@thockdown/audio/liveBrilliance.ts) is the soundscape's soft-to-crisp
 * tilt, after the EQ and before the volume, so the reverb hears it too.
 * WIDTH (@thockdown/audio/stereoWidth.ts) acts on what is heard, dry and wet
 * together, so above 1 it widens the room as well as the recording and at 0
 * it is a true mono fold-down. At width 1 it is the identity.
 */

export interface MusicPlayerConfig {
  volume: number;       // 0–1  master volume
  reverbAmount: number; // 0–1  reverb wet mix
  reverbRoom: number;   // 0–1  the room's SIZE (room.ts)
  reverbFoliage: number; // 0–1  the room's FOLIAGE (room.ts): bare and bright to dense and dark
  stereoWidth: number;  // STEREO_WIDTH_MIN–MAX, 1 neutral (stereoWidth.ts)
  brilliance: number;   // 0 soft, 0.5 neutral, 1 crisp (brilliance.ts)
}

export const DEFAULT_MUSIC_PLAYER_CONFIG: Readonly<MusicPlayerConfig> = {
  volume: 0.8,
  reverbAmount: 0,
  reverbRoom: 0.3,
  reverbFoliage: 0,
  stereoWidth: 1,
  brilliance: BRILLIANCE_NEUTRAL,
};

/**
 * Convert a native filesystem path to a thockdown-music:// URL.
 * Electron registers this scheme as a privileged protocol that proxies
 * requests to file:// in the main process, bypassing the cross-origin block
 * that prevents http://localhost (dev mode) from loading file:// media.
 *
 * A fixed "local" authority is used (rather than an empty host with
 * thockdown-music:///path) because Chromium's GURL parser for custom
 * "standard" schemes doesn't reliably treat a host-less triple-slash URL as
 * empty-host-plus-absolute-path: on Linux it was observed swallowing the
 * leading path segment (e.g. "/home/...") as if it were the hostname,
 * truncating every absolute path and making every file 404.
 */
function toMusicUrl(filePath: string): string {
  if (filePath.startsWith('thockdown-music://')) return filePath;
  // Normalise backslashes, then encode special characters (spaces, #, ? etc.)
  // in the path while preserving slashes and the Windows drive-letter colon.
  const posix = filePath.replace(/\\/g, '/');
  const encoded = encodeURI(posix).replace(/#/g, '%23').replace(/\?/g, '%3F');
  const withLeadingSlash = encoded.startsWith('/') ? encoded : `/${encoded}`;
  return `thockdown-music://local${withLeadingSlash}`;
}

/**
 * Thrown by play() when a file cannot be loaded.
 * Callers should purge the entry and pick the next song.
 */
export class MissingFileError extends Error {
  constructor(public readonly filePath: string, cause?: unknown) {
    super(`Music file not found or unreadable: ${filePath}`)
    this.name = 'MissingFileError'
    if (cause instanceof Error) this.stack = cause.stack
  }
}

/**
 * How far short of the true end a forward seek stops. Landing exactly on the
 * duration fires `ended`, which would hand the same crossing to two different
 * code paths at once.
 */
export const SEEK_TAIL_GUARD_SEC = 0.05;
export const SEEK_FADE_OUT_SEC = 0.3;
export const SEEK_FADE_IN_SEC = 0.05;

/**
 * How long after a song starts a rewind press means "the previous song"
 * rather than "the start of this one".
 *
 * The universal transport-control convention: once you are past the opening
 * moments, back means restart; in the opening moments it means go back a
 * track, because nobody presses back two seconds in wanting to hear the same
 * two seconds again.
 */
export const PREVIOUS_SONG_GRACE_SEC = 2;

/** Where in the previous song a back press from within that grace window lands. */
export const PREVIOUS_SONG_ENTRY_FRACTION = 0.8;

/**
 * Where a seek lands, and what it could not spend getting there.
 *
 * Split out of `seek()` as a pure function because the overshoot is what makes
 * a scrub cross into the neighbouring song at the right offset, and getting
 * its sign or magnitude wrong shows up as a subtly wrong entry point rather
 * than as an obvious break -- the kind of arithmetic worth pinning without a
 * media element in the way.
 */
export function resolveSeekTarget(
  currentTimeSec: number,
  durationSec: number,
  fraction: number,
): { timeSec: number; overshootSec: number } {
  const maxTimeSec = durationSec - SEEK_TAIL_GUARD_SEC;
  const requestedSec = currentTimeSec + durationSec * fraction;
  if (requestedSec > maxTimeSec) {
    return { timeSec: maxTimeSec, overshootSec: requestedSec - maxTimeSec };
  }
  if (requestedSec < 0) {
    return { timeSec: 0, overshootSec: requestedSec };
  }
  return { timeSec: requestedSec, overshootSec: 0 };
}

/** Longest a from-the-end seek waits for a duration before giving up. */
const DURATION_WAIT_TIMEOUT_MS = 2000;

/**
 * What a 20% seek BUTTON PRESS should do, as opposed to what a scrub does.
 *
 * The two gestures want different things at a boundary and this is the whole
 * of the difference:
 *
 *   A scrub is continuous motion through the timeline, so running off an end
 *   carries the leftover into the neighbour and keeps moving (see `seek`).
 *
 *   A press is a discrete command, and carrying leftovers there produces
 *   nonsense -- a forward press with 1% of the track left would drop the
 *   listener 19% into the next song, somewhere they never asked to be. So a
 *   press that cannot complete inside the track resolves to a landmark
 *   instead: the start of the next song, or the start of this one.
 *
 * The one exception is a back press in the opening seconds, which is the
 * familiar transport-control behaviour: there, "back" means the previous
 * track, entered near its end rather than at its start, because a listener
 * reaching backwards wants the music that was just playing, not four minutes
 * of lead-in to it.
 */
export type SeekPressOutcome =
  /** Stay in this song, at this time. */
  | { kind: 'within'; timeSec: number }
  /** Leave for the next song, from its beginning. */
  | { kind: 'next-song' }
  /** Restart the song currently playing. */
  | { kind: 'restart' }
  /** Leave for the previous song, entering at `entryFraction` of its length. */
  | { kind: 'previous-song'; entryFraction: number };

export function resolveSeekPress(
  currentTimeSec: number,
  durationSec: number,
  fraction: number,
): SeekPressOutcome {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { kind: 'within', timeSec: Math.max(0, currentTimeSec) };
  }

  const stepSec = durationSec * Math.abs(fraction);

  if (fraction > 0) {
    // Less than a step left to play: the press means the next song, not a
    // hop to a sliver of this one's tail.
    const remainingSec = durationSec - currentTimeSec;
    return remainingSec < stepSec
      ? { kind: 'next-song' }
      : { kind: 'within', timeSec: currentTimeSec + stepSec };
  }

  if (fraction < 0) {
    if (currentTimeSec < PREVIOUS_SONG_GRACE_SEC) {
      return { kind: 'previous-song', entryFraction: PREVIOUS_SONG_ENTRY_FRACTION };
    }
    // Past the grace window but less than a step in: back means the top of
    // this song, never a wrap into the one before it.
    return currentTimeSec < stepSec
      ? { kind: 'restart' }
      : { kind: 'within', timeSec: currentTimeSec - stepSec };
  }

  return { kind: 'within', timeSec: currentTimeSec };
}

/**
 * The music's EQ (`musicEqPreset.ts`, the visualizer's solid): one "punchy
 * rock" curve (a bass shelf, a scooped low-mid, a presence lift and an air
 * shelf), applied all the time at the preset's strength, a share of the
 * gains below. A negative strength turns the curve over: less bass and air.
 */
const AMP_EQ_BANDS: ReadonlyArray<{ type: BiquadFilterType; frequencyHz: number; q: number; gainDb: number }> = [
  { type: 'lowshelf', frequencyHz: 100, q: 0.7, gainDb: 16 },
  { type: 'peaking', frequencyHz: 500, q: 0.9, gainDb: -8 },
  { type: 'peaking', frequencyHz: 3000, q: 1, gainDb: 8 },
  { type: 'highshelf', frequencyHz: 10000, q: 0.7, gainDb: 16 },
];
const EQ_SMOOTHING_SEC = 0.05;
const VOLUME_SMOOTHING_SEC = 0.02;

type PlaybackEndHandler = () => void;

export class MusicPlayerService {
  private element: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private room: LiveRoom | null = null;
  private width: StereoWidth | null = null;
  private brilliance: LiveBrilliance | null = null;
  /** Foliage's dry half (room.ts's foliageNearCutoffHz): the whole track among the trees, not only its reverb. */
  private foliageFilter: BiquadFilterNode | null = null;
  private eqBands: BiquadFilterNode[] = [];
  private eqStrength = 0;
  private config: MusicPlayerConfig = { ...DEFAULT_MUSIC_PLAYER_CONFIG };
  private onEndedHandler: PlaybackEndHandler | null = null;
  private currentFilePath: string | null = null;
  private currentDuration = 0;
  private _isPlaying = false;
  private seekFadeGeneration = 0;
  private cancelPendingSeek: (() => void) | null = null;
  private playingListeners = new Set<(playing: boolean) => void>();
  /** The visualizer's taps on the processed music (`tapProcessed`), whose gain undoes the volume. */
  private processedTaps = new Set<GainNode>();

  get isPlaying(): boolean { return this._isPlaying; }

  private setPlaying(playing: boolean): void {
    if (this._isPlaying === playing) return;
    this._isPlaying = playing;
    for (const listener of this.playingListeners) listener(playing);
  }

  /** Calls `listener` whenever playback starts or stops; returns the unsubscribe. */
  subscribePlaying(listener: (playing: boolean) => void): () => void {
    this.playingListeners.add(listener);
    return () => { this.playingListeners.delete(listener); };
  }

  /** The URL the playing track is loaded from, for the beat pulse's look-ahead copy (`sound/musicBeat.ts`). */
  get trackUrl(): string | null { return this.currentFilePath ? toMusicUrl(this.currentFilePath) : null; }
  get filePath(): string | null { return this.currentFilePath; }
  get duration(): number { return this.currentDuration; }
  get currentTime(): number { return this.element?.currentTime ?? 0; }
  /** The playing track's length, or 0 while the browser has not reported one. */
  get currentDurationSec(): number {
    const duration = this.element?.duration;
    return Number.isFinite(duration) && (duration ?? 0) > 0 ? (duration as number) : 0;
  }

  /** Position as a fraction of the track's length, for entering a song part-way in. */
  async setCurrentTimeFraction(fraction: number): Promise<void> {
    const el = this.element;
    if (!el) return;
    const duration = await this.whenDurationKnown();
    if (!duration || el !== this.element) return;
    this.setCurrentTime(duration * Math.max(0, Math.min(1, fraction)));
  }

  /** Jump to an absolute position (seconds). Used to restore a saved playback position. */
  setCurrentTime(seconds: number): void {
    if (!this.element) return;
    const duration = this.element.duration;
    const max = Number.isFinite(duration) && duration > 0 ? duration - 0.05 : seconds;
    this.element.currentTime = Math.max(0, Math.min(max, seconds));
  }

  /** Fade around a same-track seek so the discontinuity is not audible. */
  async seekWithFade(seconds: number): Promise<void> {
    const element = this.element
    const context = this.audioCtx
    const gain = this.gainNode
    if (!element || !context || !gain) {
      this.setCurrentTime(seconds)
      return
    }

    this.cancelSeekFade()
    const generation = this.seekFadeGeneration
    const now = context.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(0, now + SEEK_FADE_OUT_SEC)

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, SEEK_FADE_OUT_SEC * 1000)
    })
    if (generation !== this.seekFadeGeneration || element !== this.element || gain !== this.gainNode) return

    const duration = element.duration
    const target = Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration - SEEK_TAIL_GUARD_SEC : seconds, seconds))
    if (element.seeking || Math.abs(element.currentTime - target) > 0.001) {
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          element.removeEventListener('seeked', finish)
          element.removeEventListener('error', fail)
          if (this.cancelPendingSeek === finish) this.cancelPendingSeek = null
          resolve()
        }
        const fail = () => {
          element.removeEventListener('seeked', finish)
          element.removeEventListener('error', fail)
          if (this.cancelPendingSeek === finish) this.cancelPendingSeek = null
          reject(new Error('Music seek failed while fading'))
        }
        this.cancelPendingSeek = finish
        element.addEventListener('seeked', finish, { once: true })
        element.addEventListener('error', fail, { once: true })
        this.setCurrentTime(seconds)
      })
    } else {
      this.setCurrentTime(seconds)
    }
    if (generation !== this.seekFadeGeneration || element !== this.element || gain !== this.gainNode) return

    const resumedAt = context.currentTime
    gain.gain.cancelScheduledValues(resumedAt)
    gain.gain.setValueAtTime(0, resumedAt)
    gain.gain.linearRampToValueAtTime(this.config.volume, resumedAt + SEEK_FADE_IN_SEC)
  }

  private cancelSeekFade(): void {
    this.seekFadeGeneration += 1
    this.cancelPendingSeek?.()
    this.cancelPendingSeek = null
  }

  // ── Audio graph ────────────────────────────────────────────────────────────

  private ensureAudioContext(): AudioContext {
    const context = outputContext();
    if (this.audioCtx !== context) {
      // A new shared context (first use, or the old one was closed): the
      // music graph belongs to a context, so it is rebuilt with it.
      this.audioCtx = context;
      this.gainNode = context.createGain();
      this.gainNode.gain.value = this.config.volume;

      this.dryGain = context.createGain();
      this.dryGain.gain.value = 1 - this.config.reverbAmount;

      this.wetGain = context.createGain();
      this.wetGain.gain.value = this.config.reverbAmount;

      this.room = new LiveRoom(context);
      this.room.setRoom(this.roomShape());
      this.width = new StereoWidth(context, this.config.stereoWidth);
      this.brilliance = new LiveBrilliance(context);
      this.brilliance.set(this.config.brilliance);
      this.foliageFilter = context.createBiquadFilter();
      this.foliageFilter.type = 'lowpass';
      this.foliageFilter.Q.value = Math.SQRT1_2;
      this.foliageFilter.frequency.value = foliageNearCutoffHz(this.config.reverbFoliage);

      // The EQ sits between the source and the volume: element → each
      // AMP_EQ_BANDS filter in turn → brilliance → foliage low-pass → gainNode.
      this.eqBands = AMP_EQ_BANDS.map((band) => {
        const filter = context.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequencyHz;
        filter.Q.value = band.q;
        filter.gain.value = band.gainDb * this.eqStrength;
        return filter;
      });
      for (let i = 1; i < this.eqBands.length; i++) this.eqBands[i - 1].connect(this.eqBands[i]);
      this.eqBands[this.eqBands.length - 1].connect(this.brilliance.input);
      this.brilliance.output.connect(this.foliageFilter);
      this.foliageFilter.connect(this.gainNode);

      // gainNode → dryGain, and gainNode → room → wetGain; both → width → limiter
      this.gainNode.connect(this.dryGain);
      this.dryGain.connect(this.width.input);
      this.gainNode.connect(this.room.input);
      this.room.output.connect(this.wetGain);
      this.wetGain.connect(this.width.input);
      connectToOutput(this.width.output);
    }
    return context;
  }

  /**
   * The music as it is HEARD, processing included (the EQ, the reverb
   * and its mix, the width), for the visualizer mode's spectrum
   * (`visualizer/spectrumTap.ts`), with the volume divided back out so the
   * reader's volume slider does not shrink what is drawn. Taken before the
   * shared limiter, which the soundscape and the key sounds pass through too.
   * Connects the tap to `target` and returns its disconnect. A tap belongs to
   * the context it was made in, like the rest of the music graph.
   */
  tapProcessed(target: AudioNode): () => void {
    const context = this.ensureAudioContext();
    const heard = this.width!.output;
    const tap = context.createGain();
    tap.gain.value = this.volumeCompensation();
    heard.connect(tap);
    tap.connect(target);
    this.processedTaps.add(tap);
    return () => {
      this.processedTaps.delete(tap);
      heard.disconnect(tap);
      tap.disconnect();
    };
  }

  /** The gain that undoes the volume: none at all at silence, where there is nothing to undo. */
  private volumeCompensation(): number {
    return this.config.volume > 1e-3 ? 1 / this.config.volume : 0;
  }

  /** The EQ's strength (`musicEqPreset.ts`): each band's gain is its `gainDb` times this, moved to over a short time constant. */
  setEqStrength(strength: number): void {
    this.eqStrength = strength;
    const context = this.audioCtx;
    if (!context) return;
    this.eqBands.forEach((filter, i) => {
      filter.gain.setTargetAtTime(AMP_EQ_BANDS[i].gainDb * strength, context.currentTime, EQ_SMOOTHING_SEC);
    });
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  setConfig(cfg: Partial<MusicPlayerConfig>): void {
    const prev = this.config;
    this.config = { ...prev, ...cfg };

    if (this.gainNode && this.audioCtx && cfg.volume !== undefined && cfg.volume !== prev.volume) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelAndHoldAtTime(now);
      this.gainNode.gain.setTargetAtTime(this.config.volume, now, VOLUME_SMOOTHING_SEC);
      for (const tap of this.processedTaps) {
        tap.gain.cancelAndHoldAtTime(now);
        tap.gain.setTargetAtTime(this.volumeCompensation(), now, VOLUME_SMOOTHING_SEC);
      }
    }
    if (this.dryGain && this.wetGain && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.dryGain.gain.cancelScheduledValues(now);
      this.dryGain.gain.setValueAtTime(1 - this.config.reverbAmount, now);
      this.wetGain.gain.cancelScheduledValues(now);
      this.wetGain.gain.setValueAtTime(this.config.reverbAmount, now);
    }
    // The room rebuilds itself only when its shape changed, once the control rests (liveRoom.ts).
    this.room?.setRoom(this.roomShape());
    if (cfg.stereoWidth !== undefined && cfg.stereoWidth !== prev.stereoWidth) this.width?.setWidth(this.config.stereoWidth);
    this.brilliance?.set(this.config.brilliance);
    if (this.foliageFilter && this.audioCtx && cfg.reverbFoliage !== undefined && cfg.reverbFoliage !== prev.reverbFoliage) {
      this.foliageFilter.frequency.setTargetAtTime(foliageNearCutoffHz(this.config.reverbFoliage), this.audioCtx.currentTime, 0.05);
    }
  }

  private roomShape(): { size: number; foliage: number } {
    return { size: this.config.reverbRoom, foliage: this.config.reverbFoliage };
  }

  /**
   * Fade in from silence + full reverb up to the current config's
   * volume/reverbAmount over durationSec, via native Web Audio gain
   * scheduling (sample-accurate, no polling). Used only when resuming
   * playback that was already in progress when the app was last closed
   * (see AudioControls' initialWasPlaying restore) -- ordinary play() calls
   * (user pressing play, auto-advance) start at full volume as before.
   * Assumes play() has already been called so the gain nodes exist.
   */
  beginFadeIn(durationSec: number): void {
    if (!this.gainNode || !this.dryGain || !this.wetGain || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    const { volume, reverbAmount } = this.config;

    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(0, now);
    this.gainNode.gain.linearRampToValueAtTime(volume, now + durationSec);

    this.dryGain.gain.cancelScheduledValues(now);
    this.dryGain.gain.setValueAtTime(0, now); // full reverb = no dry signal
    this.dryGain.gain.linearRampToValueAtTime(1 - reverbAmount, now + durationSec);

    this.wetGain.gain.cancelScheduledValues(now);
    this.wetGain.gain.setValueAtTime(1, now); // full reverb = fully wet
    this.wetGain.gain.linearRampToValueAtTime(reverbAmount, now + durationSec);
  }

  onEnded(handler: PlaybackEndHandler): void {
    this.onEndedHandler = handler;
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  async play(filePath: string): Promise<void> {
    this.cancelSeekFade()
    if (this.element && (this.currentFilePath !== filePath || this.element.ended)) {
      this.teardownSource();
    }

    const ctx = this.ensureAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    if (!this.element) {
      const el = document.createElement('audio');
      el.preload = 'none';
      // CORS mode, so the Web Audio graph below hears the song: cross-origin
      // media fetched without CORS reaches a MediaElementSource as silence
      // (see the thockdown-music scheme's registration in electron/main.ts).
      el.crossOrigin = 'anonymous';
      el.src = toMusicUrl(filePath);

      el.addEventListener('ended', () => {
        this.setPlaying(false);
        this.onEndedHandler?.();
      });
      el.addEventListener('loadedmetadata', () => {
        this.currentDuration = el.duration ?? 0;
      });

      // Wire element into the Web Audio graph.
      this.sourceNode = ctx.createMediaElementSource(el);
      this.sourceNode.connect(this.eqBands[0]);

      this.element = el;
      this.currentFilePath = filePath;
    }

    const el = this.element;

    if (el.error) {
      this.teardownSource();
      throw new MissingFileError(filePath, new Error(`media error ${el.error.code}`));
    }

    await new Promise<void>((resolve, reject) => {
      const onError = () => {
        const msg = el.error
          ? `MEDIA_ERR code ${el.error.code}: ${el.error.message}`
          : 'unknown media error';
        reject(new MissingFileError(filePath, new Error(msg)));
      };
      el.addEventListener('error', onError, { once: true });

      // Restore gain to target volume in case it was faded out by pause/stop/fadeOut.
      if (this.gainNode && this.audioCtx) {
        const g = this.gainNode.gain;
        g.cancelScheduledValues(this.audioCtx.currentTime);
        g.setValueAtTime(this.config.volume, this.audioCtx.currentTime);
      }

      el.play()
        .then(() => {
          el.removeEventListener('error', onError);
          resolve();
        })
        .catch((err: unknown) => {
          el.removeEventListener('error', onError);
          if (err instanceof DOMException && err.name === 'AbortError') {
            reject(err);
          } else {
            reject(new MissingFileError(filePath, err instanceof Error ? err : undefined));
          }
        });
    });

    this.setPlaying(true);
  }

  pause(): void {
    if (!this.element) return;
    this.cancelSeekFade()
    this.setPlaying(false);
    const el = this.element;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
      setTimeout(() => { if (el === this.element) el.pause(); }, 110);
    } else {
      el.pause();
    }
  }

  stop(): void {
    if (!this.element) return;
    this.cancelSeekFade()
    this.setPlaying(false);
    const el = this.element;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
      setTimeout(() => { if (el === this.element) { el.pause(); el.currentTime = 0; } }, 110);
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }

  /** Fade to silence over 100 ms then pause.  Resolves when the fade completes. */
  fadeOut(): Promise<void> {
    this.cancelSeekFade()
    return new Promise((resolve) => {
      if (!this.element) { resolve(); return; }
      this.setPlaying(false);
      const el = this.element;
      if (this.gainNode && this.audioCtx) {
        const now = this.audioCtx.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
        setTimeout(() => { if (el === this.element) el.pause(); resolve(); }, 110);
      } else {
        el.pause();
        resolve();
      }
    });
  }

  /** Call when continuous scrubbing begins — dims to 20 % so seeks are quiet. */
  beginScrub(): void {
    if (!this.gainNode || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.config.volume * 0.2, now);
  }

  /** Restore full volume when scrubbing ends. */
  endScrub(): void {
    if (!this.gainNode || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.config.volume, now);
  }

  /**
   * Seek forward (positive fraction) or backward (negative fraction) by a
   * percentage of the total duration.  Clamped to [0, duration−0.05] so the
   * ended event is not accidentally triggered by a forward seek at the tail.
   *
   * Returns the seconds the seek could NOT apply, signed: positive when it ran
   * past the end, negative when it ran before the start, 0 when it landed
   * inside the track. The caller uses that overshoot to continue the same
   * movement into the neighbouring song at the right offset, so holding the
   * scrub across a track boundary reads as one continuous motion rather than
   * stalling against the end of the file.  Returns 0 whenever there is nothing
   * to seek in (no element, or a duration the browser has not reported yet),
   * because a crossing computed from an unknown duration would be a guess.
   */
  seek(fraction: number): number {
    if (!this.element) return 0;
    const duration = this.element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const { timeSec, overshootSec } = resolveSeekTarget(this.element.currentTime, duration, fraction);
    this.element.currentTime = timeSec;
    return overshootSec;
  }

  /**
   * Position relative to the track's END, waiting for the browser to report a
   * duration if it has not yet.  Used when a backward scrub crosses into the
   * previous song: the offset is known ("0.4s before the end") before the
   * length that offset is measured against is, and seeking to
   * `duration - offset` the instant playback starts would silently land at 0
   * because `duration` is still NaN at that point.
   */
  async setCurrentTimeFromEnd(secondsBeforeEnd: number): Promise<void> {
    const el = this.element;
    if (!el) return;
    const duration = await this.whenDurationKnown();
    // Element swapped underneath us (another song started); the newer one owns
    // its position now, so leaving it alone is the only safe answer.
    if (!duration || el !== this.element) return;
    this.setCurrentTime(duration - SEEK_TAIL_GUARD_SEC - Math.max(0, secondsBeforeEnd));
  }

  /**
   * Resolves with the current element's duration once known, or 0 if it never
   * arrives.  Metadata is usually already there (preload is off, but playback
   * has begun by the time this is called); the listener is for the case where
   * it is not.
   */
  private whenDurationKnown(): Promise<number> {
    const el = this.element;
    if (!el) return Promise.resolve(0);
    if (Number.isFinite(el.duration) && el.duration > 0) return Promise.resolve(el.duration);
    return new Promise<number>((resolve) => {
      const settle = () => {
        el.removeEventListener('loadedmetadata', settle);
        el.removeEventListener('error', settle);
        clearTimeout(timer);
        resolve(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0);
      };
      // Bounded so a file that never reports metadata cannot leave a scrub
      // gesture waiting on a promise that never settles.
      const timer = setTimeout(settle, DURATION_WAIT_TIMEOUT_MS);
      el.addEventListener('loadedmetadata', settle, { once: true });
      el.addEventListener('error', settle, { once: true });
    });
  }

  private teardownSource(): void {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.element) {
      this.element.pause();
      this.element.src = '';
      this.element = null;
    }
    this.currentFilePath = null;
    this.currentDuration = 0;
    this.setPlaying(false);
  }
}

export const musicPlayerService = new MusicPlayerService();
