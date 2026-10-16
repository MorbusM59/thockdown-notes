/**
 * Whether the desktop app is running on Linux.
 *
 * Linux is the one desktop platform where the app cannot place its own
 * window: since Electron 38 it runs as a native Wayland client whenever the
 * session offers Wayland, and a Wayland client's `setPosition`/`setBounds`
 * are ignored. Forcing X11 instead left the packaged app with no window at
 * all, so on Linux the compositor moves the window, which it does only for a
 * press that starts on a CSS `app-region: drag` area
 * (`window/useWindowDragRegion.ts`). Those areas take the pointer away from
 * the page, so the custom cursor (`components/MouseCursorOverlay.tsx`), which
 * follows the pointer through DOM events, would freeze over them; on Linux the
 * native cursor is used everywhere and the custom cursor's options are hidden.
 *
 * Read from the user agent, which Chromium writes as "X11; Linux" under
 * Wayland and X11 alike. Decided once per process: it cannot change.
 */
export const IS_LINUX_DESKTOP: boolean = (() => {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator
  return /\bLinux\b/.test(nav?.userAgent ?? '') && !/\bAndroid\b/.test(nav?.userAgent ?? '')
})()
