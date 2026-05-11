# Measly Notes — User Guide

## Overview
Measly Notes is a Markdown-first desktop note-taking application built with Electron and React. It is designed for fast note capture, structured tagging, searchable history, and seamless editing with automatic persistence.

The app centers on three primary areas:
- **Sidebar** for navigation, search, and view modes
- **Editor** for writing and previewing Markdown notes
- **Tag & Suggested Tag panels** for note organization
- **Timeline / Time Machine** for snapshot history and recovery

---

## Main Workflow

### Opening and selecting notes
- The sidebar always lists notes in the current view mode.
- Click a note in the sidebar to open it in the editor.
- The app remembers the last edited note and restores it on launch.
- If no notes exist, start by creating a new note.

### Creating a note
- Press `Ctrl+N` to create a new note.
  - The note opens with `# ` pre-filled on the first line.
  - This first line becomes the note title when saved.
- Press `Ctrl+Shift+N` to create a new note from clipboard text.
  - The clipboard text becomes the note title.
  - The editor cursor is placed on the second line so you can continue writing immediately.

### Writing notes
- Type Markdown directly in the editor.
- The first heading line beginning with `# ` is extracted as the note title.
- Notes are saved automatically as you write.
- The editor supports live Markdown preview mode.
- Use `Escape` to toggle between edit and preview.

---

## Editor & Preview

### Markdown editing
- The editor is a text-based Markdown editor with custom highlight and caret styling.
- The first line of the document is treated as the note title.
- Subsequent lines are note content.

### Preview mode
- Preview renders Markdown using GitHub Flavored Markdown (GFM).
- When switching to preview, the app forces a save so the displayed content is current.
- The preview shows rendered headings, lists, links, tables, code blocks, and formatting.

### Auto-Save behavior
- Auto-save is enabled by default.
- Typing is saved automatically after a short pause.
- Auto-save temporarily pauses while you are editing the first line/title.
- This improves title editing without saving incomplete titles mid-typing.
- The auto-save button in the utility panel toggles this feature.

---

## Note organization

### Tags
- Notes can be tagged using the Tag input panel.
- Add tags by typing text and pressing `Enter`.
- Tags are normalized to lowercase and spaces are replaced with hyphens.
- The first tag becomes the primary tag, the second becomes secondary, and so on.
- Tags are stored in the database and used for organization, search, and category views.

### Managing tags
- Click a tag once to arm deletion.
- Click the armed tag again to delete it immediately.
- Drag tags to reorder them.
- Protected tags like `deleted` and `archived` cannot be created from the tag input and are managed through sidebar actions.

### Suggested tags
- The suggested tags panel shows popular tags you have used previously.
- Click a suggested tag to add it to the current note.
- Suggested tags exclude tags already assigned to the note and protected tags.

---

## Navigation and views

### Sidebar view modes
The sidebar supports several view modes:
- `Latest` — chronological note list by updated date
- `Active` — category-style organization by tag hierarchy
- `Archived` — notes grouped by archive tags
- `Trash` — soft-deleted notes ready for purge or recovery

### Date filters
- In date mode, the sidebar supports filtering notes by month and year.
- Left-click to include a month or year.
- Right-click on clear controls to reset filters.

### Search
- Search supports both text and tag lookups.
- Plain text searches note titles and content.
- `#tagname` searches notes by tag.
- Results show snippets with matching context.

---

## History & Timeline

### Time Machine snapshot timeline
- The timeline represents note save history.
- Each box corresponds to a saved snapshot.
- The rightmost box is the present state.
- Older snapshots appear to the left.

### Navigating snapshots
- Left-click a snapshot to view that saved revision.
- If multiple snapshots overlap, a flyout lets you choose the exact one.
- Right-click a snapshot once to arm deletion.
- Right-click the same snapshot again to permanently remove it.

### Manual snapshot trigger
- When viewing history instead of the present state, click the present box to return to the latest version.
- When already at the present state, clicking the present box creates a manual snapshot.

---

## Utility actions

### Available utility buttons
- **Sync** — sync the data folder if external synchronization is configured
- **Import** — import notes from an external folder
- **Export PDF** — export the current note as a PDF
  - Shift-click the PDF button to choose an export folder
- **Empty Trash** — permanently purge trashed notes
  - Click once to arm purge, then click again to confirm

### Auto-save toggle
- The history/auto-save button toggles automatic saving on and off.
- A context menu on this button allows editing the timeline `log base` value.
- Log base adjusts how the timeline shows snapshot spacing.

---

## Notes lifecycle

### Archiving and trash
- Notes can be moved to archive and trash via sidebar or note actions.
- Archived notes are still available but separated from active notes.
- Trash holds notes marked for deletion until purged.
- The Trash view allows review before permanently deleting.

### Deleting notes
- Deletion is confirmed by the app’s two-step arm-and-click flow.
- This prevents accidental removal of notes.

---

## Useful shortcuts
- `Ctrl+N` — create a new blank note
- `Ctrl+Shift+N` — create a new note from clipboard title
- `Escape` — toggle edit/preview mode

---

## Data storage and persistence
- Notes are stored locally in the app’s user data folder.
- The app persists layout preferences like sidebar width and editor preview mode.
- Tags and note metadata are stored in a local SQLite database.
- Notes may also be written to markdown file storage within the app data folder.

---

## Getting familiar quickly
1. Create your first note with `Ctrl+N`.
2. Add a title using the first line with `# `.
3. Write content below the title.
4. Add tags in the Tag panel to organize the note.
5. Click the Timeline boxes to inspect history and recover previous versions.
6. Use the sidebar view modes to switch between latest notes, active categories, archived notes, and trash.

---

## App structure for new users
- **Sidebar**: primary navigation and search
- **Editor**: Markdown editing and preview
- **Tag input**: active tags management
- **Suggested tags**: quick tag assignment
- **Timeline**: history snapshots and recovery
- **Utility panel**: sync, import, PDF export, trash purge, and auto-save controls

This guide is designed to help new users understand the app’s workflow and find features quickly.
