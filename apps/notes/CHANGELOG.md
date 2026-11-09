# Thockdown Notes changelog

Newest first. `npm run release` adds each entry from that release's notes, in the
same commit that sets the version (docs/release-protocol.md). Entries up to 0.7.1
were collected from the GitHub releases of the time, tagged `v<version>`; later
releases are tagged `notes-v<version>`.


## 0.8.1 (2026-11-09)

A patch for the 0.8.0 prerelease. Pressing Enter at the start of a list item now opens a blank line above it, selecting a factory preset no longer leaves the layout looking modified, and the Visualizer's beat detection is independent of Grid Beat (the beat delay now starts at 0). The Quick Access switches now only disable, and the render view's restore landing no longer disturbs scrolling.

#### Changes

- Factory presets carry the spell-check colour, so selecting one is clean
- Quick Access switches only disable; Visualizer beat independent of Grid Beat; beat delay starts at 0
- Enter at the start of a list item opens a blank line above it
- Hold the render view's restore landing as a scroll-behavior borrow

## 0.8.0 (2026-11-09)

The biggest release yet: a full-screen **Visualizer** for your music, the app's own **offline spell checker**, **speed reading**, the **Typing Trail**, drawable **music soundstages**, an **image library**, **touch screen** support, and a reorganised **Options** panel. Notes also follow their files on disk, the same note can be open in several slots, and the app is safe to switch off at any moment.

#### New

- **Visualizer (F5).** A full-screen music scene on the editor's box grid: spectrum, progress and volume bars, song list, bucket list and a pool filter by artist, album and title. A centre solid picks the music's soundstage, and a grid wave, centre pulse and swaying glaze follow the beat. Song title, artist and album are read from the files' tags.
- **Music soundstages.** Five factory stages (Muted, Neutral, Wide, Amped, Thocky) plus your own, stepped from the music bar or the Visualizer. Each stage is an EQ curve you draw in Options > Music, with stereo width, reverb, room size and foliage. Right-click the headphones button to mute.
- **Spell checking is the app's own and fully offline.** Misspelled words in view are outlined on the grid, with English, Spanish, French and German included. You can install more dictionaries (.dic/.aff, .oxt, .xpi, .zip). **Shift+Space** swaps in a suggestion, and pressing it again cycles through the others.
- **Speed reading (F9).** The reader scrolls at a set pace, and the editor shows the note chunk by chunk. The time left is shown beside the pace.
- **Typing Trail.** An optional trail of fading boxes along the line you are typing.
- **Keystroke sounds** have their own presets and six mixable channels, each with its own volume, jitter and pitch.
- **Image library.** Images get cards, trees by tag, and an image mode per note. Ctrl+drag an image's edges to crop it.
- **Touch screens.** Two fingers act as a right press, a resting finger acts as Ctrl, and a pinch scales an image. One finger scrolls the editor in whole rows.
- **One note in several slots.** Every slot edits the same live text, and undo stays per slot.
- **External notes follow their file.** A change on disk shows up in the open note, and an edit on both sides is kept as a conflict instead of being lost.
- **Ctrl+A** selects the whole note in the editor and the reader alike.

#### Changed

- **Options** has six sections behind a selector bar (General, Layouts, ..., Modules, Advanced), a search, Quick Access volume sliders, and one preset model shared by layouts, soundstages, soundscapes and keystroke sounds. Blink and Caret Beat are global settings under Advanced > Animations > Flashing.
- **Function keys:** F1 help, F2 double size, F3 light/dark, F4 next layout, F5 Visualizer, F9 speed reading.
- **The whole UI scales with the UI font**, including tracks, thumbs, the bottom row and date cards. The range is now 0.8 to 1.5.
- **Editor and reader** replace "edit view" and "render view" in everything you read.
- **Box bevel**, texture smoothness and a redesigned colour picker (a click links a target, a right click paints it).
- **A press is a click until it moves 5px,** so a slightly shaky click no longer picks up a tab or row.

#### Fixes

- **Nothing is lost on a power cut.** Everything is saved within a second of a change, and quitting by any route goes through one orderly shutdown.
- The keyboard always returns to the active slot. A pressed button no longer takes it, and neither does the menu ring.
- The window never opens off screen. On Linux it can be moved again, and a portable AppImage keeps its data beside it.
- Music streams from disk instead of loading whole files into memory.

#### Removed

- The typing flow meter, replaced by the Typing Trail.
- Chromium's built-in spell checker.

## 0.7.3 (2026-10-11)

A fix-and-polish release: **music plays again**, the music player answers your **media keys**, **Ctrl+wheel** changes a note's typography right where you read it, and the **F1 shortcut reference** is redrawn. Supersedes 0.7.2, whose music player stayed silent.

#### New

