/**
 * The visualizer's frame rate on this phone, measured while it is open and
 * kept for Settings > Debugging (MusicDiagnostics.tsx): the frames the page
 * drew per second over the whole visit and in its slowest whole second, so
 * the cost of a layer can be read on the device itself.
 */

export interface FrameRateReport {
  averageFps: number
  slowestSecondFps: number
  seconds: number
}

let last: FrameRateReport | null = null

export function lastVisualizerFrameRate(): FrameRateReport | null {
  return last
}

let readers = 0

/** Declares that the Debugging readout is open, until the returned release. Only then does the visualizer count frames. */
export function readVisualizerFrameRate(): () => void {
  readers += 1
  let released = false
  return () => {
    if (released) return
    released = true
    readers -= 1
  }
}

/** Counts frames from now until the returned stop, which records the report; counts nothing while no readout is open. */
export function measureVisualizerFrameRate(): () => void {
  if (readers === 0) return () => {}
  const startMs = performance.now()
  let frames = 0
  let secondStartMs = startMs
  let secondFrames = 0
  let slowest = Infinity
  let frame = requestAnimationFrame(function tick(nowMs) {
    frames += 1
    secondFrames += 1
    if (nowMs - secondStartMs >= 1000) {
      slowest = Math.min(slowest, (secondFrames * 1000) / (nowMs - secondStartMs))
      secondStartMs = nowMs
      secondFrames = 0
    }
    frame = requestAnimationFrame(tick)
  })
  return () => {
    cancelAnimationFrame(frame)
    const seconds = (performance.now() - startMs) / 1000
    // Under two seconds says nothing about a steady rate.
    if (seconds >= 2) last = { averageFps: frames / seconds, slowestSecondFps: slowest, seconds }
  }
}
