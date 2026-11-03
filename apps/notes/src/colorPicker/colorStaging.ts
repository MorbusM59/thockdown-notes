/**
 * The one staged colour of the options panel, which of its channels a
 * write applies, and which colour target it is linked to.
 *
 * Every colour control in the panel works against this single staging: a
 * left click on a colour target LINKS it (the staging takes its colour and
 * writes back into it as it changes), and a right click writes the staged
 * colour's masked channels into a target. The picker row (ColorPickerRow)
 * edits the staging and the channel mask; every section that has colour
 * targets draws that row at its top, and all of them show this one state, so
 * a colour picked up in one section can be written in any other.
 *
 * The staging is held as HSVA rather than RGBA because RGBA cannot carry a
 * hue through a grey: dragging saturation to zero and back must return to the
 * hue the reader chose. It is session state and is not persisted.
 */
import { useSyncExternalStore } from 'react'
import { hsvaToRgba, rgbaToCssColor, rgbaToHsva, type HsvaColor } from '@thockdown/look/colorMath'

export type ColorChannel = 'h' | 's' | 'v' | 'a'

export const COLOR_CHANNELS: readonly ColorChannel[] = ['h', 's', 'v', 'a']

export type ChannelMask = Readonly<Record<ColorChannel, boolean>>

export const ALL_CHANNELS: ChannelMask = { h: true, s: true, v: true, a: true }

export function isAllChannels(mask: ChannelMask): boolean {
  return COLOR_CHANNELS.every((channel) => mask[channel])
}

/**
 * The mask after a press on one channel's toggle.
 *
 * A plain press selects that channel alone. An additive press (Shift with a
 * mouse, every tap with a finger) toggles it and leaves the others as they
 * are. A mask with nothing in it applies nothing and would make every target
 * press a silent no-op, so turning off the last channel returns to all four:
 * "all" has exactly one representation, which is also what lights the colour
 * button.
 */
export function selectChannel(mask: ChannelMask, channel: ColorChannel, additive: boolean): ChannelMask {
  if (!additive) {
    return { h: false, s: false, v: false, a: false, [channel]: true }
  }
  const next = { ...mask, [channel]: !mask[channel] }
  return COLOR_CHANNELS.some((key) => next[key]) ? next : ALL_CHANNELS
}

/**
 * Which channels a colour actually defines. A colour with no saturation or no
 * value has no hue (rgbaToHsva reports 0, which is red, not "none"), and a
 * colour with no value has no saturation either. Writing such a channel out
 * of it would replace a real value with an artefact of the conversion.
 */
export function definedChannels(color: HsvaColor): ChannelMask {
  return {
    h: color.s > 0 && color.v > 0,
    s: color.v > 0,
    v: true,
    a: true,
  }
}

/** `target` with the channels in `mask` taken from `source`. */
export function withChannels(target: HsvaColor, source: HsvaColor, mask: ChannelMask): HsvaColor {
  return {
    h: mask.h ? source.h : target.h,
    s: mask.s ? source.s : target.s,
    v: mask.v ? source.v : target.v,
    a: mask.a ? source.a : target.a,
  }
}

/**
 * What applying the staged colour through `mask` turns `target` into.
 *
 * A target that has no hue of its own (a grey) borrows the staged hue before
 * the masked channels are written, so applying saturation alone to a grey
 * tints it with the hue on the picker rather than with the red that a
 * hue of 0 would mean.
 */
export function applyStagedColor(target: HsvaColor, staged: HsvaColor, mask: ChannelMask): HsvaColor {
  const base = definedChannels(target).h ? target : { ...target, h: staged.h }
  return withChannels(base, staged, mask)
}

/** The staging after copying `source`'s masked channels into it, skipping any channel `source` does not define. */
export function copyIntoStaging(staged: HsvaColor, source: HsvaColor, mask: ChannelMask): HsvaColor {
  const defined = definedChannels(source)
  return withChannels(staged, source, {
    h: mask.h && defined.h,
    s: mask.s && defined.s,
    v: mask.v && defined.v,
    a: mask.a && defined.a,
  })
}

