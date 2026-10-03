# Mobile soundscape app

The desktop soundscape panel and engine, alone, as an Android app (iOS later).
The whole interface is `SoundscapeControls` from
`src/sidebar/SoundscapeOptions.tsx` plus an on/off switch and a master
volume, which the desktop keeps on the audio bar instead. Nothing here is a
copy: the panel, the engine (`src/sound/SoundscapeEngine.ts`), the worklet
(`src/sound/soundscape-generator.js`) and the settings model
(`src/shared/soundscape*.ts`) are the desktop's own files, so a change there
reaches both.

## Look
Any of the desktop's ten factory visual presets, chosen in the Master section
(one button stepping through the five of the current mode, showing the
current one's icon, plus a dark mode switch that returns to the preset last
used in that mode; Paper, light, by default; kept in
localStorage by `preferencesStore.ts`). They are drawn by the same code the
desktop uses (`src/shared/loadoutTheme.ts` for the variables, filter and
overlays, `src/components/ThemeLayers.tsx` for the glaze and blend layers;
icons and names from `src/shared/presets.ts`), inside the same frame
elements, so a change to a preset reaches both. Textures are the one part of
a preset the phone does not draw: they are rendered by a worker and cached by
the desktop's main process. The desktop's custom layouts are not offered.

## Playback: rendered and played in the app's own service
The soundscape is rendered ahead of playback by one piece of code
(`src/sound/soundscapeRenderAhead.ts`: the generator,
`src/sound/soundscape-generator.js`, then the mix, `soundscapeMix.ts` --
the space as a partitioned convolution, the mix gain, the bus compressor),
keeping ten seconds of finished audio queued at an output. Where it runs is
the platform's:
- **On Android**, in the app's native service, never in the WebView: the
  same renderer, built as one script (`src/sound/soundscapeSandbox.ts` ->
  `assets/soundscape-renderer.js` by `mobile/vite.renderer.config.ts`), runs
  in a JavaScriptSandbox (`androidx.javascriptengine`, a V8 isolate the app
  owns) driven by `SoundscapeRenderer.java`, and `SoundscapeAudioOutput.java`
  plays it through the platform's AudioTrack from a queue in the app's
  process. The web page only sends settings and the volume
  (`nativeSoundscapePlayback.ts`).
- **On desktop** (and in a plain browser, or a WebView too old to provide
  the sandbox), in a worker, played by the player worklet
  (`soundscapeWebPlayback.ts`, `public/soundscape-player.js`).

How it got here, because each step was measured on a device:
1. In the WebView, the generator on the audio thread clicked under load:
   the output buffer was raised to the browser's maximum.
2. Render-ahead in a worker changed nothing for the gap on an app switch;
   diagnostics showed audio queued in the WebView and its OUTPUT stalling
   (six underruns, a second in all, with the player never dry).
3. Playing from a native queue fixed the switch, but playback stopped
   about 100 s into the background: the web page's JavaScript, worker
   included, is paused there, and the native queue ran dry ten seconds
   later. Hence rendering in the service itself.

Outputs are plain queues at absolute frame positions. A settings change is
spliced a margin past the playhead and crossfaded by the RENDERER from its
history of what it sent; on Android the playhead is read in the same
process at the moment of the change, so the margin only covers what the
device has already been handed (its buffer and one writer block).

**Measured against the Web Audio graph the mix replaced**, on the same
generator output for all six factory soundscapes (20 s each at 48 kHz): the
convolution equals the ConvolverNode's to within 1e-7 of full scale, and the
compressor, which uses Chromium's static curve and makeup gain
(`dynamicsCompressor.ts`), matches the node's loudness to 0.00 dB in every
100 ms window, with correlation 1.000.

Samples cross from the sandbox as 16-bit at half scale (`halfScalePcm.ts`;
the native side applies the volume and doubles them back), so a mix above
full scale before the volume is not clipped early. The sandbox needs a
WebView of about version 110; `soundscapeSandbox.test.ts` runs the shipped
bundle in a context with no web APIs, as the sandbox has none.

## Layout
Portrait only (`android:screenOrientation` in the manifest): the panel is one
six-column grid laid out for a phone held upright.

