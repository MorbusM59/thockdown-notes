/**
 * A volume slider's position (0..1) as a gain: every halving of the position
 * is 10 dB quieter, which is roughly what a listener hears as half as loud.
 * So the centre is -10 dB, a quarter -20 dB, an eighth -30 dB, and 0 is true
 * silence with no floor or jump (gain = position ^ log2(10^0.5), about ^1.66).
 *
 * Every LISTENER volume slider goes through this one function: the music, the
 * ambient (soundscape master) and the keystroke volume, on desktop and Android.
 * Stored values stay slider positions; only the gain they mean is derived here.
 */
export const VOLUME_DB_PER_HALVING = 10;
const VOLUME_EXPONENT = VOLUME_DB_PER_HALVING / (20 * Math.log10(2));

export function volumeGain(position: number): number {
  if (!(position > 0)) return 0;
  return position >= 1 ? 1 : position ** VOLUME_EXPONENT;
}

/** A slider position in decibels (-Infinity at 0). */
export function volumeDb(position: number): number {
  return position > 0 ? 20 * Math.log10(volumeGain(position)) : -Infinity;
}

/** The slider position that is `db` decibels from unity (the inverse of volumeDb). */
export function volumePositionForDb(db: number): number {
  return Math.min(1, 2 ** (db / VOLUME_DB_PER_HALVING));
}
