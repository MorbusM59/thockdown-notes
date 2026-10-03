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
(one button, `LookButton.tsx`, showing a moon: a tap switches between light
and dark mode, each returning to the preset last used in it, and a drag up
or down steps through the current mode's five, showing the preset's icon
while it does and for two seconds after; Paper in light
mode and Ancient in dark by default; kept in
localStorage by `preferencesStore.ts`). They are drawn by the same code the
desktop uses (`src/shared/loadoutTheme.ts` for the variables, filter and
overlays, `src/components/ThemeLayers.tsx` for the glaze and blend layers;
icons and names from `src/shared/presets.ts`), inside the same frame
elements, so a change to a preset reaches both. Textures are the one part of
a preset the phone does not draw: they are rendered by a worker and cached by
the desktop's main process. The desktop's custom layouts are not offered.

## Playback: what is shared, and what is Android's alone
The SOUND is shared: the generator (`src/sound/soundscape-generator.js`),
the settings model, the mix's numbers (`soundscapeMix.ts`: mix gain, the
space's return, the compressor's curve), the impulse response
(`soundscapeSpace.ts`), and the rule that a change of soundscape is a
crossfade between two voices. HOW it reaches the speaker is not:
- **On desktop** (and in a plain browser, or a WebView too old to provide
  the sandbox) it plays LIVE (`soundscapeLivePlayback.ts`): the generator in
  an AudioWorklet and the browser's own ConvolverNode and
  DynamicsCompressorNode, so a slider is heard at the next audio block.
  The desktop rendered ahead for a while, inherited from this app, and every
  slider became a remote control: each change discarded the queued audio
  and re-rendered it, and a room change outlasted the splice margin and
  crackled. Nothing on the desktop needed rendering ahead.
- **On Android** the soundscape is rendered AHEAD of playback by
  `src/sound/soundscapeRenderAhead.ts` (the generator, then the mix in
  JavaScript, `soundscapeMix.ts` -- the space as a partitioned convolution,
  the mix gain, the bus compressor -- because the sandbox has no Web
  Audio), keeping ten seconds of finished audio queued, in the app's native
  service, never in the WebView: the
  same renderer, built as one script (`src/sound/soundscapeSandbox.ts` ->
  `assets/soundscape-renderer.js` by `mobile/vite.renderer.config.ts`), runs
  in a JavaScriptSandbox (`androidx.javascriptengine`, a V8 isolate the app
  owns) driven by `SoundscapeRenderer.java`, and `SoundscapeAudioOutput.java`
  plays it through the platform's AudioTrack from a queue in the app's
  process. The web page only sends settings and the volume
  (`nativeSoundscapePlayback.ts`).

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
history of what it sent (50 ms). A new room (size, damping, echoes) is the
one expensive change -- about a tenth of a second to build, longer than a
splice's margin -- so it is built only once half a second is queued again,
then spliced in at the playhead (`soundscapeRenderAhead.ts`, THE ROOM). A change of SOUNDSCAPE is spliced at the
same frame and crossfaded into a fresh voice over at least two seconds
(the schedule's fades are a minute, a stop's hand-over ten seconds), and a
start from silence or a pause fades in, and a stop with no run to hand over
to fades out, over two seconds (counted from the first rendered sample, not
from the moment of asking); on Android the playhead is read in the same
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

## The session, regular mode and the schedule
On Android the soundscape belongs to a process-wide SESSION
(`SoundscapeSession.java`), not to the web page: it owns the renderer and
the output, outlives the page, the activity and the plugin, and is drawn by
a mediaPlayback foreground service (`SoundscapePlaybackService.java`) as a
notification and a lock-screen entry with previous, play/pause, next and
close.

Two things decide what is heard, combined in the session and nowhere else:
REGULAR MODE -- stopped, playing the soundscape the listener chose, or
paused on it -- and THE SCHEDULE, on or off, with the soundscape of its run
in progress. Regular mode playing or paused OVERRULES the schedule; stopped
hands over to it (its run's soundscape, or nothing, which ends the session).
Choosing a soundscape plays it in regular mode and never touches the
schedule; the power button plays and pauses, and a long press on it stops
regular mode; closing the app (the service's `onTaskRemoved`) stops it too;
pause always silences -- pausing the schedule's run makes it regular mode,
paused on that soundscape; a run's start ends a paused regular mode (a
forgotten pause must not silence tomorrow's run) but never a playing one.
A stop hands over within ten seconds, or fades out over two with no run in
progress (the schedule's own changes take a minute). The schedule's button toggles it and carries the picked-up dashed
frame while what is heard is the schedule's -- from the moment of the
hand-over, while the old soundscape is still fading; the notification says "Playing", "Paused" or "Scheduled until
07:30".

The page drives regular mode while it runs: the engine's playback
(`nativeSoundscapePlayback.ts`) PLAYS the session on opening and PAUSES it on
closing; a stop is its own call, made first, so the engine's closing pause
that follows is ignored (and so is its fade-out to silence, which would
otherwise silence the schedule taking over). The page also PUBLISHES what
next and previous step through (`sessionEntries.ts`): the desktop's own
cycle (`soundscapeCycle`) plus one stop for unsaved changes, each with the
configuration the engine would send, so the session can switch with the
page paused. Changes the session makes itself (media controls, the
schedule, closing the app) are reported (`sessionChanged`), and the page asks
for the state at startup and on returning to the foreground; a stop's
outcome is returned to the call. The session reads the schedule's current run from the stored
schedule whenever it settles, never from a value carried between alarms,
so a restarted process or slots edited under a run are followed. The
renderer skips a configuration identical to the one in force, so the page following the session changes
nothing audible.

Without the JavaScriptSandbox (a WebView older than about 110) the web
playback is used instead: it plays only in the foreground and has no
session, controls, clips or saving to files.

## Clips, export and import
- A CLIP is the current soundscape rendered OFFLINE, two minutes to an hour
  long (a drag up or down on the clip button steps through 2, 5, 15, 30 and
  60 minutes, shown while dragging and for two seconds after; the same
  `useStepDrag.ts` as the look button)
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
The help button (Master row, third) puts the page in HELP MODE: under every
subsection heading, one button-tile spanning the grid explains the controls
it stands in for (`helpText.ts`, written for a finger; the panel takes it
through its `help` option and draws it with `SubsectionHelp`: paragraphs,
each opening "Label:" set bold on a line of its own). Nothing on the page is
a control while help is up, so the page scrolls under a finger then; the
system's back gesture ends help mode, which the page takes while help is up
(`takeBack`) rather than leaving the app.

## Touch
The page does not scroll under a finger (except in help mode): its scrollbar (`PageScrollbar.tsx`,
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
channel on or off, a double tap solos it, a drag up or down out of an enabled
one changes its volume (the desktop's wheel, in the same 5% steps), a long press marks a custom
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
- Every CI build is signed with the app's one key (repository secrets
  `ANDROID_KEYSTORE_BASE64`, a PKCS12 keystore with alias `soundscapes`,
  and `ANDROID_KEYSTORE_PASSWORD`), so a new APK installs as an update.
  The build fails without them. Lose the key and the next install needs
  an uninstall first.
- Locally, with the Android SDK: `npm run mobile:build`, then
  `cd mobile/android && ./gradlew assembleDebug` (or open `mobile/android` in
  Android Studio).
