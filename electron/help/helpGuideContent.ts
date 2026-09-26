// Prose content for the built-in User Guide. Each entry becomes one real,
// protected note in the database: HELP_GUIDE_INTRO_CONTENT is the parent
// note's own body, HELP_GUIDE_CHAPTERS is one chapter per topic (in display
// order). Content only — seeding lives in helpGuideNote.ts; the ids these
// pair with live in src/shared/helpGuide.ts (shared with the renderer,
// which needs them without needing this ~800 lines of prose).
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


Hey there! Love the learning mindset!

## The Basics
Let's get you started: At its most basic, Thockdown is about
- **writing notes** in the **[Markdown Editor](${guideLink('NOTES-EDITING', 'edit-and-preview-modes')})** and
- **reading notes** in the **[Markdown Renderer](${guideLink('NOTES-EDITING', 'edit-and-preview-modes')})**.

You can 
- hit **Ctrl+N** to create a [**new note**](${guideLink('NOTES-EDITING', 'creating-notes')}),
- [**toggle**](${guideLink('NOTES-EDITING', 'edit-and-preview-modes')}) between editor and renderer using the **Escape**-key,
- **hold Escape** to bring up the [quick access note menu](${guideLink('NOTES-EDITING', 'quick-actions-menu')}),
- use the [**side bar**](${guideLink('SIDEBAR-SEARCH', 'sidebar-views')}) to find the notes you created again later and (**menu** button to the left of the bar above)
- create additional editor [**slots**](${guideLink('SPLIT-VIEW-TABS', 'opening-a-slot')}) for side by side work (**plus** button to the right of the bar above).

*If you want to, you can leave it at that and explore on your own. If you are a structural learner, however, it might be a good idea to spend a moment to familiarize yourself with a few core concepts.*

## Core Concepts and Basic Editor Layout

The **notes** you create can be...
- kept together by pinning them to [**collections**](${guideLink('SPLIT-VIEW-TABS', 'naming-and-swapping-collections')}),
- structured by splitting them into [**chapters**](${guideLink('SPLIT-VIEW-TABS', 'chapters')}),
- categorized by using [**tags**](${guideLink('TAGS', 'adding-tags')}) and
- referenced easily by assigning a unique [**ID**](${guideLink('INTERNAL-LINKING', 'assigning-a-note-id')}).

These systems are literally **surrounding your editor** and figuratively (or, possibly, also *literally* if you happen to be working on a touch-capable device) right at your fingertips.

### Collections
***Collections work like browser tabs.***
- You can find the **collection bar** right **above your editor**. ([Pinned and Temporary Tabs](${guideLink('SPLIT-VIEW-TABS', 'pinned-and-temporary-tabs')}))
  - Each tab represents one note.
  - The tabs show that note's ID.
- Each collection has a name that is displayed to the left of the note tab bar.
  - Left click that button to pick a different collection to show.
  - Right click that button to rename the collection.

### The Dual Tag and Chapter Bar
- You can find the dual mode **chapter** and **tag** bar **below the editor**.
- You can toggle between both modes using the **tag toggle button** on the very left. ([Tabs and Tags Mode](${guideLink('SPLIT-VIEW-TABS', 'tabs-and-tags-mode')}))
  - New notes shows the **tag bar** by default until they have an ID.
  - Notes with IDs show the **chapter bar** by default.

### Tags
***Tags determine how your notes are categorized in the [sidebar category view](${guideLink('SIDEBAR-SEARCH', 'sidebar-views')}).***
- You can assign an ID to your note with the button to the left.
- You can assign tags by interacting with the tag bar itself. ([Adding Tags](${guideLink('TAGS', 'adding-tags')}), [Managing Tags](${guideLink('TAGS', 'managing-tags')}))

### Chapters
***Chapters are nested notes within a note.***
- When you create a chapter, think of the original note as the parent note that may contain a preface or introduction.
- The parent note can be accessed via the house button.
- You can create chapters by hitting the new chapter button that sits to its left.

### Go Explore!

Seriously. This app has plenty of tooltips. You don't have to learn every system right away. You can have a lot of fun and success with this app without going full power user. Have fun and enjoy the trip.

But if you've committed to the guide this far, you deserve to be pointed towards the most satisfying discoveries waiting for you to be made:

