# Thockdown Soundscapes changelog

Newest first, one `## <version>` entry per release, written in the commit that
sets the version in apps/soundscapes/package.json. The Play Store release
workflow (.github/workflows/release-android.yml) refuses to build a version
that has no entry here, and tags the commit it built as
`soundscapes-v<version>`.

## 1.0.0

First release: the desktop app's soundscapes on Android, playing on with the
screen off, with play/pause, next, previous and stop on the notification and
the lock screen.
