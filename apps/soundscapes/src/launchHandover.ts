/**
 * The page's half of the launch order (the native half is MainActivity and
 * LaunchPlugin). The launch overlay -- the launch image on its own background,
 * drawn natively -- covers the screen until this page reports that it shows
 * the state it will keep, so a reader sees one field, the image on it, and
 * then the finished page: never the bare window, an unthemed page, or a
 * layout that is still moving.
 *
 * The system bars' icons follow the LOOK's mode rather than the phone's
 * night mode, because the page draws under both bars: dark icons over a dark
 * look would vanish. While the overlay is up the bars sit over the overlay's
 * dark background instead (capacitor.config.ts starts them light), so the
 * look's style is held back until the overlay is released.
 */
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'

interface LaunchPlugin {
  ready(): Promise<void>
}

const native = Capacitor.isNativePlatform()
const launch = native ? registerPlugin<LaunchPlugin>('Launch') : null

/** Whether the launch overlay has been released; until then the bars keep the overlay's style. */
let released = false
/** The look's mode, kept while the overlay is up, applied when it goes. */
let pendingMode: 'light' | 'dark' | null = null

function applyBarStyle(mode: 'light' | 'dark'): void {
  void SystemBars.setStyle({ style: mode === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
}

/** Sets the bars' icons for a look's mode ('dark' means a dark background, so light icons). */
export function styleSystemBars(mode: 'light' | 'dark'): void {
  if (!native) return
  if (released) applyBarStyle(mode)
  else pendingMode = mode
}

/**
 * Releases the launch overlay once the frame showing the state the page will
 * keep has been PRESENTED: a requestAnimationFrame callback runs before its
 * frame is painted, so the callback of the frame after it is the first moment
 * the earlier one is known to be on screen. Called after the commit in which
 * the page shows that state (MobileSoundscapeApp's `hydrated`); its layout
 * effects have applied the theme by then. A second call (a page reload)
 * reports again, which the native side ignores.
 */
export async function reportFirstFrame(): Promise<void> {
  if (!launch) return
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  await launch.ready()
  released = true
  if (pendingMode !== null) applyBarStyle(pendingMode)
}
