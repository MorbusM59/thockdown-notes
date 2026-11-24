/**
 * The visualizer mode's own settings below its presets and font: the
 * scene's edge and pane, the glaze, the wave, the pulse and the spectrum.
 * Shared by the desktop's Options > Glitz > Visualizer and the phone's
 * Visualizer tab, each passing its settings and the light/dark mode whose
 * pane is shown.
 */
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { OptionsSubsection } from '@thockdown/interaction/OptionsSubsection'
import {
  CREST_FALL_REDUCTION_MAX,
  CYCLE_BEATS,
  cycleBeatsIndex,
  DEFAULT_VISUALIZER,
  IMMERSIVE_FLAIR_STRENGTH_MAX,
  IMMERSIVE_GLARE_STRENGTH_MAX,
  IMMERSIVE_SWAY_RANGE_MAX,
  POLE_ORBIT_MAX,
  PULSE_SEC_MAX,
  PULSE_SEC_MIN,
  PULSE_SPEED_MAX,
  PULSE_SPEED_MIN,
  SPECTRUM_DELAY_MAX_SEC,
  SPECTRUM_GRAVITY_MAX,
  SPECTRUM_GRAVITY_MIN,
  SPECTRUM_STRIP_ROWS_MAX,
  SWAY_DRIFT_MAX,
  SWAY_PUSH_MAX,
  WAVE_BEATS_MAX,
  WAVE_BEATS_MIN,
  WAVE_BOXES_MAX,
  WAVE_BOXES_MIN,
  WAVE_TURN_MAX,
  waveTertiaryBeats,
  type VisualizerSettings,
} from '@thockdown/look/visualizer'
import { beatChannelControls, fallSliders, mixSliders } from './visualizerSliders'

const visualizerDefaults = DEFAULT_VISUALIZER

