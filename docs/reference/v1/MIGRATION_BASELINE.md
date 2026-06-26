# V1 -> V2 Database Baseline

## Confirmed Direction

- Restore full V1-style database architecture as the canonical runtime model.
- Keep note body in markdown files.
- Do not persist tags in markdown files during normal operation.
- Persist tags relationally in database tables.
- Include tags in markdown only for explicit export flows.

## Reference Sources

- database.main.v1.ts
- fileSystem.main.v1.ts
- paths.main.v1.ts
- ipc-main.index.v1.ts
- preload.v1.ts
- types.shared.v1.ts

## Migration Goals

- Reintroduce normalized tag model (`tags`, `note_tags`) with stable IDs.
- Reintroduce note metadata fields from V1 schema needed for timeline and restored features.
- Rebuild IPC contracts to map renderer operations to DB operations.
- Keep filesystem writes scoped to note content writes and explicit export operations.
- Decouple tag rename from note file writes.

## Decisions To Reconfirm During Implementation

- Timestamp source of truth:
  - Option A: DB fields (`updatedAt`, `lastEdited`) as in V1.
  - Option B: hybrid with filesystem mtime for selected flows.
- FTS strategy:
  - Retain V1 `notes_fts` model or adapt to current V2 search behavior.
- Sync/reconcile strategy:
  - Restore V1 reconciliation behavior and adapt for V2 note IDs/file naming.

## Non-Goals For First Pass

- Reintroducing every feature UI at once.
- Export implementation details beyond "tags are embedded only during export".

## Suggested Implementation Order

1. Port schema and DB bootstrap.
2. Port core note CRUD metadata behavior.
3. Port tag CRUD/rename/reorder behavior.
4. Wire IPC handlers and preload API.
5. Adapt renderer calls to DB-backed APIs.
6. Add migration path from V2 file-embedded tags to DB tables.
7. Re-enable feature modules (timeline, hierarchy, search).
