## Summary
<!-- What changed and why, in 1-3 bullets. Favor the "why" over restating the diff. -->

-

## Verification tier
<!-- Pick one, per CLAUDE.md's "Verification rigor: match the size of the change". -->
- [ ] **Substantial/structural** — new features, architecture/contract changes, cross-cutting refactors, anything touching editor/scroll/performance-critical code.
- [ ] **Small, well-understood** — isolated bug fixes, cosmetic tweaks, small additions with an obvious blast radius.

### Substantial/structural checklist
<!-- Skip this block for the light tier. -->
- [ ] `tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm test` clean
- [ ] Live-browser Playwright verification (not just code reading)
- [ ] Full existing regression-script suite run, if this touches editor/scroll/performance code
- [ ] A/B check (e.g. `git stash`) proving a fix's own test actually fails without the change

### Small-fix checklist
<!-- Skip this block for the substantial tier. -->
- [ ] Reproduced the issue
- [ ] Applied the minimal fix
- [ ] Verified the fix resolves it with a targeted live check (not just reasoning from code)

## Docs
- [ ] Updated `electron/help/helpReferenceContent.ts` — required whenever this ships a user-facing functional change
- [ ] Updated the relevant living doc, if this touches its area: `docs/document-scale-performance-philosophy.md` + `docs/large-document-performance-handover.md` (performance work), `docs/cm6-parity-hardening-plan.md` (CM6/editor-parity/caret-selection), `docs/editor-contract.md` (editor/app boundary), `TODO.md` (open items)
- [ ] No new point-in-time planning/tracking doc added (fold anything non-obvious into a living doc or `TODO.md` instead — see CLAUDE.md's docs hygiene note)

## Notes for reviewers
<!-- Scope deliberately left out, judgment calls made, follow-ups worth tracking. -->
