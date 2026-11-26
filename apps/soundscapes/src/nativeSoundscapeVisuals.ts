/**
 * What the visualizer reads of the NATIVE soundscape (the session's renderer,
 * soundscapeRenderer.ts), whose audio never passes through the page: one
 * `visuals` event stream from the plugin carrying, per batch of rendered
 * chunks, the soundscape's SPECTRUM (when the spectrum takes it,
 * nativeMusicListening.ts) and its SIGNALS (soundscape-generator.js's hits
 * and gusts, for packages/visualizer/sound/soundscapeSignals.ts), each in the
 * soundscape output's own frames, with that output's playhead as sent.
 *
 * - The CLOCK: a frame is heard `(frame - playhead) / sampleRate` after the
 *   report, the playhead being what is heard (no output latency to add).
 * - HEARD: the gain the session is heard at, which the page sets
 *   (`setSoundscapeVisualsHeardGain`): its volume for it (slider and channel
 *   switch) while the listener plays it or the schedule runs it, else 0. The
 *   page is the one place that knows both halves: the session reports only
 *   the changes the page did not make (SoundscapeSession.java echoes none of
 *   the page's own, which would race its next one), so a reader following the
 *   session's reports alone never learns of a play pressed on the page.
 *   Signals are rendered up to ten seconds ahead, so the moment it stops
 *   being heard every signal not yet reached is dropped: a paused session
 *   keeps its rendered audio, and would otherwise go on drawing hits.
 * - What is ASKED of the renderer: signals while the page is shown, the
 *   spectrum while one is started and takes the soundscape; nothing while
 *   hidden, where nothing draws.
 */
import { receiveSoundscapeSignals, setSoundscapeHeardGain, type SoundscapeSignal } from '@thockdown/visualizer/sound/soundscapeSignals'
import { appendBeatTrace, isBeatTraceOn } from '@thockdown/visualizer/sound/beatTrace'
import type { NativeSoundscapePlugin, SessionState } from './backgroundAudioHost'

/** A batch of spectrum frames as the renderer sends it (spectrumFrames.ts's SpectrumFrameBatch, levels in base64). */
export interface SpectrumBatch {
  from: number
  first: number
  hop: number
  l: string
}

interface SignalBatch {
  from: number
  list: Array<{ frame: number; kind: string; [key: string]: unknown }>
}

/** How far the playhead is run on past its last report: the renderer reports on every chunk while it plays. */
const RUN_ON_SEC = 1

/** The gain the soundscape session is heard at (0 while it is not heard), set by MobileSoundscapeApp. */
let heardGain = 0
/** Called when the session stops being heard, to drop what was rendered ahead (the installed reader's). */
let onSilenced: (() => void) | null = null

export function setSoundscapeVisualsHeardGain(gain: number): void {
  const wasHeard = heardGain > 0
  heardGain = gain
  if (wasHeard && !(gain > 0)) onSilenced?.()
}

/** Whether the soundscape session is heard: the listener's choice while it plays, or the schedule's run. */
export function sessionHeard(state: Pick<SessionState, 'regular' | 'source'>): boolean {
  return state.source === 'regular' ? state.regular === 'playing' : state.source === 'schedule'
}

export type SoundscapeVisualsSession = Pick<NativeSoundscapePlugin, 'setVisuals' | 'addListener'>

export class NativeSoundscapeVisuals {
  private playhead = 0
  private reportedAt = -Infinity
  private sampleRate = 48000
  private spectrumBands = 0
  private spectrumReceiver: ((batches: SpectrumBatch[], playhead: number) => void) | null = null
  /** What was last asked of the renderer, so only a change is sent. */
  private asked = { bands: 0, signals: false }

  constructor(private readonly session: SoundscapeVisualsSession) {
    void session.addListener('visuals', (data) => this.receive(data))
    onSilenced = () => this.dropAhead()
    document.addEventListener('visibilitychange', () => this.ask())
    this.ask()
  }

