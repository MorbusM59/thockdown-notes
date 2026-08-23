// Prose content for the built-in User Guide. Each entry becomes one real,
// protected note in the database: HELP_GUIDE_INTRO_CONTENT is the parent
// note's own body, HELP_GUIDE_CHAPTERS is one chapter per topic (in display
// order). Content only -- seeding lives in helpGuideNote.ts; the ids these
// pair with live in src/shared/helpGuide.ts (shared with the renderer,
// which needs them without needing this ~800 lines of prose).
//
// Internal cross-references use the ordinary, user-facing link syntax
// (`$HELP`, `$HELP#anchor-id`, `$HELP§CHAPTER-ID#anchor-id`) rather than the
// internal-only `@noteId` scheme (see src/shared/internalNoteLinks.ts) --
// that scheme is reserved for auto-generated content (the auto-TOC chapter),
// never hand-authored prose, even prose authored for a system note.
import { HELP_GUIDE_CHAPTER_IDS } from '../../src/shared/helpGuide'

export { HELP_GUIDE_ASSIGNED_ID, HELP_GUIDE_ROOT_ID, HELP_GUIDE_AUTO_TOC_ID } from '../../src/shared/helpGuide'

export interface HelpGuideChapterContent {
  noteId: string
  chapterId: string
  content: string
}

export const HELP_GUIDE_INTRO_CONTENT = `# Thockdown Notes — Help & Reference

Thockdown Notes is a Markdown note-taking app built around a good typing feel -- quick to write in, quick to find your way back through, with a lot of small things tuned so they just work. This page is your home base: a quick orientation below, then a full chapter for everything else, one topic at a time -- open the chapter bar above to browse them.

## Quick Guide

1. **Start a note.** \`Ctrl+N\` (or the file icon in the toolbar) makes a new one. Its first line becomes its title; everything else is content, and it saves automatically as you type.
2. **Switch views.** \`Esc\` toggles between the Markdown editor and its rendered preview, so you can check how your formatting looks.
3. **Keep things findable.** Tag a note from the tag bar, then browse by date, category, or tag from the sidebar -- or search it directly.
4. **Grow a note.** Once it needs sub-sections of its own, split it into chapters from the chapter bar under the tab bar -- each chapter is a full note in its own right.
5. **Make it yours.** The gear icon opens Settings: fonts, colors, sounds, and a lot more to tune to your taste.

That's enough to get going. Everything else -- internal linking, tags, split view, Time Machine, formatting, exporting, and more -- has its own chapter alongside this one.
`

