/**
 * PROTOTYPE: a profiling run of the visualizer on the device, written as a
 * plain-text report to paste back. It measures the frame times with
 * everything drawn, then with each layer hidden in turn (display: none, so
 * neither painted nor composited), so the cost of each layer is the
 * difference from the first row. Long animation frames, where the WebView
 * reports them, name the script that ran long.
 */

/** The layers hidden one at a time, by the selector that removes each one. */
const LAYERS: readonly (readonly [string, string])[] = [
  ['solid', '.empty-state-solid'],
  ['cutout orb', '.visualizer-cutout-orb'],
  ['spectrum', '.visualizer-spectrum'],
  ['chroma', '.visualizer-chroma'],
  ['grid wave', '.visualizer-grid-wave'],
  ['pulse', '.visualizer-grid-wave-pulse-canvas'],
  ['grid', '.visualizer-grid'],
  ['strips', '.visualizer-strip'],
  ['letters', '.visualizer-letter, .visualizer-letter-box, .visualizer-lit'],
  ['song list', '.visualizer-song-list'],
  ['whole scene', '.visualizer-scene'],
]

const SETTLE_MS = 600
const MEASURE_MS = 3000

type LongFrame = { duration: number; blocking: number; scripts: string[] }

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Frame intervals over `ms`, and the long animation frames that ended in that time. */
function measure(ms: number): Promise<{ frames: number[]; long: LongFrame[] }> {
  return new Promise((resolve) => {
    const frames: number[] = []
    const long: LongFrame[] = []
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { blockingDuration?: number; scripts?: { invoker?: string; sourceFunctionName?: string; duration: number }[] })[]) {
          long.push({
            duration: entry.duration,
            blocking: entry.blockingDuration ?? 0,
            scripts: (entry.scripts ?? []).map((script) => `${script.invoker ?? ''} ${script.sourceFunctionName ?? ''} ${script.duration.toFixed(0)}ms`.trim()),
          })
        }
      })
      observer.observe({ type: 'long-animation-frame', buffered: false })
    } catch {
      observer = null
    }
    const start = performance.now()
    let last = start
    const tick = (now: number) => {
      frames.push(now - last)
      last = now
      if (now - start < ms) requestAnimationFrame(tick)
      else {
        observer?.disconnect()
        resolve({ frames: frames.slice(1), long })
      }
    }
    requestAnimationFrame(tick)
  })
}

function summary(frames: number[]): string {
  if (frames.length === 0) return 'no frames'
  const sorted = [...frames].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  const fps = (frames.length * 1000) / frames.reduce((a, b) => a + b, 0)
  const late = frames.filter((t) => t > 20).length
  return `fps ${fps.toFixed(1)} | median ${at(0.5).toFixed(1)} | p95 ${at(0.95).toFixed(1)} | max ${sorted[sorted.length - 1].toFixed(1)} ms | over 20ms ${late}/${frames.length}`
}

function deviceLines(scale: number): string[] {
  const lines = [
    `agent: ${navigator.userAgent}`,
    `screen: ${screen.width}x${screen.height} css, dpr ${window.devicePixelRatio}, viewport ${innerWidth}x${innerHeight}, x${scale}`,
    `cores: ${navigator.hardwareConcurrency ?? '?'}, memory: ${(navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? '?'} GB`,
  ]
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && info) lines.push(`gpu: ${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}`)
  } catch {
    // no WebGL: the line is left out
  }
  lines.push(`canvases: ${[...document.querySelectorAll('canvas')].map((c) => `${c.className || 'canvas'} ${c.width}x${c.height}`).join(', ')}`)
  lines.push(`elements in scene: ${document.querySelector('.visualizer-scene')?.querySelectorAll('*').length ?? 0}`)
  return lines
}

/** Runs every scenario in turn, reporting progress, and returns the report. */
export async function runVisualizerProfile(scale: number, onProgress: (step: string) => void): Promise<string> {
  const lines = ['THOCKDOWN VISUALIZER PROFILE', new Date().toISOString(), ...deviceLines(scale), '']
  const run = async (name: string, selector: string | null) => {
    onProgress(name)
    const hidden = selector ? [...document.querySelectorAll<HTMLElement>(selector)] : []
    const before = hidden.map((element) => element.style.display)
    for (const element of hidden) element.style.display = 'none'
    await wait(SETTLE_MS)
    const { frames, long } = await measure(MEASURE_MS)
    hidden.forEach((element, i) => { element.style.display = before[i] })
    lines.push(`${selector ? `without ${name}` : name} (${hidden.length} hidden): ${summary(frames)}`)
    if (long.length > 0) {
      const worst = [...long].sort((a, b) => b.duration - a.duration).slice(0, 3)
      lines.push(`  long frames ${long.length}; worst: ${worst.map((f) => `${f.duration.toFixed(0)}ms [${f.scripts.join('; ') || 'no script'}]`).join(' / ')}`)
    }
  }
  await run('everything', null)
  for (const [name, selector] of LAYERS) await run(name, selector)
  await run('everything again', null)
  return lines.join('\n')
}
