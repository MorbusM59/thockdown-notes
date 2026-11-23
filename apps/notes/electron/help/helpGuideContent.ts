// Prose content for the built-in User Guide. Each entry becomes one real,
// protected note in the database: HELP_GUIDE_INTRO_CONTENT is the parent
// note's own body, HELP_GUIDE_CHAPTERS is one chapter per topic (in display
// order). Content only — seeding lives in helpGuideNote.ts; the ids these
// pair with live in src/shared/helpGuide.ts (shared with the renderer,
// which needs them without needing this prose).
//
// Internal cross-references go through `guideLink` below, which addresses the
// target chapter by its own permanent note id (`@noteId#anchor`, see
// src/shared/internalNoteLinks.ts). They used to be written as ordinary
// user-facing `$HELP§CHAPTER-ID#anchor-id` links, which meant the guide was
// reachable by name from any note the user wrote — a second route in,
// competing with the one the User Guide window control owns, and the reason
// "one guide across all slots" had to be defended rather than simply held.
// The guide has no user-facing id now (see helpGuideNote.ts), so that syntax
// would resolve to nothing; the `@noteId` scheme needs none.
import { HELP_GUIDE_CHAPTER_IDS, helpGuideChapterNoteId, type HelpGuideChapterKey } from '../../src/shared/helpGuide'
import { formatInternalNoteLink } from '../../src/shared/internalNoteLinks'
import { SHORTCUT_PANELS, formatShortcut, shortcutsInSection } from '../../src/shared/keyboardShortcuts'

// The table is the shortcut declarations themselves (src/shared/
// keyboardShortcuts.ts), the same list the in-app quick reference draws, so
// the guide cannot describe a binding the app does not have.
function shortcutTable(): string {
  const rows = SHORTCUT_PANELS.flatMap((panel) => panel.sections.flatMap((section) =>
    shortcutsInSection(section.id).map((entry) =>
      `| \`${formatShortcut(entry)}\` | ${[panel.title, section.title, entry.label].filter(Boolean).join(': ')} |`)))
  return ['| Shortcut | Action |', '| --- | --- |', ...rows].join('\n')
}

export { HELP_GUIDE_ROOT_ID, HELP_GUIDE_AUTO_TOC_ID } from '../../src/shared/helpGuide'

/**
 * The destination of one cross-reference from this guide to another of its own
 * chapters, optionally to a named anchor inside it.
 *
 * `chapterId` is typed against the real chapter table, so a reference to a
 * chapter that does not exist cannot be written at all. `anchorId` cannot be
 * typed the same way — it names a heading inside prose — so it is checked by
 * helpGuideLinks.test.ts instead, which resolves every link in this file the
 * way a click does and fails on any that lands nowhere.
 */
function guideLink(chapterId: HelpGuideChapterKey, anchorId?: string): string {
  return formatInternalNoteLink(helpGuideChapterNoteId(chapterId), anchorId ?? null)
}

export interface HelpGuideChapterContent {
  noteId: string
  chapterId: string
  content: string
}

