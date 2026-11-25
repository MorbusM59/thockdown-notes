// THE DRAG LAYER: where the picture that follows a drag is drawn.
//
// The copy of a dragged element used to be placed beside the element, so the
// stylesheet rules that reach it through its ancestors would still apply. That
// also kept it inside every one of those ancestors' stacking contexts and
// clipping boxes, so it slid under the next panel, the dock or the tab bar,
// and was cut off at a scroller's edge. Each new container needed its own
// z-index or overflow fix, the problem the tooltip layer was built to end.
//
// So the drag picture gets its own layer, like tooltips: one fixed element per
// app, mounted inside `.app-saturate-wrapper` so the wrapper's filter still
// applies, and stacked under the glaze (interaction.css) so the glaze still
// grades it like the rest of the app.
//
// THE COPY KEEPS ITS CONTEXT. Out in the layer no ancestor's rules would reach
// it, so it is placed inside SHELLS: a shallow copy of each of the source's
// ancestors (tag, classes and attributes), displayed as `contents`. A shell
// generates no box, so it paints nothing and clips nothing, but selectors
// still match through it and inherited values (colour, font, the theme's
// custom properties) still flow down it, so the browser styles the copy
// exactly as it styles the original. The exception is an ancestor that is a
// size CONTAINER, which container units (`cqw`) inside the copy are measured
// against: that shell keeps a box of the original's size, with nothing of its
// own painted (interaction.css). This costs a clone and a style pass, where
// writing every computed property onto the copy cost about a millisecond per
// element, and a list of "the properties that matter" would drift.
//
// An app that mounts no layer draws the copy on <body>: still whole and on
// top, only without the wrapper's filter and the glaze over it.

let layer: HTMLElement | null = null

/** Registers the app's drag layer; returns its unregistration. One per app. */
export function registerDragLayer(element: HTMLElement): () => void {
  layer = element
  return () => {
    if (layer === element) layer = null
  }
}

/** Where a drag's picture is attached: the registered layer, else <body>. */
export function dragLayerHost(): HTMLElement {
  return layer ?? document.body
}

/** The class every shell carries, for the rules that keep it from painting. */
export const DRAG_SHELL_CLASS = 'drag-layer-shell'

/**
 * Attributes a copy never carries: what addresses the original (`id`), what
 * makes it a drag source or a target, and the pointer's transient state, so
 * the copy shows the element at rest rather than whatever the pointer was
 * crossing as it was picked up.
 */
const DROPPED_ATTRIBUTES = ['id', 'tabindex', 'role', 'data-drag-source', 'data-drag-picture', 'data-drag-state', 'data-hovered', 'data-pressed']

function stripped<T extends Element>(element: T): T {
  for (const name of DROPPED_ATTRIBUTES) element.removeAttribute(name)
  for (const marked of element.querySelectorAll('[data-hovered], [data-pressed], [id]')) {
    marked.removeAttribute('data-hovered')
    marked.removeAttribute('data-pressed')
    marked.removeAttribute('id')
  }
  return element
}

/**
 * A copy of `source` inside shells of its ancestors, ready for the drag
 * layer: `attach` is the outermost shell (what is attached), `copy` the copy
 * itself (what is positioned). Canvases are redrawn, since a clone of one is
 * blank.
 */
export function copyInContext(source: HTMLElement): { attach: HTMLElement; copy: HTMLElement } {
  const copy = stripped(source.cloneNode(true) as HTMLElement)
  copy.setAttribute('aria-hidden', 'true')
  const canvases = source.querySelectorAll('canvas')
  if (canvases.length > 0) {
    const copies = copy.querySelectorAll('canvas')
    canvases.forEach((original, index) => {
      const canvas = copies[index]
      canvas.width = original.width
      canvas.height = original.height
      canvas.getContext('2d')?.drawImage(original, 0, 0)
    })
  }
  let attach: HTMLElement = copy
  for (let ancestor = source.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const shell = stripped(ancestor.cloneNode(false) as HTMLElement)
    shell.classList.add(DRAG_SHELL_CLASS)
    shell.removeAttribute('style')
    // Inline custom properties (a theme's variables set on the app's root)
    // are inherited like any value, so they are carried; nothing else inline is.
    for (let index = 0; index < ancestor.style.length; index += 1) {
      const name = ancestor.style[index]
      if (name.startsWith('--')) shell.style.setProperty(name, ancestor.style.getPropertyValue(name))
    }
    const style = getComputedStyle(ancestor)
    if (style.containerType && style.containerType !== 'normal') {
      // Container units measure the container's CONTENT box, and the shell
      // has no padding or border of its own, so it takes that box's size.
      shell.setAttribute('data-drag-shell-box', '')
      shell.style.width = `${ancestor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`
      shell.style.height = `${ancestor.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)}px`
    }
    shell.appendChild(attach)
    attach = shell
  }
  return { attach, copy }
}