- **Ctrl+wheel over a note's text** adjusts that pane's typography one step per notch: Ctrl the size, Ctrl+Alt the horizontal spacing, Ctrl+Shift the line height. Edit and render view each keep their own.
- **Media keys and the system media controls** show the current song and drive play, pause, next and previous.
- **Render view letter spacing** can go negative, down to -0.25em.
- **The F1 shortcut reference** is reorganised by region of the app, with one square cap per key and a key legend down the left, and lists the mouse gestures nothing on screen explains.

#### Fixes

- **Music plays again.** Songs played silently since 0.7.2.
- **Undo stays within the note you are editing.** Undoing far enough could write the previously shown document (such as the User Guide) into the current note. The User Guide is now fully read-only, Ctrl+Z included.
- **Hover follows the content.** A row that slides under a still pointer (after archiving or trashing the one above) lights up and shows its buttons without moving the mouse.
- **An empty slot takes the keyboard.** Ctrl+N in a freshly opened slot creates the note there instead of in the previous slot.
- **Render view keeps your place** through several quick typography changes.

#### Removed

- The chapter shortcuts (Shift+Alt+N, Shift+Alt+Delete, Shift+Alt+Backspace). New chapter, cut and merge stay on the chapter bar's buttons and in the quick actions menu.
- F11 no longer toggles immersive mode; Ctrl+Shift+Space does.

## 0.7.2 (2026-10-09)

A polish release: a **keyboard shortcut reference** on F1, simpler list and strikethrough shortcuts, more **chime scales**, and a lot of internal tidying. The game behind the User Guide button has grown up considerably too.

#### New

- **Hold F1** for a full-window reference of every keyboard shortcut and mouse gesture; tap F1 to open the User Guide.
- **Shortcuts:** Ctrl+U starts a bulleted list, Ctrl+O a numbered one, and Ctrl+Shift+X is strikethrough.
- **Chime scales:** one interval stacked is now a scale of its own (semitones, thirds, fourths, tritones, fifths). Scales that were the same notes from another starting point are merged into one each, and a soundscape saved on one still plays exactly as before.

#### Fixes

- The review gutter draws a flag change at once.
- The sidebar toggle restores its mode reliably.

## 0.7.1 (2026-09-30)

**Tables** come to the edit view: insert one from the toolbar, move between cells with Tab and Enter, and let rows tidy themselves as you leave them. Rows and columns can be moved and deleted from a right-click ladder, and a selected cell can be dragged onto another. Alongside that, a round of fixes to clicking, scrolling and sound.

#### Tables

- **Toolbar button** inserts a table. **Tab / Shift+Tab** and **Enter** move cell by cell, and a row is tidied (aligned, never indented) when you leave it.
- **Move rows and columns, delete a column**, from the table's right-click ladder.
- **Drag a selected cell onto another**; the target stays highlighted until you release.

#### Fixes

- A click that wobbles a few pixels stays a click: every in-app drag now starts only past one 5px threshold.
- A fast trackpad swipe no longer makes later mouse-wheel notches scroll or turn the dial several steps at once.
- List buttons start a list on an empty line.
- The selection highlight covers only the selected characters.
- Soundscapes: each soundscape's own volume applies to all its channels, and the space's damping and echoes are audible, with near layers sending more to it.
- Background work on textures and the sidebar scrollbar stops wasting time after it is no longer needed.

## 0.7.0 (2026-09-27)

A big one. **Soundscapes** arrive: a generated soundscape of wind, surf, rain, thunder, running water, fire and wind chimes that plays beside the music, all in one shared space and under one sky. The Escape menu becomes a **dial**, the player gains **sound options** of its own, the wheel learns to **spin**, and large notes open and scroll **without blocking**. Then there is a small secret behind the User Guide button.

#### Soundscapes

- **The Soundscapes button in the music player** turns them on or off, and shows the icon of the soundscape it will play. Scroll over it for volume, and right-click it for the next soundscape. Six factory soundscapes are included: Stormy Night, Wild Sea, Strong winds, Under water, Campsite and Thunderstorm.
- **Settings → Soundscapes** has eighteen channels (wind, rain, thunder, stream, fire and chimes), each with a distance and a place in the stereo field, plus a shared **space** (room to valley) and **weather** (gusts and lulls every channel can follow).
- **Each soundscape has its own volume**, the first slider under Environment. If the loudest moments of a soundscape make the rest of it duck, lower this one.
- Save your own soundscapes, and export or import them as `.tds` files, the same way layouts travel as `.tdl`.

#### Music player

- **Sound options** in the player itself: the headphones button swaps the playlist row for volume, reverb and room size, with mute and bypass switches. Press and hold a number to sweep it, or scroll over the headphones for quick changes.
- **Rewind and fast-forward** scrub across song boundaries, and a 20% click near an edge lands somewhere sensible. Right-click rewind steps back through the last hundred songs.