export const HELP_GUIDE_INTRO_CONTENT = `# Thockdown User Guide

Thockdown is a Markdown note app. Each **slot** shows a note in one of two modes: the **Editor**, where you write, and the **Reader**, where the note is shown formatted.

## The Basics
- **New note**: \`Ctrl+N\`. See [Creating Notes](${guideLink('NOTES-EDITING', 'creating-notes')}).
- **Switch modes**: \`Esc\`. See [Editor and Reader](${guideLink('NOTES-EDITING', 'edit-and-preview-modes')}).
- **Quick Actions Menu**: hold \`Esc\`. See [Quick Actions Menu](${guideLink('NOTES-EDITING', 'quick-actions-menu')}).
- **All shortcuts**: hold \`F1\`. Tap \`F1\` to open or close this guide. See [Keyboard Shortcuts](${guideLink('SHORTCUTS')}).
- **Sidebar**: the menu button left of the toolbar. See [Sidebar Views](${guideLink('SIDEBAR-SEARCH', 'sidebar-views')}).
- **Another slot**: the plus at the right of the tab bar. See [Opening a Slot](${guideLink('SPLIT-VIEW-TABS', 'opening-a-slot')}).
- **Touch**: a second finger is the right button; a finger resting on the screen holds \`Ctrl\` for the next one (two hold \`Shift\`).

## Core Concepts
- **Collections** are sets of notes, shown as tabs in the **tab bar** above the editor. Click the collection's name to pick another, right-click it to rename. See [Naming and Swapping Collections](${guideLink('SPLIT-VIEW-TABS', 'naming-and-swapping-collections')}) and [Pinned and Temporary Tabs](${guideLink('SPLIT-VIEW-TABS', 'pinned-and-temporary-tabs')}).
- **Chapters** are notes inside a note, shown in the **chapter bar** below the editor. The house is the parent note; the bookmark adds a chapter. See [Chapters](${guideLink('SPLIT-VIEW-TABS', 'chapters')}).
- **Tags** sort notes into the sidebar's categories. The tag button at the left of the chapter bar switches it to the **tag bar**. See [Adding Tags](${guideLink('TAGS', 'adding-tags')}) and [Tabs and Tags Mode](${guideLink('SPLIT-VIEW-TABS', 'tabs-and-tags-mode')}).
- **IDs** name a note so other notes can link to it. See [Assigning a Note Id](${guideLink('INTERNAL-LINKING', 'assigning-a-note-id')}).

## Worth Discovering
- [Dark mode and double size](${guideLink('TOOLBAR-FORMATTING', 'toolbar-overview')})
- The [music player](${guideLink('MUSIC-PLAYER')}) and its visualizer
- [Options](${guideLink('APPEARANCE-SETTINGS', 'settings-panel')}), especially [layout presets](${guideLink('APPEARANCE-SETTINGS', 'presets')})
- [Keystroke sounds](${guideLink('APPEARANCE-SETTINGS', 'keystroke-sounds')})
`