export interface ColorStagingState {
  color: HsvaColor
  mask: ChannelMask
  /**
   * The id of the colour target the staging is LINKED to, or null. While a
   * target is linked, every change to the staged colour is written into it
   * (after LINK_WRITE_DEBOUNCE_MS; the target's own swatch shows the change at
   * once). Linking loads the target's colour into the staging, so linking and
   * unlinking is also how a colour is picked up. At most one target is linked.
   */
  linkedId: string | null
}

/**
 * How long a linked target waits after the last staged change before it is
 * written. The swatch follows every change; the element itself, whose new
 * colour may re-theme the app, follows once the reader pauses.
 */
export const LINK_WRITE_DEBOUNCE_MS = 100

let state: ColorStagingState = {
  color: rgbaToHsva({ r: 120, g: 115, b: 112, a: 0.8 }), // the default caret colour
  mask: ALL_CHANNELS,
  linkedId: null,
}
let linkedCss: string | null = null
let linkWrite: ((css: string) => void) | null = null
let pendingWrite: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function publish(next: ColorStagingState) {
  if (next.color === state.color && next.mask === state.mask && next.linkedId === state.linkedId) return
  state = next
  linkedCss = next.linkedId === null ? null : rgbaToCssColor(hsvaToRgba(next.color))
  listeners.forEach((listener) => listener())
}

function flushLinkWrite() {
  if (pendingWrite === null) return
  clearTimeout(pendingWrite)
  pendingWrite = null
  if (linkWrite && linkedCss !== null) linkWrite(linkedCss)
}

export function getColorStaging(): ColorStagingState {
  return state
}

export function setStagedColor(update: (color: HsvaColor) => HsvaColor) {
  publish({ ...state, color: update(state.color) })
  if (linkWrite) {
    if (pendingWrite !== null) clearTimeout(pendingWrite)
    pendingWrite = setTimeout(flushLinkWrite, LINK_WRITE_DEBOUNCE_MS)
  }
}

/** Choosing channels ends any link: the mask is about what a write applies, and a link writes everything it changes. */
export function setChannelMask(mask: ChannelMask) {
  unlinkTarget()
  publish({ ...state, mask })
}

/**
 * Links the staging to a target: its colour is loaded (every channel it
 * defines; a grey keeps the staged hue) and later changes are written to it
 * through `write`. Any previous link is ended first, with its pending write.
 */
export function linkTarget(id: string, color: HsvaColor, write: (css: string) => void) {
  unlinkTarget()
  linkWrite = write
  publish({ ...state, color: copyIntoStaging(state.color, color, ALL_CHANNELS), linkedId: id })
}

/**
 * Ends the link, writing what is still pending -- unless `discard`, for a
 * target whose value was changed from outside (a layout switch), where the
 * pending write would land the old colour on the new value. The staged
 * colour stays.
 */
export function unlinkTarget(id?: string, discard = false) {
  if (state.linkedId === null || (id !== undefined && id !== state.linkedId)) return
  if (discard && pendingWrite !== null) {
    clearTimeout(pendingWrite)
    pendingWrite = null
  }
  flushLinkWrite()
  linkWrite = null
  publish({ ...state, linkedId: null })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useColorStaging(): ColorStagingState {
  return useSyncExternalStore(subscribe, getColorStaging, getColorStaging)
}

/** The staged colour as CSS while `id` is the linked target, else null: what the linked swatch shows. */
export function useLinkedColor(id: string): string | null {
  const read = () => (state.linkedId === id ? linkedCss : null)
  return useSyncExternalStore(subscribe, read, read)
}

/** The linked target's id. */
export function useLinkedId(): string | null {
  const read = () => state.linkedId
  return useSyncExternalStore(subscribe, read, read)
}