- `mobile/src/` — the web app: `MobileSoundscapeApp.tsx` (the screen),
  `preferencesStore.ts` (localStorage, through the desktop's sanitizer),
  `backgroundAudioHost.ts` (the interface to the native side),
  `sessionEntries.ts` (what the media controls step through),
  `soundscapeFiles.ts` (export and import).
- `mobile/android/` — the Capacitor Android project. The hand-written
  native code is in `app/src/main/java/com/thockdown/soundscapes/`: the
  plugin, the session, the service, the renderer, the output, the clip
  renderer and the shared sandbox. The launcher and notification icons are
  generated from `assets/icon.png`.
- `capacitor.config.ts` (repo root) — points Capacitor at both.

## The session, and the media controls
On Android the soundscape belongs to a process-wide SESSION
(`SoundscapeSession.java`), not to the web page: it owns the renderer and
the output, outlives the page, the activity and the plugin, and is drawn by
a mediaPlayback foreground service (`SoundscapePlaybackService.java`) as a
notification and a lock-screen entry with previous, play/pause, next and
stop. Its states are stopped, playing and paused; paused keeps the renderer
and the queue (the output fades out and holds its playhead), so the service
stays in the foreground while paused -- a foreground service may not be
started again from the background, which is where those controls are
pressed. Only stop ends it.

The web page drives the session while it runs: the engine's playback
(`nativeSoundscapePlayback.ts`) PLAYS it on opening and PAUSES it on
closing, so turning the soundscape off in the app leaves the controls up.
The page also PUBLISHES what next and previous step through
(`sessionEntries.ts`): the desktop's own cycle (`soundscapeCycle`: the
user's soundscapes if there are any, else the factory ones) plus one stop
for unsaved changes, each with the configuration the engine would send for
it, so the session can switch soundscapes with the page paused. The
renderer skips a configuration identical to the one in force, so when the
page follows (on the `sessionChanged` event, and on coming back to the
foreground through `getState`) the engine's own send changes nothing. Only
changes a media control made are reported back: echoing the page's own
would race its next change.

Without the JavaScriptSandbox (a WebView older than about 110) the web
playback is used instead: it plays only in the foreground and has no
session, controls, clips or sharing.

## The schedule
Twenty-four hourly slots (`schedule.ts`, drawn by `ScheduleGrid.tsx` as one
row of six cells, four half-size slots each: 0h-11h on top, 12h-23h below).
A long press on a soundscape in the panel PICKS IT UP without playing it
(the panel's `onPickPreset`, a host option the desktop does not take): every
slot then shows its hour -- the slots already holding it show its icon --
and every tap fills the tapped slot with it, until a press on anything else
puts it down; one of the user's own, picked up, turns the save button into a
delete button for it. With nothing picked up, a TAP turns a slot on or off;
a DRAG sideways paints the pressed slot onto every hour it passes (an active
slot its soundscape, an inactive one emptiness; an extended run keeps its
start and stop minutes at its new edges), counted in hours round the
clock so it carries past the end of a row into the other; a DRAG up or down
clears an inactive slot, and on a run's first or last slot moves the minute
it starts or stops at (5 minutes per slot-height of travel, wrapping). Active
slots form RUNS round the clock (23h and 0h are neighbours), and a run of one
slot is its whole hour. A press
becomes a drag only once the finger leaves the slot, by the edge that sets
its direction; anything released inside the slot is a tap. Active slots form
RUNS round the clock (23h and 0h are neighbours), and a run of one slot is
its whole hour. A long press on the power
button turns the schedule on (it then shows a clock); a tap pauses whatever
plays. A soundscape chosen by hand turns the schedule off.

`schedule.ts` is the ONLY place the slot rules are written: it turns the
slots into EVENTS (start, switch, stop, each at a minute of the day), tested
minute by minute against the slots, and the native side runs those
(`SoundscapeSchedule.java`, stored in SharedPreferences so it acts with the
app closed and after a reboot) by one exact alarm at a time
(`ScheduleReceiver.java`, which also re-arms after a reboot, an update or a
change of clock). Exact alarms need the listener's permission on Android 12
and later; it is asked for when the schedule is turned on, and they are also
what allow the session to start from the background. A start fades in over
a minute, a stop fades out over a minute, and a change of soundscape within
a run is a minute's TRANSITION: two voices rendered side by side and
crossfaded (`RenderAhead.transition`), starting at the end of the rendered
lead, so up to ten seconds after its minute.

## Clips, export and import
- A CLIP is five minutes of the current soundscape rendered OFFLINE
  (`ClipRenderer.java`): the same renderer in its own isolate of the shared
  sandbox (`SharedSandbox.java`, because a process can connect only one),
  stepped as fast as it renders, encoded to AAC in an .m4a (Opus files need
  Android 10; the app supports 8) and saved where the reader chose in the
  system's "Save as" dialog -- asked BEFORE rendering, so it does not
  interrupt a minute later, and cancelling it cancels the clip. At the
  soundscape's own level: the listener's volume is not part of it.
- EXPORT and IMPORT share one button in the Master row (a tap imports, a
  long press exports) and are the desktop's (`src/sidebar/soundscapeFileActions.ts`)
  through a phone implementation of `SoundscapeFileApi`
  (`soundscapeFiles.ts`): saved through the system's "Save as" dialog (the
  Storage Access Framework, so the reader picks folder and name, as on the
  desktop) and opened with the system file picker. Not the share sheet,
  which only hands a file to another app.

## Help
The help button (Master row, second) puts the page in HELP MODE: under every
subsection heading, one button-tile spanning the grid explains the controls
it stands in for (`helpText.ts`, written for a finger; the panel takes it
through its `help` option and draws it with `SubsectionHelp`). A tap
anywhere but the scrollbar ends help mode and does nothing else.

## Touch
The page does not scroll under a finger: its scrollbar (`PageScrollbar.tsx`,
the desktop's track and thumb, worked from a fingertip-wide column at the
right edge; the WebView's own scrollbar is switched off in `MainActivity`)
scrolls it, so every other drag belongs to the
control it starts on -- nearly everything on the page is dragged or held. A
slider resets to its default on a mouse right-click only, never on a long
press. A picked-up soundscape is put down by a press on anything that does
not act on it (anything without `data-pick-target`), which then does what it
always does.

The panel's right-button gestures have touch equivalents in the panel itself
(`SoundscapeControls`, on `pointerType === 'touch'`): a long press turns a
channel on or off, a double tap solos it, a long press marks a custom
soundscape for deletion, a long press on the save button resets the
channels.

## iOS
iOS will need the session implemented with an AVAudioSession in the playback
category and the renderer in JavaScriptCore, behind the same plugin
interface.

## Build
- Browser, for the interface: `npm run mobile:dev`.
- APK without Android Studio: on the phone, open
  `https://github.com/MorbusM59/thockdown-notes/releases/download/android-latest/thockdown-soundscapes.apk`
  (rebuilt on every push to `main` that touches the app). Any other build's
  APK is the zipped `thockdown-soundscapes-debug-apk` artifact on its
  workflow run.
- Locally, with the Android SDK: `npm run mobile:build`, then
  `cd mobile/android && ./gradlew assembleDebug` (or open `mobile/android` in
  Android Studio).
