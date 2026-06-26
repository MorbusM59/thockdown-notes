# V5 Canonical Data Model

## Purpose
Define the minimum complete data model required to restore full V1 feature coverage in V2 while preserving the V2 architecture rule that markdown files are the source of truth for note content.

## Core Principle
- Markdown note files are canonical for note body content.
- Main process remains single writer for all persistence.
- Indexed or derived stores (SQLite/JSON) are secondary projections used for queryability, timeline, and runtime UX continuity.

## Canonical Entities

### 1) Note Identity and File Record
Required fields:
- noteId: string (stable ID, filename-safe, V2 canonical)
- fileName: string
- filePath: string
- createdAtMs: number
- updatedAtMs: number

Rules:
- `noteId` must remain stable across reload and migration.
- Content truth is always loaded from markdown file.

### 2) Note Metadata Projection (Indexed)
Required fields:
- noteId: string (FK to note identity)
- title: string
- tags: string[]
- lastEditedAtMs: number
- isTemp: boolean
- externalPath?: string
- syncMode?: boolean
- originalEncoding?: string

Notes:
- `title` is derived from markdown content but cached/indexed for fast list/search.
- Protected tags are modeled in tag relation logic, not hardcoded into view state.

### 3) Tag Dictionary and Ordered Note-Tag Relations
Required fields:
- tags: { tagId, name }
- noteTagRelation: { noteId, tagId, position }

Rules:
- Tag names normalized to lowercase, whitespace collapsed to `-`.
- Ordered positions are required for primary -> secondary -> tertiary grouping.
- Protected tags: `archived`, `deleted` (and `temp` where temp-note flow is active).
- Protected tag constraints must be enforced centrally in main process.

### 4) Full-Text Search Projection
Required fields:
- noteId
- indexedTitle
- indexedContent

Required behavior:
- Text and phrase matching over title+content.
- `#tag` search integration against tag relations.
- Snippet extraction with highlighted segments.

### 5) Timeline Snapshot Projection
Required fields:
- snapshotId
- noteId
- content
- timestamp
- isManual

Required behavior:
- Manual snapshot pinning semantics.
- Duplicate suppression and age-aware compaction.
- Per-note snapshot query and deletion.

### 6) Per-Note UI State
Required fields:
- noteId
- progressPreview
- progressEdit
- cursorPos
- scrollTop

Required behavior:
- Resume continuity per note without mutating markdown canonical content.

### 7) Global App/Window State
Required fields:
- selectedNoteId
- viewport (focus boundaries + scroll)
- window bounds + maximized state

Status:
- Already present in V2 JSON state service.

## View Model Data Requirements

### Date View
- Source: notes excluding protected tags `archived` and `deleted`.
- Sort: updatedAt desc.
- Filters: month and year rail.

### Category View
- Source: non-archived, non-deleted notes.
- Grouping: ordered tag positions (primary -> secondary -> tertiary).

### Archive View
- Source: notes with protected tag `archived` and without `deleted`.
- Grouping: same hierarchy rules as Category View.

### Trash View
- Source: notes with protected tag `deleted`.
- Sort/filter: same date-order/filter semantics as Date View.

## Migration and Compatibility Rules
- Preserve markdown files as authoritative content at all times.
- Build/refresh projections from markdown + metadata writes in main process.
- No renderer-side direct persistence writes.
- Reconciliation must be deterministic and auditable (missing file, stale projection, conflicts).

## Obsolete V1 Structures Not Required To Carry Forward
- Numeric autoincrement note IDs as canonical identity (superseded by stable string noteId).
- Separate fileToken identity layer where noteId already guarantees stable filename identity.
- UI architecture labels tied to old view names (`latest`, `active`).

## Still Required From V1 Semantics (Do Not Drop)
- Ordered tag-position hierarchy for Category/Archive.
- Protected-tag semantics (`archived`, `deleted`, temp flow where applicable).
- Snapshot timeline data model and compaction semantics.
- Search/snippet behavior over title/content/tag surfaces.
- Per-note UI-state persistence.

## Implementation Sequence (Planned)
1. Stabilize tag dictionary + ordered note-tag relation contract and write paths.
2. Add per-note UI-state projection contract.
3. Reintroduce snapshot projection contract.
4. Reintroduce indexed search projection and snippet contract.
5. Add reconciliation/import/purge flows with explicit audit outputs.