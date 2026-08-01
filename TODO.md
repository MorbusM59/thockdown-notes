# TODO

- [-] Align edit and render viewport
- [x] Add render-mode in-note search
- [x] Sort date menu by edited
- [ ] Refine editor input focus behavior
- [ ] `DatabaseService.sanitizeDatabase()` (startup notes_fts dedupe + conditional VACUUM, see `docs/large-document-performance-handover.md`'s newest session) has only been manually verified once against one real database — watch for its `[db] startup sanitation` log across a few real launches before considering it fully trusted.

## Split-view rough edges (carried over from split-view handover doc)
- [ ] `editorStageRef` (App.tsx) is one shared ref across all sections for the background-texture-sizing `ResizeObserver`; it only ever tracks whichever section's stage DOM node mounted/updated last.
- [ ] `pendingViewportRestoreRef`/`isApplyingInitialViewportRef` are shared across sections, so one section's viewport-restore-in-progress window can transiently suppress another's save.
- [ ] In `npm run dev:browser`, `appShellWidthPx` was once observed stuck at a stale, too-narrow value after a sequence of interactions, hiding the "+" button even with room. Never root-caused; may be a browser-mock-only artifact.
- [ ] Hibernation rendering has never been exercised with real N>1 typing load — confirm inactive sections actually stop wiring live-typing listeners.
- [ ] Cold-start restore with 2+ sections has only been verified via browser-mock reloads, not an actual Electron app restart.
