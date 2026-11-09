import { FEATURE_IDS, type FeatureId, type FeatureToggles } from '../shared/features'
import { IS_LINUX_DESKTOP } from '../shared/platform'

/**
 * The row of quick switches at the top of Options (Quick Access): the
 * features (shared/features.ts). A feature switched off stops running, and so
 * stops costing anything, and that is all: its Options subsection stays, so it
 * can be tuned while off; the tooltip
 * names the switch, since the bar carries icons only.
 */
const FEATURE_PRESENTATION: Record<FeatureId, { icon: string; label: string }> = {
  spellCheck: { icon: 'fa-solid fa-spell-check', label: 'Spell check' },
  customCursor: { icon: 'fa-solid fa-computer-mouse', label: 'Custom cursor' },
  keySounds: { icon: 'fa-solid fa-keyboard', label: 'Keystroke sounds' },
  visualizer: { icon: 'fa-solid fa-drum', label: 'Grid Beat' },
  typingTrail: { icon: 'fa-solid fa-wand-sparkles', label: 'Typing trail' },
}

/** The custom cursor does not exist on Linux (shared/platform.ts), so neither does its switch. */
const OFFERED_FEATURES = FEATURE_IDS.filter((id) => id !== 'customCursor' || !IS_LINUX_DESKTOP)

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
        const { icon, label } = FEATURE_PRESENTATION[id]
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
