/**
 * The visualizer's display switches (MainActivity, DisplayPlugin), both
 * applied only while it is open: the x n mode -- the whole page drawn at 1/n of the screen's resolution and
 * scaled up n times, so everything is n times larger and costs n squared
 * less to draw -- and the visualizer's orientation, portrait or landscape,
 * chosen rather than detected, applied only while the visualizer is open
 * (the rest of the app is always portrait). Native only; in a browser neither exists.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

export const MIN_DISPLAY_SCALE = 1
export const MAX_DISPLAY_SCALE = 2

export interface DisplayState {
  scale: number
  landscape: boolean
}

interface DisplayPlugin {
  get(): Promise<DisplayState>
  setScale(options: { scale: number }): Promise<void>
  setLandscape(options: { landscape: boolean }): Promise<void>
  setVisualizerOpen(options: { open: boolean }): Promise<void>
}

const plugin = Capacitor.isNativePlatform() ? registerPlugin<DisplayPlugin>('Display') : null

export async function readDisplay(): Promise<DisplayState> {
  return plugin ? plugin.get() : { scale: MIN_DISPLAY_SCALE, landscape: false }
}

export async function setDisplayScale(scale: number): Promise<void> {
  if (plugin) await plugin.setScale({ scale })
}

export async function setLandscape(landscape: boolean): Promise<void> {
  if (plugin) await plugin.setLandscape({ landscape })
}

/** The next scale after `scale`, from the largest back to 1. */
export function nextDisplayScale(scale: number): number {
  return scale >= MAX_DISPLAY_SCALE ? MIN_DISPLAY_SCALE : scale + 1
}

/** Reports the visualizer open or closed; its orientation applies only while open. */
export async function setVisualizerOpen(open: boolean): Promise<void> {
  if (plugin) await plugin.setVisualizerOpen({ open })
}
