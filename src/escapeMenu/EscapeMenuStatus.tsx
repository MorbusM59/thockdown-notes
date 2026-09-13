import { usePillStripScroll } from '../shared/usePillStripScroll'
import type { EscapeMenuChromePill,
  EscapeMenuChromeToggle, EscapeMenuModeChrome } from './escapeMenuContract'

/**
 * A mode's two output channels, and WHICH BAR each one lands on.
 *
 * The split is a design rule, not a layout convenience (see the adventure's
 * design document): the tab bar above the editor carries STATE -- what you
 * are and what you have -- and the chapter bar below it carries NARRATION --
 * what just happened, and the frame for what is being asked. A reader's eye
 * goes up for "how am I doing" and down for "what is going on", the same way
 * it does for a note's tabs and its chapters.
 *
 * Both are built out of the elements the bar they land on already uses,
 * rather than a look of their own, so each sits at exactly that bar's height
 * and inset with no parallel geometry to keep in sync (pillbars.css's whole
 * reason for existing) -- and so a mode reads as something this app is
 * showing you rather than a guest with its own furniture.
 *
 * Nothing on the two BARS is interactive: every gesture a mode has belongs in
 * the ring. The toggle below is the one exception, and it is a button the
 * host already had in that position rather than furniture a mode brought
 * with it.
 */

/** Tooltip text for a pill or a gauge: its label, then a line per detail. */
function tooltipOf(label: string, detail?: string[]): string {
  return detail && detail.length > 0 ? [label, ...detail].join('\n') : label
}

/**
 * State, on the TAB BAR, in the strip a note's tabs would occupy.
 *
 * Each readout is an ICON and a number. The words were on the pills first
 * (`HP 60/95  MGT 3  AGI 2 ...`) and a full status line of them filled the
 * bar with abbreviations -- a code to learn rather than a line to read, and
 * one that pushed the last readouts out of the strip. The name lives in the
 * tooltip, where it costs nothing and is unabbreviated.
 */
