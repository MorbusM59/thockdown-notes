/**
 * What help mode says under each subsection heading (the help button in the
 * Master row): a concise account of the controls the text stands in for,
 * for a finger. Keyed by the heading as it is shown. The soundscape panel's
 * own subsections are reached through its `help` option (SoundscapeControls).
 */
const HELP: Record<string, string[]> = {
  Master: [
    'Play: Tap to play or pause the soundscape you chose; the icon shows what it is doing. Hold to stop it and hand back to the schedule.',
    'Clock: Turns the daily schedule on or off. A dashed frame shows that what you hear is the schedule\'s.',
    'Files: Tap to import soundscapes from a file. Hold to save your own to a file.',
    'Clip: Tap to save a recording of the current soundscape. Drag up or down to choose its length, from two minutes to an hour.',
    'Look: Tap to switch between light and dark mode. Drag up or down for another look.',
    'Volume: The slider sets the overall volume.',
  ],
  Schedule: [
    'Slots: One per hour, 0 to 11 on top and 12 to 23 below. The current hour is outlined.',
    'Filling: Hold a soundscape under Presets to pick it up, then tap slots to fill them. Tap anywhere else to put it down.',
    'On and off: Tap a slot to turn it on or off. Drag out of a slot that is off to clear it.',
    'Extending: Drag sideways out of a slot that is on to paint its soundscape across the hours.',
    'Start and stop: Drag up or down out of the first or last slot of a run to move its start or stop by five minutes.',
    'Playing: With the schedule on, a run fades in and out over a minute and crossfades on the hour, unless you are playing or have paused a soundscape of your own.',
  ],
  Presets: [
    'Soundscapes: Tap to play one. Hold to pick it up for the schedule.',
    'Plus: Saves the soundscape as you have it. Hold to turn every channel off and back to its defaults.',
    'Bin: With one of your own soundscapes picked up, plus becomes a bin that deletes it.',
  ],
  Environment: [
    'Volume: How loud the whole soundscape is.',
    'Room: The space it plays in, with its size, how damped it is, its echoes, and how much of it is heard.',
    'Weather: One wind for the whole scene, rising into gusts and falling into lulls. Gusts sets how far it swings, pace how often a gust or a lull comes.',
    'Channels in the weather: Only channels whose own weather control is turned up follow it, each in its own way and all at the same moment. Wind and other noise grows louder and brighter, rain heavier, a fire is fanned, chimes are struck more often and harder, thunder comes sooner. A channel with its weather at zero ignores it.',
  ],
  Channels: [
    'Eighteen sound sources: Tap one to show its controls below.',
    'On and off: Hold a channel to turn it on or off.',
    'Solo: Double-tap to hear it on its own, and again to hear them all.',
    'Volume: Drag up or down out of a channel to change its volume.',
    'Weather: Each channel has its own weather control, setting how closely it follows the gusts (see Environment).',
  ],
  Sound: ['How the selected channel sounds, in its level and its tone.'],
  Motion: ['How the selected channel moves over time, in how far and how fast it rises and falls, and how regularly.'],
  Place: ['Where the selected channel sits, in how near and how wide it is, and how it sways from side to side.'],
}

/** A subsection's help as paragraphs; one opening "Label:" is drawn as a heading (SubsectionHelp). */
export function helpFor(heading: string): string[] | null {
  return HELP[heading] ?? null
}
