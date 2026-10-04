/**
 * The page's half of the launch order (the native half is MainActivity and
 * LaunchPlugin). The splash covers the screen until this page reports that
 * its first themed frame is on screen, so a reader sees one uniform field and
 * then the finished page -- never the bare window, an unthemed page, or a
 * layout that is still moving.
 *
 * The system bars' icons follow the LOOK's mode rather than the phone's
 * night mode, because the page draws under both bars: dark icons over a dark
 * look would vanish.
 */
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'

interface LaunchPlugin {
  ready(): Promise<void>
}

const native = Capacitor.isNativePlatform()
const launch = native ? registerPlugin<LaunchPlugin>('Launch') : null

/** The latest bar-style change, so the handover waits for the one in force. */
let barsSettled: Promise<void> = Promise.resolve()

/** Sets the bars' icons for a look's mode ('dark' means a dark background, so light icons). */
export function styleSystemBars(mode: 'light' | 'dark'): void {
  if (!native) return
  barsSettled = SystemBars.setStyle({ style: mode === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
}

/**
 * Releases the splash once the first themed frame has been PRESENTED: a
 * requestAnimationFrame callback runs before its frame is painted, so the
 * callback of the frame after it is the first moment the earlier one is known
 * to be on screen. Called after the commit in which the page shows the state
 * it will keep (MobileSoundscapeApp's `hydrated`); its layout effects have
 * applied the theme and the bar style by then.
 */
export async function reportFirstFrame(): Promise<void> {
  if (!launch) return
  await barsSettled
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  await launch.ready()
}
