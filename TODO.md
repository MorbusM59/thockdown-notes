# TODO

- [x] Align edit and render viewport (scroll-sync rewrite: single persisted `anchorBlockIndex` per note/snapshot, mode-agnostic restore, see `docs/editor-contract.md`)
- [x] Add render-mode in-note search
- [x] Sort date menu by edited
- [ ] `scripts/perf/verifyScrollSync.mjs` and `perfHarness.mjs`'s `seedLargeNoteAndReload` both wait for `.editor-text[contenteditable]` to become *visible*, but a restored note comes back in render view where the edit pane is hidden — so both time out before doing anything. Confirmed pre-existing by A/B against unmodified code while working on the preview measurement prewarm. Either seed into edit mode explicitly or wait for the preview instead (see `measurePreviewMeasurementCache.mjs`, which does the latter).
- [ ] Refine editor input focus behavior
- [ ] `resolveIdentityLabel`'s derived-snippet fallback is now unreachable in practice: every note and every chapter carries an id (assigned at birth, and backfilled at startup by `sanitizeDatabase` for anything older). It is kept as a defensive floor rather than deleted -- the branch costs nothing, and removing it means changing a shared signature plus the tests that document it. Delete only if something else forces a change there.
- [ ] `DatabaseService.sanitizeDatabase()` (startup notes_fts dedupe + conditional VACUUM, see `docs/large-document-performance-handover.md`'s newest session) has only been manually verified once against one real database — watch for its `[db] startup sanitation` log across a few real launches before considering it fully trusted.
- [ ] Cosmetic only: ~19 of the `scripts/perf/verifyCM6*.mjs`/`measureCM6*.mjs` scripts still set the now-vestigial `localStorage['thockdown:cm6-editor-spike'] = '1'` flag before launching (harmless no-op now that CM6 is the only editor and the flag does nothing — Lexical and its rollback path were fully removed). Not touched during that removal since it's pure cleanup with zero behavior change; strip the lines whenever one of these scripts is next touched for real.
- [ ] On a full app restart, note text in the editor isn't aligned to the grid on initial load (both open sections, if split) — clicking into either editor section fixes it for both. Never root-caused; likely a measurement/layout timing issue on cold mount. The scroll-sync rewrite removed `applySourceAnchorToEditor` (the previously-suspected related mechanism) entirely, so re-check whether this still reproduces before investigating further -- if it doesn't, that was likely the cause.

## Split-view rough edges (carried over from split-view handover doc)
- [ ] `editorStageRef` (App.tsx) is one shared ref across all sections for the background-texture-sizing `ResizeObserver`; it only ever tracks whichever section's stage DOM node mounted/updated last.
- [ ] `pendingViewportRestoreRef`/`isApplyingInitialViewportRef` are shared across sections, so one section's viewport-restore-in-progress window can transiently suppress another's save.
- [ ] In `npm run dev:browser`, `appShellWidthPx` was once observed stuck at a stale, too-narrow value after a sequence of interactions, hiding the "+" button even with room. Never root-caused; may be a browser-mock-only artifact.
- [ ] Hibernation rendering has never been exercised with real N>1 typing load — confirm inactive sections actually stop wiring live-typing listeners.
- [ ] Cold-start restore with 2+ sections has only been verified via browser-mock reloads, not an actual Electron app restart.
