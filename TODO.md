# TODO

- [-] Align edit and render viewport
- [x] Add render-mode in-note search
- [x] Sort date menu by edited
- [ ] Refine editor input focus behavior
- [ ] Render-view continuous Page Up/Down (held key) coasts at the wrong speed — regressed at
      some unknown point, not caused by the large-document-performance work. Per the user: the
      coasting speed used to be derived from an actual calculation (max lines scrollable within
      the available time, depending on the size of the "mid section" in edit mode), not a fixed
      constant — that calculation broke at some point in history and hasn't been found yet.
      Today's code (`usePreviewScrollbar.ts`'s `runPreviewContinuousScroll`/
      `startPreviewReleaseRampDown`, both calling `resolveApexSpeedPxPerSecFromCurrentParams` in
      `src/editor/ScrollCurvePlan.ts`) derives cruise speed purely from the curve's own shape
      parameters for a fixed proxy distance (`scroller.clientHeight * 0.9`) — that function's own
      doc comment says it returns "the natural (unclamped) bell apex speed," and it never reads
      `renderScrollMaxSpeedPxPerSec` (the max-speed slider setting) at all, so the slider has no
      effect on continuous-scroll coasting speed. **A quick fix substituting
      `getRenderScrollMaxSpeedPxPerSec() * CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER` for that call
      was tried and reverted** — it produced the numerically-expected speed in an automated test,
      but made the real crawl *worse* in live use, meaning that substitution doesn't reflect
      the original design and shouldn't be retried as-is. Needs `git log -p` /
      `git bisect`-style archaeology to find when the lines/available-time/mid-section
      calculation was replaced with the current fixed-curve one, rather than reconstructing it
      from scratch by guessing.

- [ ] CM6Editor (production editor as of 0.5.4) has no empty-note placeholder text ("Jot down a
      thockdown note...") the way the Lexical editor's `Editor.tsx` does — noticed while porting
      the fontReady/caretSuspended flash-gating for the production flip, not fixed as part of it
      since it's an unrelated pre-existing gap in the CM6 port.

## Split-view rough edges (carried over from split-view handover doc)
- [ ] `editorStageRef` (App.tsx) is one shared ref across all sections for the background-texture-sizing `ResizeObserver`; it only ever tracks whichever section's stage DOM node mounted/updated last.
- [ ] `pendingViewportRestoreRef`/`isApplyingInitialViewportRef` are shared across sections, so one section's viewport-restore-in-progress window can transiently suppress another's save.
- [ ] In `npm run dev:browser`, `appShellWidthPx` was once observed stuck at a stale, too-narrow value after a sequence of interactions, hiding the "+" button even with room. Never root-caused; may be a browser-mock-only artifact.
- [ ] Hibernation rendering has never been exercised with real N>1 typing load — confirm inactive sections actually stop wiring live-typing listeners.
- [ ] Cold-start restore with 2+ sections has only been verified via browser-mock reloads, not an actual Electron app restart.