export function VisualizerSceneControls({ visualizer, setVisualizer, uiMode, folds = false }: {
  visualizer: VisualizerSettings
  setVisualizer: (update: (prev: VisualizerSettings) => VisualizerSettings) => void
  uiMode: 'light' | 'dark'
  /** Each group an accordion section rather than a divider (OptionsSubsection): the phone's tab, whose page is the section. */
  folds?: boolean
}) {
  return (
    <>
          {beatChannelControls('visualizer-edge', 'Edge', 'the edge round the visualizer mode\'s scene shows', visualizer.edge, visualizerDefaults.edge, (patch) => setVisualizer((prev) => ({ ...prev, edge: { ...prev.edge, ...patch } })), { iconClass: 'fa-expand', folds })}
          {beatChannelControls('visualizer-pane', 'Pane', 'the scene\'s box outlines show in the visualizer mode', visualizer.pane[uiMode], visualizerDefaults.pane[uiMode], (patch) => setVisualizer((prev) => ({ ...prev, pane: { ...prev.pane, [uiMode]: { ...prev.pane[uiMode], ...patch } } })), { iconClass: 'fa-table-cells', folds })}
          <OptionsSubsection label="Glaze" iconClass="fa-sun" folds={folds}>
          <div className="utility-setting-slider-stack" aria-label="Immersive glaze settings">
            <OptionsSliderRows rows={[3, 2, 2, 2, 2, 2, 2]}>
              {mixSliders('visualizer-glaze', 'Immersive glaze push', visualizer.immersive.glazeMix, visualizerDefaults.immersive.glazeMix, (glazeMix) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, glazeMix } })))}
              <CompactScrollbarSlider
                id="visualizer-flair-strength"
                min={0}
                max={IMMERSIVE_FLAIR_STRENGTH_MAX}
                step={0.01}
                value={visualizer.immersive.flairStrength}
                trackLabel="flair"
                tooltipLabel="Flair strength (% of the layout)"
                ariaLabel="Immersive: flair strength, percent of the layout's"
                defaultValue={visualizerDefaults.immersive.flairStrength}
                formatValue={(value) => String(Math.round(value * 100))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, flairStrength: value } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-flair-sources"
                min={0}
                max={4}
                step={1}
                value={visualizer.immersive.flairMinSources}
                trackLabel="sources"
                tooltipLabel="Fewest flair sources"
                ariaLabel="Immersive: fewest flair sources drawn"
                defaultValue={visualizerDefaults.immersive.flairMinSources}
                formatValue={(value) => String(Math.round(value))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, flairMinSources: Math.round(value) } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-glare-strength"
                min={0}
                max={IMMERSIVE_GLARE_STRENGTH_MAX}
                step={0.01}
                value={visualizer.immersive.glareStrength}
                trackLabel="glare"
                tooltipLabel="Glare strength (% of the layout)"
                ariaLabel="Immersive: glare strength, percent of the layout's"
                defaultValue={visualizerDefaults.immersive.glareStrength}
                formatValue={(value) => String(Math.round(value * 100))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, glareStrength: value } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-glare-stacks"
                min={0}
                max={5}
                step={1}
                value={visualizer.immersive.glareMinStacks}
                trackLabel="stacks"
                tooltipLabel="Fewest glare stacks"
                ariaLabel="Immersive: fewest glare stacks drawn"
                defaultValue={visualizerDefaults.immersive.glareMinStacks}
                formatValue={(value) => String(Math.round(value))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, glareMinStacks: Math.round(value) } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-sway-spread"
                min={0}
                max={1}
                step={0.01}
                value={visualizer.immersive.swaySpread}
                trackLabel="depth"
                tooltipLabel="How much less each glaze layer sways than the one in front of it: at the left every layer sways as far as the nearest, at the right each sways half as far as the one in front"
                ariaLabel="Immersive: how much less each glaze layer sways than the one in front of it"
                defaultValue={visualizerDefaults.immersive.swaySpread}
                formatValue={(value) => value.toFixed(2)}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, swaySpread: value } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-sway-drift"
                min={-SWAY_DRIFT_MAX}
                max={SWAY_DRIFT_MAX}
                step={5}
                value={visualizer.immersive.swayDrift}
                trackLabel="drift"
                tooltipLabel="Drift (arc minutes per beat)"
                ariaLabel="Immersive: steady drift of the glaze stripes, arc minutes per beat, negative drifts the other way"
                defaultValue={visualizerDefaults.immersive.swayDrift}
                formatValue={(value) => String(Math.round(value))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, swayDrift: Math.round(value / 5) * 5 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-sway-range"
                min={0}
                max={IMMERSIVE_SWAY_RANGE_MAX}
                step={5}
                value={visualizer.immersive.swayRange}
                trackLabel="sway"
                tooltipLabel="Sway range (arc minutes)"
                ariaLabel="Immersive: how far the nearest glaze layer sways, in arc minutes"
                defaultValue={visualizerDefaults.immersive.swayRange}
                formatValue={(value) => Math.round(value).toString()}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, swayRange: Math.round(value / 5) * 5 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-sway-cycle"
                min={0}
                max={CYCLE_BEATS.length - 1}
                step={1}
                value={cycleBeatsIndex(visualizer.immersive.swayCycle)}
                trackLabel="cycle"
                tooltipLabel="Beats per sway cycle"
                ariaLabel="Immersive: beats per cycle of the glaze's sway"
                defaultValue={cycleBeatsIndex(visualizerDefaults.immersive.swayCycle)}
                formatValue={(value) => String(CYCLE_BEATS[Math.round(value)])}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, swayCycle: CYCLE_BEATS[Math.round(value)] } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-sway-push"
                min={-SWAY_PUSH_MAX}
                max={SWAY_PUSH_MAX}
                step={5}
                value={visualizer.immersive.swayPush}
                trackLabel="push"
                tooltipLabel="Push per hit (arc minutes)"
                ariaLabel="Immersive: how far each hit of the glaze mix pushes the glaze stripes, arc minutes"
                defaultValue={visualizerDefaults.immersive.swayPush}
                formatValue={(value) => String(Math.round(value))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, swayPush: Math.round(value / 5) * 5 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-sway-return"
                min={0}
                max={1}
                step={0.01}
                value={visualizer.immersive.swayReturn}
                trackLabel="return"
                tooltipLabel="Push return (%)"
                ariaLabel="Immersive: share of each push the glaze slides back, percent"
                defaultValue={visualizerDefaults.immersive.swayReturn}
                formatValue={(value) => String(Math.round(value * 100))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, swayReturn: value } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-pole-orbit"
                min={0}
                max={POLE_ORBIT_MAX}
                step={0.001}
                value={visualizer.immersive.poleOrbit}
                trackLabel="orbit"
                tooltipLabel="Vanishing point orbit (%)"
                ariaLabel="Immersive: radius of the glare's vanishing point orbit, percent of its distance"
                defaultValue={visualizerDefaults.immersive.poleOrbit}
                formatValue={(value) => (value * 100).toFixed(1)}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, poleOrbit: value } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-pole-orbit-rate"
                min={0}
                max={CYCLE_BEATS.length - 1}
                step={1}
                value={cycleBeatsIndex(visualizer.immersive.poleOrbitCycle)}
                trackLabel="cycle"
                tooltipLabel="Beats per orbit cycle"
                ariaLabel="Immersive: beats per turn of the glare's vanishing point orbit"
                defaultValue={cycleBeatsIndex(visualizerDefaults.immersive.poleOrbitCycle)}
                formatValue={(value) => String(CYCLE_BEATS[Math.round(value)])}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, poleOrbitCycle: CYCLE_BEATS[Math.round(value)] } }))}
              />
            </OptionsSliderRows>
          </div>
          </OptionsSubsection>
          <OptionsSubsection label="Wave" iconClass="fa-water" folds={folds}>
          <div className="utility-setting-slider-stack" aria-label="Immersive wave settings">
            <OptionsSliderRows rows={[3, 3, 2]}>
              {mixSliders('visualizer-wave', 'Immersive wave', visualizer.immersive.waveMix, visualizerDefaults.immersive.waveMix, (waveMix) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, waveMix } })))}
              <CompactScrollbarSlider
                id="visualizer-wave-boxes"
                min={WAVE_BOXES_MIN}
                max={WAVE_BOXES_MAX}
                step={1}
                value={visualizer.immersive.waveBoxes}
                trackLabel="wave"
                tooltipLabel="Wave length (boxes)"
                ariaLabel="Immersive: grid wave length in boxes"
                defaultValue={visualizerDefaults.immersive.waveBoxes}
                formatValue={(value) => Math.round(value).toString()}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, waveBoxes: Math.round(value) } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-wave-beats"
                min={WAVE_BEATS_MIN}
                max={WAVE_BEATS_MAX}
                step={1}
                value={visualizer.immersive.waveBeats}
                trackLabel="travel"
                tooltipLabel="Beats per wave"
                ariaLabel="Immersive: beats the grid wave takes to travel one wave length"
                defaultValue={visualizerDefaults.immersive.waveBeats}
                formatValue={(value) => Math.round(value).toString()}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, waveBeats: Math.round(value) } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-wave-turn"
                min={-WAVE_TURN_MAX}
                max={WAVE_TURN_MAX}
                step={1}
                value={visualizer.immersive.waveTurn}
                trackLabel="cycle"
                tooltipLabel="Beats per cycle"
                ariaLabel="Immersive: beats per turn of the grid wave's fastest pivot, negative counter-clockwise, 0 still"
                defaultValue={visualizerDefaults.immersive.waveTurn}
                formatValue={(value) => String(waveTertiaryBeats(Math.round(value)) ?? 0)}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, waveTurn: Math.round(value) } }))}
              />
              {fallSliders('visualizer-wave', 'Immersive wave', { shape: visualizer.immersive.waveShape, fallSec: visualizer.immersive.waveFallSec }, { shape: visualizerDefaults.immersive.waveShape, fallSec: visualizerDefaults.immersive.waveFallSec }, 'the wave after each hit', (patch) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, ...(patch.shape !== undefined ? { waveShape: patch.shape } : {}), ...(patch.fallSec !== undefined ? { waveFallSec: patch.fallSec } : {}) } })))}
            </OptionsSliderRows>
          </div>
          </OptionsSubsection>
          <OptionsSubsection label="Pulse" iconClass="fa-bullseye" folds={folds}>
          <div className="utility-setting-slider-stack" aria-label="Immersive pulse settings">
            <OptionsSliderRows rows={[3, 3, 3]}>
              {mixSliders('visualizer-pulse', 'Immersive pulse', visualizer.immersive.pulseMix, visualizerDefaults.immersive.pulseMix, (pulseMix) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, pulseMix } })))}
              <CompactScrollbarSlider
                id="visualizer-pulse-speed"
                min={PULSE_SPEED_MIN}
                max={PULSE_SPEED_MAX}
                step={1}
                value={visualizer.immersive.pulseSpeed}
                trackLabel="pulse"
                tooltipLabel="Pulse speed (boxes/s)"
                ariaLabel="Immersive: center pulse starting speed, boxes per second"
                defaultValue={visualizerDefaults.immersive.pulseSpeed}
                formatValue={(value) => String(Math.round(value))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, pulseSpeed: Math.round(value) } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-pulse-half-life"
                min={PULSE_SEC_MIN}
                max={PULSE_SEC_MAX}
                step={0.1}
                value={visualizer.immersive.pulseHalfLifeSec}
                trackLabel="slow"
                tooltipLabel="How quickly the center pulse slows, in milliseconds: its speed halves every this long. A short half-life can stop the ring before it leaves the screen"
                ariaLabel="Immersive: center pulse speed half-life, milliseconds"
                defaultValue={visualizerDefaults.immersive.pulseHalfLifeSec}
                formatValue={(value) => String(Math.round(value * 1000))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, pulseHalfLifeSec: Math.round(value * 10) / 10 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-pulse-boost"
                min={0}
                max={1}
                step={0.01}
                value={visualizer.immersive.pulseBoost}
                trackLabel="boost"
                tooltipLabel="Pulse boost (%)"
                ariaLabel="Immersive: center pulse signal boost, percent"
                defaultValue={visualizerDefaults.immersive.pulseBoost}
                formatValue={(value) => String(Math.round(value * 100))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, pulseBoost: value } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-pulse-fade"
                min={PULSE_SEC_MIN}
                max={PULSE_SEC_MAX}
                step={0.1}
                value={visualizer.immersive.pulseFadeSec}
                trackLabel="fade"
                tooltipLabel="Pulse fade (ms)"
                ariaLabel="Immersive: center pulse fade duration, milliseconds"
                defaultValue={visualizerDefaults.immersive.pulseFadeSec}
                formatValue={(value) => String(Math.round(value * 1000))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, pulseFadeSec: Math.round(value * 10) / 10 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-pulse-softness"
                min={0}
                max={1}
                step={0.01}
                value={visualizer.immersive.pulseSoftness}
                trackLabel="soft"
                tooltipLabel="Ring softness (%)"
                ariaLabel="Immersive: center pulse edge softness, percent"
                defaultValue={visualizerDefaults.immersive.pulseSoftness}
                formatValue={(value) => String(Math.round(value * 100))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, pulseSoftness: value } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-cutout-round"
                min={0}
                max={1}
                step={0.01}
                value={visualizer.immersive.cutoutRound}
                trackLabel="round"
                tooltipLabel="Corner roundness (%)"
                ariaLabel="Immersive: center panel corner roundness, percent"
                defaultValue={visualizerDefaults.immersive.cutoutRound}
                formatValue={(value) => String(Math.round(value * 100))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, cutoutRound: value } }))}
              />
            </OptionsSliderRows>
          </div>
          </OptionsSubsection>
          <OptionsSubsection label="Spectrum" iconClass="fa-chart-simple" folds={folds}>
          <div className="utility-setting-slider-stack" aria-label="Spectrum fall settings">
            <OptionsSliderRows rows={[2, 2, 1]}>
              <CompactScrollbarSlider
                id="visualizer-spectrum-delay"
                min={0}
                max={SPECTRUM_DELAY_MAX_SEC}
                step={0.01}
                value={visualizer.immersive.spectrumDelaySec}
                trackLabel="base delay"
                tooltipLabel="Bar hang time (ms)"
                ariaLabel="Spectrum: how long a bar hangs before it falls, milliseconds"
                defaultValue={visualizerDefaults.immersive.spectrumDelaySec}
                formatValue={(value) => String(Math.round(value * 1000))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, spectrumDelaySec: Math.round(value * 100) / 100 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-spectrum-gravity"
                min={SPECTRUM_GRAVITY_MIN}
                max={SPECTRUM_GRAVITY_MAX}
                step={10}
                value={visualizer.immersive.spectrumGravity}
                trackLabel="base fall"
                tooltipLabel="Bar fall speed (dB/s²)"
                ariaLabel="Spectrum: how fast a bar falls, decibels per second squared"
                defaultValue={visualizerDefaults.immersive.spectrumGravity}
                formatValue={(value) => String(Math.round(value))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, spectrumGravity: Math.round(value / 10) * 10 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-crest-delay"
                min={0}
                max={SPECTRUM_DELAY_MAX_SEC}
                step={0.01}
                value={visualizer.immersive.crestDelaySec}
                trackLabel="crest delay"
                tooltipLabel="Extra crest hang time (ms)"
                ariaLabel="Spectrum: how much longer a crest hangs than its bar, milliseconds"
                defaultValue={visualizerDefaults.immersive.crestDelaySec}
                formatValue={(value) => String(Math.round(value * 1000))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, crestDelaySec: Math.round(value * 100) / 100 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-crest-fall"
                min={0}
                max={CREST_FALL_REDUCTION_MAX}
                step={0.01}
                value={visualizer.immersive.crestFallReduction}
                trackLabel="crest fall"
                tooltipLabel="Slower crest fall (%)"
                ariaLabel="Spectrum: how much slower a crest falls than its bar, percent"
                defaultValue={visualizerDefaults.immersive.crestFallReduction}
                formatValue={(value) => String(Math.round(value * 100))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, crestFallReduction: Math.round(value * 100) / 100 } }))}
              />
              <CompactScrollbarSlider
                id="visualizer-spectrum-rows"
                min={0}
                max={SPECTRUM_STRIP_ROWS_MAX}
                step={1}
                value={visualizer.immersive.spectrumStripRows}
                trackLabel="rows"
                tooltipLabel="Spectrum height (rows)"
                ariaLabel="Spectrum: rows of the bottom strip, 0 for the volume bar alone"
                defaultValue={visualizerDefaults.immersive.spectrumStripRows}
                formatValue={(value) => String(Math.round(value))}
                onCommit={(value) => setVisualizer((prev) => ({ ...prev, immersive: { ...prev.immersive, spectrumStripRows: Math.round(value) } }))}
              />
            </OptionsSliderRows>
          </div>
          </OptionsSubsection>
    </>
  )
}
