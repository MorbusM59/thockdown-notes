/**
 * The scales a set of chimes can be tuned to, in the order the scale slider
 * steps through them. Index 0 is the domestic standard: the major
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
 */

export interface ChimeScale {
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
  { name: 'Major pentatonic', cents: et(0, 2, 4, 7, 9), period: OCTAVE },
  { name: 'Minor pentatonic', cents: et(0, 3, 5, 7, 10), period: OCTAVE },
  { name: 'Suspended pentatonic', cents: et(0, 2, 5, 7, 10), period: OCTAVE },
  { name: 'Man gong (blues major)', cents: et(0, 2, 5, 7, 9), period: OCTAVE },
  { name: 'Ritsusen (Jue)', cents: et(0, 3, 5, 8, 10), period: OCTAVE },
  { name: 'Hirajoshi', cents: et(0, 2, 3, 7, 8), period: OCTAVE },
  { name: 'In (Miyako-bushi)', cents: et(0, 1, 5, 7, 8), period: OCTAVE },
  { name: 'Iwato', cents: et(0, 1, 5, 6, 10), period: OCTAVE },
  { name: 'Kumoi', cents: et(0, 2, 3, 7, 9), period: OCTAVE },
  { name: 'Insen', cents: et(0, 1, 5, 7, 10), period: OCTAVE },
  { name: 'Ryukyu', cents: et(0, 4, 5, 7, 11), period: OCTAVE },
  { name: 'Anchihoye (Ethiopian)', cents: et(0, 1, 5, 6, 9), period: OCTAVE },
  // Pentatonic, just and other tunings.
  { name: 'Just pentatonic', cents: ratios(1, 9 / 8, 5 / 4, 3 / 2, 5 / 3), period: OCTAVE },
  { name: 'Pythagorean pentatonic', cents: ratios(1, 9 / 8, 81 / 64, 3 / 2, 27 / 16), period: OCTAVE },
  { name: 'Septimal pentatonic', cents: ratios(1, 8 / 7, 4 / 3, 3 / 2, 7 / 4), period: OCTAVE },
  { name: 'Harmonic pentatonic', cents: ratios(1, 9 / 8, 5 / 4, 3 / 2, 7 / 4), period: OCTAVE },
  { name: 'Slendro (approx.)', cents: [0, 231, 474, 717, 955], period: OCTAVE },
  { name: 'Pelog nem (approx.)', cents: [0, 120, 270, 670, 785], period: OCTAVE },
  { name: 'Degung (approx.)', cents: [0, 110, 440, 700, 780], period: OCTAVE },
  { name: '17-EDO pentatonic', cents: edo(17, 0, 3, 6, 10, 13), period: OCTAVE },
  { name: '22-EDO pentatonic', cents: edo(22, 0, 4, 8, 13, 17), period: OCTAVE },
  { name: '11-EDO pentatonic', cents: edo(11, 0, 2, 4, 6, 9), period: OCTAVE },
  // Hexatonic.
  { name: 'Whole tone', cents: et(0, 2, 4, 6, 8, 10), period: OCTAVE },
  { name: 'Augmented', cents: et(0, 3, 4, 7, 8, 11), period: OCTAVE },
  { name: 'Blues', cents: et(0, 3, 5, 6, 7, 10), period: OCTAVE },
  { name: 'Prometheus', cents: et(0, 2, 4, 6, 9, 10), period: OCTAVE },
  { name: 'Tritone', cents: et(0, 1, 4, 6, 7, 10), period: OCTAVE },
  { name: 'Major hexatonic', cents: et(0, 2, 4, 5, 7, 9), period: OCTAVE },
  { name: 'Raga Marwa', cents: et(0, 1, 4, 6, 9, 11), period: OCTAVE },
  { name: 'Otonal hexad', cents: ratios(1, 9 / 8, 5 / 4, 11 / 8, 3 / 2, 7 / 4), period: OCTAVE },
  // Heptatonic, twelve-tone equal temperament.
  { name: 'Major (Ionian)', cents: et(0, 2, 4, 5, 7, 9, 11), period: OCTAVE },
  { name: 'Dorian', cents: et(0, 2, 3, 5, 7, 9, 10), period: OCTAVE },
  { name: 'Phrygian', cents: et(0, 1, 3, 5, 7, 8, 10), period: OCTAVE },
  { name: 'Lydian', cents: et(0, 2, 4, 6, 7, 9, 11), period: OCTAVE },
  { name: 'Mixolydian', cents: et(0, 2, 4, 5, 7, 9, 10), period: OCTAVE },
  { name: 'Aeolian (natural minor)', cents: et(0, 2, 3, 5, 7, 8, 10), period: OCTAVE },
  { name: 'Locrian', cents: et(0, 1, 3, 5, 6, 8, 10), period: OCTAVE },
  { name: 'Harmonic minor', cents: et(0, 2, 3, 5, 7, 8, 11), period: OCTAVE },
  { name: 'Melodic minor', cents: et(0, 2, 3, 5, 7, 9, 11), period: OCTAVE },
  { name: 'Phrygian dominant', cents: et(0, 1, 4, 5, 7, 8, 10), period: OCTAVE },
  { name: 'Lydian dominant', cents: et(0, 2, 4, 6, 7, 9, 10), period: OCTAVE },
  { name: 'Altered (super Locrian)', cents: et(0, 1, 3, 4, 6, 8, 10), period: OCTAVE },
  { name: 'Hungarian minor', cents: et(0, 2, 3, 6, 7, 8, 11), period: OCTAVE },
  { name: 'Double harmonic (Bhairav)', cents: et(0, 1, 4, 5, 7, 8, 11), period: OCTAVE },
  { name: 'Neapolitan major', cents: et(0, 1, 3, 5, 7, 9, 11), period: OCTAVE },
  { name: 'Neapolitan minor', cents: et(0, 1, 3, 5, 7, 8, 11), period: OCTAVE },
  { name: 'Enigmatic', cents: et(0, 1, 4, 6, 8, 10, 11), period: OCTAVE },
  { name: 'Raga Todi', cents: et(0, 1, 3, 6, 7, 8, 11), period: OCTAVE },
  { name: 'Raga Purvi', cents: et(0, 1, 4, 6, 7, 8, 11), period: OCTAVE },
  // Heptatonic, just, historical and microtonal.
  { name: 'Just major (Ptolemy)', cents: ratios(1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8), period: OCTAVE },
  { name: 'Pythagorean major', cents: ratios(1, 9 / 8, 81 / 64, 4 / 3, 3 / 2, 27 / 16, 243 / 128), period: OCTAVE },
  { name: 'Quarter-comma meantone', cents: [0, 193.16, 386.31, 503.42, 696.58, 889.74, 1082.89], period: OCTAVE },
  { name: '19-EDO major', cents: edo(19, 0, 3, 6, 8, 11, 14, 17), period: OCTAVE },
  { name: '31-EDO neutral', cents: edo(31, 0, 4, 9, 13, 18, 22, 27), period: OCTAVE },
  { name: '7-EDO (equiheptatonic)', cents: edo(7, 0, 1, 2, 3, 4, 5, 6), period: OCTAVE },
  { name: 'Maqam Rast (approx.)', cents: [0, 200, 350, 500, 700, 900, 1050], period: OCTAVE },
  { name: 'Maqam Bayati (approx.)', cents: [0, 150, 300, 500, 700, 800, 1000], period: OCTAVE },
  { name: 'Maqam Saba (approx.)', cents: [0, 150, 300, 400, 700, 800, 1000], period: OCTAVE },
  { name: 'Pelog (approx.)', cents: [0, 120, 270, 540, 670, 785, 950], period: OCTAVE },
  // Larger and unusual.
  { name: 'Octatonic (half-whole)', cents: et(0, 1, 3, 4, 6, 7, 9, 10), period: OCTAVE },
  { name: '9-EDO', cents: edo(9, 0, 1, 2, 3, 4, 5, 6, 7, 8), period: OCTAVE },
  { name: 'Harmonic series 8-16', cents: ratios(1, 9 / 8, 5 / 4, 11 / 8, 3 / 2, 13 / 8, 7 / 4, 15 / 8), period: OCTAVE },
  { name: 'Subharmonic series', cents: ratios(1, 16 / 15, 8 / 7, 16 / 13, 4 / 3, 16 / 11, 8 / 5, 16 / 9), period: OCTAVE },
  { name: 'Bohlen-Pierce (Lambda)', cents: [0, 2, 3, 4, 6, 7, 9, 10, 12].map((step) => (1901.955 * step) / 13), period: 1901.955 },
  { name: 'Quartal (stacked fourths)', cents: [0], period: 500 },
  { name: 'Harmonic series 1-8', cents: ratios(1, 2, 3, 4, 5, 6, 7, 8), period: null },
];

export const CHIME_SCALE_COUNT = CHIME_SCALES.length;

/** Cents above the lowest tube of each of `tubes` tubes on a scale. */
export function chimeScaleCents(scaleIndex: number, tubes: number): number[] {
  const scale = CHIME_SCALES[Math.max(0, Math.min(CHIME_SCALES.length - 1, Math.round(scaleIndex)))];
  const degrees = scale.cents.length;
  return Array.from({ length: tubes }, (_, index) => {
    if (scale.period === null) return scale.cents[Math.min(index, degrees - 1)];
    return scale.cents[index % degrees] + (Math.floor(index / degrees) * scale.period);
  });
}
