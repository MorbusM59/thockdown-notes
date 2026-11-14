import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'

import {
  DEFAULT_FLASHING_SETTINGS,
  FLASH_CYCLE_MAX_MS,
  FLASH_CYCLE_MIN_MS,
  FLASH_CYCLE_STEP_MS,
  FLASH_DEFAULT_HANDLE,
  FLASH_HANDLE_STEP,
  FLASH_MATCHINGS,
  FLASH_PLANE,
  FLASH_SEGMENTS,
  FLASH_X_STEP,
  FLASH_Y_STEP,
  type FlashShape,
  type FlashingSettings,
} from '../shared/flashing'
import { CurveEditor, type CurveAxisFormat, type CurveGridLine } from './CurveEditor'

/** Twelve segments of a bar: dashed on the beats (every third), dotted between. */
const VERTICALS: readonly CurveGridLine[] = Array.from({ length: FLASH_SEGMENTS + 1 }, (_, k) => ({
  at: k / FLASH_SEGMENTS,
  kind: k % 3 === 0 ? 'dashed' : 'dotted',
}))
/** Solid at no opacity and at full. */
const HORIZONTALS: readonly CurveGridLine[] = [{ at: 0, kind: 'solid' }, { at: 1, kind: 'solid' }]

/** The cycle's x read in twelfths, the grid's segments: 0 to 12, in quarters. */
const POSITION: CurveAxisFormat = {
  display: (x) => String(Math.round(x * FLASH_SEGMENTS * 4) / 4),
  raw: (x) => String(Math.round(x * FLASH_SEGMENTS * 4) / 4),
  parse: (twelfths) => Math.round((twelfths / FLASH_SEGMENTS) / FLASH_X_STEP) * FLASH_X_STEP,
  noun: 'place in the cycle, 0 to 12',
}

const OPACITY: CurveAxisFormat = {
  display: (y) => String(Math.round(y * 100)),
  raw: (y) => String(Math.round(y * 100)),
  parse: (percent) => Math.round((percent / 100) / FLASH_Y_STEP) * FLASH_Y_STEP,
  noun: 'opacity in percent',
}

interface FlashingOptionsProps {
  flashing: FlashingSettings
  /** An edit of the curve or the cycle, written into the active preset. */
  editShape: (patch: Partial<FlashShape>) => void
  setMatching: (matching: number) => void
  /** Whether a beat can be followed at all: Grid Beat is on. */
  beatAvailable: boolean
}

/**
 * Options > Advanced > Flashing (`shared/flashing.ts`), below its presets
 * (PresetListControls' grid): the curve over one cycle, and the cycle's
 * length and its matching to the music.
 */
export function FlashingOptions({ flashing, editShape, setMatching, beatAvailable }: FlashingOptionsProps) {
  const matching = FLASH_MATCHINGS[flashing.matching]
  const matchingTooltip = !beatAvailable
    ? 'Matching to the music needs Grid Beat: switch it on (the drum) under Quick Access. Until then the cycle runs on its own'
    : "How the cycle follows the music's beat, in bar notation: 4/4 is one cycle a beat, 1/4 one a bar. Off runs the cycle on its own. Whenever no beat is found the cycle runs on its own"

  return (
    <>
      <CurveEditor
        plane={FLASH_PLANE}
        curve={flashing.curve}
        onChange={(curve) => editShape({ curve })}
        xStep={FLASH_X_STEP}
        yStep={FLASH_Y_STEP}
        handleStep={FLASH_HANDLE_STEP}
        defaultHandle={FLASH_DEFAULT_HANDLE}
        verticals={VERTICALS}
        horizontals={HORIZONTALS}
        x={POSITION}
        y={OPACITY}
        columnHeaders={['#', 'pos.', '%', 'shape']}
        pointLabel={(index) => String(index)}
        ariaLabel="Flashing curve"
        tooltip={'Flashing curve: the opacity over one cycle, drawn on a bar of twelve (dashed on the beats). The end runs on into the start, so the two are one point'}
      />
      <div className="utility-setting-slider-stack" aria-label="Flashing timing">
        <OptionsSliderRows rows={[2]}>
          <CompactScrollbarSlider
            id="flash-cycle"
            min={FLASH_CYCLE_MIN_MS}
            max={FLASH_CYCLE_MAX_MS}
            step={FLASH_CYCLE_STEP_MS}
            value={flashing.cycleMs}
            trackLabel="cycle"
            tooltipLabel="Milliseconds: how long one cycle takes when it is not following the music"
            ariaLabel="Length of one flashing cycle in milliseconds"
            defaultValue={DEFAULT_FLASHING_SETTINGS.cycleMs}
            onCommit={(value) => editShape({ cycleMs: Math.max(FLASH_CYCLE_MIN_MS, Math.min(FLASH_CYCLE_MAX_MS, Math.round(value / FLASH_CYCLE_STEP_MS) * FLASH_CYCLE_STEP_MS)) })}
          />
          <CompactScrollbarSlider
            id="flash-matching"
            min={0}
            max={FLASH_MATCHINGS.length - 1}
            step={1}
            value={flashing.matching}
            trackLabel="matching"
            tooltipLabel={matchingTooltip}
            ariaLabel={`Flashing matched to the music: ${matching.label}`}
            defaultValue={DEFAULT_FLASHING_SETTINGS.matching}
            formatValue={(value) => FLASH_MATCHINGS[Math.round(value)]?.label ?? ''}
            dimmed={!beatAvailable && matching.cyclesPerBeat > 0}
            onCommit={(value) => setMatching(Math.max(0, Math.min(FLASH_MATCHINGS.length - 1, Math.round(value))))}
          />
        </OptionsSliderRows>
      </div>
    </>
  )
}
