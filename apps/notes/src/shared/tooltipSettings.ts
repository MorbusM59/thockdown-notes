import type { TooltipElementVisibility } from '@thockdown/interaction/tooltipContent'

// Options > Advanced > Tooltips: how long a hover waits before a tooltip
// shows (or that none ever does), and which of its elements are shown
// (`@thockdown/interaction/tooltipContent`). Global, not per layout.

export const TOOLTIP_DELAY_MAX_SEC = 5
export const TOOLTIP_DELAY_STEP_SEC = 0.1
/** The slider's last stop, one step past the longest delay: tooltips never show. */
export const TOOLTIP_DELAY_NEVER_SLIDER = TOOLTIP_DELAY_MAX_SEC + TOOLTIP_DELAY_STEP_SEC

export interface TooltipSettings {
  /** Seconds before a tooltip shows, or `'never'`. */
  delaySec: number | 'never'
  show: TooltipElementVisibility
}

export const DEFAULT_TOOLTIP_SETTINGS: TooltipSettings = {
  delaySec: 0.6,
  show: { intention: true, shortcut: true, gestures: true, value: true },
}

export function sanitizeTooltipSettings(input: unknown): TooltipSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof TooltipSettings, unknown>>
  const delay = raw.delaySec
  const delaySec = delay === 'never'
    ? 'never'
    : typeof delay === 'number' && Number.isFinite(delay)
      ? Math.round(Math.max(0, Math.min(TOOLTIP_DELAY_MAX_SEC, delay)) / TOOLTIP_DELAY_STEP_SEC) * TOOLTIP_DELAY_STEP_SEC
      : DEFAULT_TOOLTIP_SETTINGS.delaySec
  const show = (raw.show && typeof raw.show === 'object' ? raw.show : {}) as Partial<Record<keyof TooltipElementVisibility, unknown>>
  const flag = (key: keyof TooltipElementVisibility) => (typeof show[key] === 'boolean' ? show[key] as boolean : DEFAULT_TOOLTIP_SETTINGS.show[key])
  return {
    delaySec: Number.isFinite(delaySec as number) ? Number((delaySec as number).toFixed(1)) : delaySec,
    show: { intention: flag('intention'), shortcut: flag('shortcut'), gestures: flag('gestures'), value: flag('value') },
  }
}
