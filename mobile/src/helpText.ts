/**
 * What help mode says under each subsection heading (the help button in the
 * Master row): a concise account of the controls the text stands in for,
 * for a finger. Keyed by the heading as it is shown. The soundscape panel's
 * own subsections are reached through its `help` option (SoundscapeControls).
 */
const HELP: Record<string, string> = {
  Master:
    'Power: tap to play or pause; hold to turn the daily schedule on or off (it shows a clock while on). '
    + 'Files: tap to import soundscapes, hold to save yours to a file. '
    + 'Clip: save a five-minute recording of the soundscape. '
    + 'Look: tap for dark or light mode, drag up or down for another look. The slider is the overall volume.',
  Schedule:
    'One slot per hour: 0 to 11 above, 12 to 23 below; the current hour is outlined. '
    + 'Hold a soundscape under Presets to pick it up, then tap slots to fill them; tap anywhere else to put it down. '
    + 'Tap a slot to turn it on or off. Drag sideways out of a slot to paint it across the hours (an empty slot clears them). '
    + 'Drag up or down out of the first or last slot of a run to move its start or stop by five minutes. '
    + 'With the schedule on, a run fades in and out over a minute and crossfades on the hour.',
  Presets:
    'Tap to play a soundscape; hold to pick it up for the schedule. '
    + 'Plus saves the soundscape as you have it; hold plus to turn every channel off and back to its defaults. '
    + 'With one of your own picked up, plus becomes a bin that deletes it.',
  Environment:
    'Shared by every channel: the soundscape\'s volume, the room it plays in (its size, how damped it is, '
    + 'its echoes and how much of it is heard), and the weather (how gusty, and how often a gust comes).',
  Channels:
    'Eighteen sound sources. Tap one to show its controls below; hold to turn it on or off; '
    + 'double-tap to hear it on its own, and again to hear them all.',
  Sound: 'How the channel shown sounds: its level and its tone.',
  Motion: 'How the channel shown moves over time: how far and how fast it rises and falls, and how regularly.',
  Place: 'Where the channel shown sits: how near, how wide, and how it sways from side to side.',
}

export function helpFor(heading: string): string | null {
  return HELP[heading] ?? null
}
