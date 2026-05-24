# V4 Persistence Contract

## Purpose
Define the typed note lifecycle contract between renderer and main process for Phase 4 persistence restoration.

## Scope
This contract currently covers core note lifecycle actions:
- list notes
- load note
- create note
- save note
- delete note
- load app state
- save app state
- load window state
- save window state

Items intentionally out of scope for this contract revision:
- SQLite metadata model and migration
- trash/archive semantics
- timeline snapshots
- selected-note and UI-state persistence contracts

## IPC Channels
Defined in `src/shared/noteLifecycle.ts`:
- `notes:list`
- `notes:load`
- `notes:create`
- `notes:save`
- `notes:remove`

Defined in `src/shared/appState.ts`:
- `state:app:load`
- `state:app:save`
- `state:window:load`
- `state:window:save`

## Payload Types
All payload/result types are shared in `src/shared/noteLifecycle.ts`.

### NoteSummary
- `id: string`
- `fileName: string`
- `title: string`
- `createdAtMs: number`
- `updatedAtMs: number`
- `sizeBytes: number`

### NoteDocument
- `NoteSummary` plus:
- `text: string`

### Inputs
- `LoadNoteInput { id }`
- `CreateNoteInput { initialText? }`
- `SaveNoteInput { id, text }`
- `DeleteNoteInput { id }`

## Runtime Ownership
- Main process registers handlers in `electron/main.ts`.
- Main process delegates file operations to `electron/noteLifecycleService.ts`.
- Main process delegates app/window JSON state operations to `electron/stateService.ts`.
- Preload exposes a narrow API via `window.measlyNotes` in `electron/preload.ts`.
- Preload exposes app/window state API via `window.measlyState` in `electron/preload.ts`.
- Renderer consumes this API from `src/App.tsx`.

## Storage Strategy
- Development: `<repo>/data/notes`
- Packaged app: `<userData>/data/notes`

## Normalization Rules
- Saved text is normalized to LF (`\n`) line breaks.
- Title extraction order:
1. First non-empty `# ` heading line.
2. Otherwise first non-empty line.
3. Otherwise `Untitled`.

## Current Integration State
- Renderer bootstrap chooses most recently updated note as active note if present.
- Renderer bootstrap first attempts to restore `selectedNoteId` from app state and falls back to most recently updated note.
- If no note exists, renderer requests main to create an empty note.
- Renderer debounces text-change saves through `window.measlyNotes.saveNote`.
- Renderer persists `selectedNoteId` via `window.measlyState.saveAppState`.
- Main process restores and persists window bounds/maximized state.

## Validation Status
- TypeScript compile: PASS
- Lint: PASS
- Electron runtime persistence validation: PASS for current scope.
	- PASS: note text persists across close/relaunch.
	- PASS: startup note hydration loads existing content (non-blank editor).
	- PASS: inserted intentional empty lines round-trip without doubled row artifacts.
	- PASS: window position restores on relaunch.
	- PASS: window size restores subject to platform/runtime minimum-size constraints.
	- PASS: editor viewport scroll and separator boundaries restore on relaunch.
	- Deferred: delete/note-management semantics (full UI surface not yet restored in Phase 5).

## Known Fixes Applied During Validation
- Added startup hydration path from loaded note text into editor runtime before autosave event flow.
- Added newline normalization/migration logic to prevent Lexical paragraph-separator doubling from persisting as visual blank rows.
- Added typed app/window state persistence for selected note, window bounds, and viewport separators/scroll.

## Autosave Policy (Current)
- Debounced autosave remains enabled for body/content edits.
- Autosave decisions are made on text-change events only (no predictive caret-position logic).
- If a text change modifies the title segment (text before first newline), that change is held and not immediately saved.
- Non-title text changes use the normal debounced save path.

Note:
- The indicator now displays only the last save timestamp for low-noise runtime visibility.

## DB Compatibility and Migration Path (Documented Baseline)
Current persistence is markdown-file authoritative. DB compatibility path for reintroduction:
1. Define canonical note identity mapping (`noteId` <-> markdown file name).
2. Introduce DB metadata table keyed by `noteId` with immutable created timestamp and mutable updated/title/tag fields.
3. On startup migration pass:
	- scan markdown files,
	- upsert DB metadata from file stat/title extraction,
	- preserve existing DB rows when file exists and timestamps indicate newer DB-side metadata.
4. Enforce single writer policy in main process: renderer never writes DB/files directly.
5. Add reconciliation audit log for conflicts (missing file vs stale DB row) before enabling destructive cleanup.

Exit condition for this item:
- migration algorithm and conflict policy are explicitly documented and implemented behind typed main-process contract.

## Next Contract Increment
- Add error-code semantics for missing/deleted notes.
- Extend UI-state persistence surface as additional V2 panels return (Phase 5).
