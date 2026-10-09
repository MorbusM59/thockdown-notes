/**
 * The scales a set of chimes can be tuned to, in the order the scale slider
 * steps through them. The first is the domestic standard: the major
 * pentatonic that nearly every garden wind chime is tuned to, because no
 * two of its notes clash whichever strike together.
 *
 * A scale is its degrees in cents above the lowest tube, within one PERIOD
 * (the interval after which it repeats: an octave, 1200 cents, for almost
 * all; a tritave, 1901.96, for Bohlen-Pierce). Tubes climb the degrees in
 * order and continue into the next period, so five tubes on a pentatonic
 * scale span one octave and eight run into the next. A scale that does not
 * repeat (the harmonic series) lists every degree and has no period.
 *
 * Tunings outside twelve-tone equal temperament are given as the ratios or
 * equal divisions that define them, converted exactly; the gamelan and
 * maqam tunings, which vary from ensemble to ensemble and region to region,
 * are common published approximations and say so.
 *
 * A setting names a scale by its ID, never by its place in the list: the id
 * is given once and kept, so scales can be added anywhere, reordered or
 * retired (RETIRED) without changing what a saved soundscape plays. A new
 * scale takes the next unused id.
 */

export interface ChimeScale {
  /** Permanent: what a setting stores. */
  id: number;
  name: string;
  cents: readonly number[];
  /** Cents after which the degrees repeat; null for a scale that does not. */
  period: number | null;
}

const OCTAVE = 1200;
const cents = (ratio: number) => 1200 * Math.log2(ratio);
const ratios = (...values: number[]) => values.map(cents);
/** `steps` of an equal division of the octave into `divisions`. */
const edo = (divisions: number, ...steps: number[]) => steps.map((step) => (OCTAVE * step) / divisions);
const et = (...semitones: number[]) => semitones.map((value) => value * 100);

