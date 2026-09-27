import { describe, expect, it } from 'vitest'

import {
  getRenderScrollDynamic,
  getRenderScrollSkew,
  getRenderScrollTotalTimeSec,
  setRenderScrollDynamic,
  setRenderScrollSkew,
  setRenderScrollTotalTimeSec,
} from './ScrollCurvePlan'
import {
  remainingWheelNotchTravelPx,
  retargetWheelNotchTravel,
  takeWheelNotchTravelStep,
  resolveWheelNotchTravelMs,
  WHEEL_NOTCH_TRAVEL_TIME_FRACTION,
  type WheelNotchTravel,
} from './wheelNotchTravel'

const NOTCH_PX = 76.8

/** Runs a leg to a moment, returning what it paid and how fast it was going. */
function playTo(travel: WheelNotchTravel, startMs: number, untilMs: number, stepMs = 4) {
  let paidPx = 0
  let lastPaidPx = 0
  let lastSpeedPxPerMs = 0
  for (let tMs = startMs + stepMs; tMs < untilMs + stepMs; tMs += stepMs) {
    const step = takeWheelNotchTravelStep(travel, Math.min(tMs, untilMs))
    paidPx += step.pixels
    lastSpeedPxPerMs = (paidPx - lastPaidPx) / stepMs
    lastPaidPx = paidPx
  }
  return { paidPx, lastSpeedPxPerMs }
}

