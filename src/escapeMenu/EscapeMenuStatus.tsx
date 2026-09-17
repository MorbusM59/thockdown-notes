import { usePillStripScroll } from '../shared/usePillStripScroll'
import { typingSoundManager } from '../sound/TypingSoundManager'
import { TAB_KEY_VOICE } from '../sound/keyVoices'
import { narrationText, parseNarration, splitNarration } from './narrationMarkup'
import type { EscapeMenuCellDetail, EscapeMenuChromeMeter, EscapeMenuChromePill,
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
 * ONE narration entry: the pill, with the line's markup rendered inside it.
 *
 * `is-inert` is the one difference from a chapter pill: a chapter pill is
 * something you press, and every gesture a mode has is in the ring.
 */
function EscapeMenuNarrationPill({ entry }: { entry: string }) {
  // The pill shows the LINE; anything behind it is the arithmetic, and lands
  // in the tooltip under the words (narrationMarkup.ts's `splitNarration`).
  const { line, detail } = splitNarration(entry)
  const spans = parseNarration(line)
  const words = narrationText(spans)
  return (
    // The words, on the pill itself: the spans below are glyphs and figures,
    // and a pill reading "8" to a screen reader is a pill saying nothing.
    //
    // The SAME words are the tooltip, which is the whole of what makes a bar
    // of glyphs readable at all: every icon in the vocabulary already carries
    // the word it stands for (narrationMarkup.ts), so hovering a pill spells
    // it out with nothing to keep in step. It is also the only place a pill
    // that stands for several things -- the charm pill, which is one glyph
    // and a count -- can say which ones.
    <span
      className="tag-pill escape-menu-narration is-inert"
      aria-label={words}
      data-tooltip={[words, ...detail].join('\n')}
    >
      {/* ONE flex item, not one per span. `.tag-pill` is inline-flex, so a
          span per run makes every run a flex ITEM -- and a flex item whose
          whole content is a space collapses to nothing, which ate the gap
          between the bold action and the italic outcome. Inside a single
          inline child they are ordinary inline runs and the spaces between
          them are text. */}
      <span className="escape-menu-narration-text" aria-hidden="true">
        {spans.map((span, index) => (span.kind === 'icon' ? (
          <span key={`${index}:${span.icon}`} className={`${span.icon} escape-menu-narration-icon`} aria-hidden="true" />
        ) : (
          <span
            key={`${index}:${span.text}`}
            className={`${span.bold ? 'escape-menu-narration-strong' : ''}${span.italic ? ' escape-menu-narration-em' : ''}`.trim() || undefined}
          >
            {span.text}
          </span>
        )))}
      </span>
    </span>
  )
}

/**
 * THE WHOLE CHAPTER-BAR ROW while a mode owns the slot, on the tag bar's own
 * anatomy: the layer toggle, the id pill saying which one this is, then the
 * strip. Every element is the real bar's -- the same well, fade-masked scroll
 * shell, display row and pill a note's tags and chapters use, sharing
 * shared/usePillStripScroll.ts -- so a strip longer than the bar scrolls
 * under the same fades instead of overrunning it, and the bar sits at exactly
 * the height it does for a note (the pills are what set it; narration
 * rendered as prose made this bar shorter and the editor moved when a mode
 * took the slot).
 *
 * NEWEST FIRST, which is DOM order and therefore also reading order: a new
 * entry appears at the head and pushes the round's older ones rightward,
 * where they stay legible until the mode says they are spent.
 */
export function EscapeMenuChromeBarRow({ status, detail }: {
  status: EscapeMenuModeChrome
  /** What the cell the ring is sitting on would do -- see the detail pill below. */
  detail?: EscapeMenuCellDetail | null
}) {
  const detailLines = detail?.lines.filter((line) => line.trim().length > 0) ?? []
  // Called before any early return, and keyed on what the strip CONTAINS:
  // the detail pill appears and disappears as the dial turns, and entries
  // accumulate within a round, either of which changes the strip's width
  // without changing the row's box -- so the observer alone would never
  // re-measure the fades.
  const strip = usePillStripScroll(`${status.narration.join('\u0001')}\u0000${detail?.title ?? ''}\u0000${detailLines.join('|')}`)
  return (
    <div className="chapter-bar-row">
      {status.barToggle ? <EscapeMenuChromeButton control={status.barToggle} shape="chapter-auto-button" /> : null}
      {status.identity ? (
        <div className="section-identity-tab-shell">
          <span className="tag-pill note-identity-tab is-inert escape-menu-identity-tab" data-tooltip={status.identity}>
            <span className="tag-pill-label">{status.identity}</span>
          </span>
        </div>
      ) : null}
      {status.narration.length > 0 ? (
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
              {status.narration.map((entry, index) => (
                <EscapeMenuNarrationPill key={`${index}:${entry}`} entry={entry} />
              ))}
              {/* What the cell the ring is sitting on would do. DASHED,
                  because it is the one thing on this bar that has not
                  happened: everything else here is the state of the run, and
                  this is a preview of an option still being weighed. The
                  border is the whole signal, so it needs no other marking.

                  The lines only. `detail.title` is always the cell's own
                  label, which the ring's centre is showing at this exact
                  moment -- see EscapeMenuCellDetail. It rides the tooltip and
                  the accessible name instead, where the lines still need
                  attributing to something. */}
              {detailLines.length > 0 ? (
                <span
                  className="tag-pill escape-menu-choice-detail is-inert"
                  data-tooltip={tooltipOf(detail?.title ?? '', detailLines)}
                  aria-label={`${detail?.title ?? ''}: ${detailLines.join(', ')}`}
                >
                  {detailLines.map((line, index) => (
                    <span key={line} className="escape-menu-choice-detail-line">
                      {index > 0 ? <span className="escape-menu-choice-detail-sep" aria-hidden="true">·</span> : null}
                      {line}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
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

/**
 * `shape` is the HOST's class for a button in that position, not a choice a
 * mode makes: the two bars size their buttons differently (the chapter bar's
 * track the pill height, the stats row's the scrollbar's thickness), and a
 * reserved position has to be exactly the button it is holding open or it
 * does not hold the geometry it exists to hold.
 */
export function EscapeMenuChromeButton({ control, shape = 'chapter-toggle-button' }: {
  control: EscapeMenuChromeToggle
  shape?: 'chapter-toggle-button' | 'chapter-auto-button'
}) {
  if (!control.onActivate) {
    return (
      <span className={`ui-btn btn-icon ${shape} is-reserved`} aria-hidden="true" data-tooltip={control.label}>
        <span className={RESERVED_POSITION_ICON} aria-hidden="true" />
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`${shape} btn-icon${control.isActive ? ' is-active' : ''}`}
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
function EscapeMenuChromeStrip({ status }: { status: EscapeMenuModeChrome }) {
  const strip = status.strip
  if (!strip || (strip.leading.length === 0 && strip.trailing.length === 0)) return null

  const group = (pills: EscapeMenuChromePill[], className: string) => (
    <div className={className}>
      {pills.map((pill) => {
        // The line-number toggle's own box, not a tag pill: these sit in the
        // timeline's lane, which is a mirror of the scrollbar and has no room
        // for a pill's height. Reusing the button geometry keeps the lane at
        // the height every margin around it was set against, and keeps one
        // visual language in the chrome instead of two.
        const boxClassName = `ui-btn btn-icon chapter-toggle-button escape-menu-chrome-pill${pill.isActive ? ' is-active' : ''}`
        const tooltip = tooltipOf(pill.label, pill.detail)
        // A real BUTTON only where there is something to press. A span that
        // listens for clicks is a button that keyboards and screen readers
        // cannot reach, and most pills here genuinely are readouts.
        if (!pill.onActivate) {
          return (
            <span key={pill.key} className={boxClassName} data-tooltip={tooltip} aria-label={pill.label} role="listitem">
              <span className={pill.icon} aria-hidden="true" />
            </span>
          )
        }
        return (
          <button
            key={pill.key}
            type="button"
            className={boxClassName}
            data-tooltip={tooltip}
            aria-label={pill.label}
            aria-pressed={pill.isActive === true}
            role="listitem"
            // Nothing is behind these but an empty editor, and a right press
            // here does nothing -- declared rather than left undecided, per
            // shared/pressTracking.ts.
            data-secondary-press="none"
            onClick={pill.onActivate}
          >
            <span className={pill.icon} aria-hidden="true" />
          </button>
        )
      })}
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
 * One meter: a bare icon label and the row's small bordered box, in that
 * order at the head of the row and reversed at its foot, so both icons face
 * outward and the two values sit nearest the strip they pay for.
 *
 * The label is the strip pill's own box with no glyph of its own to press --
 * the row already has exactly one vocabulary for "a small square carrying an
 * icon", and a second would read as a control of a different kind.
 */
function EscapeMenuChromeMeterBox({ meter, side }: { meter: EscapeMenuChromeMeter; side: 'leading' | 'trailing' }) {
  const tooltip = tooltipOf(meter.label, [meter.value])
  const icon = (
    <span
      className="ui-btn btn-icon chapter-toggle-button escape-menu-chrome-pill escape-menu-meter-icon"
      data-tooltip={tooltip}
      aria-hidden="true"
    >
      <span className={meter.icon} aria-hidden="true" />
    </span>
  )
  const value = (
    <div className="wordcount-panel escape-menu-meter-value" data-tooltip={tooltip} aria-label={`${meter.label}: ${meter.value}`}>
      <span>{meter.value}</span>
    </div>
  )
  return side === 'leading' ? <>{icon}{value}</> : <>{value}{icon}</>
}

/**
 * THE WHOLE STATS ROW while a mode owns the slot -- every position on it,
 * laid out by the mode's own record rather than poured into the editor's.
 *
 * The order mirrors the tag bar one row up, which is where a reader has
 * already learned to look for each kind of thing: the leading toggle, then
 * the id box saying which one this is, then the strip, with the row's
 * remaining boxes flanking it and the manual-save position closing it. The
 * toggle and the action are RESERVED rather than omitted -- see
 * EscapeMenuChromeButton, and the note in escapeMenuContract.ts about what
 * dropping a position does to the composition.
 */
export function EscapeMenuChromeStatsRow({ status }: { status: EscapeMenuModeChrome }) {
  return (
    <>
      <div className="chapter-toggle-panel">
        {status.toggle ? <EscapeMenuChromeButton control={status.toggle} /> : null}
      </div>
      {status.meters?.leading ? <EscapeMenuChromeMeterBox meter={status.meters.leading} side="leading" /> : null}
      <div className="timeline-panel">
        <EscapeMenuChromeStrip status={status} />
      </div>
      {status.meters?.trailing ? <EscapeMenuChromeMeterBox meter={status.meters.trailing} side="trailing" /> : null}
      <div className="manual-snapshot-panel">
        {status.action ? <EscapeMenuChromeButton control={status.action} /> : null}
      </div>
    </>
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
 *
 * A gauge WITH an action is a real `<button>` and one without is a `<div>`,
 * the same rule the strip's pills follow. The `progressbar` role moves down
 * onto the TRACK when that happens rather than sitting on the button: a
 * button that is also a progressbar is neither to assistive tech, and the
 * track is the thing that is actually a bar.
 */
export function EscapeMenuChromeGauges({ status }: { status: EscapeMenuModeChrome }) {
  const gauges = status.gauges
  if (!gauges || gauges.length === 0) return null
  return (
    <div className="escape-menu-chrome-gauges">
      {gauges.map((gauge) => {
        const filled = gauge.ratio === undefined ? null : Math.max(0, Math.min(1, gauge.ratio))
        const action = gauge.action
        const bar = (
            <div
              className="thockdown-scroll-track escape-menu-chrome-gauge-track"
              // The bar's floor is raised by whatever sits under it. Declared
              // here rather than as a second class, so the count's presence
              // and the floor it creates cannot disagree.
              data-has-count={gauge.count === undefined ? undefined : 'true'}
              role="progressbar"
              aria-label={gauge.label}
              aria-valuemin={0}
              aria-valuemax={100}
              // Absent rather than zero, so assistive tech reads it as
              // indeterminate instead of as "none of it".
              aria-valuenow={filled === null ? undefined : Math.round(filled * 100)}
            >
              {filled === null ? null : (
                <div
                  className="thockdown-scroll-thumb escape-menu-chrome-gauge-fill"
                  // FULL is marked rather than inferred: CSS cannot compare a
                  // custom property against 1, and the strain animation needs
                  // to know. An attribute rather than a class for the reason
                  // shared/pressTracking.ts gives -- React rewrites className
                  // on re-render, and this element is re-rendered on every
                  // choice the player makes.
                  data-full={filled >= 1 ? 'true' : undefined}
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
              {/* Under the icon, at the very foot: what has been SPENT of
                  what this gauge measures, where the bar above is progress
                  toward the next one. Clamped to two digits -- this column is
                  a scrollbar's width, and the true figure is in the tooltip
                  the whole gauge already carries. */}
              {gauge.count === undefined ? null : (
                <span className="escape-menu-chrome-gauge-count" aria-hidden="true">
                  {Math.min(99, Math.max(0, Math.floor(gauge.count)))}
                </span>
              )}
            </div>
        )
        const tooltip = tooltipOf(action ? action.label : gauge.label, gauge.detail)
        if (!action) {
          return (
            <div key={gauge.key} className="escape-menu-chrome-gauge" data-tooltip={tooltip}>
              {bar}
            </div>
          )
        }
        return (
          <button
            key={gauge.key}
            type="button"
            className="escape-menu-chrome-gauge"
            data-tooltip={tooltip}
            // The VERB, not the noun the bar measures: this is what the press
            // does. See EscapeMenuChromeGaugeAction.
            aria-label={action.label}
            // Nothing is behind these but an empty editor, and a right press
            // here does nothing -- declared rather than left undecided, per
            // shared/pressTracking.ts.
            data-secondary-press="none"
            onClick={() => {
              // TAB: a screen brought up from OUTSIDE the ring.
              //
              // The one place in this feature where the sound says HOW
              // something happened rather than what. Every other menu sound
              // is a key the reader effectively pressed on the dial; this
              // one is a screen arriving because they pressed something on
              // the chrome instead, and Tab is the key that means "somewhere
              // else now has the keyboard".
              //
              // Played HERE rather than announced by the stage that opens:
              // the gauge press is what knows this arrival came from outside,
              // and a mode would otherwise have to carry a flag saying how
              // its own screen was reached -- a fact about the gesture stored
              // on the destination.
              void typingSoundManager.playRandomClick(TAB_KEY_VOICE)
              action.onActivate()
            }}
          >
            {bar}
          </button>
        )
      })}
    </div>
  )
}
