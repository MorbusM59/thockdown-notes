/**
 * MusicPlayerService — thin wrapper around HTMLAudioElement + Web Audio API
 * for music playback with optional reverb post-processing.
 *
 * Design notes:
 * - Uses an HTMLAudioElement as the source (supports large files via streaming).
 * - Routes the element through a Web Audio MediaElementSourceNode → gainNode →
 *   optional convolver (reverb) → destination.
 * - Reverb is a synthetic impulse response generated from white noise; the
 *   "room" slider controls the tail length and "amount" controls wet/dry mix.
 * - The service is a singleton exported at module level.
 */

export interface MusicPlayerConfig {
  volume: number;       // 0–1
  reverbAmount: number; // 0–1  (wet/dry mix)
  reverbRoom: number;   // 0–1  (impulse response length: 0 = 0.5 s, 1 = 6 s)
}

/**
 * Thrown by `play()` when the source file cannot be loaded (missing / unreadable).
 * Callers should treat this as a signal to purge the entry and pick a new song.
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
  private audioCtx: AudioContext | null = null;
  private element: HTMLAudioElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolverNode: ConvolverNode | null = null;

  private config: MusicPlayerConfig = { volume: 0.8, reverbAmount: 0, reverbRoom: 0.3 };
  private onEndedHandler: PlaybackEndHandler | null = null;
  private currentFilePath: string | null = null;
  private currentDuration = 0;
  private _isPlaying = false;

  // ------------------------------------------------------------------ public

  get isPlaying(): boolean { return this._isPlaying; }
  get filePath(): string | null { return this.currentFilePath; }
  get duration(): number { return this.currentDuration; }

  setConfig(cfg: Partial<MusicPlayerConfig>): void {
    this.config = { ...this.config, ...cfg };
    if (this.gainNode) {
      this.gainNode.gain.value = this.config.volume;
    }
    this.updateReverb();
  }

  onEnded(handler: PlaybackEndHandler): void {
    this.onEndedHandler = handler;
  }

  async play(filePath: string): Promise<void> {
    await this.ensureContext();
    const ctx = this.audioCtx!;

    // Tear down the previous source if the file changed.
    if (this.element && this.currentFilePath !== filePath) {
      this.teardownSource();
    }

    if (!this.element) {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.src = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
      el.addEventListener('ended', () => {
        this._isPlaying = false;
        this.onEndedHandler?.();
      });
      el.addEventListener('loadedmetadata', () => {
        this.currentDuration = el.duration ?? 0;
      });

      const source = ctx.createMediaElementSource(el);
      source.connect(this.gainNode!);

      this.element = el;
      this.sourceNode = source;
      this.currentFilePath = filePath;
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Race the play() call against an element error event so that a missing or
    // unreadable file surfaces as a typed MissingFileError rather than an
    // opaque DOMException or silent stall.
    const el = this.element;
    await new Promise<void>((resolve, reject) => {
      const onError = () => {
        const msg = el.error ? `code ${el.error.code}: ${el.error.message}` : 'unknown media error';
        reject(new MissingFileError(filePath, new Error(msg)));
      };
      el.addEventListener('error', onError, { once: true });

      el.play().then(() => {
        // Remove the error listener once play succeeded — the element may still
        // fire errors later (e.g. mid-stream), but those are handled by 'ended'.
        el.removeEventListener('error', onError);
        resolve();
      }).catch((err: unknown) => {
        el.removeEventListener('error', onError);
        // AbortError happens when play() is interrupted by pause/src change —
        // that is not a missing-file situation, so re-throw as-is.
        if (err instanceof DOMException && err.name === 'AbortError') {
          reject(err);
        } else {
          reject(new MissingFileError(filePath, err));
        }
      });
    });
    this._isPlaying = true;
  }

  pause(): void {
    if (!this.element) return;
    this.element.pause();
    this._isPlaying = false;
  }

  stop(): void {
    if (!this.element) return;
    this.element.pause();
    this.element.currentTime = 0;
    this._isPlaying = false;
  }

  /** Advance playback by `fraction` of total duration (e.g. 0.2 = 20 %). */
  forward(fraction: number): void {
    if (!this.element) return;
    const duration = this.element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.element.currentTime = Math.min(
      duration,
      this.element.currentTime + duration * fraction,
    );
  }

  // ----------------------------------------------------------------- private

  private async ensureContext(): Promise<void> {
    if (this.audioCtx) return;

    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = this.config.volume;

    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();
    const convolver = ctx.createConvolver();

    gain.connect(dryGain);
    gain.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(ctx.destination);
    wetGain.connect(ctx.destination);

    this.audioCtx = ctx;
    this.gainNode = gain;
    this.dryGain = dryGain;
    this.wetGain = wetGain;
    this.convolverNode = convolver;

    this.updateReverb();
  }

  private updateReverb(): void {
    if (!this.audioCtx || !this.dryGain || !this.wetGain || !this.convolverNode) return;

    const amount = this.config.reverbAmount;
    this.dryGain.gain.value = 1 - amount * 0.5;
    this.wetGain.gain.value = amount;

    if (amount === 0) return; // No need to generate impulse if reverb is off.

    // Generate a synthetic impulse response when reverbRoom changes.
    const roomSec = 0.5 + this.config.reverbRoom * 5.5; // 0.5 – 6 s
    const sampleRate = this.audioCtx.sampleRate;
    const length = Math.ceil(sampleRate * roomSec);
    const ir = this.audioCtx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }

    this.convolverNode.buffer = ir;
  }

  private teardownSource(): void {
    if (this.element) {
      this.element.pause();
      this.element.src = '';
      this.element = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.currentFilePath = null;
    this.currentDuration = 0;
    this._isPlaying = false;
  }
}

export const musicPlayerService = new MusicPlayerService();
