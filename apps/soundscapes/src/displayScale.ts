/**
 * The x n mode (MainActivity's applyDisplayScale, DisplayScalePlugin): the
 * whole page drawn at 1/n of the screen's resolution and scaled up n times,
 * so everything is n times larger and costs n squared less to draw. Native
 * only; in a browser there is no mode and the scale is always 1.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

export const MIN_DISPLAY_SCALE = 1
export const MAX_DISPLAY_SCALE = 4

interface DisplayScalePlugin {
  get(): Promise<{ scale: number }>
  set(options: { scale: number }): Promise<void>
}

const plugin = Capacitor.isNativePlatform() ? registerPlugin<DisplayScalePlugin>('DisplayScale') : null

export async function readDisplayScale(): Promise<number> {
  return plugin ? (await plugin.get()).scale : MIN_DISPLAY_SCALE
}

export async function setDisplayScale(scale: number): Promise<void> {
  if (plugin) await plugin.set({ scale })
}

/** The next scale after `scale`, from the largest back to 1. */
export function nextDisplayScale(scale: number): number {
  return scale >= MAX_DISPLAY_SCALE ? MIN_DISPLAY_SCALE : scale + 1
}