#### The Escape menu

- **Hold Escape** for a dial rather than a grid. Turn it with the arrows, Tab or the mouse wheel. It sounds like the keyboard it is.
- **Right-click the User Guide button** (the graduation cap) for **ThockQuest**, a small choose-your-path adventure played entirely from that dial. Its difficulty and auto-play live in the new ThockQuest section of the settings.

#### Reading and scrolling

- **Spin the wheel** and the text keeps scrolling on its own, in both edit and render view (Settings → Scrolling). The wheel step is now measured in lines of text, not pixels.
- **Immersive mode** (`F11` or `Ctrl+Shift+Space`): full screen, just the editor you're in.
- **Large notes** open and scroll without freezing. All the parsing moved off the main thread, and the cogwheel in the sidebar turns while the app is still working on something.
- The **edit/render toggle** now belongs to each slot and sits at the right end of its tab bar.

#### The grid

- **Every character takes exactly one cell of the editor's grid.** Emoji, Chinese, Japanese and Korean characters, and invisible characters are left out wherever text comes in, and removed from notes that already contain them. A typed emoji used to show in the editor and vanish on the next restart.
- A symbol the chosen editor font cannot draw at one cell's width (some arrows, box drawing, Greek letters) shows as an empty cell in the edit view, so nothing after it shifts. It is still in the note, and render view, search and exports show it.

#### Settings

- The settings panel names its groups of controls with small labels, spaces every section the same way, and lays its sliders out in even rows.

#### Fixes

- Switching a large note into render view lands where you were reading, not at the top, and switching back returns the caret to where you left it.
- The render view's scrollbar on a large note has the right size, instead of the size it had while the note was still loading.
- Soundscapes move smoothly: the rain's wash and the thunder's rumble no longer lurch whenever they change course, and a loud moment no longer makes every other channel duck.
- Saving an external file no longer marks it as unsaved again after a restart.
- A music scrub no longer ends with an extra 20% jump.
- A fast turn of the wheel in render view no longer travels less than it should.
- Turning soundscapes off and on no longer leaves the old generator running in the background, and thunder costs well under half of what it did.
- Pressing a note card's archive, trash or save button no longer takes the keyboard away from the editor.
- The User Guide and the welcome note were corrected wherever they had fallen behind the app.
- The options cogwheel turns about its own centre instead of wobbling.
- Reopening a large external file in render view no longer freezes the app for seconds.
- Typing no longer leaks memory. Every keystroke used to keep a full copy of the note alive until restart, about 2 MB per keystroke on a 2 MB note. Long writing sessions now stay flat.
- Saving a large note does less work: the note is no longer sent back to the window after every save.

## 0.6.1 (2026-08-30)

A small release about **search results going where they say they go**. Clicking a match in the find list used to take two clicks to reach it, sometimes three — each one landing near the match but not on it. It turns out the jump was never inaccurate: it arrived exactly where it was aimed, and the match had moved while it travelled.

#### Find

- **A search hit is reached on the first click.** Jumping to a match far down a large note means crossing text the editor has never measured, and measuring it is what moves everything below it — including the match being jumped to. The jump now settles its destination in the middle of the journey, while the screen is covered, so it arrives on the match rather than near it.
- **Matches already on screen are marked in the results list**, so you can see at a glance which of your results you are currently looking at.
- **Clicking one of those leaves the page alone.** There is nothing to travel to, so nothing moves — it selects the match where it stands, rather than scrolling the words you are reading out from under you.

#### Also

- The scrollbar thumb now travels with a search jump the way it does with any other long scroll, instead of jumping when the journey crosses the middle of the document.

## 0.6.0 (2026-08-30)

A release about **staying where you put yourself**. Almost everything here is one family of bug: the app working out where you are from geometry it hadn't finished measuring, then trusting the answer. On a large note that could put you hundreds of lines from where you were, and it had a hand in nearly every position glitch below.

#### Your position, kept

- **Switching notes no longer drifts.** A note left at the very top came back one line down, then another, then settled on a heading and looked deliberate. Reading a position and landing on it are inverses; one of the two had the wrong sign.
- **Toggling between edit and render view returns you where you were.** It was landing as much as 26,000 pixels away on a large note, and taking the caret with it — often all the way to the end of the document.
- **Holding an arrow key travels one line at a time.** Crossing into text the editor hadn't rendered yet could jump you four to six lines, or strand the caret at the bottom of the pane. Travelling down was never affected and is now left alone entirely.

#### The scrollbar

- **Clicking the end of the track reaches the end of the document** — on the first click, on a note of any size. It used to stop short until the note had been scrolled through once.
- **The thumb no longer resizes while you read.** Its size is settled once from the note and the type, and only changes when one of those does.
- **Clicking mid-journey behaves.** An ordinary click while a long scroll is travelling is ignored rather than starting a second one; a hold still snaps, and ends the journey cleanly instead of leaving the thumb stretched.

