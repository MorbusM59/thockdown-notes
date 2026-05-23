# V2 Parity Checklist

Use this checklist as the single source of truth for parity and stability. Do not skip unchecked items.

## A. Process Control
- [x] Master execution map exists.
- [x] Session handbook exists.
- [x] Current phase and objective reviewed at session start.
- [x] Session end update completed (map + checklist + handbook).

## B. Editor Contract (Phase 1)
- [x] Editor adapter interface defined in TypeScript.
- [x] Canonical text model semantics defined (line breaks, normalization, title-line behavior).
- [x] Selection semantics defined (global indices, collapsed/range rules).
- [x] Viewport semantics defined (fixed-focus, manual boundaries, scroll authority).
- [x] Event semantics defined (onTextChange, onSelectionChange, onViewportChange).
- [x] Save/restore semantics defined (selection + viewport + content).
- [x] Contract examples documented for integration points.

## C. Fixed Focus Stability (Phase 2)
- [x] Enter at/near top boundary behaves deterministically.
- [x] Enter at/near bottom boundary behaves deterministically.
- [x] Rapid key repeat does not desync caret and text.
- [x] Undo/redo maintains consistent caret and viewport behavior.
- [x] No forced browser behavior fight that causes flicker or jump.

## D. Visual Alignment (Phase 3)
- [x] Glyph advance aligns to grid cell width.
- [x] Baseline and row height alignment are stable across content.
- [x] Custom caret aligns to glyph grid in empty and non-empty lines.
- [x] Selection highlight does not break alignment perception.
- [x] Resize/font-ready/initial render keep alignment stable.

## E. Persistence Spine (Phase 4)
- [ ] Main/preload IPC contract for note lifecycle restored.
- [ ] DB model compatibility and migration path documented.
- [ ] Markdown file persistence path restored.
- [ ] Autosave cadence and title-aware save behavior restored.
- [ ] Last-edited note and UI state persistence restored.

## F. Feature Carryover (Phase 5)
- [ ] Sidebar view modes restored (latest/active/archived/trash).
- [ ] Search restored (text + #tag).
- [ ] Tag model restored (add/remove/reorder/protected tags).
- [ ] Suggested tags restored.
- [ ] Timeline/time machine restored.
- [ ] Utility actions restored (import/export/pdf/trash controls).
- [ ] Keyboard shortcuts restored (Ctrl+N, Ctrl+Shift+N, Escape).

## G. Hardening (Phase 6)
- [ ] Performance baseline measured and accepted.
- [ ] Stability baseline measured and accepted.
- [ ] Error paths and recovery behavior validated.
- [ ] Packaging metadata and product identity finalized.

## Completion Definition
Project is complete only when all checklist items are checked and no open blockers remain in the session handbook.
