// How the shortcut reference draws each key: one square cap per key, so a
// combination's width is its number of keys and every row of keys lines up.
//
// A cap holds either a Font Awesome icon or a short text (a letter, `F1`,
// `RM`). Anything that is not its own name -- an icon, or an abbreviation --
// carries a `legend`, and the reference's legend column lists exactly those
// legends for the caps it actually draws, so a cap is never left to guess.
//
// Keys are looked up by the display names `keyboardShortcuts.ts` produces
// (`displayChords`), so this module adds a picture to a name and decides
// nothing about which keys exist.

import type { MouseGesture } from '../shared/mouseGestures'

export interface KeyCap {
  /** Font Awesome classes, for an icon cap. */
  icon?: string
  /** Text, for a lettered cap; at most three characters fit. */
  text?: string
  /** What the cap stands for, when it is not its own name. */
  legend?: string
}

const ARROWS_CAP: KeyCap = { icon: 'fa-solid fa-caret-up', legend: 'Arrow keys' }

const NAMED_CAPS: Record<string, KeyCap> = {
  Ctrl: { text: 'Ctr', legend: 'Control' },
  Cmd: { text: '⌘', legend: 'Cmd' },
  Shift: { text: 'Shf', legend: 'Shift' },
  Alt: { text: 'Alt' },
  Esc: { text: 'Esc', legend: 'Escape' },
  Enter: { icon: 'fa-solid fa-turn-down fa-rotate-90', legend: 'Enter' },
  Backspace: { icon: 'fa-solid fa-delete-left', legend: 'Backspace' },
  Delete: { icon: 'fa-solid fa-delete-left fa-flip-horizontal', legend: 'Delete' },
  Tab: { text: 'Tab' },
  Space: { icon: 'fa-solid fa-window-minimize', legend: 'Space' },
  // One cap for every arrow key: which way is the description's business.
  '←': ARROWS_CAP,
  '→': ARROWS_CAP,
  '↑': ARROWS_CAP,
  '↓': ARROWS_CAP,
}

/** The cap for a key's display name; a name with no picture is its own text. */
export function capForKey(name: string): KeyCap {
  return NAMED_CAPS[name] ?? { text: name }
}

/** A gesture's caps, in reading order: how it is pressed, then with what. */
export function capsForGesture(gesture: MouseGesture): KeyCap[] {
  const caps: KeyCap[] = (gesture.modifiers ?? []).map(capForKey)
  if (gesture.action === 'hold') caps.push(HOLD_CAP)
  if (gesture.action === 'drag') caps.push({ icon: 'fa-solid fa-grip', legend: 'Drag' })
  if (gesture.action === 'wheel') caps.push({ icon: 'fa-solid fa-arrows-up-down', legend: 'Mouse: Scroll' })
  if (gesture.button === 'left') caps.push({ text: 'LM', legend: 'Mouse: Left' })
  if (gesture.button === 'right') caps.push({ text: 'RM', legend: 'Mouse: Right' })
  return caps
}

/** A held key or button, in front of what is held. */
export const HOLD_CAP: KeyCap = { icon: 'fa-solid fa-circle-down', legend: 'Hold' }

export interface LegendEntry {
  legend: string
  /** Every distinct cap drawn under this legend (the four arrow keys share one). */
  caps: KeyCap[]
}

/** The legend's reading order: modifiers, keys, then the mouse. */
const LEGEND_ORDER = [
  'Control', 'Cmd', 'Shift',
  'Escape', 'Enter', 'Space', 'Backspace', 'Delete', 'Arrow keys',
  'Mouse: Left', 'Mouse: Right', 'Mouse: Scroll', 'Drag', 'Hold',
]

/** One entry per distinct legend among `caps`, in LEGEND_ORDER (an unlisted legend last). */
export function legendOf(caps: Iterable<KeyCap>): LegendEntry[] {
  const entries = new Map<string, LegendEntry>()
  for (const cap of caps) {
    if (!cap.legend) continue
    const entry = entries.get(cap.legend) ?? { legend: cap.legend, caps: [] }
    if (!entry.caps.some((known) => known.icon === cap.icon && known.text === cap.text)) entry.caps.push(cap)
    entries.set(cap.legend, entry)
  }
  const rank = (legend: string) => {
    const index = LEGEND_ORDER.indexOf(legend)
    return index < 0 ? LEGEND_ORDER.length : index
  }
  return [...entries.values()].sort((a, b) => rank(a.legend) - rank(b.legend))
}