#### Also

- The User Guide's description of what the scrollbar measures was out of date, and said the opposite of the truth in one place.

## 0.5.9 (2026-08-29)

Mostly about **movement** this time: the scrollbar now tells the truth about where you are in a long note, long journeys through one are something you can actually watch happen, and the caret has its own section in Options.

This is also the first release built by the new one-command release protocol — and the first one that ships a **macOS build**. Earlier releases were meant to include a DMG; a permissions problem in the build pipeline meant it was built and then silently discarded every time. That's fixed.

#### Scrolling and the scrollbar

- The scrollbar thumb is sized from the document's lines rather than measured layout, so it stays honest in a long note instead of drifting as you move.
- Small documents get the exact scrollbar they can afford, instead of a thumb that pretends there's more to see.
- Click-and-hold anywhere on the scrollbar track to travel there.
- A long scroll is now shaped as two ramps with a cut between them, and the cut is covered by a passing wall of text — a *bridge* — so a long journey reads as motion rather than as a blank jump. Both the edit and render views have it.
- Max speed means max speed now that no journey has to be endured at a crawl.
- Scroll travel re-aims itself as the document's geometry changes underneath it, and a scroll in flight is no longer re-planned mid-move.
- Text stays locked to the row grid in edit mode, whoever moved it.

#### Preview accuracy

- Every block in the preview is now measured in the background, so the scrollbar is accurate from the moment you open a note rather than only after you've scrolled through it.
- That survey yields to you while you're scrolling, remembers its results by geometry instead of re-running, and re-measures when typography changes.

#### Caret

- New **Options › Caret** section: size, outline, halo blur, effect strength, and six blink shapes.
- The effect-strength slider blends the blink smoothly toward a completely static caret.

#### Fixes

- Fixed the edit pane going black — a compositor layer problem that also affected the block caret and the edge fade.
- Page Up / Page Down now go to the pane you're looking at, not to whatever happens to hold focus.
- Fixed a User Guide error, the User Guide toggle, and several editor focus and italics glitches.
- Proper handling of the undocked window state.
- First chapter heading no longer carries a stray top margin.
- Completed three dependency arrays that were quietly stale.

## 0.5.7 (2026-08-25)

Quite a lot of UI rearranging to more sensible places. We now have the "hold escape" menu!

<img width="1920" height="1032" alt="image" src="https://github.com/user-attachments/assets/8f70abe4-436c-4c7f-b34d-e89b95297c35" />

## 0.5.5 (2026-08-09)

Chapters, custom mouse cursor, line numbers, flagging. Lots of stuff.

## 0.5.3 (2026-07-26)

<img width="1137" height="601" alt="image" src="https://github.com/user-attachments/assets/8559b710-6052-475e-aabc-c4513ac616e8" />

Performance improvements!

## 0.5.2 (2026-07-26)

More granular control over sizing and containers:
- padding of elements
- padding of text
- text size
- border alpha
- box shadow alpha

New Light (default) look.

Various other fixes for a much cleaner look!

Also: Builds on Linux now!

## 0.5.1 (2026-07-23)

<img width="1204" height="730" alt="image" src="https://github.com/user-attachments/assets/765db0f8-7e4a-44f3-acb3-212e2bec79f4" />

More solid tab management!

## 0.5.0 (2026-07-21)

**Thockdown Notes**

*v0.5.0*

Now with
- **multi editor** mode, 
- **internal linking** within and across notes, 
- **tab system** including **tab sets**, 
- more **fonts**, 
- **portable** installation
and more.

**Light mode**:
<img width="1130" height="580" alt="thockdown01" src="https://github.com/user-attachments/assets/e6a19365-4a51-463e-bc7b-de8c77b1e108" />

One of the  **dark mode** presets:
<img width="1130" height="580" alt="thockdown02" src="https://github.com/user-attachments/assets/c44f5147-f4cd-4eaa-86c8-02fa2ba05b44" />

**Mini mode**, collapsed to the always on top music player:
<img width="210" height="52" alt="thockdown03" src="https://github.com/user-attachments/assets/b4b481b1-edd5-49d0-bd28-5571c8fd7905" />

## 0.4.4 (2026-07-18)

Internal linking and new tab and tag bar.

## 0.4.3 (2026-07-12)

A few more fixes.

## 0.4.2 (2026-07-11)

Better external note handling. More obvious deletion and archiving track. Backwards compatibility.

## 0.4.0 (2026-07-05)

Now with layout presets.

## 0.3.2 (2026-07-04)

Now with pretty full customization and audio player. :)

## 0.3.1 (2026-06-27)

_No notes were published for this release._

## alpha (2026-06-26)

Very much a work in progress.
