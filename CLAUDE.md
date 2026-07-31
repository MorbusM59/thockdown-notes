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

## Verification rigor: match the size of the change
Two tiers, chosen by judgment, not by rote:
- **Substantial/structural work** (new features, architecture or contract changes, cross-cutting refactors, anything touching editor/scroll/performance-critical code): gold standard. Live-browser Playwright verification (not just code reading), the full existing regression-script suite, `npm test`, `tsc`/`lint`, and an A/B check (e.g. `git stash`) proving a fix's own test actually fails without it. Update the relevant living doc/JSDoc history.
- **Small, well-understood fixes and extensions** (isolated bug fixes, cosmetic tweaks, small additions with an obvious blast radius): light pipeline. Reproduce the issue, apply the minimal fix, verify the fix actually resolves it (a targeted live check beats guessing from code), done. Don't run the full regression suite or unit test suite out of habit — that cost is disproportionate to a small, isolated change and burns session budget for no added confidence.
When unsure which tier applies, ask rather than defaulting to the expensive path.

## README.md
Keep it barebones: version, install instructions, per-OS build instructions, and release-artifact layout only. Anything else (usage, features) belongs in `helpReferenceContent.ts`, referenced from README, not duplicated into it.

## Docs hygiene
Point-in-time planning/migration records (phase trackers, decision ledgers, validation matrices) are not kept once their work ships — the shipped code and the docs above are the source of truth. Don't recreate that pattern; if a doc is a snapshot of a finished effort, fold anything non-obvious into the relevant living doc or TODO.md and delete it rather than archiving it.
