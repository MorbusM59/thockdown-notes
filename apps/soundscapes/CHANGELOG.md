# Thockdown Soundscapes changelog

Newest first, one `## <version>` entry per release, written in the commit that
sets the version in apps/soundscapes/package.json. The Play Store release
workflow (.github/workflows/release-android.yml) refuses to build a version
that has no entry here, and tags the commit it built as
`soundscapes-v<version>`.

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
