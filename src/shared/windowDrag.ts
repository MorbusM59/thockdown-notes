// Custom (non-native) frameless-window dragging. Electron's own
// `-webkit-app-region: drag` regions intercept mouse events at the Chromium
// compositor level before they ever reach the DOM, which silently breaks
// anything in the renderer that tracks the cursor across the whole app
// (see MouseCursorOverlay.tsx) -- the custom cursor would freeze the moment
// it entered a drag region. Moving the window via mousedown + a pixel
// threshold + explicit IPC calls instead keeps every pointer event flowing
// through the normal DOM/React path.
export const WINDOW_DRAG_CHANNELS = {
  start: 'window-drag:start',
  move: 'window-drag:move',
  end: 'window-drag:end',
} as const

// How far the primary button has to move (in screen px) after a mousedown
// on a drag-eligible element before it's treated as a window-move gesture
// rather than a click -- keeps ordinary clicks in draggable chrome (e.g. the
// toolbar background) from ever nudging the window by a stray pixel.
export const WINDOW_DRAG_THRESHOLD_PX = 5

// Elements (and everything inside them) that must never start a window-drag
// gesture: native form controls and links, the editor's own contenteditable
// surface, anything using HTML5 drag-and-drop (tab/note reordering, section
// dividers), the custom scrollbar rails, and a couple of panels that are
// themselves nothing but densely-packed interactive controls.
// `.no-window-drag` / `[data-no-window-drag]` are escape hatches for
// excluding one more element without editing this list.
export const WINDOW_DRAG_EXCLUDED_SELECTOR = [
  'input', 'textarea', 'select', 'button', 'a[href]', 'label',
  '[contenteditable]', '[contenteditable="true"]',
  '[role="button"]', '[role="slider"]', '[role="tab"]',
  '[draggable="true"]',
  '.cm-editor',
  '.thockdown-scroll-track', '.thockdown-scroll-thumb',
  '.editor-section-divider',
  '.tag-pill',
  '.sidebar-options-content',
  '.audio-controls',
  '.no-window-drag', '[data-no-window-drag]',
].join(', ')
