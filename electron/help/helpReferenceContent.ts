// Full built-in reference note ($HELP). Content only, for now -- creating it
// on startup, reserving the `HELP` assigned id against reassignment, hiding
// it from Date/Category/Archive/Trash/Find, and the dedicated help button
// are all still open work (see helpNote.ts for the pattern the "Welcome"
// note already uses, which this should follow once wired up).
export const HELP_REFERENCE_CONTENT = `<!--
  Protected system note. Assigned id: $HELP
  Do not delete or edit through normal note actions. Does not appear in
  Date / Category / Archive / Trash / Find. Reachable only via a direct
  cross-link ($HELP or $HELP#anchor-id) or the dedicated help button.
-->

# Thockdown Notes — Help & Reference

This note is the built-in reference for Thockdown Notes. It has two parts:

- **Quick Reference** — the essentials for every area of the app, in one pass.
- **Detailed Documentation** — every feature, in depth, with where to find it and how to use it.

Every heading below is also a jump target: \`[Anchor Text](#anchor-id)\` defines one, with the label as the visible text and a short id as the destination. Link to it from the same note with \`[Link Text]($#anchor-id)\`, or from any other note with \`[Link Text]($HELP#anchor-id)\`. \`[Link Text]($HELP)\` alone just opens this page. Since both anchors and links are ordinary Markdown links, they're never mistaken for one when shown as an example in backticks — like the ones in this sentence.

**Jump to:** [Quick Reference]($#quick-reference) · [Detailed Documentation]($#detailed-documentation)

---

## [Quick Reference](#quick-reference)

### Notes

- \`Ctrl+N\` creates a new note; \`Ctrl+Shift+N\` creates one titled from your clipboard.
- The first line of a note (starting with \`# \`) is its title. Everything else is content.
- Notes save automatically as you type. \`Esc\` toggles between the Markdown editor and the rendered preview.
- Left-click the scrollbar track to jump straight to that spot. Right-click above/below the thumb to page up/down once; hold the right click to keep paging until you release it or the thumb reaches your cursor.
- The list-number icon next to the word count toggles line numbers and a review-flag column for that editor. Left-click toggles both together; right-click toggles the review-flag column alone. Click a line's flag box to mark it for review (\`?\`), click again for a warning (\`!\`); right-click clears it.

### Organizing

- Tag notes from the tag bar (type + \`Enter\`); the first tag is the primary category, the second the sub-category.
- The sidebar has five views: Date, Category, Archive, Trash, Find. Search plain text or \`#tag\`.
- Click a note's Archive/Trash icon for one-click actions, or right-click-and-hold a note row to arm archive/delete, then click to confirm.

### Internal links

- Turn any heading or phrase into a jump target with \`[Anchor Text](#anchor-id)\` — the label is the visible text, the id is just a short internal handle.
- Link to it from the same note with \`[link text]($#anchor-id)\`. Give a note a short id (e.g. \`$MEETING-2\`) via the tab bar's identity tab, then link to it from anywhere with \`[text]($MEETING-2)\`, or straight to one of its anchors with \`[text]($MEETING-2#anchor-id)\`.
- Give one of that note's chapters a short id too (right-click its chapter-bar tab), then link straight into it with \`[text]($MEETING-2§AGENDA)\`, or to one of its anchors with \`[text]($MEETING-2§AGENDA#anchor-id)\`.

### Split view & tabs

- The \`+\` button next to the tab bar splits the editor into another section. Each section has its own tabs.
- The identity tab area holds either your open note tabs or the tag editor — toggle with the tag icon.
- Hold-click a note in the sidebar to pin it as a tab; a plain click opens it as a temporary tab.
- The chapter panel (\`+\` button, bottom bar) splits a note into chapters — full notes of their own, browsable from a bar there instead of the sidebar.

### Time Machine

- The slider under each note shows its save history. Click a mark to view it (read-only); click the circle to return to the present.
- The circle also creates a manual save point when your text has changed since the last one.
- Hold-click a history mark to branch a brand-new note starting from that revision.

### Toolbar & formatting

- \`Ctrl+B\` / \`Ctrl+I\` / \`Ctrl+J\` bold / italic / strikethrough. \`Ctrl+T\` cycles heading level. \`Ctrl+-\` / \`Ctrl+#\` bullet / numbered list.
- Export the current note with the PDF icon (preview mode) or the \`{}\` icon (edit mode); right-click either to choose an export folder.

### Find & replace

- \`Ctrl+F\` finds within the open note; \`Ctrl+H\` finds and replaces. \`Ctrl+Enter\` replaces all matches.

### Shortcuts

See the full [Keyboard Shortcuts]($#keyboard-shortcuts) table.

### Music & sound

- Typing has optional mechanical-keyboard sounds (three sets, tunable). A built-in 5-slot music player sits in the window-controls bar — right-click a slot to add files, shift+right-click to add a folder.

### Appearance

- The gear icon opens Settings: fonts, color presets, custom "paint bucket" theming, decorative overlays (Glaze), CSS filters, scroll feel, sounds, a custom animated mouse cursor, and performance toggles.
- Save your whole look as a custom layout and export/import it as a \`.tdl\` layout file.

### Window controls

- Top bar: dark mode, settings, the music player, mini mode, minimize, maximize, close. The window is frameless — there's no OS menu bar.

---

## [Detailed Documentation](#detailed-documentation)

Every feature in the app, described individually: where to find it, what it does, and how to use it well.

## Notes & Editing

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
- \`Esc\` also blurs a focused field (like search) before it starts toggling modes, so it's safe to hit repeatedly.

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

## Internal Linking

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
> The tab bar's identity tab — switch it to tag mode (tag icon), then right-click it.

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

## Tags

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
- Drag a tag left or right to reorder it relative to the others.

### [Suggested Tags](#suggested-tags)

> **Where?**
> Below the tag input field, in tag-mode.

*A shortlist of your frequently-used tags, one click away from being added.*

- Click a suggested tag to add it instantly to the current note.
- Tags already on the note, and protected tags, are excluded from suggestions.

### [Protected Tags](#protected-tags)

> **Where?**
> Never typed directly — applied automatically by the corresponding action.

*Four reserved tag names (\`archived\`, \`deleted\`, \`external\`, \`debug\`) that track note state rather than your own organization.*

- Set and cleared only through [Archiving and Trash]($#archiving-and-trash), [Restoring from Archive or Trash]($#restoring-from-archive-or-trash), [Opening an External File]($#opening-an-external-file), and [Debugging]($#debugging).
- Can't be typed into the tag field directly, and are excluded from the suggested-tags list.

## Sidebar & Search

### [Sidebar Views](#sidebar-views)

> **Where?**
> The row of icons at the top of the sidebar.

*Five different ways to browse your notes, switched with one click.*

- **Date** — a flat, chronological list ordered by last-updated time, paginated.
- **Category** — a two-level collapsible tree grouped by primary tag, then secondary tag.
- **Archive** — the same tree layout as Category, restricted to archived notes.
- **Trash** — a flat, paginated list of notes marked for deletion, awaiting purge or restore.
- **Find** — the search view, described below.
- A sixth icon opens Settings, which replaces the sidebar content rather than being a note-browsing view — see [Settings Panel]($#settings-panel).

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

## Split View & Tabs

### [Creating a Section](#creating-a-section)

> **Where?**
> The \`+\` button at the right edge of any tab bar.

*Splits the editor into an additional side-by-side section.*

- Hidden once there's no more room for another 300px-minimum-wide section.
- \`Ctrl+Tab\` cycles the active section forward; \`Ctrl+Left\` / \`Ctrl+Right\` step between sections directly.

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

- In tag mode, the identity tab itself displays — and lets you assign — the active note's \`$id\` (see [Assigning a Note Id]($#assigning-a-note-id)).

### [Pinned and Temporary Tabs](#pinned-and-temporary-tabs)

> **Where?**
> A section's tab bar, in tabs-mode.

*Keeps one note open temporarily, or several open permanently, per section.*

- Clicking a note in the sidebar opens it as a single temporary tab (replacing any previous one) — shown with a \`···\`-style label.
- Holding the click past a short threshold pins it as a permanent tab instead, which stays open alongside others.
- Right-click a pinned tab, or hold-click it, to unpin/close it.
- Drag tabs to reorder them; drag a note from the sidebar directly into a tab bar to open it there.

### [Chapters](#chapters)

> **Where?**
> The \`+\` button on the bottom utility bar creates a chapter and opens the chapter panel, above the tab bar.

*Splits a note into sub-notes, browsable from a bar of their own.*

- The chapter panel shows itself automatically the moment a note has at least one chapter, and hides itself again the moment it has none — there's no manual show/hide toggle. The bottom utility bar's button doubles as both: it always creates a new empty chapter and switches to it, which opens the panel as a side effect the first time. \`Shift+Alt+N\` does exactly the same thing from the keyboard.
- The chapter bar's first tab is always the parent note itself; every chapter follows in order. Click the parent tab or any chapter pill to switch between them — each keeps and saves its own text independently. Too many chapters to fit scrolls horizontally, fading at whichever edge has more off-screen, same as the tab bar.
- Drag a chapter pill to reorder it among its siblings — same drag-and-drop as reordering pinned tabs or tags: drop directly on another pill to land in front of it, or on the bar's empty space to send it to the end.
- Dragging a chapter pill onto the parent tab instead **promotes** it: that chapter becomes the new parent note, and the previous parent becomes the new first chapter. Whatever tags the old parent carried move onto the newly-promoted note (a chapter never carries tags of its own — see below), so the whole note keeps appearing under whatever it was filed/tagged as; each note's title stays its own, since it's always derived from that note's own content, not copied across.
- The moment a note has its first chapter, an auto-generated **Table of Contents** chapter appears too — no button to press, it just shows up pinned first in the bar (before every real chapter, not draggable, and never a promotion target) and disappears again the moment the last real chapter does, the same automatic show/hide the chapter panel itself already does. It lists every heading across the parent and all of its chapters, in order, each one a working link straight to it. It's regenerated fresh every time you open it, so it's always accurate without costing anything while you're not looking at it — meaning it's also read-only (anything you tried to type would just be overwritten on your next visit) and opens straight into render view, since the links it lists aren't clickable as raw markdown text.
- A chapter is a full note in its own right — its own tags don't exist; tags always belong to the parent — but it doesn't appear on its own in Date/Category/Archive/Trash/Find, only through its one parent's chapter bar. A chapter belongs to exactly one parent, ever, and a chapter can't have chapters of its own. Dragging a note from the sidebar onto an open chapter bar (or the \`+\` button, even before any chapter bar is showing) copies its content into a brand-new chapter and switches you to it, same as creating one any other way — the dragged note itself is untouched and stays independent, not linked to the copy. Dropping it on the bar's empty space (or the \`+\` button) adds it as the last chapter; dropping it directly on an existing chapter pill instead inserts it right in front of that one. Every heading in the copy shifts down one level (\`#\` becomes \`##\`, and so on) so its own title-heading nests under the parent's instead of competing with it — the original note's headings are untouched.
- While a chapter is open, its parent stays the one shown as active in the sidebar and the tab bar — the chapter bar itself shows which chapter you're in.
- A chapter's fate is tied to its parent's: permanently deleting a parent note permanently deletes all of its chapters with it.
- Right-click a chapter tab to give it a short id (\`§1: ···\` becomes \`§1: INTRO\`, say) — same rules as a note's \`$id\`. Link straight to it with \`[text]($NOTE-ID§CHAPTER-ID)\`, optionally down to one of its own anchors with \`[text]($NOTE-ID§CHAPTER-ID#anchor-id)\`; opening it this way keeps the parent shown as active exactly like clicking the pill would.
- Two small buttons flank the chapter tab strip. The scissors on the right cuts whatever's currently selected in the editor — or, with just a caret and nothing highlighted, everything from the caret to the end of the document — out of the note you're viewing (parent or chapter) and pastes it into a brand-new chapter, caret landing right after the pasted text. The new chapter always lands directly behind the one you cut from (or first, if you cut from the parent), pushing later chapters back by one; any blank-line run left behind at the cut site collapses down to a single blank line, and any blank lines swept up at the start or end of the extracted text itself are trimmed off. A quick way to split a long note as you write it. The merge icon on the left collapses the chapter you're currently viewing: its content is appended to the end of the previous chapter (or the parent, if it's the first chapter), the now-empty chapter is permanently deleted (chapters have no Trash of their own — its content has already been moved out), and you land in the destination note with the caret at the end. Collapsing a note's last remaining chapter this way hides the panel again.
- \`Shift+Alt+Delete\` and \`Shift+Alt+Backspace\` do the scissors/merge dance above from the keyboard, without leaving whatever you're viewing:
  - With visible (non-whitespace) text after the caret/selection, \`Shift+Alt+Delete\` cuts everything from there to the end of the document into a brand-new chapter directly behind the one you're in — same as the scissors button, but you stay put with the caret at the end of what's left.
  - With nothing but whitespace after the caret (effectively at the end), it instead pulls the *next* chapter in: appends its text to the end of the current one and deletes it, caret landing exactly where the two texts meet. No jump, no note switch.
  - \`Shift+Alt+Backspace\` is the mirror, working backward from the caret/selection: visible text before it gets cut into a brand-new chapter directly ahead of the current one (caret stays at the very start of what's left); nothing but whitespace before it instead pulls the *previous* chapter in, prepending its text and deleting it, caret again landing exactly at the seam — a no-op on the very first chapter or the parent, since there's nothing before them to pull in. Doing the *cut* half of this while viewing the parent itself works a little differently, since there's no "chapter ahead of the parent" to insert into: the parent keeps the text before the caret/selection as its own new content (nothing about it changes otherwise), everything from there onward is cut into a brand-new chapter — the new first one — and you switch straight into it.

## Archiving, Trash & Deletion

### [Archiving and Trash](#archiving-and-trash)

> **Where?**
> The Archive/Trash icons on each note row in the sidebar.

*Moves a note out of your active list without deleting it outright.*

- The Archive icon archives the note immediately; the Trash icon moves it to Trash — or, if you're already viewing Trash, permanently deletes it.
- Under the hood, archived/deleted status is just the protected \`archived\`/\`deleted\` tag.

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

### [Empty Trash](#empty-trash)

> **Where?**
> The Trash icon in the sidebar's view-mode row, held with a right-click.

*Permanently purges every note currently in Trash, in one action.*

- Hold a right-click on the button to arm the purge; a normal left-click while armed confirms it.

## Time Machine

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

### [Branching from History](#branching-from-history)

> **Where?**
> Hold a right-click on any history mark in the Time Machine timeline (not the present-state circle).

*Starts a brand-new note as a copy of a past revision, leaving the original untouched.*

- The original note and its full history are unaffected — branching only ever creates something new.

## Toolbar & Formatting

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
- Most double as the keyboard shortcuts listed in [Keyboard Shortcuts]($#keyboard-shortcuts).

## Find & Replace

### [Find and Replace](#find-and-replace)

> **Where?**
> \`Ctrl+F\` / \`Ctrl+H\`, or the search field that appears above the editor.

*Finds and optionally replaces text within the single open note.*

- \`Ctrl+F\` opens the find field and focuses it; \`Ctrl+H\` opens it in replace mode.
- \`Tab\` moves between the find and replace fields.
- \`Ctrl+Enter\` replaces every match at once.
- The \`Aa\` toggle means "case-sensitive" in plain find mode; in replace mode it's repurposed as "keep case," searching case-insensitively but re-casing each replacement to match what it's replacing.
- For searching across *all* notes rather than one, use [Search]($#search) instead.

## External Files

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
> Remove the \`external\` tag from the note (tag-mode, see [Managing Tags]($#managing-tags)).

*Adopts an external file into Thockdown permanently, as a normal internal note.*

- Writes the note's current content into a new internal file; the original external file is left untouched.
- External notes can't carry your own tags while the \`external\` tag is present, but still keep their own [Time Machine Timeline]($#time-machine-timeline) like any other note.

## Sync & Import

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

## Export

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

## Keyboard Shortcuts

### [Keyboard Shortcuts](#keyboard-shortcuts)

> **Where?**
> Global — active anywhere the app has focus, except inside search/replace/tag fields (where \`Tab\` / \`Enter\` / \`Esc\` move focus back into the editor instead).

*Every keyboard shortcut in the app, in one table.*

| Shortcut | Action |
| --- | --- |
| \`Ctrl+N\` | New blank note |
| \`Ctrl+Shift+N\` | New note titled from clipboard |
| \`Esc\` | Toggle edit / preview (or blur a focused field) |
| \`Ctrl+F\` | Find in note |
| \`Ctrl+H\` | Find & replace in note |
| \`Ctrl+Enter\` (in find mode) | Replace all matches |
| \`Ctrl+Tab\` | Next section |
| \`Ctrl+Left\` / \`Ctrl+Right\` | Previous / next section |
| \`Ctrl+Up\` / \`Ctrl+Down\` | Jump caret to start / end of document |
| \`Ctrl+B\` | Bold |
| \`Ctrl+I\` | Italic |
| \`Ctrl+J\` | Strikethrough |
| \`Ctrl+T\` | Toggle current line's heading level |
| \`Ctrl+-\` | Toggle bulleted list |
| \`Ctrl+#\` (or \`Ctrl+Shift+3\`) | Toggle numbered list |
| \`Ctrl+Z\` / \`Ctrl+Y\` | Undo / redo |

- Shortcuts that touch the editor apply to whichever section is currently active.

## Window Controls

### [Window Controls](#window-controls)

> **Where?**
> The top bar of the window.

*Thockdown runs frameless, with no OS menu bar — every window action lives here.*

- **Dark mode toggle** — switches the whole app between light and dark presets.
- **Settings (gear)** — opens/closes the Settings panel, see [Settings Panel]($#settings-panel).
- **Music player** — see [Music Player]($#music-player).
- **Mini mode** — collapses the window into a compact strip; while collapsed, the music player's options button is disabled.
- **Minimize / Maximize–Restore / Close** — standard window controls.
- **Drag the toolbar or this top bar to move the window; double-click either to maximize/restore.** Dragging a maximized window from these areas restores it, ending up positioned under the cursor as if the drag had been followed the whole way. Dragging elsewhere in the app also moves the window, but won't restore it from maximized.

## Appearance & Settings

### [Settings Panel](#settings-panel)

> **Where?**
> The gear icon in the window-controls bar.

*The home for every appearance, sound, sync, and performance control in the app, organized into collapsible sections.*

- Most controls apply live, and separately to edit mode and preview mode where the two differ (e.g. typography, text color).
- Every slider, and the draggable H/S/V/A and texture-control swatches, can also be adjusted by scrolling the mouse wheel over them — each notch moves the value by exactly one step. Hovering any of them shows a tooltip with the current value; it stays open and updates live as you scroll or drag, and only closes once the cursor actually leaves the control.

### [Typography](#typography)

> **Where?**
> Settings panel, below Music, above the presets.

*Font family, size, spacing, and padding for the editor and the rendered preview.*

- Separate controls for the editor (font family, size, line height, glyph padding) and the preview (font family, size, letter spacing, line height).

### [Presets](#presets)

> **Where?**
> Settings panel, directly below Typography.

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

- Three sound sets — Pops, Pins, Creamy — plus volume, per-key pitch variance, global pitch, bass/treble mix, and reverb controls.

### [Music Settings](#music-settings)

> **Where?**
> Settings panel → Music.

*Volume and reverb controls for the built-in music player.*

- Controls the same player described in [Music Player]($#music-player); this panel just holds its volume and reverb sliders.

### [Data Synchronization Settings](#data-synchronization-settings)

> **Where?**
> Settings panel → Data Synchronization.

*Note sync/import, and exporting or importing your whole appearance setup.*

- [Sync]($#sync) and [Import]($#import) buttons for notes.
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

- **Debug logging** routes the app's debug log into a dedicated note tagged \`debug\` — see [Protected Tags]($#protected-tags).
- A button opens a detached DevTools window.

## Music Player

### [Music Player](#music-player)

> **Where?**
> The window-controls bar, center.

*A built-in music player with five themed playlist slots, each holding your own local audio files.*

- Slots: Vocal, Instrumental, Ambient, Rock, Electro.
- **Adding music** — right-click a slot to pick individual files; shift+right-click to add an entire folder at once.
- **Clearing a slot** — hold a right-click on a slot until it arms, then release to clear every song in it.
- **Choosing what plays** — click a slot to toggle it in or out of the active playback pool; more than one slot can be active at once.
- **Playback** — play/stop; the favorite/skip button (click to favorite the current song for early replay, right-click to skip it, hold right-click to purge it from its slot entirely); the seek button (click forward 20%, right-click back 20%, hold to scrub continuously).
- **Volume and reverb** — adjustable from [Settings panel → Music]($#music-settings), or directly by scrolling over the player: plain scroll adjusts volume, Shift+scroll adjusts reverb amount, Ctrl+scroll adjusts reverb room size.
- **Resuming across restarts** — if music was playing when the app was last closed, it resumes on launch (same song and position), fading in over 10 seconds from silence and full reverb up to your usual volume/reverb settings.

## Data Storage

### [Data Storage](#data-storage)

> **Where?**
> Not a UI element — describes where your files live on disk.

*Everything Thockdown stores is local to your machine.*

- Note content is written to Markdown files on disk; titles, tags, ordering, snapshots, and app preferences live in a local database alongside them.
- Nothing leaves your machine unless you explicitly export, sync to, or import from another location yourself.
`;
