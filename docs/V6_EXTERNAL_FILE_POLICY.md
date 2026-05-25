# V6 External File Policy

Status: Active design directive for V2 carryover.

## Scope
This policy defines how files opened from outside the app are represented, edited, synchronized, and converted.

## Canonical Rules
1. Intake sources:
- External files are accepted from explorer/file associations.
- External files are accepted from drag-and-drop into the editor/main area.

2. External identity:
- An opened external file is represented as a temporary note row in the database.
- The protected designation tag is `EXTERNAL` (all caps by policy).

3. Visibility:
- External notes appear in Date view.
- External notes do not appear in Category, Archive, or Trash views.

4. Autosave behavior:
- Editor changes for external notes are autosaved to database snapshot state.
- Autosave must not write to the original external file.

5. Dirty/sync indication:
- If database snapshot content differs from external file content, note is dirty/out-of-sync.
- UX may represent this with save affordance state (implementation-specific).

6. Explicit save behavior:
- Only explicit user save writes snapshot content to the external file.
- A successful explicit save marks external and snapshot content as in-sync at that moment.

7. Conversion to regular note:
- Removing the `EXTERNAL` tag converts the note to regular app note.
- Conversion does not write to the original external file.
- Conversion immediately persists current editor snapshot to a new internal `.md` file.

8. Tag constraints while external:
- External notes cannot receive user tags while `EXTERNAL` is present.
- Protected and conversion semantics are enforced in main-process persistence logic.

9. Timeline behavior:
- V2 intentionally keeps natural timeline integration for external notes.

## Process Constraints
- Main process is the single writer for DB and files.
- Renderer never writes files directly.
- External content handling follows sanitization directives documented in `docs/V1_AMBIGUOUS_DECISIONS_QUEUE.md`.
