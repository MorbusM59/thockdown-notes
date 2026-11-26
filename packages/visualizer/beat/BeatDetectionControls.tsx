import { Fragment } from 'react'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { OptionsSubsectionLabel } from '@thockdown/interaction/OptionsSubsectionLabel'
import {
  BEAT_CONTRAST_MAX,
  BEAT_RESPONSE_MAX_DB,
  BEAT_RESPONSE_MIN_DB,
  DEFAULT_VISUALIZER,
  DEFAULT_VISUALIZER_TRACKERS,
  type VisualizerSettings,
  type VisualizerTrackerName,
} from '@thockdown/look/visualizer'
import {
  BEAT_DELAY_MAX_MS,
  BEAT_DELAY_MIN_MS,
  type BeatSettings,
} from '../shared/beatSettings'

const TRACKERS: ReadonlyArray<[VisualizerTrackerName, string, string]> = [
  ['thump', 'Thump', 'The low end jumping: a kick, a bass stab, what you feel in the chest'],
  ['pierce', 'Pierce', 'A sharp sound cutting through the mix: a snare, a clap, a rim shot'],
  ['tick', 'Tick', 'The busy, rhythmic top: hats and shakers'],
]

/**
 * Beat detection's settings, shared by the desktop (Options > Beat
 * Detection) and the phone (the Visualizer tab's Delay and Signal sections):
 * the DELAY, the pulse's offset for this output device, set against the
 * calibration loop above it; and the SIGNAL, the level that still gives a
 * full response and the three TRACKERS' tuning. The desktop draws both in one
 * section, the signal under its divider; the phone gives each a section.
 */
export function BeatDetectionControls({ beatSettings, outputDevice, onBeatSettings, visualizer, setVisualizer }: {
  beatSettings: BeatSettings
  /** The output device the delay is kept for ('' when the platform has one). */
  outputDevice: string
  onBeatSettings: (update: (prev: BeatSettings) => BeatSettings) => void
  visualizer: VisualizerSettings
  setVisualizer: (update: (prev: VisualizerSettings) => VisualizerSettings) => void
}) {
  return (
    <>
      <BeatDelayControl beatSettings={beatSettings} outputDevice={outputDevice} onBeatSettings={onBeatSettings} />
      <OptionsSubsectionLabel>Signal</OptionsSubsectionLabel>
      <BeatSignalControls visualizer={visualizer} setVisualizer={setVisualizer} />
    </>
  )
}

/** The delay for `outputDevice`, kept per device and global rather than in a preset. */
export function BeatDelayControl({ beatSettings, outputDevice, onBeatSettings }: {
  beatSettings: BeatSettings
  /** The output device the delay is kept for ('' when the platform has one). */
  outputDevice: string
  onBeatSettings: (update: (prev: BeatSettings) => BeatSettings) => void
}) {
  return (
    <div className="utility-setting-slider-stack" aria-label="Beat delay">
      <OptionsSliderRows rows={[1]}>
        <CompactScrollbarSlider
          id="beat-delay"
          min={BEAT_DELAY_MIN_MS}
          max={BEAT_DELAY_MAX_MS}
          step={10}
          value={beatSettings.delayMsByDevice[outputDevice] ?? 0}
          trackLabel="delay"
          tooltipLabel={`Additional ms to draw the pulse later than its built-in timing offset, for ${outputDevice || 'this output device'}: kept per device and picked up again when you switch back. Raise it if the pulse leads the music, as a wireless headset often makes it`}
          ariaLabel="Beat pulse: additional visual delay in milliseconds for this output device"
          defaultValue={0}
          formatValue={(value) => Math.round(value).toString()}
          onCommit={(value) => onBeatSettings((prev) => ({ ...prev, delayMsByDevice: { ...prev.delayMsByDevice, [outputDevice]: Math.round(value) } }))}
        />
      </OptionsSliderRows>
    </div>
  )
}

/** The signal: the full-response level, then the three trackers' tuning, each under its own divider. */
export function BeatSignalControls({ visualizer, setVisualizer }: {
  visualizer: VisualizerSettings
  setVisualizer: (update: (prev: VisualizerSettings) => VisualizerSettings) => void
}) {
  const { trackers } = visualizer
  const setTracker = (key: VisualizerTrackerName, field: 'contrast' | 'pattern', value: number) => setVisualizer((prev) => ({ ...prev, trackers: { ...prev.trackers, [key]: { ...prev.trackers[key], [field]: value } } }))
  return (
    <>
      <div className="utility-setting-slider-stack" aria-label="Beat response">
        <OptionsSliderRows rows={[1]}>
          <CompactScrollbarSlider
            id="beat-response"
            min={BEAT_RESPONSE_MIN_DB}
            max={BEAT_RESPONSE_MAX_DB}
            step={1}
            value={visualizer.responseDb}
            trackLabel="response"
            tooltipLabel="dB below full scale the music's peak may be and still pulse at full strength. A track mixed quieter than this, or a quiet passage between loud ones, pulses less in proportion: 6 dB further down is half"
            ariaLabel="Beat pulse: dB below full scale that still gives a full response"
            defaultValue={DEFAULT_VISUALIZER.responseDb}
            formatValue={(value) => Math.round(value).toString()}
            onCommit={(value) => setVisualizer((prev) => ({ ...prev, responseDb: Math.round(value) }))}
          />
        </OptionsSliderRows>
      </div>
      {TRACKERS.map(([key, label, what]) => (
        <Fragment key={key}>
          <div className="utility-setting-button-row" role="group" aria-label={`${label} controls`}>
            <OptionsSubsectionLabel tooltip={what}>{label}</OptionsSubsectionLabel>
          </div>
          <div className="utility-setting-slider-stack" aria-label={`${label} settings`}>
            <OptionsSliderRows rows={[2]}>
              {[
                <CompactScrollbarSlider
                  key="contrast"
                  id={`beat-tracker-${key}-contrast`}
                  min={0}
                  max={BEAT_CONTRAST_MAX}
                  step={0.01}
                  value={trackers[key].contrast}
                  trackLabel="contrast"
                  tooltipLabel="Hit threshold"
                  ariaLabel={`${label}: contrast`}
                  defaultValue={DEFAULT_VISUALIZER_TRACKERS[key].contrast}
                  onCommit={(value) => setTracker(key, 'contrast', value)}
                />,
                <CompactScrollbarSlider
                  key="pattern"
                  id={`beat-tracker-${key}-pattern`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={trackers[key].pattern}
                  trackLabel="pattern"
                  tooltipLabel="How far hits follow the bar's pattern rather than only what is heard: at 0 the signal alone, higher lifts a weak hit toward the same place in the bars around it and fills in expected hits that barely sound"
                  ariaLabel={`${label}: pattern`}
                  defaultValue={DEFAULT_VISUALIZER_TRACKERS[key].pattern}
                  formatValue={(value) => Math.round(value * 100).toString()}
                  onCommit={(value) => setTracker(key, 'pattern', value)}
                />,
              ]}
            </OptionsSliderRows>
          </div>
        </Fragment>
      ))}
    </>
  )
}
