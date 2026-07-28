# Large-Document Editor Performance — Handover

Written for a fresh Claude Code conversation picking this up mid-stream. Not part of the
project's own `docs/V*` ledger (that's a different, earlier rewrite-phase sequence) — this
is scoped specifically to editor/preview performance under large notes, and can be deleted
once that's addressed and folded into whatever the project's normal docs become.

## Where this came from

A prior session fixed input lag from **held-key autorepeat** (Backspace/Delete, or any held
printable key) — lag that scaled with *typing speed*, on notes of any size. That work
shipped as four merged PRs, in order:

- **#14** — `deferPreviewOnRapidInput` toggle: coalesces the preview-driving
  `setActiveNoteText`/`setEditorTextVersion` commit onto a single `requestAnimationFrame`
  during a `user-input` burst, instead of firing once per keystroke. Opt-in setting,
  Sidebar → Performance section. `src/editorSection/useEditorSectionMount.ts`.
- **#15** — Fixed the caret disappearing off-screen on a run of spaces (`white-space:
  pre-wrap` → `break-spaces !important` in `src/index.css`; unrelated to the rest of this,
  found while testing #14).
- **#16** — Split the markdown preview into independently memoized per-block
  `ReactMarkdown` calls (`src/editor/PreviewBlockSplit.ts`), so editing one paragraph no
  longer reparses/reconciles the whole note. Blocks split at remark's own AST boundaries
  (never mid-list/table/code-fence), with cross-block propagation of link-reference and
  footnote definitions so those still resolve.
- **#17** — Folded `deriveNoteTitleFromText`'s O(document length) title re-derivation into
  the *same* rAF from #14 — it was running unconditionally on every keystroke, bypassing
  that toggle entirely.

That axis (typing-speed-driven lag) is done. **This doc is about the other axis: a note
large enough that a single frame's worth of work exceeds budget regardless of how fast you
type** — pasting a huge document, opening a huge note, or just holding a key inside one that
already has thousands of lines.

## What's already fixed, don't re-audit these

- Preview pane: per-block memoization (#16) means an edit to one paragraph costs O(1), not
  O(document length), for the *reconciliation* step specifically — regardless of note size.
- `SyntaxHighlightPlugin` (`src/plugins/SyntaxHighlightPlugin.tsx`) uses Lexical's own
  `registerNodeTransform`, which is inherently dirty-node-scoped by the framework itself
  (never a whole-document walk), plus a value-equality check before touching the DOM. This
  is the reference example of "let the framework do the incremental work" in this codebase.
- `TypingSoundManager` (`src/sound/TypingSoundManager.ts`) already bounces a held key's
  *first* press synthesis into a cached single buffer so every later repeat of that same key
  hits a fast path instead of re-synthesizing.
- `queueSave` (`src/editorSection/useNoteSaveQueue.ts`) is properly debounced (350ms); the
  per-keystroke cost is just a cheap regex normalize, not the actual disk write.

## What's genuinely still open

**The real remaining hot spot**: `readCanonicalRootText()` in
`src/plugins/ContractBridgePlugin.tsx` still does a full `root.getChildren().map(child =>
child.getTextContent())` walk — O(document length) — on **every** Lexical update tick,
completely bypassing `deferPreviewOnRapidInput`. That toggle only gates what happens
*downstream* of this function (the preview/title commit); the reconstruction itself runs
before the gate is even checked, and it also fires a second time per plain-character
keystroke inside the `KEY_DOWN_COMMAND` handler's character-insert-transform check. For a
document large enough (many thousands of lines), this alone could threaten frame budget —
this is the actual target for "held key inside a huge note."

**Already attempted and reverted — do not redo this specific approach.** The natural-seeming
fix is to cache each top-level paragraph's text, keyed by comparing the paragraph *node
object* to what was seen last tick (same object ⇒ reuse cached text, skip
`.getTextContent()`). **This is unsound and was proven wrong live, not just in theory.**
Confirmed in Lexical's own source (`getWritable()` in `node_modules/lexical/Lexical.dev.mjs`):
editing a `TextNode` only clones *that node* — `getWritable()` does not cascade a clone up to
the parent `ParagraphNode`. The parent is merely marked in `dirtyElements`
(`internalMarkParentElementsAsDirty`), but keeps the *same object reference* across edits to
its own child. So "same paragraph object as last tick" does **not** mean "paragraph text
unchanged." Live repro: typing "Alpha paragraph" character-by-character with this cache in
place left the DOM correctly showing "Alp" after three keystrokes while the cached canonical
text stayed stuck at `"A"` — a silent divergence between what's on screen and what the app
thinks the note contains, i.e. a data-loss bug, not a perf bug. It shipped past unit tests
because those tested the pure caching function against a *wrong* mental model of Lexical
internals, not the real integration — a live-browser check is what caught it.

The *correct* signal for this is Lexical's own `dirtyElements`/`dirtyLeaves` (from
`registerUpdateListener`'s payload — confirmed present in `LexicalEditor.d.ts`, not a private
API), which does reliably reflect "something in this subtree changed" regardless of object
identity. The complication, and the reason this wasn't pushed through anyway: that dirty
info is only available inside `registerUpdateListener` itself. Four *other* call sites in
the same file — the Tab-transform, character-insert-transform, markdown-shortcut-transform,
and Enter-transform command handlers — all call the same `readCanonicalRootText()` to read
canonical text *before* their own edit commits, for transform-checking purposes, and none of
them have that dirty info the same way. Doing this properly means redesigning how this file
tracks "current text" across those five call sites, not a contained one-function fix — and
the failure mode for getting it wrong is silent text corruption. If picking this up: start by
deciding whether the four pre-commit call sites can be satisfied by reading
`previousTextRef.current` (already held by this component, trivially correct, zero new
assumptions) instead of re-deriving canonical text at all — that alone would cut the
per-plain-character-keystroke cost roughly in half with zero risk, even before touching the
`registerUpdateListener` walk itself.

**Not investigated at all yet — two candidate paths for genuinely huge notes:**

1. **Move markdown parsing to a Web Worker.** Strongest guarantee (a slow parse literally
   can't compete with keystroke handling on the main thread), but real integration cost:
   `src/editorSection/usePreviewScrollbar.ts`'s custom-scrollbar sync, and the source-anchor
   resolution in `src/editor/EditRestoreMath.ts` / `src/editor/PreviewScrollAnchor.ts`
   (`resolvePreviewSourceAnchorFromContainer`, `findPreviewSourceAnchorElement`), all assume
   *synchronous* DOM access to the already-rendered markdown (`querySelectorAll` for
   `[data-source-line]` elements happening in the same tick as the edit). Moving the parse
   off-thread turns rendering into an async round trip, and those call sites would need
   rethinking.
2. **Virtualize the preview pane** (render only visible blocks + a buffer, à la
   react-window). Reduces DOM node count and initial-mount cost to O(viewport), not
   O(document length) — the per-block split from #16 doesn't help here, since it still
   mounts every block regardless of whether it's on screen. Same complication as above: the
   source-anchor and scrollbar-sync code currently assumes every block is in the DOM at all
   times; virtualizing would need those made virtualization-aware.

## Recommended first action

**Don't write code first — measure.** This whole thread's discipline was verify-live-before-
and-after, not assume; that matters even more before investing multiple days in a worker or
virtualization rewrite. Before picking a path:

1. Generate or paste a genuinely large note (start around 5,000–20,000 lines) into a live
   `npm run dev:browser` session driven by Playwright (Chromium binary in this environment:
   `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, launched via the global `playwright`
   package — see below).