  /** The gain the soundscape is heard at: 0 while the session is not heard. */
  heardGain(): number {
    return heardGain
  }

  /** The soundscape output's frame at `nowSec` (performance clock, seconds): its last report run on, for at most `RUN_ON_SEC`. */
  frameAt(nowSec: number): number {
    const since = Math.min(RUN_ON_SEC, Math.max(0, nowSec - this.reportedAt))
    return this.playhead + since * this.sampleRate
  }

  /** Asks for the spectrum in `bands` log bands, delivered to `receiver`; 0 and null stop it. */
  requestSpectrum(bands: number, receiver: ((batches: SpectrumBatch[], playhead: number) => void) | null): void {
    this.spectrumBands = bands
    this.spectrumReceiver = receiver
    this.ask()
  }

  /** Drops every signal still ahead: what was rendered for later is no longer going to be heard. */
  private dropAhead(): void {
    const now = performance.now() / 1000
    receiveSoundscapeSignals([], now, now)
  }

  private receive(data: { visuals: string; playhead: number; sampleRate: number }): void {
    const now = performance.now() / 1000
    this.playhead = data.playhead
    this.sampleRate = data.sampleRate
    this.reportedAt = now
    const visuals = JSON.parse(data.visuals) as { spectrum: SpectrumBatch[]; signals: SignalBatch[] }
    this.spectrumReceiver?.(visuals.spectrum, data.playhead)
    this.trace(now, visuals.signals)
    if (!(heardGain > 0)) return
    const at = (frame: number) => now + (frame - data.playhead) / data.sampleRate
    for (const batch of visuals.signals) {
      const signals: SoundscapeSignal[] = []
      for (const signal of batch.list) {
        if (signal.kind === 'gust') signals.push({ at: at(signal.frame), kind: 'gust', value: signal.value as number })
        else if (signal.kind === 'drip' || signal.kind === 'drop' || signal.kind === 'chime') {
          signals.push({ at: at(signal.frame), kind: signal.kind, amplitude: signal.amplitude as number, salience: signal.salience as number })
        }
      }
      // A batch re-sent after a rewind replaces everything held from its first frame on.
      receiveSoundscapeSignals(signals, now, at(batch.from))
    }
  }

  /** What arrived since the last `soundscape visuals` trace line: events, signals in them, and the latest heard. */
  private traced = { events: 0, signals: 0, lastAt: -Infinity }

  /**
   * One beat-trace line a second while the trace is on: the `visuals` events the renderer sent, the signals in them,
   * whether the session counts as heard and at what gain. It is written whether or not the trackers run, so a log
   * shows the delivery apart from what the trackers made of it (musicBeat.ts's `soundscape recv` line).
   */
  private trace(now: number, batches: SignalBatch[]): void {
    this.traced.events++
    for (const batch of batches) this.traced.signals += batch.list.length
    if (!isBeatTraceOn() || now - this.traced.lastAt < 1) return
    this.traced.lastAt = now
    appendBeatTrace(`soundscape visuals events=${this.traced.events} signals=${this.traced.signals} heard=${heardGain > 0} gain=${this.heardGain().toFixed(2)} asked=${this.asked.signals ? 'signals' : 'none'}/${this.asked.bands}`)
    this.traced.events = this.traced.signals = 0
  }

  private ask(): void {
    const shown = !document.hidden
    const next = { bands: shown ? this.spectrumBands : 0, signals: shown }
    if (next.bands === this.asked.bands && next.signals === this.asked.signals) return
    this.asked = next
    void this.session.setVisuals(next)
  }
}

/**
 * Starts reading the native soundscape's visuals, and has the trackers
 * weigh its signals at the gain it is heard at (the music's is the
 * listening's, nativeMusicListening.ts).
 */
export function installNativeSoundscapeVisuals(session: SoundscapeVisualsSession): NativeSoundscapeVisuals {
  const visuals = new NativeSoundscapeVisuals(session)
  setSoundscapeHeardGain(() => visuals.heardGain())
  return visuals
}

