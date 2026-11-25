import { FontControls } from '@thockdown/interaction/FontControls'
import {
  clampVisualizerBoxSize,
  clampVisualizerFontSizePx,
  DEFAULT_VISUALIZER_BOX_SIZE,
  VISUALIZER_BOX_SIZE,
  VISUALIZER_FONT_SIZE_PX,
  type VisualizerFont,
} from '../shared/visualizerFont'
import { MONO_FONTS } from './visualizerFonts'

/**
 * The visualizer's font setting, the same on the desktop (top of Options >
 * Visualizer) and the phone (the Visualizer tab's Font): the font picker,
 * then size and box size. `defaultSizePx` is what the size slider resets to,
 * which on the desktop depends on the size mode.
 */
export function VisualizerFontControls({ font, onChange, defaultSizePx }: {
  font: VisualizerFont
  onChange: (font: VisualizerFont) => void
  defaultSizePx: number
}) {
  return (
    <FontControls
      pickerLabel="Visualizer typography"
      options={MONO_FONTS}
      activeKey={font.style}
      onSelect={(style) => onChange({ ...font, style })}
      sliders={[
        {
          id: 'visualizer-font-size',
          min: VISUALIZER_FONT_SIZE_PX.min,
          max: VISUALIZER_FONT_SIZE_PX.max,
          step: VISUALIZER_FONT_SIZE_PX.step,
          value: font.sizePx,
          trackLabel: 'size',
          ariaLabel: 'Visualizer font size',
          defaultValue: defaultSizePx,
          onCommit: (value) => onChange({ ...font, sizePx: clampVisualizerFontSizePx(value) }),
        },
        {
          id: 'visualizer-box-size',
          min: VISUALIZER_BOX_SIZE.min,
          max: VISUALIZER_BOX_SIZE.max,
          step: VISUALIZER_BOX_SIZE.step,
          value: font.boxSize,
          trackLabel: 'line height',
          ariaLabel: 'Visualizer box size',
          defaultValue: DEFAULT_VISUALIZER_BOX_SIZE,
          onCommit: (value) => onChange({ ...font, boxSize: clampVisualizerBoxSize(value) }),
        },
      ]}
    />
  )
}