- The [**double size** and **dark modes**](${guideLink('TOOLBAR-FORMATTING', 'toolbar-overview')}).
- The immserive low distraction [**music player**](${guideLink('MUSIC-PLAYER')}).
- The endless [**customization options**](${guideLink('APPEARANCE-SETTINGS', 'settings-panel')}) in the sidebar options menu.
- Particularly the [**layout presets**](${guideLink('APPEARANCE-SETTINGS', 'presets')}).
- The app's namesake feature: [**Thocky typing sounds**](${guideLink('APPEARANCE-SETTINGS', 'keystroke-sounds')})!
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
> The pen icon at the right of the tab bar, next to the "+", or \`Esc\`.

*Toggles between the raw Markdown you type and the rendered, formatted view.*

- Preview renders GitHub-Flavored Markdown: headings, bold/italic/strikethrough, lists (including task checklists with ☐/☑), tables, blockquotes, syntax-highlighted code blocks, horizontal rules, images, and links.
- A task checklist's box is clickable right there in preview, same as [clicking its caret in edit mode](${guideLink('TOOLBAR-FORMATTING', 'formatting-group')}) — it's the same checkbox either way, so the note's own text (and edit mode's view of it) updates immediately.
- \`Esc\` also blurs a focused field (like search) before it starts toggling modes, so it's safe to hit repeatedly.
- **In a slot that isn't showing a note** — the User Guide, or the adventure — there is no other view to switch to, so the same button becomes an **exit** and closes what the slot is showing. \`Esc\` follows it, because \`Esc\` *is* that button: one key, one position, one meaning — leave whatever this slot is currently doing.

### [Quick Actions Menu](#quick-actions-menu)

> **Where?**
> Hold \`Esc\` for about a quarter of a second, anywhere in the editor area — works with a note open, an empty editor, or a read-only auto-generated one (Table of Contents, Open Items, the User Guide, ...).

*A small on-editor grid for the note actions you reach for most, without leaving the keyboard.*

- Keeps showing while you hold \`Esc\`; tapping \`Esc\` once more dismisses it without doing anything. Clicking outside it does *not* — the menu is only ever dismissed deliberately, so a stray click can't end something you were in the middle of.
- Navigate with the arrow keys, \`Tab\`/\`Shift+Tab\`, or by rolling the mouse wheel while the pointer is over the menu — one notch is one step, the same as one arrow press. The choices turn *under* the pointer, so you can leave the mouse where it is, wheel until the one you want is beneath it, and click: the whole menu is reachable without moving the mouse at all. Then \`Enter\`/\`Space\` or a click to run the highlighted action. Running an action closes the menu — unless it's something that carries on *inside* the menu, in which case the menu stays up and its cells change to whatever comes next.
- Currently wired up: New Note, New Chapter, Export, Export All, Help (opens this page — see [The User Guide]($#the-user-guide)). New Note and Help always work; New Chapter and Export only appear with a note open (New Chapter not for a note that can't take one, like a read-only auto-generated chapter), and Export All only for a note that has chapters — see [Export All]($#export-all). The remaining grid cells are reserved for future actions.

### [The User Guide](#the-user-guide)

> **Where?**
> The lightbulb button in the window controls (top right, above Maximize), or the Help button in the Quick Actions Menu above — both do the same thing.

*This page, opened as an ordinary (timeless, read-only) note in whichever slot you triggered it from.*

- Opens exactly like clicking any note in the sidebar does — as a temporary tab, replacing whatever that slot was showing. Leave it with the **exit button** where that slot's [edit/render toggle](${guideLink('NOTES-EDITING', 'edit-and-preview-modes')}) normally sits, or with \`Esc\`, which is the same button. Picking another note, a pinned tab, or anything from the sidebar also leaves it, the ordinary way.
- Browsable with the same chapter bar every note with chapters uses — click a chapter pill to jump to it, or the bookmark icon for a full table of contents.
- Always render-only: nothing here can be edited, renamed, tagged, archived, or deleted.
- **Right-click** this button and you get something else entirely: **ThockQuest**, a small choose-your-path adventure. The button lights up and turns into a flame, the slot is set aside (whatever it was showing comes back afterwards), and the quick actions menu opens over the empty editor with your choices on it. Each cell is one choice and the menu stays up as you make them; where you are is written across the tab bar above, and how you're doing on the bar below. Leave with the exit button where that slot's edit/render toggle normally sits, by pressing \`Esc\`, or by pressing the flame button again — the menu is the game here, so putting it away puts the game away with it. There's also a **Leave the game** choice on the opening screen, for anyone who arrived by accident and wants straight back out.
- The bars and rails around the empty editor become the game's own while it runs: **what you are carrying** shows as icons where a note's history timeline sits — items from the left, traits from the right — and hovering one tells you exactly what it is doing for you, with live numbers. Those icons are one of the two things you press outside the menu: **click one to keep it** when the level ends — one item and one trait, everything else left behind. Whatever is lit is what you keep, and it starts on the newest things you found, so you only have to press anything if you disagree. The **level, the encounter and the stage** read where the word count would be — \`V-3\` is the third of a level's ten encounters, and it moves on once the spoils of the last one are behind you. The **rail down the right** is the other thing you can press: two bars, fame above and stat points below, each filling toward its next point, with the number waiting to be spent at its foot. **Click either bar** to go to where those points are spent — whether or not one is waiting, and from any screen, including mid-fight; you come straight back to what you were doing if you choose nothing there.
- **You are four things, and so is everything you fight.** A **build** is an adjective — *Hulking*, *Erudite*, *Sly* — and it decides the *shape* of your stats rather than the size: it is a set of proportions, so the same build reads the same at the start of a run and at the end of one. A **tier** is the size, one number, and it is the budget your build divides up; you begin at five. A **species** is what you *are* — one of the peoples — and carries everything about you that is not a stat. A **class** is what you *do* when it comes to blows. Character creation asks for all three of the ones you choose, one screen each, and then for the trait and the item you set out with. You are offered six of each, drawn for this run, so the character in front of you is not the character the next run will offer. **All four stay readable on the upper bar**: your tier as a figure, then three small square pills carrying the icons of your build, your species and your class — hover one for its name, and the build's for the weights it splits your tier by, written as repeated initials (*Sly (AAP)* is two parts Agility to one of Perception).
- **Read a monster's name and you know what it is**, because it is made the same way: *Sly Harpy Bruiser*, *Champion Hulking Orc Duelist*. The first word is its rank where it has one — **Runt**, **Elite**, **Champion**, **Overlord** — then its build, its species and its class, and an ×2 or ×3 where there is more than one of them. Hover it for its tier, which is the single number worth comparing two offers by, and for what its class will do to you. The small ones travel in company: a runt always has at least one friend, an ordinary monster often has one, and nothing above that comes with help.
- **Your class renames the cell it changes.** A Duelist's *Defend* reads **Riposte**, a Juggler's *Attack* reads **Flurry**, and an Assassin's first attack of a fight reads **Ambush** — the cell is in its usual position doing its usual job, and the different name is your class taking it over. Some fire every time, some on the first action of a round, some only at a given state of **Health**, and some on a roll — so a cell that changed its name since last action is your class having come up. Hover it to see exactly what pressing it is worth. Nothing is ever *added* to the ring by a class, so the order you are used to pressing never moves.
- **Fame buys your tier**, alongside what you can carry: *Ascendant* is one fame point for five more points of stat budget, up to five of them. It is the only purchase that changes what you *are* rather than what you may hold — and because your build divides the budget, the points land in the proportions you chose at the start rather than wherever you put them.
- **Fighting is meant to be fast, and the menu is arranged so it can be.** On your own action the choices are always in the same order: any magic you have this round, strongest first, then a plain **Attack**, then **Prepare**. The first one is the one worth taking, so a run of fights can be played by pressing the same position over and over — you only have to think when you want to. Everything stacks, so nothing is ever wasted: a second curse bites twice as hard, and a second Prepare doubles what the attack is loaded with.
- **Prepare** skips your attack this action and loads the next one with *everything* you have — and you can do it twice in a row to double it — more damage, more chance to land, more chance to crit, a chance to strike twice, a chance to end the monster's round outright, and your best spell fired on top of it. One press, one payoff. While it's loaded the attack reads **Attack, aimed** and its description says what it will do.
- **Magic comes from Intellect, and it's dealt fresh each round** rather than learned. The sharper the mind the more of the list is in reach, and reaching one spell brings every weaker one with it — so some rounds you have nothing and some you have all six. Magic never misses, can't be dodged, and goes straight through armour, which is what makes it the answer to the armoured things you'll meet.
- **Charisma you never press at all.** At the start of a round it may take hold of the monster: at worst it forgets what it was doing, at best it turns on itself or simply gives up and dies. A single mask pill on the lower bar says how many of those are running this round — hover it to see which. When one fires you'll see the mask in place of the blow that never came.
- **How hurt you are is three named states**, and effects use them by name: you are **maimed** below a third of your Health, **injured** below two thirds, and **healthy** at two thirds or above. Injured includes maimed — something that rewards being hurt keeps rewarding it all the way down, rather than switching off at the worst possible moment — and healthy is exactly the other side of that line. A trait reading *+50% Damage injured* is live from the moment you drop below two thirds; one reading *+40% Dodge healthy* is live until you do.
- **A blow's damage is a range, and two stats read it.** The number you see on your character is the *most* a blow can do; what actually lands is rolled below it. **Perception** tightens that range — at 6 it closes entirely and you do full damage every time, and gear that pushes you past 6 starts pushing the range *above* full instead. **Luck** doesn't add damage; it gives you an extra roll per point and keeps the best one, so it can save you from a bad swing but never beat a good one.
- **Hovering any pill on the lower bar spells it out — and shows the maths.** The fight is told in glyphs to keep it short, so the tooltip is where each one says what it means *and* what it actually rolled: \`Hit: 41|60\` is "rolled 41, needed under 60", and \`Damage: 11 = 5 (4-7, best of 2) x 2 crit\` is "rolled a 5 out of a possible 4 to 7, taking the better of two rolls, then doubled it". Those are the numbers the fight used, not a re-reckoning, so what you read there is exactly what happened.
- **How hard it is is decided outside the game**, in the settings panel's [ThockQuest section](${guideLink('APPEARANCE-SETTINGS', 'thockquest-settings')}): how fast monsters outgrow you, how far the rolls are tilted your way, and whether those two are an override you can move mid-run or a commitment the run is played out at.
- **Hold the space bar to play on.** Tapping space takes the choice you are sitting on, the same as \`Enter\`; holding it keeps taking choices by itself, at a rate you set and stopping where you said to stop — both of those in that same [ThockQuest section](${guideLink('APPEARANCE-SETTINGS', 'thockquest-settings')}), and set to carry nothing until you say otherwise. Letting go stops it wherever it has got to. It is for the fights whose shape you already know.
- **Coming back always starts at the opening screen**, offering to continue or to begin again. Continuing puts you back on the exact screen you left, mid-decision if that's where you were; starting a new adventure clears the old one. The run is saved where it stands, so leaving is never a cost.

### [Scrollbar Navigation](#scrollbar-navigation)

> **Where?**
> The scrollbar track alongside the editor, in both edit and preview mode.

*Left-click jumps straight to a spot; right-click pages up or down, one screen at a time.*

- Left-click anywhere on the track to travel to that position — a smooth ride, so you keep your bearings and see what you're passing.
- **Hold** the left button on the track instead, for about a quarter of a second, and it snaps there instantly rather than travelling. The jump happens while the button is still down, so the gesture shows you what it does the first time you try it. Use it when you already know where you're going and the journey is just in the way.
- Right-click above or below the thumb to page up/down once, the same as pressing \`Page Up\`/\`Page Down\`. Right-clicking on the thumb itself does nothing.
- Hold the right click down to keep paging continuously, just like holding \`Page Up\`/\`Page Down\` on the keyboard. It stops when you release the button, or as soon as the thumb reaches your cursor.
- **What the thumb measures depends on the size of the note.** On a smaller note it represents actual screen space, the way a scrollbar normally does, so you keep the familiar sense of orientation as you write. On a larger one — which in practice usually means an external file — it represents character count instead, to give you an exact idea of how much information is left in the document regardless of that note's internal geometry.
- That second reading is why, on a large note in render view, your position means the same thing whatever your view settings are: changing the font size or the pane width can re-flow every line without moving the thumb, and dragging it to the bottom of the track lands at the end of the note whether or not you've read your way down there before.
- **Where that line falls is yours to move.** The **note size threshold** slider in [Performance]($#performance) sets how many paragraphs a note may have before it switches to the second reading, and a toggle beside it puts every note on the character reading regardless of size.

### [Word and Character Count](#word-and-character-count)

> **Where?**
> Beneath the editor, next to the Time Machine slider.

*A live word and character count for the note you're currently viewing.*

- Updates as you type; shown only while a note is open.

### [Line Numbers and Review Flags](#line-numbers-and-review-flags)

> **Where?**
> The list-number icon next to the Word and Character Count panel.

*A toggleable gutter: true (unwrapped) line numbers on the left, a review/warning flag column on the right, both fit into the editor's existing grid.*

- Toggling is per open editor (split-view slot) — each slot remembers its own on/off state independently, and a freshly opened slot always starts with it off. It's not tied to which note or chapter happens to be showing in that slot.
- Left-click toggles both columns together, based on whether line numbers are currently shown: off shows both, on hides both. Right-click toggles the review-flag column alone, leaving line numbers as they are.
- Line numbers count actual Markdown source lines, not wrapped visual rows: a long wrapped line gets one number, shown beside its first row, with the rest of its rows left blank.
- Click a line's box in the flag column to mark it for review (\`?\`); click again to escalate it to a warning (\`!\`); click again to go back to \`?\`. Either state tints the whole line (all of its wrapped rows) in the review or warning color. Right-click the box to clear the flag entirely — the only way to remove one.
- Flags are saved permanently per note (or chapter) regardless of whether the gutter is currently shown — toggling the gutter off only hides them, it never deletes them.
- Review and warning colors (plus the gutter's own background) are customizable from Settings alongside the other box colors.
- When a flagged line sits above or below what's currently visible, the flag column's topmost or bottommost box swaps to an up or down arrow — click it (or press Ctrl+Up/Ctrl+Down) to smooth-scroll to and center that flagged line. If the box showing the arrow is itself already flagged, clicking centers that line instead of jumping past it.

### [Spell Check](#spell-check)

> **Where?**
> Settings panel → Tools.

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
`,
  `## Tags

### [Adding Tags](#adding-tags)

> **Where?**
> The tag input field in the chapter bar's tag view (toggle it with the tag icon at the bar's left edge).

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
- Too many tags to fit scrolls horizontally, fading at whichever edge has more off-screen, same as the tab and chapter bars.

### [Suggested Tags](#suggested-tags)

> **Where?**
> Below the tag input field, in tag-mode.

*A shortlist of your frequently-used tags, one click away from being added.*

- Click a suggested tag to add it instantly to the current note.
- Tags already on the note, and protected tags, are excluded from suggestions.
- Suggestions only ever use space the note's own tags don't need: as the tag list grows, the least-used suggestions drop off one at a time — always whole, never half a pill — and once the note's own tags no longer all fit, no suggestion is shown at all.
- Right-click the tag input field to expand the suggested list to fill the whole bar; right-click again (anywhere in the expanded view) to collapse it back.

### [Protected Tags](#protected-tags)

> **Where?**
> Never typed directly — applied automatically by the corresponding action.

*Four reserved tag names (\`archived\`, \`deleted\`, \`external\`, \`debug\`) that track note state rather than your own organization.*

- Set and cleared only through [Archiving and Trash](${guideLink('ARCHIVE-TRASH', 'archiving-and-trash')}), [Restoring from Archive or Trash](${guideLink('ARCHIVE-TRASH', 'restoring-from-archive-or-trash')}), [Opening an External File](${guideLink('EXTERNAL-FILES', 'opening-an-external-file')}), and [Debugging](${guideLink('APPEARANCE-SETTINGS', 'debugging')}).
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
- A sixth icon opens Settings, which replaces the sidebar content rather than being a note-browsing view — see [Settings Panel](${guideLink('APPEARANCE-SETTINGS', 'settings-panel')}).

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

### [Opening a Slot](#opening-a-slot)

> **Where?**
> The \`+\` button at the very right edge of any tab bar (not the leading \`+\` pill inside the tab strip itself — that one creates a note instead, see [Pinned and Temporary Tabs](#pinned-and-temporary-tabs)).

*Splits the editor into an additional side-by-side slot.*

- Hidden once there's no more room for another 300px-minimum-wide slot.
- \`Alt+Left\` / \`Alt+Right\` step between slots directly — Alt rather than Ctrl so it never collides with the editor's own word-jump caret navigation.

### [Naming and Swapping Collections](#naming-and-swapping-collections)

> **Where?**
> A collection's identity tab.

*Gives a collection a name so you can swap it in and out of any slot instead of rebuilding it.*

- Right-click the identity tab to name the current collection.
- Left-click the identity tab to open a picker of your other named collections — click one to swap it into this slot.
- Right-click a candidate in that picker to delete it permanently; the leading \`···\` pill clears the current slot back to empty (no note, no tabs, no name).

### [Closing a Slot](#closing-a-slot)

> **Where?**
> The chevron button on the left edge of any non-leftmost slot.

*Closes a split-view slot entirely.*

- The leftmost slot shows the sidebar toggle in this spot instead, since it can't be closed.

### [Tabs and Tags Mode](#tabs-and-tags-mode)

> **Where?**
> The tag icon at the left edge of the chapter bar.

*Switches the chapter bar between a note's content structure (its chapters) and its metadata (its id and tags).*

- Tags belong to a note, never to a collection or a chapter, which is why they live on this bar rather than the tab bar above it. The tag view also carries the note's own id button: right-click it to give the note an id of your own (see [Assigning a Note Id](${guideLink('INTERNAL-LINKING', 'assigning-a-note-id')})), or left-click it to fill the bar with suggested tags.

### [Pinned and Temporary Tabs](#pinned-and-temporary-tabs)

> **Where?**
> A collection's tab bar.

*Keeps one note open temporarily, or several open permanently, per collection.*

- The leading \`+\` pill in the tab strip creates a brand-new note and pins it as this collection's own rightmost tab in one step — the quickest way to attach a fresh note to whichever collection you're looking at, active or not.
- Clicking a note in the sidebar opens it as a single temporary tab (replacing any previous one). Its label is the note's own \`$id\` if you've assigned one (shown upright), or otherwise a short preview pulled live from the note's own first line (shown in italics, so the two never look alike) — never a placeholder minted on your behalf.
- Holding the click past a short threshold pins it as a permanent tab instead, which stays open alongside others — pinning doesn't assign an id either, it's still whichever of the two labels above already applied.
- A quick right-click on any tab (pinned or temporary) turns it into an editable field for that note's \`$id\` — same as [Assigning a Note Id](${guideLink('INTERNAL-LINKING', 'assigning-a-note-id')}). Holding the right-click past a short threshold arms it for unpin/close instead; release early and it's a rename, hold it and a follow-up left-click confirms the close (move the pointer away to cancel either way).
- Drag tabs to reorder them; drag a note from the sidebar directly into a tab bar to open it there.
- Each tab remembers which chapter of its note you last had open, per collection — switching away and clicking back returns you to that chapter, not always the parent's own base content. This is remembered per tab, not per note, so the same note pinned as a tab in two different collections can be resting on two different chapters at once.

### [Chapters](#chapters)

> **Where?**
> The chapter bar's own trailing \`+\` pill, right below the tab bar — or the bottom utility bar's New Chapter action (\`Shift+Alt+N\`), which does the same thing.

*Splits a note into sub-notes, browsable from a bar of their own.*

- The chapter bar is always showing for whatever note is open, with or without chapters yet — there's no manual show/hide toggle, and no need to reach for the bottom utility bar just to start a note's first chapter. Either \`+\` (the chapter bar's own trailing pill, or the bottom utility bar's New Chapter action) creates a new empty chapter and switches straight to it. \`Shift+Alt+N\` does exactly the same thing from the keyboard.
- The bar's leading icon buttons, before the tab strip, act on the slot as a whole rather than on one chapter: an **edit/render toggle** (the pen icon, lit while you're in edit mode — the same switch \`Esc\` makes), then the auto-generated Table of Contents and Open Items chapters when they exist. On a note that's always rendered — an auto chapter, or a note frozen in time — the pen toggle sits unlit and unclickable, since there's no edit mode to switch to.
- The chapter bar's first tab is always the parent note itself; every chapter follows in order. Click the parent tab or any chapter pill to switch between them — each keeps and saves its own text independently. Too many chapters to fit scrolls horizontally, fading at whichever edge has more off-screen, same as the tab bar.
- Drag a chapter pill to reorder it among its siblings — same drag-and-drop as reordering pinned tabs or tags: drop directly on another pill to land in front of it, or on the bar's empty space to send it to the end.
- The moment a note has its first chapter, an auto-generated **Table of Contents** chapter appears too — no button to press, it just shows up pinned first in the bar (before every real chapter, not draggable) and disappears again the moment the last real chapter does, the same automatic show/hide the chapter panel itself already does. It lists every heading across the parent and all of its chapters, each one a working link — always, whether or not the parent or any chapter has an assigned \`$id\`/\`§id\`, since it navigates internally rather than through the same link syntax you'd hand-type. Following one lands you in whichever mode you were already in: render view scrolls to the heading, edit mode puts the caret on it, ready to type. The parent's own title sits at the top, bold and unbulleted, apart from the list below it; every \`##\` heading after that — the parent's own, and each chapter's title — is a bullet at the same level, with that heading's own deeper headings nested under it. It's regenerated fresh every time you open it, so it's always accurate without costing anything while you're not looking at it — meaning it's also read-only (anything you tried to type would just be overwritten on your next visit) and opens straight into render view. Since it's a generated view rather than something you write, it has no [Time Machine Timeline](${guideLink('TIME-MACHINE', 'time-machine-timeline')}) of its own — the present-state circle stays live while viewing it, but re-runs the same regeneration instead of taking a save point (see [Present-State Circle](${guideLink('TIME-MACHINE', 'present-state-circle')})).
- An auto-generated **Open Items** chapter appears right after the Table of Contents (same pinned, non-draggable treatment) the moment any checklist item (\`- [ ]\`) anywhere in the parent or one of its chapters is unchecked, and disappears again once none are left anywhere in the family — including whenever the last real chapter itself disappears. It groups every open item under whichever heading it falls under, linked the same way the Table of Contents is — headings with nothing open under them are skipped entirely, so it's a pruned outline, not a full copy of every heading. Unlike the Table of Contents, it isn't regenerated on every visit: it only updates when a checklist item is actually created or its checked state flips, patching in just that one note's own part — so if you're looking at it in one editor while checking something off in another, it can go briefly stale until the next change anywhere in the family refreshes it, or until you click its present-state circle to force a full refresh on demand (see [Present-State Circle](${guideLink('TIME-MACHINE', 'present-state-circle')})). Same as the Table of Contents, it's read-only, has no Time Machine Timeline of its own, and opens straight into render view — but its own checkboxes are the one exception to "read-only": clicking one checks the real item off in its own source chapter without removing it from this list, so you can click it again to undo. The list itself doesn't update as you go — it only catches up (dropping anything actually checked off) the next time something elsewhere refreshes it, or when you force one with the present-state circle.
- A chapter is a full note in its own right — its own regular tags don't exist; tags always belong to the parent — but it doesn't appear on its own in Date/Category/Find, only through its one parent's chapter bar. The exceptions are Trash, once deleted, and Archive, once archived (see below for both). A chapter belongs to exactly one parent, ever, and a chapter can't have chapters of its own. Dragging a note from the sidebar onto the chapter bar copies its content into a brand-new chapter and switches you to it, same as creating one any other way — the dragged note itself is untouched and stays independent, not linked to the copy. Dropping it on the bar's empty space (or its trailing \`+\` pill) adds it as the last chapter; dropping it directly on an existing chapter pill instead inserts it right in front of that one. Every heading in the copy shifts down one level (\`#\` becomes \`##\`, and so on) so its own title-heading nests under the parent's instead of competing with it — the original note's headings are untouched.
- While a chapter is open, its parent stays the one shown as active in the sidebar and the tab bar — the chapter bar itself shows which chapter you're in.
- A chapter's fate is tied to its parent's: permanently deleting a parent note permanently deletes all of its chapters with it.
- Right-click a chapter tab to give it a short id (\`§1: ···\` becomes \`§1: INTRO\`, say) — same rules as a note's \`$id\`. Link straight to it with \`[text]($NOTE-ID§CHAPTER-ID)\`, optionally down to one of its own anchors with \`[text]($NOTE-ID§CHAPTER-ID#anchor-id)\`; opening it this way keeps the parent shown as active exactly like clicking the pill would.
- Hold a right-click on a chapter pill (same threshold as the sidebar's own [Right-Click-Hold Note Gesture](${guideLink('ARCHIVE-TRASH', 'right-click-hold-note-gesture')})) to split it into two small buttons in place of the pill: archive and delete. Clicking delete removes the chapter from the bar and moves it to Trash, where it's prefixed \`§ \` to read as a chapter, with its parent's title (prefixed \`$ \`) shown in place of a created date; clicking archive does the same but moves it into its parent's own fold-out row in the Archive tree instead (see [Archiving and Trash](${guideLink('ARCHIVE-TRASH', 'archiving-and-trash')})). A quick right-click on it there restores it to its exact original position among its siblings, shifting whatever's there — and everything after it — back by one, same restore gesture as a note's own (see [Restoring from Archive or Trash](${guideLink('ARCHIVE-TRASH', 'restoring-from-archive-or-trash')})). Moving the pointer off the split pill without clicking either button reverts it to normal.
- Two small buttons flank the chapter tab strip. The scissors on the right cuts whatever's currently selected in the editor — or, with just a caret and nothing highlighted, everything from the caret to the end of the document — out of the note you're viewing (parent or chapter) and pastes it into a brand-new chapter, caret landing right after the pasted text. The new chapter always lands directly behind the one you cut from (or first, if you cut from the parent), pushing later chapters back by one; any blank-line run left behind at the cut site collapses down to a single blank line, and any blank lines swept up at the start or end of the extracted text itself are trimmed off. A quick way to split a long note as you write it. The merge icon on the left collapses the chapter you're currently viewing: its content is appended to the end of the previous chapter (or the parent, if it's the first chapter), the now-empty chapter is permanently deleted (chapters have no Trash of their own — its content has already been moved out), and you land in the destination note with the caret at the end. Collapsing a note's last remaining chapter this way leaves the chapter bar showing, same as it does for any note with no chapters yet — just its book pill and the trailing \`+\` pill.
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
- A parent note that isn't itself archived, but has one or more archived chapters (see [Chapters](${guideLink('SPLIT-VIEW-TABS', 'chapters')})), still shows up in the Archive tree — as a single row, same as any other note, but clicking it doesn't open it. It's a pure fold-out toggle instead: click it to show or hide its own archived chapters, indented underneath it. Clicking one of those, once visible, opens its parent with that chapter active, same as clicking any chapter pill.
- A parent note that's archived itself shows in the Archive tree the same simple way any other archived note does — no fold-out, nothing indented under it. Clicking it opens it in the editor with its full chapter bar, showing *every* chapter regardless of whether any of them are also archived — the archived ones read a little dimmed, aren't draggable, and can't be right-click-renamed, since (unlike a live chapter) there's nowhere real for either of those to write to while a chapter sits archived. Nothing here changes their archived status; un-archive one the same way any archived chapter is un-archived, from its Archive-tree row.

### [Right-Click-Hold Note Gesture](#right-click-hold-note-gesture)

> **Where?**
> Right-click and hold on a note card in the Category or Archive tree.

*How to archive or delete a note in the tree views, where the cards have no room for buttons.*

- **Only in the tree views.** The flat lists — Date, Find, Trash — put an Archive and a Trash button on every row, and those are the way to do it there. A hidden gesture doing the same thing beside a visible button is a way to file a note away by accident and then wonder where it went, so it isn't offered.
- Holding past a short threshold arms the card (it highlights) for its next action: archive for a normal note, straight to permanent deletion for one that's already archived.
- A left-click on the armed card confirms the action; moving the pointer away cancels it.
- The halo of the [animated cursor](${guideLink('APPEARANCE-SETTINGS', 'mouse-options')}), if you have it on, fills as you hold and is full at the moment the gesture arms.
- A quick tap (released fast) on an already-archived or already-deleted note restores it instead, and that one works **everywhere**, tree or list — see [Restoring from Archive or Trash]($#restoring-from-archive-or-trash). No view has a restore button, so it is the only way back.

### [Restoring from Archive or Trash](#restoring-from-archive-or-trash)

> **Where?**
> A quick right-click tap on an archived or deleted note row.

*Returns a note to normal, undoing an archive or trash action.*

- Releasing the right-click before the arm threshold triggers the restore immediately — no confirmation needed for this direction.
- Works the same way on a deleted chapter's row in Trash, or an archived chapter's row in its parent's Archive-tree fold-out — restoring puts it back into its parent's chapter bar at its exact original position, shifting later chapters back to make room (see [Chapters](${guideLink('SPLIT-VIEW-TABS', 'chapters')})).

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
- On the auto-generated Table of Contents or Open Items chapter (see [Chapters](${guideLink('SPLIT-VIEW-TABS', 'chapters')})), there's no save-point history to track — clicking the circle instead refreshes that chapter's content from the family's current live state on the spot, without leaving the page. The Time Machine slider itself is hidden there for the same reason.

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

*One global toolbar that always acts on whichever slot is currently active.*

- Left cluster: a split button pairing the dark-mode toggle (top) with double size (bottom), plus an export button that switches between PDF (preview mode) and Markdown (edit mode). Switching between edit and render view is done with Esc or the chapter bar's pen toggle (see [Chapters](${guideLink('SPLIT-VIEW-TABS', 'chapters')})); creating a note with Ctrl+N.
- The rest of the bar holds the formatting group, always visible in both edit and render view.

### [Formatting Group](#formatting-group)

> **Where?**
> The toolbar.

*One-click Markdown formatting for the current selection or line.*

- Bold, italic, strikethrough; heading levels H1–H3; bulleted, numbered, and checklist lists; blockquote; code block and inline code; horizontal rule; link insertion; table of contents.
- The buttons resize themselves to the room the toolbar has: full-size squares on a single row whenever they all fit, and mini squares — wrapping onto a second row if they still don't fit — when they don't. Full-size, they carry the same glyph size and rounding as the chapter bar's own icon buttons, inset evenly from every edge of the toolbar. Nothing is ever dropped, and the toolbar keeps the same height either way, so widening or narrowing the window never shifts anything below it.
- The group stays on screen in render view too, so the toolbar doesn't change shape when you flip modes. While a slot is in render view, clicking any of these buttons switches that slot to edit mode instead of formatting — it deliberately doesn't also apply the formatting, so a stray click on a rendered note can't quietly edit it. Click again once you're in edit mode to actually apply it. (On a chapter that's always rendered — an auto table of contents or Open Items — the buttons are disabled, since there's no edit mode to switch to.)
- Each button reflects whether the current selection or line already has that formatting applied.
- Most double as the keyboard shortcuts listed in [Keyboard Shortcuts](${guideLink('SHORTCUTS')}).
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
- For searching across *all* notes rather than one, use [Search](${guideLink('SIDEBAR-SEARCH', 'search')}) instead.
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
> Remove the \`external\` tag from the note (tag-mode, see [Managing Tags](${guideLink('TAGS', 'managing-tags')})).

*Adopts an external file into Thockdown permanently, as a normal internal note.*

- Writes the note's current content into a new internal file; the original external file is left untouched.
- External notes can't carry your own tags while the \`external\` tag is present, but still keep their own [Time Machine Timeline](${guideLink('TIME-MACHINE', 'time-machine-timeline')}) like any other note.
`,
  `## Sync & Import

### [Sync](#sync)

> **Where?**
> Settings → Data → the sync icon.

*Rescans the app's own notes folder for files that exist on disk but aren't yet registered.*

- Any newly-found file is added to the database as a regular note.

### [Import](#import)

> **Where?**
> Settings → Data → the import icon.

*Brings Markdown files from anywhere on your computer into Thockdown as regular notes.*

- Opens a file/folder picker; you choose exactly what gets imported.

### [Open Notes Folder](#open-notes-folder)

> **Where?**
> Settings → Data → the folder icon.

*Opens the app's own notes folder (where your \`.md\` files live on disk) in your system file explorer.*
`,
  `## Export

### [Export to PDF](#export-to-pdf)

> **Where?**
> Hold \`Esc\` → Export (or Export All), while in render view.

*Exports the rendered note as a PDF file.*

### [Export to Markdown](#export-to-markdown)

> **Where?**
> Hold \`Esc\` → Export (or Export All), while in edit view.

*Exports the raw note text as a \`.md\` file.*

### [Export All](#export-all)

- Which format you get follows the view you're in: render view exports PDF, edit view exports Markdown.
- In a note with chapters, **Export** covers only the chapter (or parent) you're looking at. **Export All** assembles the parent and every chapter, in chapter order, into a single document named after the parent.
- The auto-generated Table of Contents and Open Items chapters are not included.
- The first export asks for a destination folder; later exports reuse it.
`,
  `## Keyboard Shortcuts

> **Where?**
> Global — active anywhere the app has focus, except inside search/replace/tag fields (where \`Tab\` / \`Enter\` / \`Esc\` move focus back into the editor instead).

*Every keyboard shortcut in the app, in one table.*

| Shortcut | Action |
| --- | --- |
| \`Ctrl+N\` | New blank note |
| \`Ctrl+Shift+N\` | New note titled from clipboard |
| \`Ctrl+Space\` | Show / hide the sidebar |
| \`F11\` or \`Ctrl+Shift+Space\` | Immersive mode: full screen, just the editor you're in — press again to leave |
| \`Esc\` | Toggle edit / preview (or blur a focused field) |
| Hold \`Esc\` | Open the quick actions menu |
| \`Ctrl+F\` | Find in note — opens the sidebar if it's closed; press again from the find field to close it |
| \`Ctrl+H\` | Find & replace in note — opens the sidebar if it's closed; press again from the find field to close it |
| \`Ctrl+Enter\` (in find mode) | Replace all matches |
| \`Alt+Left\` / \`Alt+Right\` | Previous / next slot |
| \`Ctrl+Up\` / \`Ctrl+Down\` | Jump caret to start / end of document |
| \`Ctrl+B\` | Bold |
| \`Ctrl+I\` | Italic |
| \`Ctrl+J\` | Strikethrough |
| \`Ctrl+T\` | Toggle current line's heading level |
| \`Ctrl+-\` | Toggle bulleted list |
| \`Ctrl+#\` (or \`Ctrl+Shift+3\`) | Toggle numbered list |
| \`Ctrl+Z\` / \`Ctrl+Y\` | Undo / redo |
| \`Ctrl+V\` | Paste the text as-is |
| \`Ctrl+Shift+V\` | Smart paste: rejoins lines broken mid-paragraph and tidies list markers |

- Shortcuts that touch the editor apply to whichever slot is currently active.
`,
  `## Window Controls

> **Where?**
> The top bar of the window.

*Thockdown runs frameless, with no OS menu bar — every window action lives here.*

- **Settings (gear)** — opens/closes the Settings panel, see [Settings Panel](${guideLink('APPEARANCE-SETTINGS', 'settings-panel')}).
- **Music player** — see [Music Player](${guideLink('MUSIC-PLAYER')}).
- **Mini mode** — collapses the window into a compact strip; the music player stays fully usable, sound options included. The button that got you there expands back out, maximized — see [Music Player](${guideLink('MUSIC-PLAYER')}).
- **Immersive mode** (\`F11\` or \`Ctrl+Shift+Space\`) — the window goes full screen with just the editor you're working in, edge to edge: no sidebar, toolbar, tabs or other slots. Press either shortcut again to come back exactly as you were. Opening the sidebar any way you normally would (\`Ctrl+Space\`, \`Ctrl+F\`, \`Ctrl+H\`) also brings you back, with the sidebar showing. Not available from mini mode.
  - In edit view the scrollbar lives in the grid itself: the rightmost column of boxes is the track, and the darker boxes show where you are. Click anywhere else on it to travel there; hold to jump straight there. Its colour is **Immersive Scroll Thumb** in the colour settings.
- **Minimize / Maximize–Restore / Close** — standard window controls.
- **User Guide (lightbulb)** — the upper half of the split maximize button. Opens this guide, exactly like the Quick Actions Menu's own Help cell, see [The User Guide](${guideLink('NOTES-EDITING', 'the-user-guide')}).
- **Dark mode / Double size** — a split button in the toolbar's left cluster (not in this bar): the top half switches the whole app between light and dark presets, the bottom half is double size (2x). Double size doubles the app's page zoom and, to match, the window's minimum size, so 2x content gets 2x room instead of being squeezed into the same space. Toggling off relaxes the minimum again but doesn't shrink a window you've since resized larger. Persists across restarts. Font sizes — edit view, render view and the interface — are remembered separately for normal and double size: set them once in each, and switching back and forth keeps both.
- **How small the window goes** is worked out from what actually has to fit rather than being a fixed number: across, the sidebar, the toolbar's formatting buttons at three groups of three per row, and this bar; down, enough of the Date view to show four note cards. Both scale with the spacing setting, so a roomier spacing raises the floor and a tighter one lowers it. Hiding the sidebar drops the width floor by the sidebar's own width, and each extra split-view slot raises it once the slots need more room than the chrome does.
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

### [Colors](#colors-and-textures)

> **Where?**
> Settings panel → Colors.

*A "paint bucket" system for recoloring and retexturing individual UI elements.*

- Click a source swatch — or an active color, or a texture preview — to pick it up, then click any target swatch (UI elements, text colors, textures) to apply it there.

### [Borders](#borders-and-spacing)

> **Where?**
> Settings panel → Borders.

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

### [Animations](#animations)

> **Where?**
> Settings panel → Animations.

*Tunes the custom easing curve used for scroll animations the app makes on your behalf — a search jump, a page key, a chapter change. For what the wheel itself does, see [Scrolling]($#scrolling).*

- Controls for ramp, speed, maximum speed, and overall curve shape. Response is auto-derived from ramp.
- **Maximum speed** does two jobs at once. It caps how fast a scroll animation travels, and it also caps how *long* one may take: the longest any scroll can run is the time it would take to cover 200,000 pixels at the speed you've set — 2 seconds at the top of the slider, 2.5 at the default. Wind the speed up and long journeys get shorter as well as quicker; wind it down and a trip across a very large note becomes a proper voyage. A journey that can't fit under both limits keeps the time one and exceeds the speed one, so you're never left waiting.
- These settings aren't part of a layout — they stay as you left them across layout switches and app restarts, the same way the custom cursor toggle does.

### [Scrolling](#scrolling)

> **Where?**
> Settings panel → Scrolling.

*What your own hand does to the page: how far one turn of the wheel goes, and whether a spin of it keeps going after you let go.*

- **Edit step** and **view step** are how far one notch of the wheel scrolls, one for each pane. Edit mode counts in whole rows (1 to 10); render view counts in lines of text and will take fractions of one (0.5 to 5). Both are measured in text rather than pixels on purpose: make the text bigger, or the line spacing wider, and a notch still moves the same amount of *reading* rather than quietly moving less of it.
- **Auto scroll** and **dampen** are a pair, and they work the same way in edit mode and render view. Spin the wheel — three notches in the same direction, each within the number of milliseconds **auto scroll** is set to — and the text keeps scrolling on its own at the speed you spun, without you having to keep turning. Slid all the way left, **auto scroll** reads “off” and the wheel behaves exactly as it always has.
- **Dampen** decides how long the free scroll lasts before it winds down. It holds your speed for a good while and then lets go fairly quickly, rather than trailing off into a crawl; slide it right to have it let go sooner, left to make it last. At its leftmost position it never winds down at all — the text keeps going until you stop it. Either way, one more turn of the wheel stops it — as does typing, or clicking in the text. That stopping nudge only stops; it doesn't also scroll, so you can halt on the line you wanted rather than one past it.
- **Cut off** is where the free scroll gives up: once the steps are arriving further apart than the number of milliseconds you set here, it stops. Between it and **dampen** you can have a scroll that eases off gently and ends early, or one that holds its pace and runs on until it hits the cut off.
- In render view the free scroll glides rather than stepping line to line — there is no row grid there to step between — but it is the same spin, at the same speed, from the same settings.
- For half a second after a spin starts, the wheel is ignored. That's the tail of your own gesture: without it, the last few notches of the spin would either double the speed or cancel the scroll the instant it began.
- These settings aren't part of a layout either — they stay as you left them across layout switches and app restarts.

### [Cursor](#mouse-options)

> **Where?**
> Settings panel → Cursor.

*An optional animated cursor replacement: orbiting dots with fading trails, a center dot, a soft halo, and a breathing pulse, all pinned to the real pointer position. Off by default — flip it on in [Performance]($#performance).*

- Top-left button is a halo color swatch. The 4 buttons beside it (H, S, V, A) stage a color by dragging up/down or scrolling on each — left-click a swatch (halo, circling dots, center dot, trail) to paint it onto that element; hold right-click on a swatch to load its current color back into H/S/V/A.
- Sliders: number of circling dots, orbit radius, spin speed (-4Hz to 4Hz, negative reverses direction, 0 freezes it), trail fade duration (how long a trail particle takes to decay after the head passes it — e.g. 1000ms at 1Hz spin sweeps exactly one full revolution), trail thickness (0–12px, 0 hides it), dot size (0–12px, 0 hides it), center dot size (0–12px, 0 hides it), halo radius (0 hides it, capped at the same max as orbit radius), fall-off (0–100 — how far out the halo's glow stays near-opaque before fading to nothing at its edge; low values fade fast near the center, high values stay bright almost all the way to the rim), and a pulse effect that breathes the orbit's radius outward — magnitude 0 keeps it locked at its base size, magnitude 1 breathes up to 200% of it — at a given speed. The halo is rendered centered behind the center dot. Colors and these sliders are saved per layout, same as the rest of your theming.
- Click response: left-click tightens the orbit (smaller radius, faster spin) and right-click widens it (larger radius, slower spin), up to 200% and down to 50% of your base radius/spin. Every click is handled the same way regardless of how long you hold it — a plain click is too fast to tell "tap" from "hold" apart — it rises to full strength, stays there while held, then eases back down to baseline on release instead of snapping. Six more sliders tune the feel, using the same bell-curve model as Animations' ramp/shape/speed/max-speed: click ramp (linear → bouncy), click shape (apex bias), click speed (how long the rise/fall takes — weighted so the high-speed end of the slider gives much finer control than the low-speed end), click max speed (how strong the effect gets), min impact (floors how long a click is treated as held internally, 0–200ms, so even a quick real click still registers instead of flickering), and click balance (center = radius and spin both affected equally; left = radius only; right = spin only).
- Hold gestures show themselves in the cursor. Several controls do something different when you hold the button rather than click it (snapping a scrollbar, pinning a tab, arming a purge — each one is described where it lives). While you hold one, **the halo swells**, reaching its full size at the exact moment the gesture fires — so you can see how much longer to hold rather than guessing, and let go early if you have changed your mind. When it does fire, the orbit gives one brief flick against whatever the press was doing to it, which is how you know it landed even when the thing it did is off-screen. Both are scaled by click max speed, and both settle back on their own. There are only ever two hold lengths in the app: a short one for "I meant this control, not the one beside it", and a longer one for anything that can't be undone.

### [Caret](#caret)

> **Where?**
> Settings panel → Caret.

*Shape, glow and blink rhythm for the block caret in the editor. Its fill color lives with the rest of your theming in [Colors and Textures]($#colors-and-textures); everything else about it is here.*

- The caret sits above the box grid and below your text, so the grid never draws lines across it and the caret never hides the character it's on — however big you make it, whatever color you give it.
- Top row: an outline color swatch and a halo color swatch. The 4 buttons beside them (H, S, V, A) stage a color by dragging up/down or scrolling on each — left-click a swatch to paint it onto that part of the caret; hold right-click on a swatch to load its current color back into H/S/V/A. Same widget as [Cursor]($#mouse-options), independent of it.
- **Size** (-5 to +5) grows or shrinks the caret on every side. 0 is the default: it fills a grid box's interior without covering the lines around it. -1 leaves a one-pixel gap to those lines; positive values spill past them into the neighbouring boxes.
- **Outline** (0–5px) draws a border around the caret rectangle, in the outline color. 0 hides it.
- **Halo** (0–20px) reaches a glow outward from the caret, in the halo color. 0 hides it.
- **Blur** (0–20px) softens that glow's edge. At 0 the halo is a hard square ring that reads as part of the grid; wind it up and it feathers into a soft glow without reaching any further. Blur works on its own too — with halo at 0 it feathers the caret's own edge outward.
- Six blink shapes to pick from: the classic heartbeat, its big beat on its own, a plain fade in/out peaking halfway through, the same fade peaking early (15%) or late (85%), and a bouncing-ball rhythm that drops in ever-smaller hops before starting over. The fill, outline and halo all fade together, so the caret always reads as one object.
- **Cycle** (100–5000ms) is how long one full blink takes.
- **Frame** (5–500ms) is how long the caret holds each step of the blink. At its lowest the blink is smooth; wind it up and the caret animates in visible chunks, like a machine that only redraws itself so often. Steps never cross a shape's own turning points — a step longer than the stretch it lands in just holds that whole stretch, and one that would split a stretch unevenly is spread evenly across it instead.
- **Effect** (0–100%) is how much of the chosen shape actually reaches the caret. At 100 you get the blink at full strength; at 0 the caret is simply static, sitting at whatever colors you gave it; in between is a straight blend of the two, so you can keep a rhythm you like and just take the edge off it.
- All of these are saved per layout, same as the rest of your theming. To stop the blink entirely, use **Reduce caret animation** in [Performance]($#performance).

### [Sounds](#keystroke-sounds)

> **Where?**
> Settings panel → Sounds.

*Optional mechanical-keyboard sound effects on typing, undo/redo, and navigation.*

- Four sound sets — Pops, Pins, Creamy, Forge — plus volume, per-key pitch variance, global pitch, bass/treble mix, reverb, and pitch jitter controls.
- **Spatial** slider adds stereo panning, centered (off) by default. Left of center pans by keyboard key position (left-hand keys sound from the left, right-hand keys from the right, non-character keys like arrows/Tab/Backspace stay centered); right of center pans by where the caret sits on the current line (line start sounds left, the far edge before an automatic wrap sounds right). The two modes don't blend — the slider picks one or the other by which side of center it's on, with distance from center setting how strong the effect is.

### [Ambient Sound](#ambient-sound)

> **Where?**
> The cloud-bolt button in the music player turns it on or off, and scrolling over it sets its overall volume. Settings panel → Ambient Sound adjusts the layers and soundscapes.

*Generated sound — wind, surf, rain, thunder, running water, fire and wind chimes — that can play alongside the music player, all in one shared space and under one sky.*

- **Overall volume** — hover the cloud-bolt button in the music player and scroll; hold Shift to move by ten. Scrolling turns ambient sound on if it was off. **Right-click** it to step to the next soundscape — through your own saved ones if you have any, otherwise through the factory ones. The volume belongs to you rather than to a soundscape: switching soundscapes keeps it, and saving one does not store it.
- Choose one of twelve soundscapes from the first rows, then choose a channel to show its controls below. There are eighteen channels, each marked by the icon of its kind and numbered within it: six **noise** (a wave), three **rain** (a cloud), three **thunder** (a lightning bolt), two **water** (a drop), two **fire** (a flame) and two **chimes** (a bell). Click a channel to view it; hold left-click on a disabled channel to enable it, or hold right-click on an enabled channel to disable it — a disabled channel costs nothing to play. A short right-click solos a channel and shows its controls; right-click it again to clear solo, or right-click another channel to switch solo. The soloed button is highlighted. Disabled channels keep their settings, and their controls remain visible but cannot be changed. While hovering over an enabled channel button, scroll the mouse wheel to adjust its volume in 5% steps.
- **Every channel's volume is in decibels**: each step of the slider changes the loudness by the same amount, and a channel keeps its level whatever else is playing — turning on another channel never makes this one quieter.
- **Every channel has a distance**, one rule for all of them: near is direct and clear, far is darker, quieter and more of it heard in the space. Channels that sit somewhere have a **pan** as well, which also sets their width: in the centre they fill the whole stereo field, and panned toward a side they narrow onto it, to a single point at the edge. Layering the same kind near, in the middle and far away is what gives a soundscape depth.
- The **environment**, the sliders at the top of the section, acts across every channel at once. It is still part of the soundscape: choosing one sets it, and saving one keeps it. Four of its sliders shape the **space**, the place every channel plays in: its **size** runs from a small room to a wide valley (how long it rings, and how late the first reflection comes), **damping** from a bright tail to one that darkens quickly the way open air and trees swallow the highs, **echoes** adds distinct reflections off walls, buildings or cliffs, and **amount** is how much of the space you hear at all. The other two are the **weather**, one slow rhythm of gusts and lulls for the whole scene: **gusts** is how strong they are, **pace** how often they come. A channel's own **weather** slider decides how closely it follows them — wind grows louder and brighter in a gust, rain gets heavier, a fire is fanned, chimes are struck more often and harder, and thunder comes sooner. At zero a channel ignores the weather entirely.
- **Noise channels** are surf, wind or a steady wash, depending on how they are set. **Colour** blends the noise itself from deep brown through balanced pink to bright white. **Bright** is where its filter sits, and **focus** turns that filter from a gentle darkening into a narrow, resonant band — a whistle at that pitch. Loudness holds while you move any of the three. Under **Motion**, **depth** is how far the level rises and falls, **period** how long one rise and fall takes, **curve** its shape (a sine in the middle; to the left it lingers loud and dips briefly, to the right it stays quiet and swells briefly) and **skew** where the peak falls — a fast rise and slow fall is a wave. **Sweep** makes the filter follow the swell: to the right it opens as the level rises, so a gust whistles higher and a wave brightens as it breaks; to the left it closes. **Vary** makes every cycle a little longer or shorter, stronger or weaker than the last. Under **Place**, **width** runs from a single point to all around you, and **sway** carries the channel from side to side, sweeping past the centre as it swells — easiest to hear on a narrow channel.
- **Rain channels**: **intensity** runs from drizzle to downpour — more drops, a louder wash and heavier drops. **Surface** is what it falls on, soft to hard: **leaves**, **canvas** (a tent or an awning — a dull thump), the **street**, **tin** (a shed or a car roof) and **glass**, with everything between two of them a blend. **Mix** balances the drops heard one by one against the wash, the steady hiss of rain too dense to hear drop by drop: wash alone on the left, drops alone on the right, both at full in the middle — drops alone sound like dripping, the wash is what makes it rain. **Drips** adds large, heavy drops from gutters, eaves and branches. **Wetness** is standing water: drops land in it with a bright splash, a spray of finer droplets and the rising *plip* of a trapped bubble, and the water deadens the surface's ring — a wet road is the street with wetness up. **Ring** is how much the surface rings: dead to the left, as it is in the middle, twice as long to the right.
- **Thunder channels** rumble now and then rather than continuously; the first peal comes within a few seconds of enabling one. **Share** is how much of the time it thunders, shown as rumbling to silence — **1 : 99** with a 20-second peal means 20 seconds of thunder, then 33 minutes of quiet. **Length** is how long a peal rolls. **Character** is how harshly the deep boom breaks up, from a smooth swell to a choppy growl. **Contrast** pushes a peal's loud and quiet moments apart to the right, or draws them together to the left. **Random** varies the other controls again after every peal, by up to a quarter of each range, so no two peals come out alike. **Spread** is how much of the stereo field a peal fills around its pan.
- **Water channels** are a brook or a stream: a cloud of bubbles over the low rush of the flow. **Flow** runs from a trickle to a torrent, **size** from small, high, glassy bubbles to large, low gurgles, and **tumble** from an even patter to water arriving in bursts as it tumbles over stones.
- **Fire channels**: **size** runs from embers to a blaze — the weight and depth of the roar, and its hiss. **Crackle** is how often the wood crackles, **pops** how often sap pops and sizzles. **Hiss** is the strength of the hiss over the flames (off to the left, twice as strong to the right) and **hiss tone** where it begins, from a dull hiss to a thin sizzle, without changing its loudness. Three sliders shape how the flames move: **flicker** is how far the roar and hiss swing (a steady burn to the left, surging and faltering to the right), **pace** how often they change, and **edge** how sharp each change is — a soft swell that eases in and out, or an abrupt lurch.
- **Chimes channels** are a set of metal tubes tuned up a five-note scale from the lowest, **pitch**. **Tubes** is how many there are, **ring** how long a struck tube keeps sounding, **activity** how often the clapper strikes before the wind has any say, and **hardness** runs from a soft wooden clapper, warm and round, to a hard metal one, bright with a tick. Chimes follow the weather strongly by default — they are what the wind plays.
- Disabling a channel removes it from the soundscape without changing its stored controls. The cloud-bolt player button turns all ambient sound on or off without changing its settings. Selecting a soundscape starts ambient playback; music is not required.
- Adjusting a channel, the space or the weather makes the plus button active. Press it to save the current soundscape as a numbered button below the factory rows. Select a numbered button to restore it; right-click it, then click it to remove it. Ambient soundscapes are independent of appearance layouts.

### [Data](#data-synchronization-settings)

> **Where?**
> Settings panel → Data.

*Note sync/import, and exporting or importing your whole appearance setup.*

- [Sync](${guideLink('SYNC-IMPORT', 'sync')}), [Import](${guideLink('SYNC-IMPORT', 'import')}), and [Open Notes Folder](${guideLink('SYNC-IMPORT', 'open-notes-folder')}) buttons for notes.
- Export or import your custom appearance presets as a \`.tdl\` file, so you can carry your look between machines.

### [Performance](#performance)

> **Where?**
> Settings panel → Performance.

*Toggles for easing load on constrained machines, the custom cursor switch, and where a note stops being small.*

- **Reduce visual effects** forces [Glaze]($#glaze), [Filters]($#filters), and the colorize filter off, without discarding your slider positions (Invert is kept, since it's often load-bearing for dark layouts).
- **Reduce caret animation** stops the idle caret blink, easing compositor load.
- **Defer preview on rapid input** coalesces preview updates onto one frame during fast key-repeat (e.g. held Backspace).
- **Force character based scrollbar thumb** puts every note on the character reading described under [Scrollbar Navigation](${guideLink('NOTES-EDITING', 'scrollbar-navigation')}), however short it is.
- **Note size threshold** is where that switch happens when the toggle above is off: how many paragraphs a note may have before its scrollbar starts counting characters instead of measuring height. A whole list counts as one paragraph, as does a table or a code block. Hover the slider to read the current number.
- The cursor button toggles the [custom cursor]($#mouse-options) on/off; while on, the native cursor is hidden everywhere in the app, not just the editor — sidebar, toolbar, dialogs, all of it. This toggle always starts on for a fresh install and isn't part of a layout — it stays as you left it across layout switches and app restarts until you flip it again.

### [ThockQuest](#thockquest-settings)

> **Where?**
> Settings panel -> ThockQuest.

*How hard ThockQuest is, and how much of a fight the space bar will play for you.*

- **Difficulty** is how much stronger monsters get with every level you clear, and **Luckiness** is a thumb on the scale: it scales away your chance to *fail* and a monster's chance to *succeed*, so both sides go on reading the same stats while the fight tilts your way. Both start at their gentlest, so raising one is the first thing to do about a run that is going badly. (Luckiness is not the *Luck* stat your character carries — that one buys extra damage rolls, and no slider touches it.)
- **The lock below them says whether those two count.** Left off they are an override — move one and the adventure you are in the middle of changes with it, which is what makes them worth moving while you watch. Pressed on, you are in *true mode*: they set how the **next** adventure is created and then stay put for the whole of it, so what a run was played at becomes a fact about that run rather than something you can revisit.
- Because a run cannot be half-locked, turning the lock **on** while an adventure is past its first level **ends that adventure**. That is why it wants the button *held down* rather than clicked, and why its tooltip says so before you commit. Turning it back off is an ordinary click and costs nothing.
- **Verbose descriptions** decides how much an effect explains itself. On (the default), "+20% to Hit (of your misses)" spells out that a chance takes a share of what is left rather than twenty flat points — which is worth knowing once and tedious at every fight after that. Off, the same effect reads "+20% to Hit": what changed, and nothing else. Nothing is abbreviated beyond recognition either way; only the explanation goes, along with the flavour line under a class move.
- **Auto advance** is how far holding the space bar carries a fight on by itself — nothing at all, to the end of the round, to the end of the fight, to the end of the stage, or to the end of the level — and **auto speed** is how quickly, from a twentieth of a second between choices to a whole one. The speed slider is dead while the one beside it says nothing.

### [Debugging](#debugging)

> **Where?**
> Settings panel → Debugging.

*Tools for diagnosing problems, not intended for everyday use.*

- **Debug logging** routes the app's debug log into a dedicated note tagged \`debug\` — see [Protected Tags](${guideLink('TAGS', 'protected-tags')}).
- A button opens a detached DevTools window.
`,
  `## Music Player

> **Where?**
> The window-controls bar, center.

*A built-in music player with five themed playlist slots, each holding your own local audio files, and an independent procedural ambience switch.*

- Music slots: Pop, Rock, Electro, Lounge, Ambient. The cloud-bolt button toggles generated ambient sound independently; scroll over it to set the ambient volume.
- **Adding music** — right-click a slot to pick individual files; shift+right-click to add an entire folder at once.
- **Clearing a slot** — hold a right-click on a slot until it arms, then release to clear every song in it.
- **Choosing what plays** — click a slot to toggle it in or out of the active playback pool; more than one slot can be active at once.
- **Playback** — play/stop, and the favorite/skip button (click to favorite the current song for early replay, right-click to skip it, hold right-click to purge it from its slot entirely). The favorite click is a toggle: clicking a song that is already marked takes the replay marker off and drops it back into the normal rotation, without undoing how much you have favorited it over time.
- **Rewind and fast-forward** — each button always moves its own way through the music: left-click jumps 20% of the track, right-click changes song, and holding either mouse button scrubs continuously. A scrub that runs off the end of a track carries straight on into the next one, and off the front into the previous one, so you can hold rewind and walk backwards through what you have been listening to without stopping at each boundary.
- **What a 20% click does near an edge** — it lands somewhere sensible rather than partway into a neighbour. With less than 20% of the track left, forward starts the next song from its beginning. Less than 20% in, rewind returns to the start of the song you are on. And in the first two seconds, rewind means the previous song, dropping you 80% of the way through it — near the end, where you were.
- **Going back** — the player remembers the last hundred songs it played, so right-clicking rewind can step back through them one at a time, not just to the one before this. Fast-forward is deliberately not the mirror of that: right-clicking it always picks a fresh song, exactly as if the current one had reached its end. Once a song you went back to finishes, play carries on as normal.
- **Mini mode** — the expand button on the player's right leaves mini mode and maximizes the window (its arrows point that way). Your previous window size isn't lost: un-maximizing returns to it.
- **Sound options** — the headphones button swaps the row of five music slots and the ambient-noise switch for six sound controls, and swaps back. Nothing else opens or closes: volume and reverb live in the player itself, not in the settings panel.
- Scroll over the headphones button to adjust sound without opening the controls: plain scroll for volume, \`Shift\` for reverb, \`Ctrl\` for room size.
  - Three of them are **numbers** — volume, reverb, and room size, each reading 0–99. Hover one and scroll to change it; hold Shift to move by ten. You can also press and hold: left lowers, right raises. The hold starts gently and settles into a steady climb, so a quick press nudges by one and a long one crosses the whole range — it never races away before you can stop it. How long that full sweep takes follows the animation speed in [Settings panel → Animations](${guideLink('APPEARANCE-SETTINGS')}).
  - The other three are **switches**. The speaker mutes (and shows how loud you are: quiet, medium, loud); the antenna turns reverb off; the room icon (a box, a room, a hall, open air, showing which size you're in) is a second face of that same reverb switch, so either one turns it off and both show the crossed circle while it is. Every switch shows that same crossed circle while it is off, whichever one it is. Turning something off never loses its number — switch it back on and it returns to where you left it. So does adjusting the number while it's off: that turns it back on for you.
  - A lit switch here means *off*, the opposite of the buttons elsewhere in the app. These three are lit only while something is muted or bypassed, so a glance at the row tells you whether anything is holding your sound back, without reading a single icon.
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
