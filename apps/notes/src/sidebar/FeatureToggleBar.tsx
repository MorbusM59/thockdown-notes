import { BAR_FEATURE_IDS, type FeatureId, type FeatureToggles } from '../shared/features'
import { IS_LINUX_DESKTOP } from '../shared/platform'

/**
 * The row of feature switches under the theme presets at the top of Options
 * (shared/features.ts). A feature switched off leaves the panel -- its
 * section or subsection is not rendered -- and stops costing anything; the
 * tooltip names the feature, since the bar carries icons only.
 */
const FEATURE_PRESENTATION: Record<Exclude<FeatureId, 'caretBlink'>, { icon: string; label: string }> = {
  spellCheck: { icon: 'fa-solid fa-spell-check', label: 'Spell check' },
  customCursor: { icon: 'fa-solid fa-computer-mouse', label: 'Custom cursor' },
  keySounds: { icon: 'fa-solid fa-keyboard', label: 'Keystroke sounds' },
  visualizer: { icon: 'fa-solid fa-drum', label: 'Visualizer' },
  glaze: { icon: 'fa-solid fa-wand-magic-sparkles', label: 'Glaze' },
  flow: { icon: 'fa-solid fa-water', label: 'Typing flow' },
}

/** The custom cursor does not exist on Linux (shared/platform.ts), so neither does its switch. */
const OFFERED_FEATURES = BAR_FEATURE_IDS.filter((id) => id !== 'customCursor' || !IS_LINUX_DESKTOP)

export function FeatureToggleBar({
  features,
  setFeatures,
}: {
  features: FeatureToggles
  setFeatures: (updater: (previous: FeatureToggles) => FeatureToggles) => void
}) {
  return (
    <div className="options-loadout-grid options-feature-toggle-grid" role="group" aria-label="Features">
      {OFFERED_FEATURES.map((id) => {
        const { icon, label } = FEATURE_PRESENTATION[id as Exclude<FeatureId, 'caretBlink'>]
        const on = features[id]
        const tooltip = `${label}: ${on ? 'on' : 'off'}`
        return (
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
      })}
    </div>
  )
}
