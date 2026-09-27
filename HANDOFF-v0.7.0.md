# Handoff: finish the v0.7.0 release (from a cloud session)

Temporary. **Delete this file in the same commit that closes the release out**; `CLAUDE.md`'s docs-hygiene rule applies. Everything durable already lives in `TODO.md`, `docs/release-protocol.md` and the code.

## State of `main`

- The pre-release sweep is merged: bug fixes, the User Guide and welcome-note corrections, and the thunder render cost cut from 32% to 13% of real time with bit-identical output. Lint, `tsc` and 1,735 tests passed at the time.
- `f25828f` is **`Release v0.7.0`**: `package.json` and `package-lock.json` are at 0.7.0. It is **not tagged**. The cloud session's git proxy refused the tag push (HTTP 403), and so did the Actions token when it tried to create the tag through a release. The most likely cause is a repository rule letting only the owner create `v*` tags.
- After the version bump, `main` gained more work, all intended for this release: the cogwheel fix, the render-view reopen freeze fix, note text moved out of the FTS table, and the typing memory-leak fix (below). At the tip, lint and `tsc` are clean and 1,743 tests pass. The regression scripts were compared against the commit before the leak fix: 14 of them fail identically on both, so none of those failures is new (see section 4).
- A failed run of `.github/workflows/release-windows.yml` exists (Actions → "Release from CI" → run #1). It created nothing: no tag, no release, no assets.

## 1. Cut the release

```
git pull origin main
git tag -a v0.7.0 origin/main -m "Thockdown Notes v0.7.0"
git push origin v0.7.0          # starts build-mac.yml
npm run release -- 0.7.0        # tag exists -> skips the bump, resumes
```

Without the tag, `npm run release -- 0.7.0` dies with "version is already 0.7.0 and no tag v0.7.0 exists". Tag `main`'s tip, not `f25828f`: the cogwheel fix came after the version bump and belongs in this release. (Delete this handoff before tagging, or tag the commit that deletes it.) When the script pauses for notes, paste the text below into `release-notes/v0.7.0.md`.

Check the result: the release (Alpha Release #18, a prerelease) should carry a `.dmg`, `.dmg.sha256`, `.exe`, `.zip` and `SHA256SUMS.txt`.

## 2. Release notes (paste as-is)

A big one. **Soundscapes** arrive: a generated soundscape of wind, surf, rain, thunder, running water, fire and wind chimes that plays beside the music, all in one shared space and under one sky. The Escape menu becomes a **dial**, the player gains **sound options** of its own, the wheel learns to **spin**, and large notes open and scroll **without blocking**. Then there is a small secret behind the User Guide button.

## Soundscapes

- **The Soundscapes button in the music player** turns them on or off, and shows the icon of the soundscape it will play. Scroll over it for volume, and right-click it for the next soundscape. Six factory soundscapes are included: Stormy Night, Forest rain, Strong winds, Under water, Campsite and Passing thunderstorm.
- **Settings → Soundscapes** has eighteen channels (noise, rain, thunder, water, fire and chimes), each with a distance and a place in the stereo field, plus a shared **space** (room to valley) and **weather** (gusts and lulls every channel can follow).
- Save your own soundscapes, and export or import them as `.tds` files, the same way layouts travel as `.tdl`.

## Music player

- **Sound options** in the player itself: the headphones button swaps the playlist row for volume, reverb and room size, with mute and bypass switches. Press and hold a number to sweep it, or scroll over the headphones for quick changes.
- **Rewind and fast-forward** scrub across song boundaries, and a 20% click near an edge lands somewhere sensible. Right-click rewind steps back through the last hundred songs.

## The Escape menu

- **Hold Escape** for a dial rather than a grid. Turn it with the arrows, Tab or the mouse wheel. It sounds like the keyboard it is.
- **Right-click the User Guide button** (the graduation cap) for **ThockQuest**, a small choose-your-path adventure played entirely from that dial. Its difficulty and auto-play live in the new ThockQuest section of the settings.

## Reading and scrolling

- **Spin the wheel** and the text keeps scrolling on its own, in both edit and render view (Settings → Scrolling). The wheel step is now measured in lines of text, not pixels.
- **Immersive mode** (`F11` or `Ctrl+Shift+Space`): full screen, just the editor you're in.
- **Large notes** open and scroll without freezing. All the parsing moved off the main thread, and the cogwheel in the sidebar turns while the app is still working on something.
- The **edit/render toggle** now belongs to each slot and sits at the right end of its tab bar.

## Fixes from the release sweep

- Saving an external file no longer marks it as unsaved again after a restart.
- A music scrub no longer ends with an extra 20% jump.
- A fast turn of the wheel in render view no longer travels less than it should.
- Turning soundscapes off and on no longer leaves the old generator running in the background, and thunder costs well under half of what it did.
- Pressing a note card's archive, trash or save button no longer takes the keyboard away from the editor.
- The User Guide and the welcome note were corrected wherever they had fallen behind the app.
- The options cogwheel turns about its own centre instead of wobbling.
- Reopening a large external file in render view no longer freezes the app for seconds.
- Typing no longer leaks memory. Every keystroke used to keep a full copy of the note alive until restart, about 2 MB per keystroke on a 2 MB note. Long writing sessions now stay flat.


## 3. Worth checking in the real app

These fixes were verified with tests and in `dev:browser` only, never in a packaged Electron build:

- **Saving an external file** (`useNoteProtectionActions.ts`). Open a `.md` from outside the notes folder, edit it, save, restart. It should not come back marked unsaved. This is the one the browser mock cannot exercise at all.
- **Soundscapes on/off** (`SoundscapeEngine.ts` sends `stop`; the worklet's `process()` then returns false). Toggle soundscapes a few times and confirm the sound stops and restarts cleanly, and that audio-thread CPU does not climb.
- **External file IPC** (`electron/main.ts`) now uses async `fs`. Open, save and import an external file once.
- **Music scrub**: hold rewind to scrub, then release. There should be no extra 20% jump after it.
- **macOS**: hold right-click on a soundscape channel to disable it. It should not solo the channel first, and the next short right-click should still solo. On Windows `contextmenu` fires on release, so this path mattered on the Mac.
- **Reopening a large external file in render view**: drag the same big file in, close it, drag it in again a few times. The cursor should keep moving, and the note should appear without a multi-second freeze (it was ~3.5s per reopen, now ~0.4s in headless Chromium).
- **Options cogwheel**: it is now an SVG (`WorkIndicatorGlyph.tsx`). Check it looks the same at rest in light and dark, and holds still at the centre while it turns.
- **Render-view wheel**: spin, re-spin and fast notches should feel slightly longer than before. They used to lose distance; `wheelNotchTravel.ts` and `wheelSpinProfile.ts` now conserve it.

### The memory-leak fix (largest change, and never run in Electron)

The note's text moved out of React state; see `CLAUDE.md` → `useDisplayedNoteText.ts` for the rule. This touched the editor's hydration path, the notes list, and the main process's note summaries: they now carry `leadLine` instead of the full text, and App's `setNotes` moves the text into a store. Check:

- **Memory:** type in a large note for ten minutes with Electron's task manager (or Chrome DevTools → Memory) open. The renderer should level off, not climb. The automated gate is `node scripts/perf/measureTypingRetention.mjs` (browser mock).
- **Sidebar search** still finds notes by words in their body, not only titles.
- **Labels:** tab, tag-bar and chapter pills still show titles. A chapter with no `## ` first line shows "Missing title".
- **Links into another note** (`$id#anchor`, `§chapter`) still land on the anchor.
- **Time Machine:** browse snapshots and return to the present. The editor and render view must show the snapshot, then the live text.
- **Section buttons** (rename, swap, clear, delete, dock/undock) still work. They now go through `useStableCallbacks`.
- **External-file save while typing:** hold Enter in a large external note, and save during it. No lines should disappear. Two write-backs that could roll the editor back were removed.

## 4. Loose ends needing a decision

All three are written up in full under "Needs a decision" at the bottom of `TODO.md`:

1. The wheel's learned notch size only ever shrinks. A fast trackpad swipe, or possibly double-size zoom, can make a mouse scroll several rows per notch.
2. Stale full-document parses queue up in the worker when a large note's text changes while its first split is pending. The fix is a cancel message in `documentFacts.worker.ts`.
3. `useHeadlineLevelGuard.ts` has had no caller since `58fdfceb`, but several comments still describe it as active. Decide whether to delete it or remount it; see `docs/pending-review-and-removal.md`.
4. `saveNote` sends the whole note back over IPC on every save, which is wasteful now that the renderer keeps note text in its own store (`TODO.md`).
5. Fourteen regression scripts fail on `main`, both before and after the leak fix. Five are early CM6-migration scripts (`verifyCM6Phase2Slice9/11/13/17/20`) and may simply be stale. The others are `verifyEditRowGrid` (a `flushSync` warning), `verifyNoHydrationOverwrite` (+820 characters for 40 Enters), `verifyPreviewBlockGeometry`, `verifyPreviewCharThumb`, `verifyPreviewPrewarmSafety` (render view never shown), `verifyScrollbarSemantics`, `verifyTagBarSuggestionFit`, `verifyScrollBridge` and `verifyModeToggleRoundTrip`. Triage them before relying on the suite as a gate.

Also:

- The `dev:browser` cold-load hooks crash did not reproduce in five tries. It is still open in `TODO.md`, and not claimed fixed.
- `release-windows.yml` has never had a successful run. When dispatched with a tag that already exists, it only edits the release, so the tag rule does not matter there. It also dispatches `build-mac.yml` itself; if the tag push already started one, a second Mac build runs and its upload overwrites the first, which does no harm. Consider dropping that dispatch when the tag already exists, or leave it and note it in `docs/release-protocol.md`.
