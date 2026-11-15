// What a tooltip SAYS, as fields rather than a sentence, so the reader can
// choose which kinds of thing they want to be told (Options > Advanced >
// Tooltips) and every tooltip in the app obeys that choice by construction.
//
// A tooltip is up to four ELEMENTS:
//   - intention: what pressing the control does, named by its purpose
//     ("Next song"), never by its mechanics;
//   - shortcut: the id of a keyboard shortcut that does the same thing (the
//     app resolves it against its one shortcut table, so the key shown can
//     never drift from the key bound);
//   - gestures: what the other presses do, each a press spelled in words
//     ("[Right]", "[Hold right]") plus its own intention;
//   - value: the control's current value (a slider, a readout). A toggle has
//     none: its tooltip names the intention only.
//
// The content travels in the element's ordinary `data-tooltip` /
// `data-live-tooltip` attribute, so the one tooltip layer stays the only
// renderer and an element needs no registration. A plain string IS an
// intention-only tooltip, which is what the large majority are; anything with
// more than an intention is written by `encodeTooltip`, which marks the
// string with a leading control character no hand-typed tooltip contains.

/** A press other than the plain click, spelled for the reader in words. */
export type TooltipGesture = 'right' | 'hold' | 'holdRight' | 'doubleClick' | 'drag' | 'rightDrag' | 'ctrlClick' | 'shiftClick' | 'wheel'

export const TOOLTIP_GESTURE_WORDS: Readonly<Record<TooltipGesture, string>> = {
  right: 'Right',
  hold: 'Hold',
  holdRight: 'Hold right',
  doubleClick: 'Double',
  drag: 'Drag',
  rightDrag: 'Right drag',
  ctrlClick: 'Ctrl',
  shiftClick: 'Shift',
  wheel: 'Wheel',
}

export interface TooltipGestureLine {
  press: TooltipGesture
  intention: string
}

export interface TooltipContent {
  intention?: string
  /** A shortcut id from the app's shortcut table (`shared/keyboardShortcuts.ts`). */
  shortcut?: string
  gestures?: readonly TooltipGestureLine[]
  value?: string
  /**
   * A fixed explanation, shown whatever the reader's element choice and
   * delay, after its own `delayMs`: for the controls that MAKE that choice,
   * which would otherwise explain themselves only under the setting they set.
   */
  fixed?: TooltipFixed
}

export interface TooltipFixed {
  /** Shown bold, followed by `detail`. */
  title: string
  detail: string
  example: string
  delayMs: number
}

/** Which elements the reader wants shown. */
export interface TooltipElementVisibility {
  intention: boolean
  shortcut: boolean
  gestures: boolean
  value: boolean
}

export type TooltipElement = keyof TooltipElementVisibility

const STRUCTURED_MARK = '\u0002'

/** The attribute value for a tooltip; intention-only content stays a plain string. */
export function encodeTooltip(content: TooltipContent): string {
  const { intention, shortcut, gestures, value } = content
  if (!content.fixed && !shortcut && !(gestures && gestures.length > 0) && value === undefined) return intention ?? ''
  return STRUCTURED_MARK + JSON.stringify(content)
}

/** Reads an attribute value back; a plain string is an intention. Malformed content reads as nothing. */
export function decodeTooltip(raw: string): TooltipContent {
  if (!raw.startsWith(STRUCTURED_MARK)) return raw ? { intention: raw } : {}
  try {
    const parsed: unknown = JSON.parse(raw.slice(STRUCTURED_MARK.length))
    return parsed && typeof parsed === 'object' ? (parsed as TooltipContent) : {}
  } catch {
    return {}
  }
}

/** The lines a tooltip shows under the reader's choice; none means no tooltip at all. */
export function tooltipLines(
  content: TooltipContent,
  show: TooltipElementVisibility,
  shortcutText: (id: string) => string | null,
): string[] {
  const head: string[] = []
  const intention = show.intention && content.intention ? content.intention : ''
  const value = show.value && content.value !== undefined && content.value !== '' ? content.value : ''
  if (intention && value) head.push(`${intention}: ${value}`)
  else if (intention || value) head.push(intention || value)
  const keys = show.shortcut && content.shortcut ? shortcutText(content.shortcut) : null
  if (keys) head.push(`[${keys}]`)
  const lines = head.length > 0 ? [head.join('  ')] : []
  if (show.gestures && content.gestures) {
    for (const line of content.gestures) lines.push(`[${TOOLTIP_GESTURE_WORDS[line.press]}] ${line.intention}`)
  }
  return lines
}

/** Every word a tooltip can show, for search: its intention, value and gestures' intentions. */
export function tooltipSearchText(raw: string): string {
  const { intention, value, gestures } = decodeTooltip(raw)
  return [intention, value, ...(gestures ?? []).map((line) => line.intention)].filter(Boolean).join('\n')
}
