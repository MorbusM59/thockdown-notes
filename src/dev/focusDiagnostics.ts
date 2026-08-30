// Focus tracing, for defects only a human can currently reproduce.
//
// WHY THIS EXISTS
// A first click into a non-active section marks it active but leaves
// `document.activeElement` on `<body>` -- no caret, and arrow keys nudge the
// pane instead of moving anything, until a second click. It reproduces every
// time by hand and not once under either harness: `dev:browser` focuses
// correctly on the first click, and the Electron harness could not be made to
// hold the precondition (one column in render view, one in edit) long enough
// to try. Rather than keep guessing at a defect the instruments cannot see,
// this puts the instrument where the defect is.
//
// HOW TO USE
//   localStorage.setItem('thockdown:debug-focus', '1')   // then reload
//   ... perform the gesture ...
//   copy the [focus] lines out of the console
//   localStorage.removeItem('thockdown:debug-focus')     // to stop
//
// It logs the four things that together say who took focus and who took it
// away: every mousedown (capture phase, before any handler can redirect it),
// every focusin/focusout with both parties named, and what actually holds
// focus one frame after each mousedown -- which is the moment the missing
// focus should have arrived and does not.
//
// Costs nothing when the flag is off: the listeners are never attached.

const FLAG = 'thockdown:debug-focus'

function isEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(FLAG) === '1'
  } catch {
    // Private mode, or storage blocked. Never let diagnostics break the app.
    return false
  }
}

/** A short, stable description of an element: tag, the classes that identify it, and which section column it lives in. */
function describe(node: EventTarget | null): string {
  if (!(node instanceof Element)) {
    return node === null ? 'null' : String((node as { toString?: () => string })?.toString?.() ?? 'non-element')
  }
  if (node === document.body) return 'body'
  const classes = typeof node.className === 'string'
    ? node.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    : ''
  const columns = Array.from(document.querySelectorAll('.editor-section-column'))
  const column = columns.findIndex((candidate) => candidate.contains(node))
  const mode = column >= 0
    ? (columns[column].querySelector('.render-container:not(.is-pane-hidden)') ? 'render' : 'edit')
    : null
  const where = column >= 0 ? ` [col${column}/${mode}]` : ''
  return `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ''}${where}`
}

function activeColumnLabel(): string {
  const columns = Array.from(document.querySelectorAll('.editor-section-column'))
  const index = columns.findIndex((column) => column.classList.contains('is-active'))
  return index >= 0 ? `col${index}` : 'none'
}

let installed = false

/** Attaches the trace once, if the flag is set. Safe to call on every mount. */
export function installFocusDiagnostics(): void {
  if (installed || !isEnabled()) return
  installed = true

  const log = (label: string, detail: string) => {
    console.log(`[focus] ${label.padEnd(11)} ${detail}`)
  }

  log('armed', 'tracing mousedown / focusin / focusout. Clear with localStorage.removeItem(\'thockdown:debug-focus\')')

  // Capture phase: this runs before any application handler has had the
  // chance to redirect, preventDefault, or re-render anything.
  window.addEventListener('mousedown', (event) => {
    log('mousedown', `on ${describe(event.target)} | activeElement=${describe(document.activeElement)} | activeSection=${activeColumnLabel()} | defaultPrevented=${event.defaultPrevented}`)
    // One frame later is where a click's focus has normally landed, and where
    // this bug's missing focus would have shown up.
    requestAnimationFrame(() => {
      log('  +1 frame', `activeElement=${describe(document.activeElement)} | activeSection=${activeColumnLabel()}`)
    })
    // And once more after React has had a turn to commit the activation.
    window.setTimeout(() => {
      log('  +1 tick', `activeElement=${describe(document.activeElement)} | activeSection=${activeColumnLabel()}`)
    }, 120)
  }, true)

  window.addEventListener('focusin', (event) => {
    log('focusin', `${describe(event.target)} | from=${describe((event as FocusEvent).relatedTarget)}`)
  }, true)

  // The one that names the thief: whatever pulls focus back to <body> will
  // show up here with a relatedTarget of null.
  window.addEventListener('focusout', (event) => {
    log('focusout', `${describe(event.target)} | to=${describe((event as FocusEvent).relatedTarget)}`)
  }, true)
}