const HELP_GUIDE_CHAPTER_CONTENTS: string[] = [
  `## Notes & Editing

### [Creating Notes](#creating-notes)
- **Blank note**: \`Ctrl+N\`, the \`+\` at the start of the tab strip, or New Note in the Quick Actions Menu.
- **Note titled from the clipboard**: \`Ctrl+Shift+N\`.
- **Title**: the note's first line, written as \`# Title\`.
- Notes save themselves as you type.

### [Characters the Editor Keeps](#characters-the-editor-keeps)
- Every character takes one box of the editor's grid. Emoji, Chinese, Japanese and Korean characters and invisible characters are left out when typed, pasted or opened.
- A symbol the editor font cannot draw shows as an empty box in the editor; the Reader, search and exports still show it.

### [Editor and Reader](#edit-and-preview-modes)
- **Switch modes**: \`Esc\`, or the pen at the right end of the tab bar.
- **Tick a checklist box**: click it in the Reader.
- In a slot showing the User Guide, \`Esc\` closes it.

### [Quick Actions Menu](#quick-actions-menu)
- **Open**: hold \`Esc\`. **Close**: tap \`Esc\`.
- **Choose**: arrow keys, \`Tab\` or the mouse wheel, then \`Enter\`, \`Space\` or a click.
- Offers New Note, New Chapter, Export, Export All and User Guide.

### [The User Guide](#the-user-guide)
- **Open**: the graduation cap in the window controls, \`F1\`, or User Guide in the Quick Actions Menu.
- **Close**: \`Esc\`, or open any other note.
- Read-only; browse it with its chapter bar.

### [Scrollbar Navigation](#scrollbar-navigation)
- **Travel to a spot**: click the track.
- **Jump there at once**: hold on the track.
- **Page up or down**: right-click above or below the thumb; hold to keep paging.

### [Word and Character Count](#word-and-character-count)
- Below the editor, beside the Time Machine.

### [Line Numbers and Review Flags](#line-numbers-and-review-flags)
- **Show or hide line numbers and flags**: the list button beside the word count. Right-click it for the flags alone.
- **Flag a line for review**: click its box in the flag column (\`?\`); click again for a warning (\`!\`). Right-click to clear.
- **Go to the next flagged line**: the arrow at either end of the flag column, or \`Ctrl+Up\`/\`Ctrl+Down\`.
- Flags stay with the note when the column is hidden.

### [Spell Check](#spell-check)
- **On or off**: Options → [Feature Toggles](${guideLink('APPEARANCE-SETTINGS', 'feature-toggles')}). It checks the slot you are typing in.
- **Dictionaries**: Options → Tools → Spell Checking. Click a dictionary's icon to use it, type over its name to rename it, the pen to see and edit its words. The dock below imports Hunspell dictionaries and resets the open one.
- **Add a word to your User Dictionary**: \`Ctrl+D\`.
- **Correct a word**: \`Shift+Space\` replaces the nearest marked word before the caret; press again for the next suggestion.

### [Typing Trail](#typing-trail)
- A trail along the line you are typing in. **On or off**: [Feature Toggles](${guideLink('APPEARANCE-SETTINGS', 'feature-toggles')}). **Tune**: Options → Glitz → Typing Trail. **Colour**: Colors → Editor Boxes.

### [Visualizer](#visualizer)
- **Grid Beat**: the caret, the edge and the pane of the active slot follow the music. On or off in [Feature Toggles](${guideLink('APPEARANCE-SETTINGS', 'feature-toggles')}); tuned in Options → Glitz → Grid Beat.
- **Visualizer scene**: \`F5\` or the eye in the music player. Tuned in Options → Glitz → Visualizer; its colours are part of the layout.
- **Beat detection**: Options → Advanced → Beat Detection. Every effect mixes three kinds of hits: **Thump** (kick, bass), **Pierce** (snare, clap) and **Tick** (hats, shakers). To line the effects up with what you hear, press the strip at the top: a drum loop plays and the strip flashes on its kick, snare and hats. Right-click for the next loop; press again or Escape to stop. Use Left and Right (Up and Down for steps of 10), or scroll over the strip, until the flashes land exactly on the drums. This sets the **delay** for your current output device.
- In the scene:
  - **Play a song**: click it in the song list on the left.
  - **Add or remove a set**: click it in the list on the right; hold to play that set alone.
  - **Filter songs**: just type. Start with **$** for artists, **§** for albums, **#** for titles. Leaving the field plays the first song that matches.
  - **Volume**: click the bottom bar, or \`Up\`/\`Down\`.
  - **Play or pause**: \`Space\`. **Skip within a song**: \`Left\`/\`Right\`; press twice for the previous or next song; hold to scrub.
  - **Show or hide the panels**: \`Esc\`. **Leave**: \`F5\`.

### [Speed Reading](#speed-reading)
- **Start or stop**: \`F9\`, the book beside the mode button, or the Quick Actions Menu. Settings: [Speed Reading](${guideLink('APPEARANCE-SETTINGS', 'speed-reading-settings')}).
- **Reader**: the page scrolls at your pace. Hold \`Space\` or \`↓\` to pause.
- **Editor**: the note shows a few words at a time from the caret. \`Space\` or \`↓\` for the next words (hold to read on), \`↑\` to go back.
- **Slower or faster**: \`←\`/\`→\`. The word count shows the pace and the time left.
`,
  `## Internal Linking

### [Defining an Anchor](#defining-an-anchor)
- **Make an anchor**: select text and press the anchor button or \`Ctrl+Shift+L\`, or type \`[Label](#anchor-id)\`.
- An anchor id needs to be unique only within its note.

### [Assigning a Note Id](#assigning-a-note-id)
- **Set**: right-click the note's tab.
- Ids ignore case and turn spaces into hyphens.

### [Linking to Notes and Anchors](#linking-to-notes-and-anchors)
- **Make a link**: select text and press the link button or \`Ctrl+L\`. It fills in the last anchor you made.
- \`[text]($#anchor-id)\`: an anchor in this note.
- \`[text]($NOTE-ID)\`: another note.
- \`[text]($NOTE-ID#anchor-id)\` or \`[text]($NOTE-ID§CHAPTER-ID#anchor-id)\`: a place in another note or chapter.
- Without the \`$\`, \`[text](#anchor-id)\` defines an anchor, not a link.
`,
  `## Tags

### [Adding Tags](#adding-tags)
- **Add**: type into the tag bar's field, or click a suggested tag below it.
- The first tag is the note's category, the second its sub-category in the sidebar.

### [Managing Tags](#managing-tags)
- **Delete**: click a tag twice.
- **Rename everywhere**: right-click a tag.
- **Reorder**: drag a tag.

### [Suggested Tags](#suggested-tags)
- Your most-used tags appear beside the field. Right-click the field to show all of them.

### [Protected Tags](#protected-tags)
- \`archived\`, \`deleted\` and \`external\` are set by [archiving](${guideLink('ARCHIVE-TRASH', 'archiving-and-trash')}), deleting and [opening a file](${guideLink('EXTERNAL-FILES', 'opening-an-external-file')}), never typed.
`,
  `## Sidebar & Search

### [Sidebar Views](#sidebar-views)
- The icons at the top switch between **Notes**, **Images**, **Songs**, **Soundscapes**, **Find** and **Options**.
- **Notes** has four sections: **Date**, **Category** (by tag; right-click a group to open it without folding the others), **Archive** and **Trash**.
- **Images**: see [Images](${guideLink('TOOLBAR-FORMATTING', 'images')}). **Find**: see [Find and Replace](${guideLink('FIND-REPLACE', 'find-and-replace')}). **Options**: see [Options](${guideLink('APPEARANCE-SETTINGS', 'settings-panel')}).
- **Songs**: see [Music Player](${guideLink('MUSIC-PLAYER')}). Drop files or folders on a set's icon to add them to it, or between the icons to make a new set.

### [Pagination](#pagination)
- **Turn the page**: the arrows; hold for the first or last page. Right-click the page number to type one.

### [Search](#search)
- The field at the top of the sidebar searches notes by title, text, file name and tag. Start with \`#\` for tags only.
- In Find it searches the open note, in Songs it filters songs, in Options it filters settings.
`,
  `## Split View & Tabs

### [Opening a Slot](#opening-a-slot)
- **Open**: the \`+\` at the right end of a tab bar.
- **Move between slots**: \`Alt+Left\`/\`Alt+Right\`.

### [Closing a Slot](#closing-a-slot)
- **Close**: the chevron at the left of the slot. Right-click it to close the slot to its left.

### [Naming and Swapping Collections](#naming-and-swapping-collections)
- **Name**: right-click the collection's name.
- **Swap in another**: click the name and pick one. Right-click one in the list to delete it; \`···\` empties the slot.

### [Pinned and Temporary Tabs](#pinned-and-temporary-tabs)
- **Open temporarily**: click a note in the sidebar. **Pin**: hold the click.
- **New pinned note**: the \`+\` at the start of the tab strip.
- **Set the note's id**: right-click a tab. **Close**: hold right-click, then click, or the \`×\` at the right end of the tab bar, which closes whatever the slot shows and opens the right-most remaining tab. Closing never deletes a note.
- **Reorder**: drag tabs; drag a note from the sidebar to open it there.
- A tab returns to the chapter you left it on.

### [Tabs and Tags Mode](#tabs-and-tags-mode)
- **Switch the chapter bar to tags and back**: the tag button at its left.
- The tag bar also holds the note's id: right-click it to set the id, click it to show suggested tags.

### [Chapters](#chapters)
- **New chapter**: the bookmark, or New Chapter in the Quick Actions Menu.
- **Open**: click a chapter, or the house for the parent note. **Reorder**: drag.
- **Set its id**: right-click a chapter.
- **Archive or delete**: hold right-click on a chapter, then click one of the two buttons.
- **Split off**: the scissors moves the selection, or everything after the caret, into a new chapter.
- **Merge**: the merge button appends the chapter to the one before it.
- **Copy a note in as a chapter**: drag it from the sidebar onto the chapter bar.
- **Table of Contents** and **Open Items** (unticked checklist items) appear on their own. Clicking one of their links or checkboxes acts on the real note.
- Tags belong to the parent note. Deleting the parent deletes its chapters.
`,
  `## Archiving, Trash & Deletion

### [Archiving and Trash](#archiving-and-trash)
- **Archive or trash a note**: hover its card and hold the box or the trash can. In Trash, holding the trash can deletes it for good.
- An external note offers save and close instead.
- In Archive, a parent with archived chapters folds open to show them.

### [Restoring from Archive or Trash](#restoring-from-archive-or-trash)
- **Restore**: hold the turning arrow on a card. A chapter returns to its old place.

### [Empty Trash](#empty-trash)
- **Empty**: hold the Trash section's icon.
`,
  `## Time Machine

### [Time Machine Timeline](#time-machine-timeline)
- The slider below the editor holds the note's saved versions, oldest left.
- **Step**: \`←\`/\`→\`; \`Home\`/\`End\` for oldest and present. **Zoom**: the mouse wheel.

### [Viewing a Past Revision](#viewing-a-past-revision)
- **View**: click a mark. **Return**: the present-state circle.

### [Present-State Circle](#present-state-circle)
- Hollow means changed since your last save point. **Make a save point**: click it.
- **Tidy the automatic versions**: hold it.
- On Table of Contents and Open Items it refreshes them.

### [Branching from History](#branching-from-history)
- **Copy a version into a new note**: hold right-click on its mark.

### [Freezing a Note in Time](#freezing-a-note-in-time)
- **Freeze or unfreeze**: the snowflake below the Reader.
- A frozen note cannot be changed. Freezing deletes its history.
`,
  `## Toolbar & Formatting

### [Toolbar Overview](#toolbar-overview)
- **Dark mode**: the top half of the split button at the left; **double size**: the bottom half. Font sizes are kept separately for each size.
- The rest are formatting buttons. They act on the active slot.

### [Formatting Group](#formatting-group)
- Bold, italic, strikethrough, headings, lists, checklists, quotes, code, rules, [tables]($#tables), links and table of contents.
- In the Reader a formatting button switches to the Editor instead.
- **Tick a checklist item in the Editor**: type a character between its brackets, or click the caret there.

### [Tables](#tables)
- **Start or tidy a table**: the table button, or type \`|\`.
- \`Tab\`/\`Shift+Tab\`: next or previous cell. \`Enter\`: new row; in an empty last row, ends the table.
- **Align a column**: click the left, middle or right of its part of the divider line.
- **Select cell, row, table**: right-click repeatedly.
- **Move rows and columns**: \`Ctrl+Shift+Arrows\`, or drag a selected cell.
- **Delete a column**: \`Ctrl+Shift+Backspace\`, or hold its part of the divider.
- **Empty a cell**: \`Shift+Backspace\`.

### [Images](#images)
- **Add**: drop or paste an image file, or drag one from the Images view.
- **Align**: \`Ctrl+Shift+←\`/\`→\`. **Resize**: \`Ctrl+Shift+↑\`/\`↓\`. **Reset**: \`Shift+Backspace\`.
- **In the Reader**: \`Ctrl\`+drag to move (or out of the slot to remove), \`Shift\`+drag to resize, \`Ctrl\`+drag an edge to crop, \`Ctrl\`+right-click to uncrop.
- **Store web or file images in the app**: hold the image button beside the word count; hold right-click to point them back.
- **Images view**: **Images in Order** and **Images by Section** list the note's images; click one to go to it. **Image Archive** holds every stored image by tag; drop files or folders on it to add them. Right-click an image to see it whole.
- **Select alt text, id, image**: right-click repeatedly.
`,
  `## Find & Replace

### [Find and Replace](#find-and-replace)
- **Find**: \`Ctrl+F\`. **Replace**: \`Ctrl+H\`, or the mode button in the dock.
- **Go to the marked match**: \`Enter\`. **Switch fields**: \`Tab\`.
- **Replace all**: \`Ctrl+Enter\`, the replace-all button, or right-click the Find icon.
- **Aa**: match case; while replacing, keep the case. The whole-word button skips matches inside words.
- **Step through matches**: the pager's arrows; right-click the count to type a number.
- The Editor searches the Markdown, the Reader only the visible text.
- To search all notes, use [Search](${guideLink('SIDEBAR-SEARCH', 'search')}).
`,
  `## External Files

### [Opening an External File](#opening-an-external-file)
- **Open**: open a Markdown file with Thockdown, or drop it on a slot. It is listed under Notes → External.
- The file changes only when you save. If it changes on disk, the note follows, unless you edited it too.
- [Characters the editor does not keep](${guideLink('NOTES-EDITING', 'characters-the-editor-keeps')}) are removed.

### [Saving an External File](#saving-an-external-file)
- **Save**: the save icon on its card.

### [Converting an External File to a Regular Note](#converting-an-external-file-to-a-regular-note)
- **Convert**: remove its \`external\` tag ([Managing Tags](${guideLink('TAGS', 'managing-tags')})). The file stays as it is.
`,
  `## Import & Backup

All in Options → Advanced → Data.

### [Export All Notes](#export-all-notes)
- Writes every note and image to a folder of plain Markdown and image files, sorted by tag.

### [Import](#import)
- **Add notes**: pick \`.md\` or \`.txt\` files.
- **Restore an export**: pick its \`thockdown.json\`.
- The toggle beside the button decides whether a clashing id is renamed on the imported side or on yours.

### [Back Up All Notes](#back-up-all-notes)
- **Back up**: the database button. A backup is also made on each start.
`,
  `## Export

### [Export to PDF](#export-to-pdf)
- Hold \`Esc\` → Export, in the Reader.

### [Export to Markdown](#export-to-markdown)
- Hold \`Esc\` → Export, in the Editor.

### [Export All](#export-all)
- Exports the parent note and all its chapters as one document.
`,
  `## Keyboard Shortcuts

Hold \`F1\` to see this list over the window.

${shortcutTable()}
`,
  `## Window Controls

- **Music player**: see [Music Player](${guideLink('MUSIC-PLAYER')}).
- **Mini mode**: shrinks the window to the music player; the button on its right expands it again.
- **Immersive mode**: \`Ctrl+Shift+Space\`. Only the active editor, full screen; the rightmost column of boxes is its scrollbar.
- **User Guide**: the graduation cap. See [The User Guide](${guideLink('NOTES-EDITING', 'the-user-guide')}).
- **Move the window**: drag the toolbar or this bar. **Maximize**: double-click either.
`,
  `## Appearance & Options

### [Options](#settings-panel)
- **Open**: the cogwheel in the sidebar. The buttons at the top pick a section.
- Only **Layouts** belongs to a layout; every other setting is the same for all layouts.
- **Adjust a slider**: drag or scroll over it; right-click to type a value.

### [Editor Font](#editor-font)
- Options → General → Editor Font and Reader Font.
- **From the text**: \`Ctrl\`+wheel for size, \`Ctrl+Alt\`+wheel for spacing, \`Ctrl+Shift\`+wheel for line height, in the mode under the pointer.

### [UI Font](#ui-font)
- Options → General → UI Font: the font of the app's own controls.

### [Feature Toggles](#feature-toggles)
- Options → General → Feature Toggles: [Spell Check](${guideLink('NOTES-EDITING', 'spell-check')}), the [custom cursor]($#mouse-options), [keystroke sounds]($#keystroke-sounds), [Grid Beat](${guideLink('NOTES-EDITING', 'visualizer')}) and [Typing Trail](${guideLink('NOTES-EDITING', 'typing-trail')}).
- A feature that is off costs nothing; its settings stay adjustable.

### [Presets](#presets)
- Options → Layouts → Presets. Changes are kept in the layout you use; there is nothing to save.
- **New layout**: the plus copies the current one.
- **The dock at the bottom**: click the icon to pick another, right-click the name to rename, the turning arrow to reset, hold the last button to trash your own or restore a built-in one.
- **Export a layout**: hold right-click on it.
- Soundstages, keystroke sounds, flashing and the visualizer (Options → Glitz → Visualizer) work the same way.

### [Colors](#colors-and-textures)
- Options → Layouts → Colors.
- **Pick up a colour**: click it; the picker then paints it. **Paint with the picker's colour**: right-click a colour.
- **H**, **S**, **V**, **A**: which channels a right-click paints.
- **Textures**: pick up a surface to edit its texture.

### [Borders](#borders-and-spacing)
- Options → Layouts → Borders: border widths, corners and spacing.

### [Glaze](#glaze)
- Options → Layouts → Glaze: decorative light layers over the app.

### [Filters](#filters)
- Options → Layouts → Filters: colour filters over the whole app.

### [Cursor](#mouse-options)
- Options → Layouts → Cursor: the animated cursor. On or off in [Feature Toggles]($#feature-toggles); colours under Colors → Cursor.
- While you hold a button for a hold gesture, the halo grows; it is full when the gesture happens.

### [Caret](#caret)
- Options → Layouts → Caret: size, outline, halo and blur of the caret. Colours under [Colors]($#colors-and-textures).

### [Animations](#animations)
- Options → Advanced → Movement: how the app's own scrolling moves.
- Options → Advanced → Flashing: how the caret blinks. **Curve**: click to add a point, drag to move, right-drag to round, right-click to remove. **Matching** times the blink to the music's beat.
- Options → Advanced → Tooltips: their delay, and which parts they show.

### [Scrolling](#scrolling)
- Options → Advanced → Scrolling.
- **Step**: how far one wheel notch goes in the Editor and the Reader.
- **Auto scroll**: spin the wheel and the text keeps going; one more notch, typing or a click stops it. **Dampen** and **cut off** set how long it runs.

### [Speed Reading](#speed-reading-settings)
- Options → Tools → Speed Reading: the pace in each mode, the Editor's row and pause per chunk, and how it eases. See [Speed Reading](${guideLink('NOTES-EDITING', 'speed-reading')}).

### [Keystroke Sounds](#keystroke-sounds)
- Options → Sound → Keystroke Sounds. On or off in [Feature Toggles]($#feature-toggles).
- **Channels**: click to show one, hold to turn it on, hold right-click to turn it off, scroll to set its volume.
- **Mix**: all channels together. **Spatial**: left pans by key position, right by caret position.

### [Soundscapes](#soundscapes)
- **Play or stop**: the Soundscape button in the music player; right-click it for the next one. **Volume**: Ambient.
- **Choose and edit**: the Soundscapes view in the sidebar. Changes are kept in the soundscape; the plus copies it. The dock works like the [layout dock]($#presets).
- **Channels**: click to show, hold to turn on, hold right-click to turn off, right-click to solo, scroll for volume. On touch: hold to turn on or off, double-tap to solo, drag for volume.
- **Environment**: the sliders above the channels act on all of them. **Size** and **foliage** make the place, **brilliance** the clarity, **amount** how much of the place you hear, **gusts** and **pace** the weather. A channel's **weather** slider sets how much it follows the weather.
- Every channel has a **distance**; most have a **pan**. Layer one kind near and far for depth.
- **Export a soundscape**: hold right-click on it.

### [Data](#data-synchronization-settings)
- Options → Advanced → Data: [Export All Notes](${guideLink('IMPORT-BACKUP', 'export-all-notes')}), [Import](${guideLink('IMPORT-BACKUP', 'import')}), [Back Up All Notes](${guideLink('IMPORT-BACKUP', 'back-up-all-notes')}), and import or export of layouts (\`.tdl\`) and soundscapes (\`.tds\`).

### [Debugging](#debugging)
- Options → Advanced → Debugging: opens developer tools.
`,
  `## Music Player

In the middle of the window's top bar.

- **Play or pause**: **Music**.
- **Skip forward**: right-click **Music**. **Next song**: hold right-click on **Music**.
- **Volume**: the **Music** and **Ambient** sliders.
- **Filter what plays**: **Filter**, then type; it applies when you leave the field. \`Esc\` empties it.
- **Soundstage**: **Headphones**, then pick one.
- **Visualizer**: the eye, or \`F5\`. See [Visualizer](${guideLink('NOTES-EDITING', 'visualizer')}).
- **Soundscape**: see [Soundscapes](${guideLink('APPEARANCE-SETTINGS', 'soundscapes')}).
- **Media keys** and your system's media controls work too.

### Sets
- **Choose what plays**: in the Songs view, click a set's icon to add or remove it; hold it to play that set alone.
- **Open a set's songs**: right-click its icon. Click a song to play it.
- **New set**: the plus. **Reorder**: drag the icons.
- **Add songs**: the file and folder buttons below the songs, or drop files.
- **Rename**: right-click the set's name. **Change its icon**: click it.
- **Delete a set**: hold its X. **Remove songs**: hold the X on a song or a heading.
- A song can be in several sets.
`,
  `## Data Storage

- Everything stays on your computer. Nothing leaves it unless you export it.
`,
]

export const HELP_GUIDE_CHAPTERS: HelpGuideChapterContent[] = HELP_GUIDE_CHAPTER_IDS.map((idPair, index) => ({
  ...idPair,
  content: HELP_GUIDE_CHAPTER_CONTENTS[index],
}))