2. Bracket `performance.now()` around (a) note switch/initial mount, (b) a single
   `registerUpdateListener` tick during a held-key burst, (c) pasting a large block into an
   already-large note. Get real numbers for where the time actually goes: the
   `readCanonicalRootText` walk, the `PreviewBlockSplit` structural pre-pass, or the
   per-block `ReactMarkdown` calls for whichever blocks changed.
3. Only then decide: if (b) dominates, the `dirtyElements` rework or the cheap
   `previousTextRef.current` partial fix (see above) is the target. If (a)/(c) or DOM node
   count dominates, virtualization is more relevant than a worker. If parse time itself
   (not React reconciliation) dominates for a single large paste, the worker is the one that
   actually helps.

## Environment notes for the next session

- `node_modules` is not installed by default in a fresh container — run `npm install` (or
  `npm ci`) first.
- Live-browser verification pattern used throughout: `npm run dev:browser -- --port 5183
  --strictPort` in the background, then drive it with Playwright using
  `NODE_PATH=/opt/node22/lib/node_modules node <script>.js` (playwright itself is a global
  package, not a project dependency) and
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })`.
- Verification bar for any change here: `npx tsc --noEmit`, `npm test` (136/136 passing as of
  this writing, no known pre-existing failures), `npm run lint`, **and** a live-browser check
  — the reverted attempt above passed its own unit tests and was still wrong.
- This branch's PRs (#14–#17) were all opened against `main` and merged directly (`merge`
  method, not squash/rebase) once each was independently verified; follow the same pattern
  for any follow-up here rather than stacking onto old branch state.