describe('wheelNotchTravel', () => {
  it('delivers a notch over time instead of at once', () => {
    const travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const firstFrame = takeWheelNotchTravelStep(travel, 16)
    expect(firstFrame.pixels).toBeGreaterThan(0)
    expect(firstFrame.pixels).toBeLessThan(NOTCH_PX * 0.25)
    expect(firstFrame.finished).toBe(false)
  })

  it('eases from rest on the first notch', () => {
    const travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const opening = takeWheelNotchTravelStep(travel, 1).pixels
    expect(opening).toBeLessThan(0.5)
  })

  it('pays out exactly one notch, and no more', () => {
    const travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const { paidPx } = playTo(travel, 0, resolveWheelNotchTravelMs() + 40)
    expect(paidPx).toBeCloseTo(NOTCH_PX, 6)
    expect(takeWheelNotchTravelStep(travel, resolveWheelNotchTravelMs() + 40).finished).toBe(true)
  })

  it('carries the unpaid remainder into the next notch', () => {
    const first = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const { paidPx } = playTo(first, 0, 30)
    const remaining = remainingWheelNotchTravelPx(first)
    expect(paidPx + remaining).toBeCloseTo(NOTCH_PX, 4)

    const second = retargetWheelNotchTravel(first, NOTCH_PX, 30)
    expect(second.leg.kind).toBe('continuation')
    if (second.leg.kind !== 'continuation') throw new Error('expected a continuation leg')
    expect(second.leg.plan.signedDistance).toBeCloseTo(remaining + NOTCH_PX, 6)
  })

  it('splices without a velocity step when a second notch lands mid-flight', () => {
    // The defect this replaces would be a restart from rest: speed dropping
    // to zero at the exact moment the reader asked for more of it.
    const first = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const { lastSpeedPxPerMs: before } = playTo(first, 0, 40, 1)
    expect(before).toBeGreaterThan(0)

    const second = retargetWheelNotchTravel(first, NOTCH_PX, 40)
    const after = takeWheelNotchTravelStep(second, 41).pixels
    expect(Math.abs(after - before) / before).toBeLessThan(0.1)
  })

  it('keeps composing across a run of notches', () => {
    let travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    let totalPaid = 0
    for (let n = 1; n < 5; n += 1) {
      const atMs = n * 20
      totalPaid += playTo(travel, (n - 1) * 20, atMs).paidPx
      travel = retargetWheelNotchTravel(travel, NOTCH_PX, atMs)
    }
    totalPaid += playTo(travel, 80, 80 + resolveWheelNotchTravelMs() + 40).paidPx
    // Five notches asked for, five notches delivered -- nothing dropped by
    // the splicing.
    expect(totalPaid).toBeCloseTo(NOTCH_PX * 5, 4)
  })

  it('never scrolls backwards within a leg', () => {
    // A quintic asked to land a short distance while already moving fast
    // will overshoot and come back; the reader must not see that.
    const fast = retargetWheelNotchTravel(null, NOTCH_PX * 4, 0)
    playTo(fast, 0, 60, 1)
    const tiny = retargetWheelNotchTravel(fast, 1, 60)
    for (let tMs = 61; tMs <= 60 + resolveWheelNotchTravelMs(); tMs += 1) {
      expect(takeWheelNotchTravelStep(tiny, tMs).pixels).toBeGreaterThanOrEqual(0)
    }
  })

  it('turns around when the reader reverses the wheel', () => {
    const down = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    playTo(down, 0, 30)
    const up = retargetWheelNotchTravel(down, -NOTCH_PX * 2, 30)
    expect(up.sign).toBe(-1)
    const { paidPx } = playTo(up, 30, 30 + resolveWheelNotchTravelMs() + 40)
    expect(paidPx).toBeLessThan(0)
  })

  it('loses nothing when a notch lands between frames', () => {
    // Frames every 16ms; each notch arrives part-way between two of them,
    // when the curve has moved on from what the scroller was last paid.
    let travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    let totalPaid = 0
    let frameMs = 0
    for (let n = 1; n < 6; n += 1) {
      while (frameMs + 16 < n * 23) {
        frameMs += 16
        totalPaid += takeWheelNotchTravelStep(travel, frameMs).pixels
      }
      travel = retargetWheelNotchTravel(travel, NOTCH_PX, n * 23)
      frameMs = n * 23
    }
    totalPaid += playTo(travel, frameMs, frameMs + resolveWheelNotchTravelMs() + 40, 16).paidPx
    expect(totalPaid).toBeCloseTo(NOTCH_PX * 6, 4)
  })

  it('hands a coast exactly what the scroller has not yet received', () => {
    const travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const { paidPx } = playTo(travel, 0, 32, 16)
    expect(paidPx + remainingWheelNotchTravelPx(travel)).toBeCloseTo(NOTCH_PX, 6)
  })

  it('owes the same total however coarsely it is sampled', () => {
    const fine = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const coarse = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const finePaid = playTo(fine, 0, 60, 2).paidPx
    const coarsePaid = playTo(coarse, 0, 60, 30).paidPx
    expect(coarsePaid).toBeCloseTo(finePaid, 4)
  })

  describe('the animation sliders reach a single notch', () => {
    // The bug this split fixes: built on a quintic alone, one notch measured
    // byte-identical across the full range of every slider -- the reader
    // could move shape from end to end and nothing happened.

    /** Where the notch has got to at a quarter, half and three quarters. */
    const notchProgress = () => {
      const durationMs = resolveWheelNotchTravelMs()
      const at = (fraction: number) =>
        playTo(retargetWheelNotchTravel(null, NOTCH_PX, 0), 0, durationMs * fraction, 1).paidPx
      return [at(0.25), at(0.5), at(0.75)]
    }

    it('shape moves the apex from the start of the notch to the end', () => {
      const restore = getRenderScrollSkew()
      try {
        setRenderScrollSkew(0.1)
        const early = notchProgress()
        setRenderScrollSkew(0.9)
        const late = notchProgress()
        // Apex early: over half the distance is gone in the first quarter,
        // and the rest glides out. Apex late: it has barely started.
        expect(early[0]).toBeGreaterThan(NOTCH_PX * 0.4)
        expect(late[0]).toBeLessThan(NOTCH_PX * 0.1)
        expect(early[1]).toBeGreaterThan(late[1] * 3)
      } finally {
        setRenderScrollSkew(restore)
      }
    })

    it('ramp changes how sharply the notch peaks', () => {
      const restore = getRenderScrollDynamic()
      try {
        setRenderScrollDynamic(0.1)
        const gentle = notchProgress()
        setRenderScrollDynamic(5)
        const sharp = notchProgress()
        // Gentle is close to a straight line through the notch; sharp holds
        // back and then goes.
        expect(gentle[0]).toBeGreaterThan(sharp[0] * 5)
      } finally {
        setRenderScrollDynamic(restore)
      }
    })

    it('speed sets the notch duration, as a share of the journey time', () => {
      const restore = getRenderScrollTotalTimeSec()
      try {
        setRenderScrollTotalTimeSec(0.4)
        expect(resolveWheelNotchTravelMs())
          .toBeCloseTo(400 * WHEEL_NOTCH_TRAVEL_TIME_FRACTION, 6)
        // The ceiling bites before the slider's top end does.
        setRenderScrollTotalTimeSec(2)
        expect(resolveWheelNotchTravelMs())
          .toBeCloseTo(Math.min(1000, 2000 * WHEEL_NOTCH_TRAVEL_TIME_FRACTION), 6)
        // The slider's own floor is 0; a notch still takes a frame.
        setRenderScrollTotalTimeSec(0)
        expect(resolveWheelNotchTravelMs()).toBe(16)
      } finally {
        setRenderScrollTotalTimeSec(restore)
      }
    })

    it('still splices with a continuation, which no slider can shape', () => {
      // The splice has to match a velocity and an acceleration exactly, and
      // the bell cannot be started from a motion it did not plan. So a notch
      // landing mid-flight is a quintic, and only the FIRST notch of a run
      // carries the shape slider's character.
      const first = retargetWheelNotchTravel(null, NOTCH_PX, 0)
      expect(first.leg.kind).toBe('curve')
      const second = retargetWheelNotchTravel(first, NOTCH_PX, 30)
      expect(second.leg.kind).toBe('continuation')
    })
  })
})