export function EscapeMenuReadouts({ status }: { status: EscapeMenuModeChrome }) {
  if (status.readouts.length === 0) return null
  return (
    <div
      className="escape-menu-readouts"
      role="status"
      aria-live="polite"
      aria-label={`${status.title} state`}
    >
      {status.readouts.map((readout) => (
        <div
          key={readout.key}
          className="tag-pill escape-menu-readout"
          data-tooltip={tooltipOf(readout.label, [readout.value])}
          aria-label={`${readout.label}: ${readout.value}`}
        >
          <span className={readout.icon} aria-hidden="true" />
          <span className="escape-menu-readout-value">{readout.value}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Narration, on the CHAPTER BAR, which is otherwise empty while a mode owns
 * the slot (there is no note, so there are no chapters and no tags).
 *
 * It is the chapter bar's own strip, element for element: the well, the
 * fade-masked scroll shell, the display row and the pill. That is not a
 * resemblance -- it is the same chain, with the same shared scrolling
 * (shared/usePillStripScroll.ts), so a headline longer than the bar scrolls
 * under the same fades a note's chapters do instead of overrunning the bar
 * or being clipped at its edge. The pills also set the bar's height, which
 * is why narration is a pill and not prose: rendered as text this bar came
 * out shorter than the same bar showing a note, and the editor moved when a
 * mode took the slot.
 *
 * `is-inert` is the one difference: a chapter pill is something you press,
 * and every gesture a mode has is in the ring. Same box, no affordance.
 */
export function EscapeMenuNarration({ status }: { status: EscapeMenuModeChrome }) {
  // Called before the early return: the strip is one pill today and a list
  // tomorrow, and a hook that only runs on some renders is not a hook.
  const strip = usePillStripScroll(status.headline)
  if (!status.headline) return null
  return (
    <div className="chapter-bar-row">
      <div className="chapter-tab-mode-shell">
        <div className={`chapter-bar-scroll-shell${strip.fadeClassName}`}>
          <div
            className="chapter-bar-display"
            role="status"
            aria-live="polite"
            aria-label={`${status.title} narration`}
            ref={strip.ref}
            onScroll={strip.onScroll}
            onWheel={strip.onWheel}
          >
            <span className="tag-pill escape-menu-narration is-inert">{status.headline}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * One of the chrome's two button positions -- the slot's toggle, or the
 * action beside the counter.
 *
 * A control with no `onActivate` is RESERVED: the button's exact shape and
 * style, carrying `fa-ban`. That icon is the app-wide convention for "this
 * position is spoken for and does not work yet" -- an empty frame reads as a
 * rendering fault, and a plausible icon reads as a control that is broken.
 * `fa-ban` reads as neither.
 *
 * Omitting the position instead would close the gap it holds and shift the
 * panels beside it, which is how the word-count panel acquired a leading
 * space it never had.
 */
export const RESERVED_POSITION_ICON = 'fa-solid fa-ban'

export function EscapeMenuChromeButton({ control }: { control: EscapeMenuChromeToggle }) {
  if (!control.onActivate) {
    return (
      <span className="ui-btn btn-icon chapter-toggle-button is-reserved" aria-hidden="true" data-tooltip={control.label}>
        <span className={RESERVED_POSITION_ICON} aria-hidden="true" />
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`chapter-toggle-button btn-icon${control.isActive ? ' is-active' : ''}`}
      aria-label={control.label}
      aria-pressed={control.isActive}
      data-tooltip={control.label}
      onClick={control.onActivate}
    >
      {control.icon ? <span className={control.icon} aria-hidden="true" /> : null}
    </button>
  )
}

/**
 * The pills a mode is accumulating, across the width the snapshot timeline
 * occupies for a note. Two groups reading inward from each end, because the
 * two things a run accumulates are different in kind and a single run of
 * pills would make them look like one list.
 *
 * The detail lives in the TOOLTIP rather than on the pill. A pill is an icon
 * and a name; what an item actually does is computed live from the same
 * declaration the resolver applies (model/modifiers.ts), so it is prose of
 * unpredictable length and would burst the strip.
 */
export function EscapeMenuChromeStrip({ status }: { status: EscapeMenuModeChrome }) {
  const strip = status.strip
  if (!strip || (strip.leading.length === 0 && strip.trailing.length === 0)) return null

  const group = (pills: EscapeMenuChromePill[], className: string) => (
    <div className={className}>
      {pills.map((pill) => (
        // The line-number toggle's own box, not a tag pill: these sit in the
        // timeline's lane, which is a mirror of the scrollbar and has no room
        // for a pill's height. Reusing the button geometry keeps the lane at
        // the height every margin around it was set against, and keeps one
        // visual language in the chrome instead of two.
        <span
          key={pill.key}
          className="ui-btn btn-icon chapter-toggle-button escape-menu-chrome-pill"
          data-tooltip={tooltipOf(pill.label, pill.detail)}
          aria-label={pill.label}
          role="listitem"
        >
          <span className={pill.icon} aria-hidden="true" />
        </span>
      ))}
    </div>
  )

  return (
    <div className="escape-menu-chrome-strip" role="list" aria-label={`${status.title} holdings`}>
      {group(strip.leading, 'escape-menu-chrome-strip-group is-leading')}
      {group(strip.trailing, 'escape-menu-chrome-strip-group is-trailing')}
    </div>
  )
}

/**
 * The scrollbar rail, divided one track per gauge.
 *
 * Each track carries its icon at the foot INSIDE it, and fills upward from
 * the bottom, so the icon reads as the thing being measured and the bar as
 * how far along it is. The fill passes behind the icon rather than stopping
 * short of it: the icon is what the track is for, so it stays legible at
 * every value instead of the track owing it a reserved strip it only needs
 * when full. Styled as a scroll thumb rather than as a progress bar of its
 * own -- it is standing in the scrollbar's place, and a second visual
 * language in that column would read as a second control.
 *
 * A gauge with NO ratio draws its track and its icon and no fill: the
 * quantity is named and its curve is not written yet. See the contract.
 */
export function EscapeMenuChromeGauges({ status }: { status: EscapeMenuModeChrome }) {
  const gauges = status.gauges
  if (!gauges || gauges.length === 0) return null
  return (
    <div className="escape-menu-chrome-gauges">
      {gauges.map((gauge) => {
        const filled = gauge.ratio === undefined ? null : Math.max(0, Math.min(1, gauge.ratio))
        return (
          <div
            key={gauge.key}
            className="escape-menu-chrome-gauge"
            data-tooltip={tooltipOf(gauge.label, gauge.detail)}
            role="progressbar"
            aria-label={gauge.label}
            aria-valuemin={0}
            aria-valuemax={100}
            // Absent rather than zero, so assistive tech reads it as
            // indeterminate instead of as "none of it".
            aria-valuenow={filled === null ? undefined : Math.round(filled * 100)}
          >
            <div className="thockdown-scroll-track escape-menu-chrome-gauge-track">
              {filled === null ? null : (
                <div
                  className="thockdown-scroll-thumb escape-menu-chrome-gauge-fill"
                  // The RATIO, not a height: the bar's floor sits above the
                  // icon, so how tall it should be is a fraction of what is
                  // left over -- an arithmetic the stylesheet owns, because
                  // it owns the icon's size and the gap.
                  style={{ ['--gauge-ratio' as string]: filled }}
                />
              )}
              {/* The FA class carries its own WIDTH (1.25em). On a
                  positioned element that width beats `right: 0` and `left`
                  beats `right`, so the icon pinned to the track's left edge
                  instead of centring -- `text-align` then centred it inside
                  its own 1.25em box, which was the wrong box. The positioned
                  element and the glyph are separate now: this one owns the
                  placement, the inner one owns nothing but the glyph. */}
              <span className="escape-menu-chrome-gauge-icon" aria-hidden="true">
                <span className={gauge.icon} aria-hidden="true" />
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
