/**
 * The position the LISTENER is at, for drawing: the element's position run on
 * the FRAME's clock (the `requestAnimationFrame` timestamp, the moment the
 * frame is shown), and steered toward each report rather than set to it.
 * The element reports its position in steps (a chunk of the graph's pulls at
 * a time), and taking each report as it comes jumps the time back and forth
 * by up to a chunk several times a second; a fall read off a time that jumps
 * is drawn in steps. The audio context's clock stood here as the time between
 * reports and steps the same way: it advances once per audio callback (ten
 * milliseconds and more, far more over Bluetooth), so frames between two
 * callbacks read one time, and a fall drawn off it repeated a value and then
 * jumped. The frame's clock advances by exactly one frame per frame. A report
 * further off than `SNAP_SEC` is a seek and is taken at once; anything nearer
 * closes a share of the gap per report, and the time never runs backwards.
 * Reset while the music is stopped, as the frame's clock runs on through a
 * pause.
 */
export class SmoothClock {
  private static readonly SNAP_SEC = 0.5
  private static readonly STEER = 0.1
  private offset = NaN
  private reported = NaN
  private last = -Infinity

  reset(): void {
    this.offset = NaN
    this.reported = NaN
    this.last = -Infinity
  }

  read(reported: number, now: number): number {
    if (reported !== this.reported) {
      this.reported = reported
      const gap = reported - now - this.offset
      if (!Number.isFinite(this.offset) || Math.abs(gap) > SmoothClock.SNAP_SEC) {
        this.offset = reported - now
        this.last = -Infinity
      } else {
        this.offset += gap * SmoothClock.STEER
      }
    }
    this.last = Math.max(this.last, now + this.offset)
    return this.last
  }

  /**
   * The position at `now` from the offset the reports so far settled on,
   * without taking a report or moving the clock: for a moment between two
   * frames, such as a press's own timestamp. NaN before the first report.
   */
  at(now: number): number {
    return now + this.offset
  }
}

