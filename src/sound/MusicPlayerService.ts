/**
 * MusicPlayerService — Web Audio API based music playback.
 *
 * Signal chain:
 *   HTMLAudioElement → MediaElementSourceNode → GainNode → ConvolverNode → destination
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
 * Convert a native filesystem path to a measly-music:// URL.
 * Electron registers this scheme as a privileged protocol that proxies
 * requests to file:// in the main process, bypassing the cross-origin block
 * that prevents http://localhost (dev mode) from loading file:// media.
 */
function toMusicUrl(filePath: string): string {
  if (filePath.startsWith('measly-music://')) return filePath;
  // Normalise backslashes, then encode special characters (spaces etc.) in
  // the path while preserving slashes and the Windows drive-letter colon.
  const posix = filePath.replace(/\\/g, '/');
  const encoded = encodeURI(posix);
  return encoded.startsWith('/') ? `measly-music://${encoded}` : `measly-music:///${encoded}`;
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

type PlaybackEndHandler = () => void;

export class MusicPlayerService {
  private element: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private config: MusicPlayerConfig = { volume: 0.8, reverbAmount: 0, reverbRoom: 0.3 };
  private onEndedHandler: PlaybackEndHandler | null = null;
  private currentFilePath: string | null = null;
  private currentDuration = 0;
  private _isPlaying = false;

  get isPlaying(): boolean { return this._isPlaying; }
  get filePath(): string | null { return this.currentFilePath; }
  get duration(): number { return this.currentDuration; }

  // ── Audio graph ────────────────────────────────────────────────────────────

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.config.volume;

      this.dryGain = this.audioCtx.createGain();
      this.dryGain.gain.value = 1 - this.config.reverbAmount;

      this.wetGain = this.audioCtx.createGain();
      this.wetGain.gain.value = this.config.reverbAmount;

      this.convolver = this.audioCtx.createConvolver();
      this.convolver.buffer = buildImpulseResponse(this.audioCtx, this.config.reverbRoom);

      // gainNode → dryGain → destination
      this.gainNode.connect(this.dryGain);
      this.dryGain.connect(this.audioCtx.destination);

      // gainNode → convolver → wetGain → destination
      this.gainNode.connect(this.convolver);
      this.convolver.connect(this.wetGain);
      this.wetGain.connect(this.audioCtx.destination);
    }
    return this.audioCtx;
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  setConfig(cfg: Partial<MusicPlayerConfig>): void {
    const prev = this.config;
    this.config = { ...prev, ...cfg };

    if (this.gainNode) {
      this.gainNode.gain.value = this.config.volume;
    }
    if (this.dryGain && this.wetGain) {
      this.dryGain.gain.value = 1 - this.config.reverbAmount;
      this.wetGain.gain.value = this.config.reverbAmount;
    }
    // Rebuild impulse response only when roomSize changes (relatively expensive).
    if (this.convolver && this.audioCtx && cfg.reverbRoom !== undefined && cfg.reverbRoom !== prev.reverbRoom) {
      this.convolver.buffer = buildImpulseResponse(this.audioCtx, this.config.reverbRoom);
    }
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
   */
  seek(fraction: number): void {
    if (!this.element) return;
    const duration = this.element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const next = this.element.currentTime + duration * fraction;
    this.element.currentTime = Math.max(0, Math.min(duration - 0.05, next));
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
