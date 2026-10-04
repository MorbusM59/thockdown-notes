// THE THREE HEALTH BANDS, and the only place their boundaries are written.
//
// A conditional effect used to carry its own threshold -- `belowFraction:
// 0.35` on one move, `0.4` on a species, `0.5` and `0.6` elsewhere -- which
// meant four different ideas of "hurt" in one game, none of them nameable on
// a pill and none of them comparable to each other. There are three bands
// now and content names one:
//
//   maimed    below a third
//   injured   below two thirds  (a maimed character is also injured)
//   healthy   two thirds and up
//
// NOT DISJOINT, deliberately, and this is the author's own definition. An
// effect that rewards being hurt should get MORE true as things get worse,
// not switch off at the bottom -- a Frenzy that stopped when you were nearly
// dead would quit at the only moment it was for. So `injured` includes
// `maimed`, and `healthy` is exactly its complement: a fraction is either
// injured or healthy and never both, which `health.test.ts` asserts over the
// whole range rather than trusting the two constants to stay in step.

/** Every band, in order of how badly it is going. */
export const HEALTH_BANDS = ['maimed', 'injured', 'healthy'] as const

export type HealthBand = typeof HEALTH_BANDS[number]

/** Below this fraction of full health, a character is maimed. */
export const MAIMED_BELOW = 1 / 3

/** Below this fraction, a character is injured. At or above it, healthy. */
export const INJURED_BELOW = 2 / 3

/**
 * Is a character at this fraction of their full health in this band?
 *
 * The fraction is measured against the maximum the STATS derive, before any
 * modifier has moved it -- see `resolveProfile`, where a conditional effect
 * that raised the maximum would otherwise decide its own condition.
 */
export function inHealthBand(fraction: number, band: HealthBand): boolean {
  switch (band) {
    case 'maimed': return fraction < MAIMED_BELOW
    case 'injured': return fraction < INJURED_BELOW
    case 'healthy': return fraction >= INJURED_BELOW
  }
}

/** Which band a fraction is IN, taking the worst that applies. For a readout. */
export function healthBandOf(fraction: number): HealthBand {
  if (fraction < MAIMED_BELOW) return 'maimed'
  if (fraction < INJURED_BELOW) return 'injured'
  return 'healthy'
}

/**
 * The band in words, and what its boundary actually is.
 *
 * The bare word is the concise form -- it is a term the game teaches once and
 * then uses -- and the parenthesis is the verbose one, which is the only
 * place a player can find out where the line falls.
 */
export const HEALTH_BAND_BOUNDS: Readonly<Record<HealthBand, string>> = {
  maimed: 'below a third of full Health',
  injured: 'below two thirds of full Health',
  healthy: 'at two thirds of full Health or above',
}

/**
 * "a maimed", "an injured", "a healthy" -- the article the band's own word
 * takes, so a description does not have to know which of the three it has.
 */
export function bandWithArticle(band: HealthBand): string {
  return `${/^[aeiou]/.test(band) ? 'an' : 'a'} ${band}`
}
