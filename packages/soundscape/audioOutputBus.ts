/**
 * The app's one audio output stage: a single AudioContext and a hard limiter
 * in front of its destination. Every audio source that should be limited
 * together with the others (the music player, the soundscape engine) joins
 * here, so music and ambience share one ceiling instead of each clipping on
 * its own.
 *
 * The context asks for a large output buffer (OUTPUT_BUFFER_SEC) instead of
 * the browser's default, which is sized for sound that must answer a
 * keypress at once. A stall of the CPU shorter than the buffer is then
 * absorbed instead of being heard as a click where the output ran dry --
 * heard worst in a smooth soundscape such as Ocean Floor, which has no noise
 * to mask a gap. Nothing routed here needs immediacy: a soundscape and a
 * music track only start, stop, fade and seek, and each of those now takes
 * effect up to one buffer later. Typing sounds, which do need it, have their
 * own context (TypingSoundManager).
 *
 * It lives apart from both of its users so that neither depends on the
 * other: the mobile build ships the soundscape engine without the music
 * player, and the desktop build is unchanged by that.
 */
/**
 * How long sound resumed from the previous session takes to rise from
 * silence, so the app does not open at full volume: the music player's
 * restored song and the soundscape both use it.
 */
export const RESTORE_FADE_IN_SEC = 10;

/**
 * Requested output buffer, in seconds. Chromium clamps a numeric latencyHint
 * to its largest Web Audio buffer (8192 frames: about 186 ms at 44.1 kHz,
 * 171 ms at 48 kHz, measured in desktop Chromium), so this asks for that
 * maximum. The 'playback' hint, used before, gave 23 ms on the same machine
 * and still clicked on a phone.
 */
const OUTPUT_BUFFER_SEC = 0.2;

let context: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;
let duck: GainNode | null = null;
let duckHolders = 0;

/**
 * How long the ducked sources take to fall silent or come back. Linear in
 * gain from wherever the ramp stood, so a release during a fall turns round
 * without a step.
 */
const DUCK_FADE_SEC = 0.1;

/** The shared context, built on first use and rebuilt if it was closed. */
export function outputContext(): AudioContext {
  if (!context || context.state === 'closed') {
    context = new AudioContext({ latencyHint: OUTPUT_BUFFER_SEC });
    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;
    limiter.connect(context.destination);
    duck = context.createGain();
    duck.connect(limiter);
    duckHolders = 0;
  }
  return context;
}

/** The shared context, resumed; what a source awaits before it starts making sound. */
export async function resumedOutputContext(): Promise<AudioContext> {
  const ctx = outputContext();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

/**
 * Route `source` into the shared limiter. `source` must belong to
 * `outputContext()`. Everything routed here (the music, the soundscape) is
 * silenced while something holds the output alone (`holdOutputAlone`); a
 * source that must stay audible meanwhile passes `alone`.
 */
export function connectToOutput(source: AudioNode, alone = false): void {
  const ctx = outputContext();
  if (source.context !== ctx || !limiter || !duck) {
    throw new Error('Audio output input must use the shared output audio context.');
  }
  source.connect(alone ? limiter : duck);
}

/**
 * Fades every source not connected `alone` to silence over DUCK_FADE_SEC and
 * returns the release, which fades them back. They keep playing underneath
 * (nothing is paused, so nothing has to start again), and holds are counted,
 * so two holders cannot release each other's. The release is idempotent.
 */
export function holdOutputAlone(): () => void {
  outputContext();
  let held = true;
  if (duckHolders++ === 0) rampDuck(0);
  return () => {
    if (!held) return;
    held = false;
    if (--duckHolders === 0) rampDuck(1);
  };
}

function rampDuck(target: number): void {
  if (!duck) return;
  const gain = duck.gain;
  const now = duck.context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(target, now + DUCK_FADE_SEC);
}
