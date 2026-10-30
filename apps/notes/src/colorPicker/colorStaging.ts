/**
 * The one staged colour of the options panel, and which of its channels a
 * press applies or copies.
 *
 * Every colour control in the panel works against this single staging: a
 * left click on a colour target writes the ACTIVE channels of the staged
 * colour into the target, and a held right click on a target copies the
 * target's active channels into the staging. The picker row (ColorPickerRow)
 * edits the staging and the channel mask; every section that has colour
 * targets draws that row at its top, and all of them show this one state, so
 * a colour picked up in one section can be applied in any other.
 *
 * The staging is held as HSVA rather than RGBA because RGBA cannot carry a
 * hue through a grey: dragging saturation to zero and back must return to the
 * hue the reader chose. It is session state and is not persisted.
 */
import { useSyncExternalStore } from 'react'
import { rgbaToHsva, type HsvaColor } from '@thockdown/look/colorMath'

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
}

let state: ColorStagingState = {
  color: rgbaToHsva({ r: 120, g: 115, b: 112, a: 0.8 }), // the default caret colour,
  mask: ALL_CHANNELS,
}
const listeners = new Set<() => void>()

function publish(next: ColorStagingState) {
  if (next.color === state.color && next.mask === state.mask) return
  state = next
  listeners.forEach((listener) => listener())
}

export function getColorStaging(): ColorStagingState {
  return state
}

export function setStagedColor(update: (color: HsvaColor) => HsvaColor) {
  publish({ ...state, color: update(state.color) })
}

export function setChannelMask(mask: ChannelMask) {
  publish({ ...state, mask })
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
