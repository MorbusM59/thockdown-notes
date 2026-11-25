/**
 * The Dashboard's Debugging section: what the native music's output is doing (MusicSession
 * and OutputLane's `diagnostics`), read twice a second while the section is
 * open, so a fault in the output can be read on a phone without adb; and
 * the visualizer's frame rate on its last visit (visualizerFrameRate.ts);
 * and the BEAT TRACE (@thockdown/visualizer/sound/beatTrace.ts), the
 * desktop's console trace of what the visualizer's analysis reads, switched
 * on here and its latest lines shown, since a phone has no console.
 */
import { useEffect, useState } from 'react'
import { useAccordionSectionOpen } from '@thockdown/interaction/accordionSectionOpen'
import { nativeMusic } from './nativeMusic'
import { lastVisualizerFrameRate, readVisualizerFrameRate } from './visualizerFrameRate'

const BEAT_TRACE_FLAG = 'thockdown:debug-beat'
/** The trace lines shown: the newest, enough to cover a few seconds. */
const TRACE_LINES = 40

function beatTraceOn(): boolean {
  try { return localStorage.getItem(BEAT_TRACE_FLAG) === '1' } catch { return false }
}

function beatTraceTail(): string {
  const lines = (window as unknown as { __beatTrace?: string[] }).__beatTrace ?? []
  return lines.slice(-TRACE_LINES).join('\n')
}

const READ_MS = 500

export function MusicDiagnostics() {
  const open = useAccordionSectionOpen()
  const [text, setText] = useState('')
  const [tracing, setTracing] = useState(beatTraceOn)
  const [trace, setTrace] = useState('')
  useEffect(() => (open ? readVisualizerFrameRate() : undefined), [open])
  useEffect(() => {
    if (!open) return undefined
    const readTrace = () => setTrace(beatTraceTail())
    readTrace()
    const timer = window.setInterval(readTrace, READ_MS)
    return () => window.clearInterval(timer)
  }, [open])
  useEffect(() => {
    if (!open || !nativeMusic) return undefined
    const plugin = nativeMusic
    const read = () => { void plugin.getDiagnostics().then((result) => setText(result.text)) }
    read()
    const timer = window.setInterval(read, READ_MS)
    return () => window.clearInterval(timer)
  }, [open])
  const rate = lastVisualizerFrameRate()
  return (<>
    <p className="mobile-tab-placeholder">{nativeMusic ? text : 'Only in the app.'}</p>
    <p className="mobile-tab-placeholder">{rate
      ? `Visualizer, last visit: ${rate.averageFps.toFixed(1)} fps on average, ${rate.slowestSecondFps.toFixed(0)} in its slowest second, over ${Math.round(rate.seconds)} s`
      : 'Visualizer: not opened yet'}</p>
    <div className="options-loadout-grid" role="group" aria-label="Beat trace">
      <button
        type="button"
        className={`btn-icon options-color-swatch options-loadout-btn${tracing ? ' is-active' : ''}`}
        aria-pressed={tracing}
        aria-label="Beat trace: record what the visualizer's analysis reads"
        onClick={() => {
          const next = !tracing
          try {
            if (next) localStorage.setItem(BEAT_TRACE_FLAG, '1')
            else localStorage.removeItem(BEAT_TRACE_FLAG)
          } catch { /* storage unavailable: the trace stays as it was */ }
          setTracing(next)
        }}
      >
        <span className="fa-solid fa-wave-square" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn-icon options-color-swatch options-loadout-btn"
        aria-label="Copy the beat trace"
        onClick={() => { void navigator.clipboard?.writeText(((window as unknown as { __beatTrace?: string[] }).__beatTrace ?? []).join('\n')) }}
      >
        <span className="fa-solid fa-copy" aria-hidden="true" />
      </button>
    </div>
    {trace ? <pre className="mobile-beat-trace">{trace}</pre> : null}
  </>)
}
