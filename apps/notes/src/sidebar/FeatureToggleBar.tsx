import { BAR_FEATURE_IDS, type FeatureId, type FeatureToggles } from '../shared/features'
import { IS_LINUX_DESKTOP } from '../shared/platform'

/**
 * The row of quick switches under the theme presets at the top of Options:
 * the features (shared/features.ts) and, beside Grid Beat, Caret Beat. A
 * feature switched off leaves the panel -- its subsection is not rendered --
 * and stops costing anything; the tooltip names the switch, since the bar
 * carries icons only. Caret Beat is not a feature but the layout's
 * caretFollowsMusic, which needs Grid Beat to act, so it is the panel's to
 * describe (`caretBeat`).
 */
const FEATURE_PRESENTATION: Record<Exclude<FeatureId, 'caretBlink'>, { icon: string; label: string }> = {
  spellCheck: { icon: 'fa-solid fa-spell-check', label: 'Spell check' },
  customCursor: { icon: 'fa-solid fa-computer-mouse', label: 'Custom cursor' },
  keySounds: { icon: 'fa-solid fa-keyboard', label: 'Keystroke sounds' },
  visualizer: { icon: 'fa-solid fa-drum', label: 'Grid Beat' },
  typingTrail: { icon: 'fa-solid fa-water', label: 'Typing trail' },
}

/** The custom cursor does not exist on Linux (shared/platform.ts), so neither does its switch. */
const OFFERED_FEATURES = BAR_FEATURE_IDS.filter((id) => id !== 'customCursor' || !IS_LINUX_DESKTOP)

export interface CaretBeatSwitch {
  on: boolean
  /** Grid Beat is off, so the switch cannot act: drawn faded, its tooltip saying why. */
  unavailable: boolean
  /** On but not in effect (or unavailable): drawn dimmed. */
  dimmed: boolean
  tooltip: string
  toggle: () => void
}

export function FeatureToggleBar({
  features,
  setFeatures,
  caretBeat,
}: {
  features: FeatureToggles
  setFeatures: (updater: (previous: FeatureToggles) => FeatureToggles) => void
  caretBeat: CaretBeatSwitch
}) {
  return (
    <div className="options-loadout-grid options-feature-toggle-grid" role="group" aria-label="Features">
      {OFFERED_FEATURES.flatMap((id) => {
        const { icon, label } = FEATURE_PRESENTATION[id as Exclude<FeatureId, 'caretBlink'>]
        const on = features[id]
        const tooltip = `${label}: ${on ? 'on' : 'off'}`
        const featureButton = (
          <button
            key={id}
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn${on ? ' is-active' : ''}`}
            data-tooltip={tooltip}
            aria-label={tooltip}
            aria-pressed={on}
            onClick={() => setFeatures((previous) => ({ ...previous, [id]: !previous[id] }))}
          >
            <span className={icon} aria-hidden="true" />
          </button>
        )
        if (id !== 'visualizer') return [featureButton]
        return [featureButton, (
          <button
            key="caretBeat"
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn${caretBeat.on ? ' is-active' : ''}${caretBeat.dimmed ? ' is-dimmed' : ''}`}
            data-tooltip={caretBeat.tooltip}
            aria-label="Caret Beat"
            aria-pressed={caretBeat.on}
            // aria-disabled rather than disabled, so the tooltip saying why still shows on hover.
            aria-disabled={caretBeat.unavailable}
            onClick={() => caretBeat.unavailable || caretBeat.toggle()}
          >
            <span className="fa-solid fa-heart-pulse" aria-hidden="true" />
          </button>
        )]
      })}
    </div>
  )
}
