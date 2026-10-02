/**
 * The app's one audio output stage: a single AudioContext and a hard limiter
 * in front of its destination. Every audio source that should be limited
 * together with the others (the music player, the soundscape engine) joins
 * here, so music and ambience share one ceiling instead of each clipping on
 * its own.
 *
 * The context is created with latencyHint 'playback': the browser then uses
 * a larger output buffer than its default ('interactive', sized for sound
 * that must answer a keypress at once), so a short stall of the CPU is
 * absorbed by the buffer instead of being heard as a crackle when the
 * output runs dry. Nothing routed here needs that immediacy: a soundscape
 * and a music track only start, stop and fade. Typing sounds, which do,
 * have their own context (TypingSoundManager).
 *
 * It lives apart from both of its users so that neither depends on the
 * other: the mobile build ships the soundscape engine without the music
 * player, and the desktop build is unchanged by that.
 */
let context: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;

/** The shared context, built on first use and rebuilt if it was closed. */
export function outputContext(): AudioContext {
  if (!context || context.state === 'closed') {
    context = new AudioContext({ latencyHint: 'playback' });
    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;
    limiter.connect(context.destination);
  }
  return context;
}

/** The shared context, resumed; what a source awaits before it starts making sound. */
export async function resumedOutputContext(): Promise<AudioContext> {
  const ctx = outputContext();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

/** Route `source` into the shared limiter. `source` must belong to `outputContext()`. */
export function connectToOutput(source: AudioNode): void {
  const ctx = outputContext();
  if (source.context !== ctx || !limiter) {
    throw new Error('Audio output input must use the shared output audio context.');
  }
  source.connect(limiter);
}