const HELP_GUIDE_CHAPTER_CONTENTS: string[] = [
  `## Notes & Editing

### [Creating Notes](#creating-notes)

> **Where?**
> Toolbar's file icon (left cluster), or \`Ctrl+N\` / \`Ctrl+Shift+N\` from anywhere.

*Starts a new note, either blank or pre-titled from your clipboard.*

- \`Ctrl+N\` creates a blank note pre-filled with \`# \` on the title line.
- \`Ctrl+Shift+N\` creates a note whose title is taken directly from your clipboard, with the cursor placed on line two so you can start writing immediately.

### [Note Titles](#note-titles)

> **Where?**
> The first line of any note's text.

*A note's title is just its first line — no separate title field.*

- A line starting with \`# \` becomes the note's title everywhere in the app: sidebar, tabs, exports.
- A note without a \`# \` first line falls back to showing its content as-is wherever a title would appear.

### [Autosave](#autosave)

> **Where?**
> Runs automatically in the background — no control to find or toggle.

*Your changes save themselves a short moment after you stop typing.*

- Autosave briefly pauses while you're actively editing the title line, so a half-typed title is never saved as the note's name.
- Switching into preview mode forces an immediate save first, so what you see is always current.

### [Edit and Preview Modes](#edit-and-preview-modes)

> **Where?**
> The pen icon at the left of the toolbar, or \`Esc\`.

*Toggles between the raw Markdown you type and the rendered, formatted view.*

- Preview renders GitHub-Flavored Markdown: headings, bold/italic/strikethrough, lists (including task checklists with ☐/☑), tables, blockquotes, syntax-highlighted code blocks, horizontal rules, images, and links.
- A task checklist's box is clickable right there in preview, same as [clicking its caret in edit mode]($HELP§TOOLBAR-FORMATTING#formatting-group) — it's the same checkbox either way, so the note's own text (and edit mode's view of it) updates immediately.
- \`Esc\` also blurs a focused field (like search) before it starts toggling modes, so it's safe to hit repeatedly.

### [Quick Actions Menu](#quick-actions-menu)

> **Where?**
> Hold \`Esc\` for about a quarter of a second, anywhere in the editor area -- works with a note open, an empty editor, or a read-only auto-generated one (Table of Contents, Open Items, the User Guide, ...).

*A small on-editor grid for the note actions you reach for most, without leaving the keyboard.*

- Keeps showing while you hold \`Esc\`; tapping \`Esc\` once more (or clicking outside it) dismisses it without doing anything.
- Navigate with the arrow keys or \`Tab\`/\`Shift+Tab\`, then \`Enter\`/\`Space\` or a click to run the highlighted action. Running any action closes the menu.
- Currently wired up: New Note, New Chapter, Export PDF, Export MD, Help (opens this page -- see [The User Guide]($#the-user-guide)). New Note and Help always work; New Chapter and the two Export actions grey out with no note open (or one that can't take them, like a read-only auto-generated chapter). The remaining grid cells are reserved for future actions.

### [The User Guide](#the-user-guide)

> **Where?**
> The Help button in the Quick Actions Menu above.

*This page, opened as an ordinary (timeless, read-only) note in whichever section you triggered it from.*

- Opens exactly like clicking any note in the sidebar does -- as a temporary tab, replacing whatever that section was showing. Leave it the same way too: pick another note, click a pinned tab, or open a different note from the sidebar. There's no dedicated close gesture any more.
- Browsable with the same chapter bar every note with chapters uses -- click a chapter pill to jump to it, or the bookmark icon for a full table of contents.
- Always render-only: nothing here can be edited, renamed, tagged, archived, or deleted.

### [Scrollbar Navigation](#scrollbar-navigation)

> **Where?**
> The scrollbar track alongside the editor, in both edit and preview mode.

*Left-click jumps straight to a spot; right-click pages up or down, one screen at a time.*

- Left-click anywhere on the track to jump directly to that position.
- Right-click above or below the thumb to page up/down once, the same as pressing \`Page Up\`/\`Page Down\`. Right-clicking on the thumb itself does nothing.
- Hold the right click down to keep paging continuously, just like holding \`Page Up\`/\`Page Down\` on the keyboard. It stops when you release the button, or as soon as the thumb reaches your cursor.

### [Word and Character Count](#word-and-character-count)

> **Where?**
> Beneath the editor, next to the Time Machine slider.

*A live word and character count for the note you're currently viewing.*

- Updates as you type; shown only while a note is open.

### [Line Numbers and Review Flags](#line-numbers-and-review-flags)

> **Where?**
> The list-number icon next to the Word and Character Count panel.

*A toggleable gutter: true (unwrapped) line numbers on the left, a review/warning flag column on the right, both fit into the editor's existing grid.*

- Toggling is per open editor (split-view section) — each section remembers its own on/off state independently, and a freshly opened section always starts with it off. It's not tied to which note or chapter happens to be showing in that section.
- Left-click toggles both columns together, based on whether line numbers are currently shown: off shows both, on hides both. Right-click toggles the review-flag column alone, leaving line numbers as they are.
- Line numbers count actual Markdown source lines, not wrapped visual rows: a long wrapped line gets one number, shown beside its first row, with the rest of its rows left blank.
- Click a line's box in the flag column to mark it for review (\`?\`); click again to escalate it to a warning (\`!\`); click again to go back to \`?\`. Either state tints the whole line (all of its wrapped rows) in the review or warning color. Right-click the box to clear the flag entirely — the only way to remove one.
- Flags are saved permanently per note (or chapter) regardless of whether the gutter is currently shown — toggling the gutter off only hides them, it never deletes them.
- Review and warning colors (plus the gutter's own background) are customizable from Settings alongside the other box colors.
- When a flagged line sits above or below what's currently visible, the flag column's topmost or bottommost box swaps to an up or down arrow — click it (or press Ctrl+Up/Ctrl+Down) to smooth-scroll to and center that flagged line. If the box showing the arrow is itself already flagged, clicking centers that line instead of jumping past it.

### [Spell Check](#spell-check)

> **Where?**
> The spell-check icon in the toolbar's left cluster.

*Underlines misspelled words using your OS's native spell checker.*

- Edit mode and preview/render mode each have their own independent on/off state.
`,
  `## Internal Linking

### [Defining an Anchor](#defining-an-anchor)

> **Where?**
> Typed directly into a note's text, anywhere, in either edit or preview source — or select some text and hit the anchor button (⚓, right behind the link button) or \`Shift+Ctrl+L\`.

*Turns a heading or phrase into a jump target with \`[Anchor Text](#anchor-id)\` — a real link whose destination is never clicked.*

- The bracketed part is the label — shown exactly as written, formatting and all. The \`#anchor-id\` part is just an internal handle: short, no spaces, and separate from the label.
- The anchor button/shortcut needs an actual selection (not just a caret) — it wraps whatever's selected as the label and derives the id from it automatically: lowercased, spaces become hyphens, anything else stripped. Selecting "Two Words" and hitting it gives \`[Two Words](#two-words)\`. It doesn't check whether that id collides with another anchor already in the note — same as typing one by hand, that's on you to keep unambiguous.
- Anchor ids only need to be unique within the note they're defined in.
- Anchors work in both the current note and any note you link to; a link naming an anchor that doesn't actually exist in the target note simply does nothing when clicked, rather than partially navigating.
- The app remembers the note/chapter and id of whichever anchor you most recently set this way (button or shortcut, anywhere in the app) for the rest of the session — see the link button's own prefill below.

### [Assigning a Note Id](#assigning-a-note-id)

> **Where?**
> A quick right-click on any note tab in the tab bar (tabs mode) — the active note's own tab, or any other pinned tab.

*Gives a note a short, memorable id (shown as \`$id\`) so other notes can link straight to it.*

- If you never set one, the app derives a default from the note's title the first time it's needed.
- Ids are case-insensitive and spaces become hyphens — \`$meeting-2\` and \`$Meeting 2\` refer to the same note.
- If the id you type is already taken by another note, a \`-2\`, \`-3\`, … suffix is appended automatically.

### [Linking to Notes and Anchors](#linking-to-notes-and-anchors)

> **Where?**
> Typed directly into a note's text, using standard Markdown link syntax \`[text](destination)\` — or select some text and hit the link button (🔗) or \`Ctrl+L\`.

*One link syntax covers jumping within a note, to another note, or straight to a spot inside another note — the \`$\` always means "go somewhere," never "you are here."*

- \`[text]($#anchor-id)\` — jump to the \`#anchor-id\` anchor in the current note.
- \`[text]($NOTE-ID)\` — open another note by its assigned id.
- \`[text]($NOTE-ID#anchor-id)\` — open another note and jump straight to one of its anchors.
- A bare \`[text](#anchor-id)\` — no \`$\` — always means "define an anchor here," never a link; if you want to link, the \`$\` is required.
- Opening a link to the note that's already active just scrolls to the anchor, without disrupting your place otherwise.
- The link button/shortcut prefills the destination with the last anchor you set (button or shortcut, anywhere, this session) — \`$NOTE-ID§CHAPTER-ID#anchor-id\`, with each part left blank if that anchor wasn't set inside a chapter, or if nothing's been set yet this session. Wraps a selection as the link text the same way the other toolbar buttons do; with just a caret, it inserts \`[link](...)\` with "link" selected, ready to type over.
- This very page works the same way: \`[text]($HELP)\` opens it, \`[text]($HELP§CHAPTER-ID#anchor-id)\` jumps straight into one of its chapters. Every heading in a chapter is already an anchor target, so any one of them can be linked to directly.
`,
  `## Tags

### [Adding Tags](#adding-tags)

> **Where?**
> The tag input field in a section's tab bar, in tag-mode (toggle with the tag icon).

*Types and commits a tag onto the active note.*

- Tag names are normalized automatically: lowercased, spaces become hyphens.
- The first tag you add is the note's primary category; the second is its sub-category — this ordering drives the Category sidebar view.

### [Managing Tags](#managing-tags)

> **Where?**
> The tag chips shown in the tab bar's tag-mode view.

*Removes or reorders the tags already on a note.*

- Click a tag once to arm it for deletion (it highlights); click it again to delete, or move the pointer away to cancel.
- Right-click a tag to rename it in place — the pill itself becomes an editable field, renaming the tag everywhere it's used (not just on this note). Enter or clicking away commits, Escape cancels. Protected tags can't be renamed this way.
- Drag a tag left or right to reorder it relative to the others.

### [Suggested Tags](#suggested-tags)

> **Where?**
> Below the tag input field, in tag-mode.

*A shortlist of your frequently-used tags, one click away from being added.*

- Click a suggested tag to add it instantly to the current note.
- Tags already on the note, and protected tags, are excluded from suggestions.
- Right-click the tag input field to expand the suggested list to fill the whole bar; right-click again (anywhere in the expanded view) to collapse it back.

### [Protected Tags](#protected-tags)

> **Where?**
> Never typed directly — applied automatically by the corresponding action.

*Four reserved tag names (\`archived\`, \`deleted\`, \`external\`, \`debug\`) that track note state rather than your own organization.*

- Set and cleared only through [Archiving and Trash]($HELP§ARCHIVE-TRASH#archiving-and-trash), [Restoring from Archive or Trash]($HELP§ARCHIVE-TRASH#restoring-from-archive-or-trash), [Opening an External File]($HELP§EXTERNAL-FILES#opening-an-external-file), and [Debugging]($HELP§APPEARANCE-SETTINGS#debugging).
- Can't be typed into the tag field directly, and are excluded from the suggested-tags list.
`,
  `## Sidebar & Search

### [Sidebar Views](#sidebar-views)

> **Where?**
> The row of icons at the top of the sidebar.

*Five different ways to browse your notes, switched with one click.*

- **Date** — a flat, chronological list ordered by last-updated time, paginated.
- **Category** — a two-level collapsible tree grouped by primary tag, then secondary tag.
- **Archive** — the same tree layout as Category, restricted to archived notes.
- **Trash** — a flat, paginated list of notes marked for deletion, awaiting purge or restore.
- **Find** — the search view, described below.
- A sixth icon opens Settings, which replaces the sidebar content rather than being a note-browsing view — see [Settings Panel]($HELP§APPEARANCE-SETTINGS#settings-panel).

### [Pagination](#pagination)

> **Where?**
> Bottom of the sidebar, visible only in Date and Trash views.

*Steps through a long, flat list of notes a page at a time.*

- Click the page number to type a specific page and jump to it directly.

### [Search](#search)

> **Where?**
> The search field in the sidebar's Find view.

*Filters your notes by title, content, filename, or tag as you type.*

- Plain text matches a note's title, filename, content, and tags.
- Prefixing the query with \`#\` searches tags only — \`#project\` matches any note tagged \`project\`, or with \`project\` anywhere in a tag name.
- The \`Aa\` button toggles case-sensitive matching.
`,
  `## Split View & Tabs

### [Creating a Section](#creating-a-section)

> **Where?**
> The \`+\` button at the very right edge of any tab bar (not the leading \`+\` pill inside the tab strip itself — that one creates a note instead, see [Pinned and Temporary Tabs](#pinned-and-temporary-tabs)).

*Splits the editor into an additional side-by-side section.*

- Hidden once there's no more room for another 300px-minimum-wide section.
- \`Alt+Left\` / \`Alt+Right\` step between sections directly -- Alt rather than Ctrl so it never collides with the editor's own word-jump caret navigation.

### [Naming and Swapping Sections](#naming-and-swapping-sections)

> **Where?**
> A section's identity tab, in tab-bar mode.

*Gives a section a name so you can swap it in and out of any slot instead of recreating it.*

- Right-click the identity tab to name the current section.
- Left-click a named section's identity tab to open a picker of every other named section — click one to swap it into this slot.
- Right-click a candidate in that picker to delete it permanently; the leading \`···\` pill clears the current slot back to empty (no note, no tabs, no name).

### [Closing a Section](#closing-a-section)

> **Where?**
> The chevron button on the left edge of any non-leftmost section.

*Removes a split-view section entirely.*

- The leftmost section shows the sidebar toggle in this spot instead, since it can't be closed.

### [Tabs and Tags Mode](#tabs-and-tags-mode)

> **Where?**
> The tag icon next to the sidebar toggle, at the left of each section's tab bar.

*Switches a section's identity strip between showing its open-note tabs and its tag editor.*

- The identity tab (section name / picker) only shows in tabs mode — tag mode uses that space for the tag input and assigned tags instead. To give the active note an id while in tag mode, switch back to tabs mode and right-click its tab (see [Assigning a Note Id]($HELP§INTERNAL-LINKING#assigning-a-note-id)).

### [Pinned and Temporary Tabs](#pinned-and-temporary-tabs)

> **Where?**
> A section's tab bar, in tabs-mode.

*Keeps one note open temporarily, or several open permanently, per section.*

- The leading \`+\` pill in the tab strip creates a brand-new note and pins it as this section's own rightmost tab in one step — the quickest way to attach a fresh note to whichever section you're looking at, active or not.
- Clicking a note in the sidebar opens it as a single temporary tab (replacing any previous one). Its label is the note's own \`$id\` if you've assigned one (shown upright), or otherwise a short preview pulled live from the note's own first line (shown in italics, so the two never look alike) — never a placeholder minted on your behalf.
- Holding the click past a short threshold pins it as a permanent tab instead, which stays open alongside others — pinning doesn't assign an id either, it's still whichever of the two labels above already applied.
- A quick right-click on any tab (pinned or temporary) turns it into an editable field for that note's \`$id\` — same as [Assigning a Note Id]($HELP§INTERNAL-LINKING#assigning-a-note-id). Holding the right-click past a short threshold arms it for unpin/close instead; release early and it's a rename, hold it and a follow-up left-click confirms the close (move the pointer away to cancel either way).
- Drag tabs to reorder them; drag a note from the sidebar directly into a tab bar to open it there.
- Each tab remembers which chapter of its note you last had open, per section — switching away and clicking back returns you to that chapter, not always the parent's own base content. This is remembered per tab, not per note, so the same note pinned as a tab in two different sections can be resting on two different chapters at once.

### [Chapters](#chapters)

> **Where?**
> The chapter bar's own trailing \`+\` pill, right below the tab bar -- or the bottom utility bar's New Chapter action (\`Shift+Alt+N\`), which does the same thing.

*Splits a note into sub-notes, browsable from a bar of their own.*

- The chapter bar is always showing for whatever note is open, with or without chapters yet -- there's no manual show/hide toggle, and no need to reach for the bottom utility bar just to start a note's first chapter. Either \`+\` (the chapter bar's own trailing pill, or the bottom utility bar's New Chapter action) creates a new empty chapter and switches straight to it. \`Shift+Alt+N\` does exactly the same thing from the keyboard.
- The chapter bar's first tab is always the parent note itself; every chapter follows in order. Click the parent tab or any chapter pill to switch between them — each keeps and saves its own text independently. Too many chapters to fit scrolls horizontally, fading at whichever edge has more off-screen, same as the tab bar.
- Drag a chapter pill to reorder it among its siblings — same drag-and-drop as reordering pinned tabs or tags: drop directly on another pill to land in front of it, or on the bar's empty space to send it to the end.
- The moment a note has its first chapter, an auto-generated **Table of Contents** chapter appears too — no button to press, it just shows up pinned first in the bar (before every real chapter, not draggable) and disappears again the moment the last real chapter does, the same automatic show/hide the chapter panel itself already does. It lists every heading across the parent and all of its chapters, each one a working link — always, whether or not the parent or any chapter has an assigned \`$id\`/\`§id\`, since it navigates internally rather than through the same link syntax you'd hand-type. Following one lands you in whichever mode you were already in: render view scrolls to the heading, edit mode puts the caret on it, ready to type. The parent's own title sits at the top, bold and unbulleted, apart from the list below it; every \`##\` heading after that — the parent's own, and each chapter's title — is a bullet at the same level, with that heading's own deeper headings nested under it. It's regenerated fresh every time you open it, so it's always accurate without costing anything while you're not looking at it — meaning it's also read-only (anything you tried to type would just be overwritten on your next visit) and opens straight into render view. Since it's a generated view rather than something you write, it has no [Time Machine Timeline]($HELP§TIME-MACHINE#time-machine-timeline) of its own — the present-state circle stays live while viewing it, but re-runs the same regeneration instead of taking a save point (see [Present-State Circle]($HELP§TIME-MACHINE#present-state-circle)).
- An auto-generated **Open Items** chapter appears right after the Table of Contents (same pinned, non-draggable treatment) the moment any checklist item (\`- [ ]\`) anywhere in the parent or one of its chapters is unchecked, and disappears again once none are left anywhere in the family — including whenever the last real chapter itself disappears. It groups every open item under whichever heading it falls under, linked the same way the Table of Contents is — headings with nothing open under them are skipped entirely, so it's a pruned outline, not a full copy of every heading. Unlike the Table of Contents, it isn't regenerated on every visit: it only updates when a checklist item is actually created or its checked state flips, patching in just that one note's own section — so if you're looking at it in one editor while checking something off in another, it can go briefly stale until the next change anywhere in the family refreshes it, or until you click its present-state circle to force a full refresh on demand (see [Present-State Circle]($HELP§TIME-MACHINE#present-state-circle)). Same as the Table of Contents, it's read-only, has no Time Machine Timeline of its own, and opens straight into render view — but its own checkboxes are the one exception to "read-only": clicking one checks the real item off in its own source chapter without removing it from this list, so you can click it again to undo. The list itself doesn't update as you go — it only catches up (dropping anything actually checked off) the next time something elsewhere refreshes it, or when you force one with the present-state circle.
- A chapter is a full note in its own right — its own regular tags don't exist; tags always belong to the parent — but it doesn't appear on its own in Date/Category/Find, only through its one parent's chapter bar. The exceptions are Trash, once deleted, and Archive, once archived (see below for both). A chapter belongs to exactly one parent, ever, and a chapter can't have chapters of its own. Dragging a note from the sidebar onto the chapter bar copies its content into a brand-new chapter and switches you to it, same as creating one any other way — the dragged note itself is untouched and stays independent, not linked to the copy. Dropping it on the bar's empty space (or its trailing \`+\` pill) adds it as the last chapter; dropping it directly on an existing chapter pill instead inserts it right in front of that one. Every heading in the copy shifts down one level (\`#\` becomes \`##\`, and so on) so its own title-heading nests under the parent's instead of competing with it — the original note's headings are untouched.
- While a chapter is open, its parent stays the one shown as active in the sidebar and the tab bar — the chapter bar itself shows which chapter you're in.
- A chapter's fate is tied to its parent's: permanently deleting a parent note permanently deletes all of its chapters with it.
- Right-click a chapter tab to give it a short id (\`§1: ···\` becomes \`§1: INTRO\`, say) — same rules as a note's \`$id\`. Link straight to it with \`[text]($NOTE-ID§CHAPTER-ID)\`, optionally down to one of its own anchors with \`[text]($NOTE-ID§CHAPTER-ID#anchor-id)\`; opening it this way keeps the parent shown as active exactly like clicking the pill would.
- Hold a right-click on a chapter pill (same threshold as the sidebar's own [Right-Click-Hold Note Gesture]($HELP§ARCHIVE-TRASH#right-click-hold-note-gesture)) to split it into two small buttons in place of the pill: archive and delete. Clicking delete removes the chapter from the bar and moves it to Trash, where it's prefixed \`§ \` to read as a chapter, with its parent's title (prefixed \`$ \`) shown in place of a created date; clicking archive does the same but moves it into its parent's own fold-out row in the Archive tree instead (see [Archiving and Trash]($HELP§ARCHIVE-TRASH#archiving-and-trash)). A quick right-click on it there restores it to its exact original position among its siblings, shifting whatever's there — and everything after it — back by one, same restore gesture as a note's own (see [Restoring from Archive or Trash]($HELP§ARCHIVE-TRASH#restoring-from-archive-or-trash)). Moving the pointer off the split pill without clicking either button reverts it to normal.
- Two small buttons flank the chapter tab strip. The scissors on the right cuts whatever's currently selected in the editor — or, with just a caret and nothing highlighted, everything from the caret to the end of the document — out of the note you're viewing (parent or chapter) and pastes it into a brand-new chapter, caret landing right after the pasted text. The new chapter always lands directly behind the one you cut from (or first, if you cut from the parent), pushing later chapters back by one; any blank-line run left behind at the cut site collapses down to a single blank line, and any blank lines swept up at the start or end of the extracted text itself are trimmed off. A quick way to split a long note as you write it. The merge icon on the left collapses the chapter you're currently viewing: its content is appended to the end of the previous chapter (or the parent, if it's the first chapter), the now-empty chapter is permanently deleted (chapters have no Trash of their own — its content has already been moved out), and you land in the destination note with the caret at the end. Collapsing a note's last remaining chapter this way leaves the chapter bar showing, same as it does for any note with no chapters yet -- just its book pill and the trailing \`+\` pill.
- \`Shift+Alt+Delete\` and \`Shift+Alt+Backspace\` do the scissors/merge dance above from the keyboard, without leaving whatever you're viewing:
  - With visible (non-whitespace) text after the caret/selection, \`Shift+Alt+Delete\` cuts everything from there to the end of the document into a brand-new chapter directly behind the one you're in — same as the scissors button, but you stay put with the caret at the end of what's left.
  - With nothing but whitespace after the caret (effectively at the end), it instead pulls the *next* chapter in: appends its text to the end of the current one and deletes it, caret landing exactly where the two texts meet. No jump, no note switch.
  - \`Shift+Alt+Backspace\` is the mirror, working backward from the caret/selection: visible text before it gets cut into a brand-new chapter directly ahead of the current one (caret stays at the very start of what's left); nothing but whitespace before it instead pulls the *previous* chapter in, prepending its text and deleting it, caret again landing exactly at the seam — a no-op on the very first chapter or the parent, since there's nothing before them to pull in. Doing the *cut* half of this while viewing the parent itself works a little differently, since there's no "chapter ahead of the parent" to insert into: the parent keeps the text before the caret/selection as its own new content (nothing about it changes otherwise), everything from there onward is cut into a brand-new chapter — the new first one — and you switch straight into it.
`,
  `## Archiving, Trash & Deletion

### [Archiving and Trash](#archiving-and-trash)

> **Where?**
> The Archive/Trash icons on each note row in the sidebar.

*Moves a note out of your active list without deleting it outright.*

- The Archive icon archives the note immediately; the Trash icon moves it to Trash — or, if you're already viewing Trash, permanently deletes it.
- Under the hood, archived/deleted status is just the protected \`archived\`/\`deleted\` tag.
- A parent note that isn't itself archived, but has one or more archived chapters (see [Chapters]($HELP§SPLIT-VIEW-TABS#chapters)), still shows up in the Archive tree — as a single row, same as any other note, but clicking it doesn't open it. It's a pure fold-out toggle instead: click it to show or hide its own archived chapters, indented underneath it. Clicking one of those, once visible, opens its parent with that chapter active, same as clicking any chapter pill.
- A parent note that's archived itself shows in the Archive tree the same simple way any other archived note does — no fold-out, nothing indented under it. Clicking it opens it in the editor with its full chapter bar, showing *every* chapter regardless of whether any of them are also archived — the archived ones read a little dimmed, aren't draggable, and can't be right-click-renamed, since (unlike a live chapter) there's nowhere real for either of those to write to while a chapter sits archived. Nothing here changes their archived status; un-archive one the same way any archived chapter is un-archived, from its Archive-tree row.

### [Right-Click-Hold Note Gesture](#right-click-hold-note-gesture)

> **Where?**
> Right-click and hold anywhere on a note row in the sidebar.

*A one-handed alternative to the Archive/Trash icons, with a built-in confirm step.*

- A quick tap (released fast) on an already-archived or already-deleted note immediately restores it to normal — see [Restoring from Archive or Trash]($#restoring-from-archive-or-trash).
- Holding past a short threshold arms the row (it highlights) for its next action: archive for a normal note, straight to permanent deletion for one that's already archived or deleted.
- A left-click on the armed row confirms the action; moving the pointer away cancels it.

### [Restoring from Archive or Trash](#restoring-from-archive-or-trash)

> **Where?**
> A quick right-click tap on an archived or deleted note row.

*Returns a note to normal, undoing an archive or trash action.*

- Releasing the right-click before the arm threshold triggers the restore immediately — no confirmation needed for this direction.
- Works the same way on a deleted chapter's row in Trash, or an archived chapter's row in its parent's Archive-tree fold-out — restoring puts it back into its parent's chapter bar at its exact original position, shifting later chapters back to make room (see [Chapters]($HELP§SPLIT-VIEW-TABS#chapters)).

### [Empty Trash](#empty-trash)

> **Where?**
> The Trash icon in the sidebar's view-mode row, held with a right-click.

*Permanently purges every note currently in Trash, in one action.*

- Hold a right-click on the button to arm the purge; a normal left-click while armed confirms it.
`,
  `## Time Machine

### [Time Machine Timeline](#time-machine-timeline)

> **Where?**
> The slider beneath the editor, next to the word-count panel.

*Shows every saved revision of the current note as a horizontal timeline.*

- Each mark is a saved snapshot; time runs left (older) to right (present).
- Automatic snapshots are taken as you work and are clustered/thinned automatically so the timeline doesn't get cluttered; manual snapshots are never thinned.
- Hovering a mark shows its date/time and word count.
- \`←\` / \`→\` on the focused slider steps between marks; \`Home\` / \`End\` jumps to the oldest / present.
- Scroll the wheel over the slider to zoom the timescale it displays — the tooltip shows the current cut-off, e.g. "6 hours."

### [Viewing a Past Revision](#viewing-a-past-revision)

> **Where?**
> Click any mark on the Time Machine timeline.

*Loads that revision into the editor, read-only, without changing the note.*

- Click the present-state circle, or navigate to the rightmost end of the slider, to return to the live document.

### [Present-State Circle](#present-state-circle)

> **Where?**
> The small circle next to the Time Machine slider.

*Tracks and creates manual save points, and returns you to the present.*

- Hollow means your text has changed since your last manual save; filled means it matches.
- Click it to create a manual save point when hollow, or to jump back to the live present when you're viewing history.
- Hold-click it to merge adjacent automatic snapshots — manual housekeeping, distinct from the automatic thinning described above.
- On the auto-generated Table of Contents or Open Items chapter (see [Chapters]($HELP§SPLIT-VIEW-TABS#chapters)), there's no save-point history to track — clicking the circle instead refreshes that chapter's content from the family's current live state on the spot, without leaving the page. The Time Machine slider itself is hidden there for the same reason.

### [Branching from History](#branching-from-history)

> **Where?**
> Hold a right-click on any history mark in the Time Machine timeline (not the present-state circle).

*Starts a brand-new note as a copy of a past revision, leaving the original untouched.*

- The original note and its full history are unaffected — branching only ever creates something new.

### [Freezing a Note in Time](#freezing-a-note-in-time)

> **Where?**
> Switch the note to preview mode, then click the snowflake button beneath the editor (in the same spot the line-numbers button sits in edit mode).

*Locks a note down so it can't be changed by accident — on purpose, permanently, until you unfreeze it.*

- Freezing clears the note's entire Time Machine history (and that of its chapters) and switches it to always show in preview — edit mode is unreachable while frozen.
- While frozen, nothing about the note can be changed: no typing, no tag edits, no chapter reordering/renaming/archiving/deleting, no new snapshots, no archiving or deleting the note itself. The one exception is unfreezing it.
- Click the same (now lit) snowflake button again to unfreeze — the note goes back to being a normal, editable note. Its history stays gone; freezing doesn't keep a backup.
`,
  `## Toolbar & Formatting

### [Toolbar Overview](#toolbar-overview)

> **Where?**
> The bar directly above the editor, shared by the whole window.

*One global toolbar that always acts on whichever section is currently active.*

- Left cluster: edit/preview toggle, new note, spell-check toggle, and an export button that switches between PDF (preview mode) and Markdown (edit mode).
- The rest of the bar holds the formatting group, visible only in edit mode.

### [Formatting Group](#formatting-group)

> **Where?**
> The toolbar, edit mode only.

*One-click Markdown formatting for the current selection or line.*

- Bold, italic, strikethrough; heading levels H1–H3; bulleted, numbered, and checklist lists; blockquote; code block and inline code; horizontal rule; link insertion.
- Each button reflects whether the current selection or line already has that formatting applied.
- Most double as the keyboard shortcuts listed in [Keyboard Shortcuts]($HELP§SHORTCUTS).
- A checklist item's box (\`- [ ]\`) can be toggled two ways once the caret sits between its brackets: type any character to check it off with that character (type a space to uncheck it again), or click the caret itself — with the caret already there and not moving — to flip \`[ ]\`/\`[X]\` without touching the keyboard.
`,
  `## Find & Replace

### [Find and Replace](#find-and-replace)

> **Where?**
> \`Ctrl+F\` / \`Ctrl+H\`, or the search field that appears above the editor.

*Finds and optionally replaces text within the single open note.*

- \`Ctrl+F\` opens the find field and focuses it; \`Ctrl+H\` opens it in replace mode.
- \`Tab\` moves between the find and replace fields.
- \`Ctrl+Enter\` replaces every match at once.
- The \`Aa\` toggle means "case-sensitive" in plain find mode; in replace mode it's repurposed as "keep case," searching case-insensitively but re-casing each replacement to match what it's replacing.
- What gets searched follows the mode you're in: in edit mode, the note's Markdown exactly as you typed it; in rendered mode, only the text the page actually shows. A link's target, an image's URL, a heading's \`#\` marks are invisible there, so they never produce a match you can't see — searching \`anchor\` against a rendered \`[anchor](#anchor)\` finds the one word on screen, not two.
- For searching across *all* notes rather than one, use [Search]($HELP§SIDEBAR-SEARCH#search) instead.
`,
  `## External Files

### [Opening an External File](#opening-an-external-file)

> **Where?**
> Your OS file explorer, a file association, or drag-and-drop onto the editor area.

*Edits a file that lives outside Thockdown's own notes folder, in place.*

- Becomes a temporary note tagged \`external\`, appearing only in the Date view (not Category, Archive, or Trash).
- Your edits autosave into the app's own database as you type, but never touch the original file until you explicitly save.

### [Saving an External File](#saving-an-external-file)

> **Where?**
> The Save icon on the external note's row.

*Writes the note's current content back out to the original file on disk.*

- If the saved database content and the on-disk file differ, the note shows as unsaved until you save again.

### [Converting an External File to a Regular Note](#converting-an-external-file-to-a-regular-note)

> **Where?**
> Remove the \`external\` tag from the note (tag-mode, see [Managing Tags]($HELP§TAGS#managing-tags)).

*Adopts an external file into Thockdown permanently, as a normal internal note.*

- Writes the note's current content into a new internal file; the original external file is left untouched.
- External notes can't carry your own tags while the \`external\` tag is present, but still keep their own [Time Machine Timeline]($HELP§TIME-MACHINE#time-machine-timeline) like any other note.
`,
  `## Sync & Import

### [Sync](#sync)

> **Where?**
> Settings → Data Synchronization → the sync icon.

*Rescans the app's own notes folder for files that exist on disk but aren't yet registered.*

- Any newly-found file is added to the database as a regular note.

### [Import](#import)

> **Where?**
> Settings → Data Synchronization → the import icon.

*Brings Markdown files from anywhere on your computer into Thockdown as regular notes.*

- Opens a file/folder picker; you choose exactly what gets imported.

### [Open Notes Folder](#open-notes-folder)

> **Where?**
> Settings → Data Synchronization → the folder icon.

*Opens the app's own notes folder (where your \`.md\` files live on disk) in your system file explorer.*
`,
  `## Export

### [Export to PDF](#export-to-pdf)

> **Where?**
> The toolbar's export icon, while in preview mode.

*Exports the active note's rendered view as a PDF file.*

- Right-click the export button first to choose a destination folder before exporting.

### [Export to Markdown](#export-to-markdown)

> **Where?**
> The toolbar's export icon, while in edit mode.

*Exports the raw note text as a \`.md\` file.*

- Right-click the export button to force the folder picker, even if a destination is already remembered.
`,
  `## Keyboard Shortcuts

> **Where?**
> Global — active anywhere the app has focus, except inside search/replace/tag fields (where \`Tab\` / \`Enter\` / \`Esc\` move focus back into the editor instead).

*Every keyboard shortcut in the app, in one table.*

| Shortcut | Action |
| --- | --- |
| \`Ctrl+N\` | New blank note |
| \`Ctrl+Shift+N\` | New note titled from clipboard |
| \`Esc\` | Toggle edit / preview (or blur a focused field) |
| Hold \`Esc\` | Open the quick actions menu |
| \`Ctrl+F\` | Find in note |
| \`Ctrl+H\` | Find & replace in note |
| \`Ctrl+Enter\` (in find mode) | Replace all matches |
| \`Alt+Left\` / \`Alt+Right\` | Previous / next section |
| \`Ctrl+Up\` / \`Ctrl+Down\` | Jump caret to start / end of document |
| \`Ctrl+B\` | Bold |
| \`Ctrl+I\` | Italic |
| \`Ctrl+J\` | Strikethrough |
| \`Ctrl+T\` | Toggle current line's heading level |
| \`Ctrl+-\` | Toggle bulleted list |
| \`Ctrl+#\` (or \`Ctrl+Shift+3\`) | Toggle numbered list |
| \`Ctrl+Z\` / \`Ctrl+Y\` | Undo / redo |

- Shortcuts that touch the editor apply to whichever section is currently active.
`,
  `## Window Controls

> **Where?**
> The top bar of the window.

*Thockdown runs frameless, with no OS menu bar — every window action lives here.*

- **Dark mode toggle** — switches the whole app between light and dark presets.
- **Settings (gear)** — opens/closes the Settings panel, see [Settings Panel]($HELP§APPEARANCE-SETTINGS#settings-panel).
- **Music player** — see [Music Player]($HELP§MUSIC-PLAYER).
- **Mini mode** — collapses the window into a compact strip; while collapsed, the music player's options button is disabled.
- **Minimize / Maximize–Restore / Close** — standard window controls.
- **Double size (2x)** — the lower half of the split maximize button. Doubles the app's page zoom and, to match, the window's minimum size, so 2x content gets 2x room instead of being squeezed into the same space. Toggling off relaxes the minimum again but doesn't shrink a window you've since resized larger. Persists across restarts.
- **Drag the toolbar or this top bar to move the window; double-click either to maximize/restore.** Dragging a maximized window from these areas restores it, ending up positioned under the cursor as if the drag had been followed the whole way. Dragging elsewhere in the app also moves the window, but won't restore it from maximized.
`,
  `## Appearance & Settings

### [Settings Panel](#settings-panel)

> **Where?**
> The gear icon in the window-controls bar.

*The home for every appearance, sound, sync, and performance control in the app, organized into collapsible sections.*

- Most controls apply live, and separately to edit mode and preview mode where the two differ (e.g. typography, text color).
- Every slider, and the draggable H/S/V/A and texture-control swatches, can also be adjusted by scrolling the mouse wheel over them — each notch moves the value by exactly one step. Hovering any of them shows a tooltip with the current value; it stays open and updates live as you scroll or drag, and only closes once the cursor actually leaves the control.

### [Editor Font](#editor-font)

> **Where?**
> Settings panel, directly below the theme presets.

*Font family, size, spacing, and padding for the editor and the rendered preview.*

- Separate controls for the editor (font family, size, line height, glyph padding) and the preview (font family, size, letter spacing, line height).

### [Presets](#presets)

> **Where?**
> Settings panel, at the very top.

*A row of built-in light and dark theme presets.*

- A "Custom" marker preset activates automatically once you've changed anything away from a built-in preset.

### [Custom Layouts](#custom-layouts)

> **Where?**
> Settings panel → Custom Layouts.

*Saves your entire current configuration as a reusable, numbered preset slot.*

- Right-click a slot to arm it for deletion, or hold right-click to export it.
- Use the reset button to restore the active custom layout back to its defaults.

### [Colors and Textures](#colors-and-textures)

> **Where?**
> Settings panel → Colors & Textures.

*A "paint bucket" system for recoloring and retexturing individual UI elements.*

- Click a source swatch — or an active color, or a texture preview — to pick it up, then click any target swatch (UI elements, text colors, textures) to apply it there.

### [Borders and Spacing](#borders-and-spacing)

> **Where?**
> Settings panel → Borders & Spacing.

*Fine control over border widths, corner radii, and layout spacing throughout the UI.*

### [UI Font](#ui-font)

> **Where?**
> Settings panel → UI Font.

*Font family and size for the app's own chrome — sidebar, buttons, tags, tooltips — separate from the editor/preview content fonts under [Editor Font]($#editor-font).*

- Twelve bundled UI fonts, from the general-purpose IBM Plex Sans to full-personality display fonts, alongside the app's default system font.
- The size slider scales UI text only; icons and button sizing stay fixed.

### [Glaze](#glaze)

> **Where?**
> Settings panel → Glaze.

*A decorative multi-layer light overlay on top of the UI — purely cosmetic.*

- Independent linear ("glare") and radial ("flair") gradient layers, plus dark and light gradient accents ("gloom" and "sheen"), each with its own position, shape, opacity, and randomizable seed.
- Safe to leave at defaults, or turn off entirely via [Performance]($#performance).

### [Filters](#filters)

> **Where?**
> Settings panel → Filters.

*Global CSS filters applied over the whole app.*

- Invert, sepia, hue-rotate, brightness, contrast, saturate, and a colorize overlay.

### [Scrolling Behavior](#scrolling-behavior)

> **Where?**
> Settings panel → Scrolling Behavior.

*Tunes the custom easing curve used for preview-mode scroll animations.*

- Controls for ramp, speed, maximum speed, and overall curve shape. Response is auto-derived from ramp.
- These settings aren't part of a layout — they stay as you left them across layout switches and app restarts, the same way the custom cursor toggle does.

### [Mouse Options](#mouse-options)

> **Where?**
> Settings panel → Mouse Options.

*An optional animated cursor replacement: orbiting dots with fading trails, a center dot, a soft halo, and a breathing pulse, all pinned to the real pointer position. Off by default — flip it on in [Performance]($#performance).*

- Top-left button is a halo color swatch. The 4 buttons beside it (H, S, V, A) stage a color by dragging up/down or scrolling on each — left-click a swatch (halo, circling dots, center dot, trail) to paint it onto that element; hold right-click on a swatch to load its current color back into H/S/V/A.
- Sliders: number of circling dots, orbit radius, spin speed (-4Hz to 4Hz, negative reverses direction, 0 freezes it), trail fade duration (how long a trail particle takes to decay after the head passes it — e.g. 1000ms at 1Hz spin sweeps exactly one full revolution), trail thickness (0–12px, 0 hides it), dot size (0–12px, 0 hides it), center dot size (0–12px, 0 hides it), halo radius (0 hides it, capped at the same max as orbit radius), fall-off (0–100 — how far out the halo's glow stays near-opaque before fading to nothing at its edge; low values fade fast near the center, high values stay bright almost all the way to the rim), and a pulse effect that breathes the orbit's radius outward — magnitude 0 keeps it locked at its base size, magnitude 1 breathes up to 200% of it — at a given speed. The halo is rendered centered behind the center dot. Colors and these sliders are saved per layout, same as the rest of your theming.
- Click response: left-click tightens the orbit (smaller radius, faster spin) and right-click widens it (larger radius, slower spin), up to 200% and down to 50% of your base radius/spin. Every click is handled the same way regardless of how long you hold it — a plain click is too fast to tell "tap" from "hold" apart — it rises to full strength, stays there while held, then eases back down to baseline on release instead of snapping. Six more sliders tune the feel, using the same bell-curve model as Scrolling Behavior's ramp/shape/speed/max-speed: click ramp (linear → bouncy), click shape (apex bias), click speed (how long the rise/fall takes -- weighted so the high-speed end of the slider gives much finer control than the low-speed end), click max speed (how strong the effect gets), min impact (floors how long a click is treated as held internally, 0–200ms, so even a quick real click still registers instead of flickering), and click balance (center = radius and spin both affected equally; left = radius only; right = spin only).

### [Keystroke Sounds](#keystroke-sounds)

> **Where?**
> Settings panel → Keystroke Sounds.

*Optional mechanical-keyboard sound effects on typing, undo/redo, and navigation.*

- Four sound sets — Pops, Pins, Creamy, Forge — plus volume, per-key pitch variance, global pitch, bass/treble mix, reverb, and pitch jitter controls.
- **Spatial** slider adds stereo panning, centered (off) by default. Left of center pans by keyboard key position (left-hand keys sound from the left, right-hand keys from the right, non-character keys like arrows/Tab/Backspace stay centered); right of center pans by where the caret sits on the current line (line start sounds left, the far edge before an automatic wrap sounds right). The two modes don't blend — the slider picks one or the other by which side of center it's on, with distance from center setting how strong the effect is.

### [Music Settings](#music-settings)

> **Where?**
> Settings panel → Music.

*Volume and reverb controls for the built-in music player.*

- Controls the same player described in [Music Player]($HELP§MUSIC-PLAYER); this panel just holds its volume and reverb sliders.

### [Data Synchronization Settings](#data-synchronization-settings)

> **Where?**
> Settings panel → Data Synchronization.

*Note sync/import, and exporting or importing your whole appearance setup.*

- [Sync]($HELP§SYNC-IMPORT#sync), [Import]($HELP§SYNC-IMPORT#import), and [Open Notes Folder]($HELP§SYNC-IMPORT#open-notes-folder) buttons for notes.
- Export or import your custom appearance presets as a \`.tdl\` file, so you can carry your look between machines.

### [Performance](#performance)

> **Where?**
> Settings panel → Performance.

*Toggles for easing load on constrained machines, plus the custom cursor switch.*

- **Reduce visual effects** forces [Glaze]($#glaze), [Filters]($#filters), and the colorize filter off, without discarding your slider positions (Invert is kept, since it's often load-bearing for dark layouts).
- **Reduce caret animation** stops the idle caret blink, easing compositor load.
- **Defer preview on rapid input** coalesces preview updates onto one frame during fast key-repeat (e.g. held Backspace).
- The cursor button toggles the [custom cursor]($#mouse-options) on/off; while on, the native cursor is hidden everywhere in the app, not just the editor — sidebar, toolbar, dialogs, all of it. This toggle always starts on for a fresh install and isn't part of a layout — it stays as you left it across layout switches and app restarts until you flip it again.

### [Debugging](#debugging)

> **Where?**
> Settings panel → Debugging.

*Tools for diagnosing problems, not intended for everyday use.*

- **Debug logging** routes the app's debug log into a dedicated note tagged \`debug\` — see [Protected Tags]($HELP§TAGS#protected-tags).
- A button opens a detached DevTools window.
`,
  `## Music Player

> **Where?**
> The window-controls bar, center.

*A built-in music player with five themed playlist slots, each holding your own local audio files.*

- Slots: Vocal, Instrumental, Ambient, Rock, Electro.
- **Adding music** — right-click a slot to pick individual files; shift+right-click to add an entire folder at once.
- **Clearing a slot** — hold a right-click on a slot until it arms, then release to clear every song in it.
- **Choosing what plays** — click a slot to toggle it in or out of the active playback pool; more than one slot can be active at once.
- **Playback** — play/stop; the favorite/skip button (click to favorite the current song for early replay, right-click to skip it, hold right-click to purge it from its slot entirely); the seek button (click forward 20%, right-click back 20%, hold to scrub continuously).
- **Volume and reverb** — adjustable from [Settings panel → Music]($HELP§APPEARANCE-SETTINGS#music-settings), or directly by scrolling over the player: plain scroll adjusts volume, Shift+scroll adjusts reverb amount, Ctrl+scroll adjusts reverb room size.
- **Resuming across restarts** — if music was playing when the app was last closed, it resumes on launch (same song and position), fading in over 10 seconds from silence and full reverb up to your usual volume/reverb settings.
`,
  `## Data Storage

> **Where?**
> Not a UI element — describes where your files live on disk.

*Everything Thockdown stores is local to your machine.*

- Note content is written to Markdown files on disk; titles, tags, ordering, snapshots, and app preferences live in a local database alongside them.
- Nothing leaves your machine unless you explicitly export, sync to, or import from another location yourself.
`,
]

export const HELP_GUIDE_CHAPTERS: HelpGuideChapterContent[] = HELP_GUIDE_CHAPTER_IDS.map((idPair, index) => ({
  ...idPair,
  content: HELP_GUIDE_CHAPTER_CONTENTS[index],
}))
