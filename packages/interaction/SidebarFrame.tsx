/**
 * THE SIDEBAR FRAME, which both apps draw their sidebar in: the panel the
 * content scrolls in (with its texture layer, which scrolls with it), the
 * dock below the panel, and the scrollbar slot beside them. The view
 * selector and anything else above the frame are the app's, drawn before it.
 *
 * The scrollbar is a slot rather than a component because the platforms draw
 * it differently (the desktop's canonical scroll rail, the phone's page
 * scrollbar); a wheel over the slot is the app's to hand to its scroller.
 * Styles: sidebarFrame.css.
 */
import type { ReactNode, Ref, WheelEvent } from 'react'

export interface SidebarFrameProps {
  /** The panel scrolls itself (a scrollbar beside it); otherwise its content does (a tree or a list with its own scroller). */
  panelMode: boolean
  contentRef?: Ref<HTMLDivElement>
  textureRef?: Ref<HTMLDivElement>
  /** Below the panel: the docks. */
  dock?: ReactNode
  /** In the scrollbar slot. */
  scrollbar?: ReactNode
  onScrollbarWheel?: (event: WheelEvent<HTMLElement>) => void
  children: ReactNode
}

export function SidebarFrame({ panelMode, contentRef, textureRef, dock, scrollbar, onScrollbarWheel, children }: SidebarFrameProps) {
  return (
    <div className={`sidebar-scroll-frame${panelMode ? '' : ' is-tree-mode'}`}>
      <div className="sidebar-content-column">
        <div className="sidebar-wrapper">
          <div className={`sidebar-content${panelMode ? ' is-scrollbar-mode' : ' is-tree-mode'}`} ref={contentRef}>
            <div ref={textureRef} className="sidebar-content-texture" />
            {children}
          </div>
        </div>
        {dock}
      </div>
      <aside className="sidebar-scrollbar-slot" aria-hidden="true" onWheel={onScrollbarWheel}>
        <div className="sidebar-scrollbar-slot-inner">{scrollbar}</div>
      </aside>
    </div>
  )
}
