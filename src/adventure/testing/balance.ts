// COMBAT BALANCE TESTING IS SUSPENDED, and this is the one switch.
//
// The author is tuning content by hand -- builds, tiers, weights, the six
// tactics, what each move is worth -- and a single-stat build at a high tier
// now reaches stat spreads no earlier content could produce (twenty-odd
// points in one stat against another build's nothing). A test that asserts
// how hard something hits, how long a fight lasts or how often a run ends
// will fail on every such edit, and a suite that fails for the expected
// reason teaches its reader to stop reading it.
//
// SO: flip `BALANCE_TESTING_SUSPENDED` to false to bring them all back. One
// constant, one place, and nothing to hunt for -- which is the whole reason
// this exists rather than a scattering of `describe.skip`.
//
// ----------------------------------------------------------------------
// WHAT MAY BE SUSPENDED, AND WHAT MAY NOT. This is the load-bearing line,
// because "suspended" will otherwise grow to cover whatever is inconvenient.
//
// A BALANCE test asserts a VALUE that tuning is allowed to change:
//   "a Ghoul deals 20 damage", "Easy kills two runs in three", "this fight
//   lasts six rounds", "a Haymaker beats an ordinary attack". Tuning changes
//   the answer, and the test is then WRONG rather than the content -- so it
//   waits until tuning settles.
//
// A CORRECTNESS test asserts a PROPERTY that holds whatever the content
// says:
//   "a chance is strictly inside 0..1 at every delta", "Combo pays per strike
//   already taken", "a round survives the disk", "two sources of Counter
//   add", "the thumb moves both sides in one direction only", "a description
//   never says '% of a blow'". Content cannot make these false. If one of
//   them starts failing after a content edit, THE CODE OR THE CONTENT IS
//   WRONG -- that is the test doing its job, and suspending it would be
//   throwing away the only thing still watching.
//
// The test is not "did this fail after I changed content". It is: COULD A
// LEGITIMATE TUNING CHANGE MAKE THIS ASSERTION FALSE WITHOUT ANYTHING BEING
// BROKEN? Only then is it balance.
//
// **NEVER LOOSEN A CORRECTNESS TEST TO FIT NEW CONTENT.** Widening a bound
// until the numbers fit is how a property test becomes a test of nothing,
// and it leaves no mark that it happened. Suspending is visible and
// reversible; loosening is neither.
//
// THE SIM IS THE REAL BALANCE INSTRUMENT (`npm run adventure:sim`), and it is
// not a gate while this is on -- nor is it reported as evidence that a change
// is balanced. It is also currently saturated (94-98% death at every
// difficulty regardless of what is changed, entries 109 and 111 of
// docs/adventure-platform.md), so it could not answer a balance question
// today even if one were being asked.

import { describe } from 'vitest'

/** Flip to `false` to run the balance suites again. */
export const BALANCE_TESTING_SUSPENDED = true

/**
 * `describe` for a suite that asserts a TUNED VALUE rather than a property.
 *
 * Reads as an ordinary `describe` at the call site and says what kind of
 * suite it is by being used at all, so a reader scanning a test file can see
 * which assertions are content's and which are the code's.
 */
export const describeBalance: typeof describe | typeof describe.skip =
  BALANCE_TESTING_SUSPENDED ? describe.skip : describe
