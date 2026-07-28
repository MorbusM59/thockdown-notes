# Thockdown Notes — canonical docs

This project's documentation is kept deliberately small. These are the load-bearing documents; nothing else in the repo should be treated as authoritative project doctrine.

## Read first
- [docs/guiding-vision.md](docs/guiding-vision.md) — the product's spiritual guideline: why this app exists and who it's for. Written for the AI agent, not for end users; let it inform judgment calls, don't surface it to users.

## Living documents (update these, not README, when things change)
- [electron/help/helpNoteContent.ts](electron/help/helpNoteContent.ts) — the welcome note seeded into an empty database.
- [electron/help/helpReferenceContent.ts](electron/help/helpReferenceContent.ts) — the in-app `$HELP` reference note. This is the canonical user-facing documentation. **Update it whenever a user-facing functional change ships.**
- [docs/document-scale-performance-philosophy.md](docs/document-scale-performance-philosophy.md) + [docs/large-document-performance-handover.md](docs/large-document-performance-handover.md) — the standing contract and session-to-session handover for the large-document performance effort, currently in progress. Read the handover doc before touching editor/performance code; keep it current when handing off between sessions.
- [TODO.md](TODO.md) — small open-items backlog.

## Architecture contracts
- [docs/editor-contract.md](docs/editor-contract.md) — the boundary between app features and Lexical editor internals.
- [docs/interaction-design-philosophy.md](docs/interaction-design-philosophy.md) — rules for input, caret, scroll, and note-activation behavior.

## README.md
Keep it barebones: version, install instructions, per-OS build instructions, and release-artifact layout only. Anything else (usage, features) belongs in `helpReferenceContent.ts`, referenced from README, not duplicated into it.

## Docs hygiene
Point-in-time planning/migration records (phase trackers, decision ledgers, validation matrices) are not kept once their work ships — the shipped code and the docs above are the source of truth. Don't recreate that pattern; if a doc is a snapshot of a finished effort, fold anything non-obvious into the relevant living doc or TODO.md and delete it rather than archiving it.
