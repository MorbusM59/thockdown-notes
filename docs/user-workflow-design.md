# Organizational Workflow Design

## What this document is
The standing design contract for **how a user is meant to organize and retrieve their notes in Thockdown**, and how the UI is supposed to teach them that without ever explaining it.

It is a *living* document and an *active* one: it accompanies incremental UI work rather than describing finished work. Proposed changes are validated against it. When a change is made that the document doesn't cover, or that contradicts it, the document is updated in the same session — either the change is wrong, or the doctrine has moved. Both are legitimate outcomes; silently diverging is not.

It sits below [guiding-vision.md](guiding-vision.md) (the tie-breaker for *why*) and beside [interaction-design-philosophy.md](interaction-design-philosophy.md) (the rules for *feel*). This one owns *structure*: the layers, what each layer is for, and what each layer deliberately cannot do.

Audience: the AI agent and the maintainer. Not user-facing prose. The user-facing expression of everything here lives in `electron/help/helpGuideContent.ts` — see [Obligations](#5-obligations).

---

## 1. The layer model

Thockdown organizes on four layers. Each layer has exactly one job, one home in the UI, and one time-scale it operates on.

| Layer | Scope | Lives in | Time-scale | Job |
|---|---|---|---|---|
| **Chapter** | inside a note | chapter bar | minutes | internal structure of one document |
| **Note** | the unit | editor | the session | the thing you actually write |
| **Section** | a working set of notes | tab bar (+ split panes) | hours/days | everything at your fingertips *right now* |
| **Tag** | a filing dimension | sidebar (Category / Find) | weeks/years | put it away so you can find it again |

The two directions from the note are deliberately mirrored:
- **Below the note** → chapters, *inward*, one document's own spine.
- **Above the note** → sections, *outward*, a workspace of documents.

Tags are not a fifth spatial layer. They're an orthogonal axis: **retrieval**, not **arrangement**.

### 1.1 The core loop
This is the workflow the entire UI should be bending the user toward:

> **Retrieve → assemble → close the sidebar → work.**

1. Open the sidebar. Find notes by date, by category, or by search.
2. Pull the ones you need into sections.
3. **Close the sidebar.** Everything you need is now in the tab bar.
4. Work — moving between notes with tabs, within a note with chapters.
5. Tag anything new so future-you can retrieve it.

Step 3 is the payoff and the tell. **If the user can't comfortably close the sidebar and keep working, the workspace layer has failed.** That is the single sharpest test we have for any change to sections, tabs, or the sidebar, and it should be applied literally: make the change, then try to work with the sidebar shut.

### 1.2 Sections vs. tags — the overlap, resolved
Both group notes. The overlap is intentional (flexibility), but the *intent* must never blur:

- A **tag** is a fact about a note. Durable, cheap, about the note's identity. "This is a recipe." Tags answer: *where does this belong, and how will I find it in six months?*
- A **section** is a fact about *your current attention*. Transient by default, about proximity. "These six things are what I'm doing today." Sections answer: *what do I need within one click, right now?*

Practical consequences that must hold:
- Adding a note to a section must **never** imply, suggest, or perform a tag change.
- Tagging a note must **never** move it into or out of a section.
- Sections are cheap to make and cheap to destroy. Tags are cheap to make and *meaningful* to destroy.
- A named section is the one place the two converge — a workspace the user decided to keep. That's a deliberate escape hatch, not the default path.

### 1.3 Deliberate restrictions
Restrictions are the primary teaching instrument. Every one below is load-bearing: it removes an ambiguity that would otherwise leave the user feeling adrift.

| Restriction | What it teaches |
|---|---|
| Tags apply to notes only — never to sections or chapters | Filing is a note-level fact. Nothing above or below the note gets filed. |
| Sections hold notes, not chapters | The workspace deals in documents, not fragments. |
| Chapters belong to exactly one note | A chapter is spine, not content that floats free. |
| Protected tags (`archived`, `deleted`, `external`, `debug`) aren't freely editable | Lifecycle state is the system's business, not a filing decision. |
| Sidebar clicks land in the default section | There's always one obvious "here" — activation is never ambiguous. |

### 1.4 Slot vs. section — the distinction that keeps getting lost
These are two different things and have been muddled repeatedly, in conversation and in the code. Getting this wrong makes the whole layer model mushy, because it turns one clean chain into a vague "pane that has notes in it".

- A **slot** is a *container in the app's chrome*: one of the side-by-side positions an editor environment can be loaded into. It is furniture. It has a position, a width, and a divider. It holds no notes and remembers nothing about your work.
- A **section** is a *collection of tabs* — a working set of notes (§1.2) that gets **loaded into** a slot. It is content. It has a name, tabs, and a memory of which note it last showed. It exists whether or not it's currently on screen.

A slot is *where*; a section is *what*. A section is not "a pane". A slot is not "a group of notes".

**The activation chain.** Everything the user does resolves through this, in exactly this order:

> user input → **active slot** → the section currently loaded there → **active section** → the note selected in it → **active note**

Each step is *by extension* of the one before. The user never targets a section directly — they target a slot, and the slot funnels input into whatever section it currently holds. This is why "the active note" is a derived fact two levels down, not a global. It also explains the parked-section case cleanly: a named section that occupies no slot still exists, still has its tabs and its last-active note, and is simply unreachable by input until it's loaded into a slot again.

**Placement follows scope.** A control belongs to the bar of the thing it acts on: per-slot controls sit at the slot's own edge in the tab bar, per-note-internals controls in the chapter bar. The edit/render toggle is the worked example — it's a property of the slot, not of one note's structure, so it moved out of the chapter bar to the tab bar's right edge, beside the add-slot `+`. The two then read together as slot-level actions: *this is the writing window; that makes another one.* Placement is doing the teaching that a tooltip otherwise has to.

**Naming rule going forward.** New identifiers, comments, tooltips, and docs use "slot" for the container and "section" for the tab collection, never as loose synonyms. When touching code in this area, fix the vocabulary in what you're already editing — this is a running cleanup, not a migration project.

**Known muddles in current code** (verified; fix opportunistically):
- `EditorSectionEntry`'s JSDoc opens with "One side-by-side editor pane" — that's a slot's description written on the section type. It should describe a tab collection.
- `widthFraction` and `fixedWidthPx` live on `EditorSectionEntry` but are *slot* properties. This is real structural coupling, not just naming: a parked section still carries the width of a slot it no longer occupies.
- `noteSlotInitialized` uses "slot" for a **third** thing entirely — whether the section's active-note memory has ever been set. Worst offender; nothing about a slot is involved.
- `createSection(afterPosition)` creates a section *and* opens a slot in one call; `removeSection` destroys a section while `closeSlot` merely vacates one. The names don't reveal which does which.
- Reads correctly today and shouldn't be "fixed": `computeSlotWidthsPx` (`src/shared/sectionWidths.ts`), the `.editor-section-slot` DOM class, and App.tsx's per-slot gutter-toggle comments, which explicitly reason about a property belonging to "this occupied slot" rather than to any section identity that outlives it.
- The phrase "the sections actually occupying a slot right now, sorted left-to-right" recurs in `App.tsx` as an ad-hoc derivation. That's the *loaded* set — a real concept in this model, worth a name of its own if it's touched again.

### 1.5 Icon language (committed)
One icon per layer, used *only* for that layer. This is how the layer model becomes visible at a glance, so the mapping is exclusive — an icon on this list must never stand for anything else anywhere in the app.

| Layer | Icon |
|---|---|
| **Section** | `fa-book` |
| **Note** | `fa-file` |
| **Chapter** | `fa-bookmark` |

**Creation always uses the layer's own icon, never a generic `+`.** A "new X" affordance — menu item or button — shows X's glyph: new section = `fa-book`, new note = `fa-file`, new chapter = `fa-bookmark`. This holds everywhere, including the create pills that used to be `+` in the chapter bar and the tab bar. A `+` says only "another one of whatever this row is" and makes the user infer the layer from context; the layer glyph says *what* you're about to make, so the same three symbols keep teaching the model at the exact moment the user acts on it.

**The corollary, straight out of §1.4: a slot is not a layer, so adding a slot keeps the generic `+`.** The tab bar's rightmost button opens a new slot — furniture, not content — and using `fa-book` there would say "new section" for an action that is nothing of the kind. The real "new section" action is the section picker's leftmost button (`section-picker-create`), which empties the current slot to a fresh unnamed, tabless, noteless section; *that* is the one that carries `fa-book`. This pair is the sharpest live test of whether the slot/section distinction is being respected in UI work — the two buttons sit in the same bar, and it is easy to give the wrong one the section glyph (already done once).

One position-marker exception: the chapter bar's **base-note pill** uses `fa-house`. It isn't identifying a note among notes — every pill in that bar belongs to the same note — it's marking *where the top is*, the thing you return to from any chapter. "Home" says that; `fa-file` would only repeat what the whole bar already is.

Feature buttons that are *not* one of the three layers take descriptive icons of their own — and one concept keeps one icon everywhere it appears: Table of Contents = `fa-bars-staggered` (both the chapter bar's auto-TOC button and the toolbar's insert-TOC action; *on trial — being lived with before it's called final*), Open Items = `fa-clipboard-list`, edit/render toggle = `fa-pen-to-square`.

**Rule for future work:** a new capability that crosses a layer boundary is presumed wrong. If it's genuinely needed, the boundary itself gets redesigned and this table gets rewritten — the boundary does not get quietly punctured for one feature.

---

## 2. Current implementation (verified against code)

Kept honest so the doctrine above never argues with a stale mental model. Re-verify when touching any of it.

- **Chapters** — `src/chapters/`, `src/shared/chapters.ts`, surfaced in `ChapterBar.tsx`. A section's tab remembers the last chapter it showed (`NoteTabEntry.lastActiveChapterNoteId`, `src/shared/tabs.ts`), so returning to a tab resumes where you were rather than snapping to the note's top. That memory is per-*section*, which is correct: it's an attention fact, not a note fact.
- **Sections** — `src/shared/sections.ts`, `src/editorSection/`, `src/tabBar/SectionTabBar.tsx`. Side-by-side panes, each with its own tab bar and its own `lastActiveNoteId`. `DEFAULT_EDITOR_SECTION_ID = 'default'` is where sidebar clicks always land. **Unnamed sections are disposable** (deleted when their slot closes); **named sections are kept forever** and can be recalled into any slot (`swapIntoSlot`). This naming-as-commitment gesture is the intended expression of §1.2's escape hatch, and it is currently the app's only signal of that distinction — a candidate for clearer UI.
- **Tags** — `src/shared/tags.ts`. Freeform, normalized (lowercased, spaces → hyphens). `PROTECTED_TAGS` carry lifecycle meaning.
- **Category view** — `App.tsx`, `hierarchyFromTags` / `buildHierarchyGroups`. The sidebar's Category mode builds a **three-level tree from tag order**: a note's 1st non-protected tag is its primary group, 2nd its secondary (default `General`), 3rd its tertiary (default `Notes`); untagged notes fall into `Uncategorized`. **Tag order is therefore load-bearing and mostly invisible to the user** — the largest known gap between the model and its presentation (see §4).
- **Sidebar modes** — `date`, `category`, `archive`, `trash`, `find`, `options` (`App.tsx`, `SIDEBAR_MODES`). Date and Category are the two retrieval lenses; Find is the escape hatch when neither lens helps.

---

## 3. How the UI is supposed to teach this

Principles for every UI decision in this space:

1. **Position teaches scope.** Chapters below the note, tabs above it, sidebar outside it. Spatial arrangement should be readable as the layer model without a word of explanation. Anything that breaks this correspondence needs a very good reason.
2. **Affordance asymmetry teaches permanence.** Transient things should *look* light and disposable; durable things should feel like a small commitment. A named section should not look identical to a scratch one.
3. **Absence teaches boundaries.** The absence of a tag control on a section is a lesson. Don't soften a deliberate restriction with a "helpful" shortcut that blurs it.
4. **One obvious path, escape hatches second.** Retrieve → assemble → close sidebar is the highway. Power moves (split panes, named sections, tag-order editing) stay available but must never compete for the beginner's attention.
5. **Never explain in-app what layout could have shown.** Explanatory text in the UI is a design failure that's been paid for in prose. The User Guide exists for depth; the interface itself should be self-evident.

---

## 4. Open refinements

Live backlog, ordered roughly by how much confusion each resolves. Add findings here as they surface; strike them when shipped.

- [ ] **Tag order is invisible but structural.** Category view's entire hierarchy comes from the order of a note's tags, and nothing in the UI says so or makes reordering feel like a real gesture. Sharpest current model/presentation gap.
- [ ] **`Uncategorized` / `General` / `Notes` are silent fallbacks.** They appear as if they were real user categories. They should read as *unfilled*, and ideally be an invitation to file.
- [ ] **Named vs. unnamed sections look alike.** The commitment gesture (naming = keep forever, recallable) is the app's central section concept and it's near-invisible. See §3.2.
- [ ] **The "close the sidebar" moment isn't rewarded or suggested.** Nothing hints that this is the intended destination of the retrieval flow. The loop's payoff is unmarked.
- [ ] **Sections vs. Category groups can read as redundant** to a new user, since both are "a group of notes". Nothing yet distinguishes *now* from *filed* at a glance.
- [ ] **`fa-bars-staggered` for Table of Contents is on trial.** Picked over `fa-list`, replacing the older `fa-bookmark`; to be used for a while before it's considered settled. Revisit.
- [ ] **Slot/section vocabulary cleanup** — the misnomers listed in §1.4, fixed opportunistically as their files are touched. `noteSlotInitialized` and the `EditorSectionEntry` JSDoc are pure renames; the `widthFraction`/`fixedWidthPx`-on-the-section coupling is a real structural question and needs a deliberate decision, not a drive-by rename.
- [ ] **One §1.5 exception left standing, deliberately:** `SidebarOptionsPanel.tsx`'s light-preset icon list uses `fa-regular fa-file` as pure decoration for a theme preset. Judged harmless — it doesn't stand for a note — and left alone.
- [ ] **The User Guide doesn't yet teach the loop.** It documents features; it should teach §1.1 first and features second.

---

## 5. Obligations

For the agent, every session that touches organization UI:

1. **Validate before building.** A proposed change gets checked against §1 (layers), §1.2 (sections vs. tags), §1.3 (restrictions), and the §1.1 sidebar-closed test. Say plainly when a proposal contradicts one of these, and why — that's the whole point of this document.
2. **Update in the same session.** New restriction, changed boundary, resolved refinement → edit this file alongside the code. Don't let it drift.
3. **Sanity-check §2 against real code** before leaning on it. It's a snapshot, and snapshots rot; the code is the truth.
4. **Mirror user-facing changes into the User Guide.** `electron/help/helpGuideContent.ts` is the user-facing expression of this doctrine, and per `CLAUDE.md` it's updated whenever a user-facing functional change ships. A workflow change that doesn't reach the guide is only half shipped.