export const CHIME_SCALES: readonly ChimeScale[] = [
  // Pentatonic, twelve-tone equal temperament.
  { id: 0, name: 'Major pentatonic', cents: et(0, 2, 4, 7, 9), period: OCTAVE },
  { id: 5, name: 'Hirajoshi', cents: et(0, 2, 3, 7, 8), period: OCTAVE },
  { id: 8, name: 'Kumoi', cents: et(0, 2, 3, 7, 9), period: OCTAVE },
  { id: 10, name: 'Ryukyu', cents: et(0, 4, 5, 7, 11), period: OCTAVE },
  { id: 11, name: 'Anchihoye (Ethiopian)', cents: et(0, 1, 5, 6, 9), period: OCTAVE },
  // Pentatonic, just and other tunings.
  { id: 12, name: 'Just pentatonic', cents: ratios(1, 9 / 8, 5 / 4, 3 / 2, 5 / 3), period: OCTAVE },
  { id: 14, name: 'Septimal pentatonic', cents: ratios(1, 8 / 7, 4 / 3, 3 / 2, 7 / 4), period: OCTAVE },
  { id: 15, name: 'Harmonic pentatonic', cents: ratios(1, 9 / 8, 5 / 4, 3 / 2, 7 / 4), period: OCTAVE },
  { id: 16, name: 'Slendro (approx.)', cents: [0, 231, 474, 717, 955], period: OCTAVE },
  { id: 17, name: 'Pelog nem (approx.)', cents: [0, 120, 270, 670, 785], period: OCTAVE },
  { id: 18, name: 'Degung (approx.)', cents: [0, 110, 440, 700, 780], period: OCTAVE },
  { id: 19, name: '17-EDO pentatonic', cents: edo(17, 0, 3, 6, 10, 13), period: OCTAVE },
  { id: 20, name: '22-EDO pentatonic', cents: edo(22, 0, 4, 8, 13, 17), period: OCTAVE },
  { id: 21, name: '11-EDO pentatonic', cents: edo(11, 0, 2, 4, 6, 9), period: OCTAVE },
  // Hexatonic.
  { id: 23, name: 'Augmented', cents: et(0, 3, 4, 7, 8, 11), period: OCTAVE },
  { id: 24, name: 'Blues', cents: et(0, 3, 5, 6, 7, 10), period: OCTAVE },
  { id: 25, name: 'Prometheus', cents: et(0, 2, 4, 6, 9, 10), period: OCTAVE },
  { id: 26, name: 'Tritone', cents: et(0, 1, 4, 6, 7, 10), period: OCTAVE },
  { id: 27, name: 'Major hexatonic', cents: et(0, 2, 4, 5, 7, 9), period: OCTAVE },
  { id: 29, name: 'Otonal hexad', cents: ratios(1, 9 / 8, 5 / 4, 11 / 8, 3 / 2, 7 / 4), period: OCTAVE },
  // Equal steps: one interval, stacked, the scale repeating after every step.
  { id: 66, name: 'Chromatic (semitones)', cents: [0], period: 100 },
  { id: 22, name: 'Whole tone', cents: [0], period: 200 },
  { id: 67, name: 'Minor thirds (diminished)', cents: [0], period: 300 },
  { id: 68, name: 'Major thirds (augmented)', cents: [0], period: 400 },
  { id: 64, name: 'Fourths (quartal)', cents: [0], period: 500 },
  { id: 69, name: 'Tritones', cents: [0], period: 600 },
  { id: 70, name: 'Fifths (quintal)', cents: [0], period: 700 },
  // Heptatonic, twelve-tone equal temperament.
  { id: 30, name: 'Major (Ionian)', cents: et(0, 2, 4, 5, 7, 9, 11), period: OCTAVE },
  { id: 37, name: 'Harmonic minor', cents: et(0, 2, 3, 5, 7, 8, 11), period: OCTAVE },
  { id: 38, name: 'Melodic minor', cents: et(0, 2, 3, 5, 7, 9, 11), period: OCTAVE },
  { id: 43, name: 'Double harmonic (Bhairav)', cents: et(0, 1, 4, 5, 7, 8, 11), period: OCTAVE },
  { id: 44, name: 'Neapolitan major', cents: et(0, 1, 3, 5, 7, 9, 11), period: OCTAVE },
  { id: 45, name: 'Neapolitan minor', cents: et(0, 1, 3, 5, 7, 8, 11), period: OCTAVE },
  { id: 46, name: 'Enigmatic', cents: et(0, 1, 4, 6, 8, 10, 11), period: OCTAVE },
  { id: 47, name: 'Raga Todi', cents: et(0, 1, 3, 6, 7, 8, 11), period: OCTAVE },
  { id: 48, name: 'Raga Purvi', cents: et(0, 1, 4, 6, 7, 8, 11), period: OCTAVE },
  // Heptatonic, just, historical and microtonal.
  { id: 49, name: 'Just major (Ptolemy)', cents: ratios(1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8), period: OCTAVE },
  { id: 51, name: 'Quarter-comma meantone', cents: [0, 193.16, 386.31, 503.42, 696.58, 889.74, 1082.89], period: OCTAVE },
  { id: 52, name: '19-EDO major', cents: edo(19, 0, 3, 6, 8, 11, 14, 17), period: OCTAVE },
  { id: 53, name: '31-EDO neutral', cents: edo(31, 0, 4, 9, 13, 18, 22, 27), period: OCTAVE },
  { id: 54, name: '7-EDO (equiheptatonic)', cents: edo(7, 0, 1, 2, 3, 4, 5, 6), period: OCTAVE },
  { id: 55, name: 'Maqam Rast (approx.)', cents: [0, 200, 350, 500, 700, 900, 1050], period: OCTAVE },
  { id: 56, name: 'Maqam Bayati (approx.)', cents: [0, 150, 300, 500, 700, 800, 1000], period: OCTAVE },
  { id: 57, name: 'Maqam Saba (approx.)', cents: [0, 150, 300, 400, 700, 800, 1000], period: OCTAVE },
  { id: 58, name: 'Pelog (approx.)', cents: [0, 120, 270, 540, 670, 785, 950], period: OCTAVE },
  // Larger and unusual.
  { id: 59, name: 'Octatonic (half-whole)', cents: et(0, 1, 3, 4, 6, 7, 9, 10), period: OCTAVE },
  { id: 60, name: '9-EDO', cents: edo(9, 0, 1, 2, 3, 4, 5, 6, 7, 8), period: OCTAVE },
  { id: 61, name: 'Harmonic series 8-16', cents: ratios(1, 9 / 8, 5 / 4, 11 / 8, 3 / 2, 13 / 8, 7 / 4, 15 / 8), period: OCTAVE },
  { id: 62, name: 'Subharmonic series', cents: ratios(1, 16 / 15, 8 / 7, 16 / 13, 4 / 3, 16 / 11, 8 / 5, 16 / 9), period: OCTAVE },
  { id: 63, name: 'Bohlen-Pierce (Lambda)', cents: [0, 2, 3, 4, 6, 7, 9, 10, 12].map((step) => (1901.955 * step) / 13), period: 1901.955 },
  { id: 65, name: 'Harmonic series 1-8', cents: ratios(1, 2, 3, 4, 5, 6, 7, 8), period: null },
];

