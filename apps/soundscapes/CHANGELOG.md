# Thockdown Soundscapes changelog

Newest first, one `## <version>` entry per release, written in the commit that
sets the version in apps/soundscapes/package.json. The Play Store release
workflow (.github/workflows/release-android.yml) refuses to build a version
that has no entry here, and tags the commit it built as
`soundscapes-v<version>`.

## 1.1.0

The schedule is now a list of rows: each plays a soundscape from a start time
to a stop time on the days you pick, a stop before the start running into the
next day. The top row wins where rows overlap. Rows fade in at their start and
are silent at their stop, the fade a tenth of the row's length, at most five
minutes. Earlier schedules are not carried over.

A timer limits how long a soundscape you start plays, from 1 minute to 24
hours or continuous. The time left shows under the soundscape's name, and
playback fades out at the end; a schedule row due then crossfades in.

Playing a soundscape yourself overrides the schedule until you stop it (hold
play) or the timer ends; a pause keeps your choice.

The playing soundscape has a row of its own under the presets: change its
icon, rename it, reset it, delete your own or restore a factory one. Every
change is saved to the playing soundscape, factory ones included. Hold and
drag a soundscape to reorder it or to drop it onto a schedule row.

Swiping anywhere scrolls the page; controls that drag need a short hold first.

Sound: rooms, foliage and brilliance are shared with the desktop app, and the
soundscapes are louder.

## 1.0.3

Android Auto: the soundscapes appear in the car as a list to play from, and
play, pause, next and previous work from the car's controls, even when the
app has not been opened since the phone started, or at all since it was
installed.

Chime scales: one interval stacked is a scale of its own, from semitones
through minor and major thirds, fourths and tritones to fifths. Scales that
were the same notes from another starting point (the church modes, and the
rotations of the pentatonics) are now one scale each, since chimes struck at
random have no home note; a soundscape saved on one still plays exactly as
it did.

## 1.0.2

Fixes from an audit of the Android side:
- Stopping playback just as it starts no longer crashes the app.
- Granting the exact-alarm permission while the app is closed now arms the
  schedule straight away.
- On phones without a settings page for exact alarms, asking for that
  permission no longer crashes the app; the schedule stays off instead.
- The schedule's alarms can no longer be fired by other apps.

## 1.0.1

The notification and lock screen name what is playing as "Soundscape: <name>",
for a scheduled soundscape too, and a factory soundscape is named while you
have soundscapes of your own.

Chimes have a width: narrow, the tubes hang together; wide, each tube has
its own place across the stereo field and from near to far, and keeps it.
The chime sliders are rearranged, with the scale on a row of its own.

A new soundscape, Cloudburst. Strong winds is now Snowy Peaks, Under water
Ocean Floor, Campsite River Camp, and Temple Temple Grounds.

Next and previous step through every factory soundscape and then your own,
and no longer stop at unsaved changes.

## 1.0.0

First release: the desktop app's soundscapes on Android, playing on with the
screen off, with play/pause, next, previous and stop on the notification and
the lock screen.
