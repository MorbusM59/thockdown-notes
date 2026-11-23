# Google Play data safety form

The answers the Play Console's Data safety section takes, kept with the app
so a release can be checked against them. They follow from `../PRIVACY.md`;
a change to either is a change to both.

## Data collection and security

- Does your app collect or share any of the required user data types? **No.**

Play counts data as collected only when it leaves the device. Nothing does:
the app has no INTERNET permission. What it reads on the device stays there,
which Play does not count as collection:

- Music: audio files in folders the listener picks with the system folder
  picker (a tree grant, no storage permission), and the title, artist and
  album tags in them, kept in the app's private storage as the music library.
- Soundscapes, schedule, settings: the app's private storage.
- Exports (soundscape files, recorded clips): written only where the
  listener chooses, through the system's file picker.

Because nothing is collected, the questions on encryption in transit and on
deletion requests do not apply, and the form shows "No data collected" and
"No data shared with third parties".

## Privacy policy

https://github.com/MorbusM59/thockdown-notes/blob/main/apps/soundscapes/PRIVACY.md
