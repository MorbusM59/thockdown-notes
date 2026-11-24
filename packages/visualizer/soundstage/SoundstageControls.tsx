/**
 * A SOUNDSTAGE's controls (shared/soundstages.ts): the EQ curve and the room
 * parameters, as the desktop's Options > Sound > Soundstages and the phone's
 * Soundstages tab both show them. The stage shown is the active one; an edit
 * goes back through `onEdit`, which each app routes to its player.
 */
import { OptionsSubsection } from '@thockdown/interaction/OptionsSubsection'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { clamp } from '@thockdown/interaction/clamp'
import { sanitizeStereoWidth, STEREO_WIDTH_MAX, STEREO_WIDTH_MIN, STEREO_WIDTH_NEUTRAL } from '@thockdown/audio/stereoWidth'
import { NEUTRAL_SOUNDSTAGE, type SoundstageSettings } from '../shared/soundstages'
import { EqCurveEditor } from './EqCurveEditor'

export function SoundstageControls({ stage, onEdit, folds = false }: {
  stage: SoundstageSettings
  onEdit: <K extends keyof SoundstageSettings>(field: K, value: SoundstageSettings[K]) => void
  /** Each group an accordion section rather than a divider (OptionsSubsection): the phone's tab, whose page is the section. */
  folds?: boolean
}) {
  return (
    <>
      <OptionsSubsection label="Equalization" iconClass="fa-chart-line" folds={folds}>
        <EqCurveEditor curve={stage.eq} onChange={(eq) => onEdit('eq', eq)} />
      </OptionsSubsection>
      <OptionsSubsection label="Room Parameters" iconClass="fa-cube" folds={folds}>
      <div className="utility-setting-slider-stack" aria-label="Music room parameters">
        <OptionsSliderRows rows={[2, 2]}>
          <CompactScrollbarSlider
            id="music-stereo-width"
            min={STEREO_WIDTH_MIN}
            max={STEREO_WIDTH_MAX}
            step={0.01}
            value={stage.width}
            trackLabel="width"
            ariaLabel="Music stereo width: mono at the left, as recorded at the default, wider to the right"
            defaultValue={STEREO_WIDTH_NEUTRAL}
            onCommit={(value) => onEdit('width', sanitizeStereoWidth(value))}
          />
          <CompactScrollbarSlider
            id="music-reverb"
            min={0}
            max={1}
            step={0.01}
            value={stage.reverb}
            trackLabel="reverb"
            ariaLabel="Music reverb amount"
            defaultValue={NEUTRAL_SOUNDSTAGE.reverb}
            onCommit={(value) => onEdit('reverb', clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="music-reverb-room"
            min={0}
            max={1}
            step={0.01}
            value={stage.size}
            trackLabel="size"
            ariaLabel="Music reverb size: a small room to a wide valley"
            defaultValue={NEUTRAL_SOUNDSTAGE.size}
            onCommit={(value) => onEdit('size', clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="music-reverb-foliage"
            min={0}
            max={1}
            step={0.01}
            value={stage.room}
            trackLabel="softening"
            ariaLabel="Music room softening: bare and bright to dense and dark"
            defaultValue={NEUTRAL_SOUNDSTAGE.room}
            onCommit={(value) => onEdit('room', clamp(value, 0, 1))}
          />
        </OptionsSliderRows>
      </div>
      </OptionsSubsection>
    </>
  )
}