/**
 * Scales that were offered once and are no longer, by id, each as a degree
 * of a scale that is: [that scale's id, the degree its lowest tube starts on].
 * Most were MODES of a scale still offered -- the same notes from another
 * starting point (Dorian is Major from its second degree). A chime strikes
 * its tubes at random, so no note is heard as home and a mode is not a
 * different sound; read this way, a soundscape saved on one keeps exactly
 * its tubes. The two Pythagorean scales differ from their just neighbours
 * by a few cents and play those instead.
 */
const RETIRED: Readonly<Record<number, readonly [number, number]>> = {
  1: [0, 4], 2: [0, 1], 3: [0, 3], 4: [0, 2],
  6: [5, 3], 7: [5, 1], 9: [8, 1],
  13: [12, 0],
  28: [24, 3],
  31: [30, 1], 32: [30, 2], 33: [30, 3], 34: [30, 4], 35: [30, 5], 36: [30, 6],
  39: [37, 4], 40: [38, 3], 41: [38, 6], 42: [43, 3],
  50: [49, 0],
};

const BY_ID = new Map(CHIME_SCALES.map((scale) => [scale.id, scale]));

/** The highest id ever given to a scale: the setting's upper bound. */
export const CHIME_SCALE_MAX_ID = Math.max(...CHIME_SCALES.map((scale) => scale.id), ...Object.keys(RETIRED).map(Number));

/** The scale a setting names and the degree its lowest tube starts on; an unknown id is the domestic standard. */
function resolve(id: number): { scale: ChimeScale; degree: number } {
  const offered = BY_ID.get(Math.round(id));
  if (offered) return { scale: offered, degree: 0 };
  const retired = RETIRED[Math.round(id)];
  if (retired) return { scale: BY_ID.get(retired[0])!, degree: retired[1] };
  return { scale: CHIME_SCALES[0], degree: 0 };
}

/** The scale a setting plays: what the slider shows for it. */
export function chimeScaleOf(id: number): ChimeScale {
  return resolve(id).scale;
}

/** Cents above the lowest tube of each of `tubes` tubes on the scale with this id. */
export function chimeScaleCents(id: number, tubes: number): number[] {
  const { scale, degree } = resolve(id);
  const degrees = scale.cents.length;
  const at = (index: number) => {
    if (scale.period === null) return scale.cents[Math.min(index, degrees - 1)];
    return scale.cents[index % degrees] + (Math.floor(index / degrees) * scale.period);
  };
  return Array.from({ length: tubes }, (_, index) => at(index + degree) - at(degree));
}
