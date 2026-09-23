/**
 * MusicPlayerService — Web Audio API based music playback.
 *
 * Signal chain:
 *   Music sources and other app audio → shared dynamics limiter → destination
 *
 * The ConvolverNode provides a simple room-reverb effect using a synthetic
 * impulse response.  When reverbAmount is 0 the wet signal is silent and
 * the dry path through the GainNode dominates, so there is no audible change.
 */

export interface MusicPlayerConfig {
  volume: number;       // 0–1  master volume
  reverbAmount: number; // 0–1  reverb wet mix
  reverbRoom: number;   // 0–1  reverb room size (impulse length)
}

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
 * Build a synthetic reverb impulse response.  The decay is an exponential
 * noise burst whose length is controlled by roomSize (0–1 mapped to 0.1–3 s).
 */
function buildImpulseResponse(ctx: AudioContext, roomSize: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const lengthSec = 0.1 + roomSize * 2.9;   // 0.1 s … 3 s
  const length = Math.ceil(sampleRate * lengthSec);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    }
  }
  return buffer;
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

type PlaybackEndHandler = () => void;

export class MusicPlayerService {
  private element: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private mixLimiter: DynamicsCompressorNode | null = null;
  private config: MusicPlayerConfig = { volume: 0.8, reverbAmount: 0, reverbRoom: 0.3 };
  private onEndedHandler: PlaybackEndHandler | null = null;
  private currentFilePath: string | null = null;
  private currentDuration = 0;
  private _isPlaying = false;

  get isPlaying(): boolean { return this._isPlaying; }
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

  // ── Audio graph ────────────────────────────────────────────────────────────

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext();
      this.mixLimiter = this.audioCtx.createDynamicsCompressor();
      this.mixLimiter.threshold.value = -1;
      this.mixLimiter.knee.value = 0;
      this.mixLimiter.ratio.value = 20;
      this.mixLimiter.attack.value = 0.003;
      this.mixLimiter.release.value = 0.08;
      this.mixLimiter.connect(this.audioCtx.destination);
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.config.volume;

      this.dryGain = this.audioCtx.createGain();
      this.dryGain.gain.value = 1 - this.config.reverbAmount;

      this.wetGain = this.audioCtx.createGain();
      this.wetGain.gain.value = this.config.reverbAmount;

      this.convolver = this.audioCtx.createConvolver();
      this.convolver.buffer = buildImpulseResponse(this.audioCtx, this.config.reverbRoom);

      // Both music paths share the output limiter with ambient audio.
      this.gainNode.connect(this.dryGain);
      this.dryGain.connect(this.mixLimiter);

      // gainNode → convolver → wetGain → destination
      this.gainNode.connect(this.convolver);
      this.convolver.connect(this.wetGain);
      this.wetGain.connect(this.mixLimiter);
    }
    return this.audioCtx;
  }

  async getAudioContextForMix(): Promise<AudioContext> {
    const context = this.ensureAudioContext();
    if (context.state === 'suspended') await context.resume();
    return context;
  }

  connectToMix(source: AudioNode): void {
    const context = this.ensureAudioContext();
    if (source.context !== context || !this.mixLimiter) {
      throw new Error('Audio mix input must use the music player audio context.');
    }
    source.connect(this.mixLimiter);
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  setConfig(cfg: Partial<MusicPlayerConfig>): void {
    const prev = this.config;
    this.config = { ...prev, ...cfg };

    // cancelScheduledValues + setValueAtTime (not a bare `.value =`) so this
    // always wins over an in-progress beginFadeIn() ramp -- an explicit
    // config change (e.g. the user dragging the volume slider mid-fade)
    // should cut the automation off and jump straight to the new value,
    // rather than have the scheduled ramp silently keep overriding it on
    // every subsequent audio frame.
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.config.volume, now);
    }
    if (this.dryGain && this.wetGain && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.dryGain.gain.cancelScheduledValues(now);
      this.dryGain.gain.setValueAtTime(1 - this.config.reverbAmount, now);
      this.wetGain.gain.cancelScheduledValues(now);
      this.wetGain.gain.setValueAtTime(this.config.reverbAmount, now);
    }
    // Rebuild impulse response only when roomSize changes (relatively expensive).
    if (this.convolver && this.audioCtx && cfg.reverbRoom !== undefined && cfg.reverbRoom !== prev.reverbRoom) {
      this.convolver.buffer = buildImpulseResponse(this.audioCtx, this.config.reverbRoom);
    }
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
    if (this.element && (this.currentFilePath !== filePath || this.element.ended)) {
      this.teardownSource();
    }

    const ctx = this.ensureAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    if (!this.element) {
      const el = document.createElement('audio');
      el.preload = 'none';
      el.src = toMusicUrl(filePath);

      el.addEventListener('ended', () => {
        this._isPlaying = false;
        this.onEndedHandler?.();
      });
      el.addEventListener('loadedmetadata', () => {
        this.currentDuration = el.duration ?? 0;
      });

      // Wire element into the Web Audio graph.
      this.sourceNode = ctx.createMediaElementSource(el);
      this.sourceNode.connect(this.gainNode!);

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

    this._isPlaying = true;
  }

  pause(): void {
    if (!this.element) return;
    this._isPlaying = false;
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
    this._isPlaying = false;
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
    return new Promise((resolve) => {
      if (!this.element) { resolve(); return; }
      this._isPlaying = false;
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
    this._isPlaying = false;
  }
}

export const musicPlayerService = new MusicPlayerService();
