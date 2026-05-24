# V2 Sidebar View Architecture

## Purpose
Define canonical view naming and behavior for sidebar navigation so implementation, documentation, and UX language remain consistent.

## Canonical View Labels
- Date
- Category
- Archive
- Trash

## Internal Mode IDs
- `date`
- `category`
- `archive`
- `trash`

These IDs are canonical for code-level state, filters, tests, and IPC payload references where applicable.

## Behavioral Contracts

### Date View
- List notes in strict descending last-modified order.
- Include a compact two-line filter rail for month and year (V1 parity behavior).
- Exclude notes carrying protected tags `archived` and `deleted`.

### Category View
- Render hierarchical categorized navigation by tag position:
  - Primary tags as top-level groups.
  - Secondary tags as expandable sections beneath primary.
  - Tertiary tags as section headers above note lists.
- Exclude notes carrying protected tags `archived` and `deleted`.

### Archive View
- Use the same hierarchical structure as Category View.
- Include archived notes only.
- Exclude deleted notes.

### Trash View
- Render deleted notes in a date-ordered list, matching Date View list behavior.
- Include notes carrying protected tag `deleted`.

## Terminology Boundaries
- Top-level navigation uses Date/Category/Archive/Trash only.
- `tag` / `tags` terminology is reserved for note classification metadata and tag-management workflows.
- Do not use `tags` as a top-level view label.

## Migration Mapping From V1 Terms
- `latest` -> `Date`
- `active` -> `Category`
- `archived` -> `Archive`
- `trash` -> `Trash`

## Architectural Constraint
Placeholders are acceptable only when they preserve this final architecture:
- final view names,
- final inclusion/exclusion rules,
- final extension seams for date filters and category hierarchy.

No placeholder should require structural rewrite to reach final form.
