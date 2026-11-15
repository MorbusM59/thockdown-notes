/**
 * What help mode says under each subsection heading (the help button in the
 * Master row): a concise account of the controls the text stands in for,
 * for a finger. Keyed by the heading as it is shown. The soundscape panel's
 * own subsections are reached through its `help` option (SoundscapeControls).
 */
const HELP: Record<string, string[]> = {
  Master: [
    'Play button: Tap to play or pause the selected soundscape. Hold to stop; a scheduled soundscape due now then takes over. The icon shows playing, paused or stopped.',
    'Clock button: Turns the schedule on or off. A dashed frame means a scheduled soundscape is playing.',
    'Files button: Tap to load soundscapes from a file. Hold to save your own soundscapes to a file.',
    'Record button: Tap to save the playing soundscape as an audio file. Hold and drag up or down to set the length: 2, 5, 15, 30 or 60 minutes.',
    'Look button: Tap to switch between light and dark mode. Hold and drag up or down to change the colour theme.',
    'Volume: Sets the volume of the app.',
  ],
  Schedule: [
    'Rows: Each row plays a soundscape from its start time to its stop time on its active days. A stop time earlier than the start time ends on the next day. Equal start and stop times play for 24 hours. Where rows overlap, the higher row plays.',
    'Plus button: Tap to add a row for the playing soundscape. Drag a soundscape from Presets onto it to add a row for that soundscape.',
    'Soundscape button: Tap to turn the row on or off. Hold and drag it onto another row to move the row there. Drag a soundscape from Presets onto it to change what the row plays.',
    'Times: Tap an hour or minute to advance it one step. Hold and drag up or down to change it faster.',
    'Days: Tap a day to turn it on or off. The calendar button sets all days for the moment: tap for every day, hold for none, tap again to return to your days. Changing a day meanwhile keeps the days as shown.',
    'Bin: Hold to delete the row.',
    'Fades: A row fades in at its start time and is silent at its stop time. Each fade lasts a tenth of the length of the row, at most five minutes.',
    'Your own playback: While you play a soundscape, the schedule pauses. It resumes when you stop playback or your timer ends.',
  ],
  Timer: [
    'Timer buttons: Tap a length to limit playback to it. Tap the active length again to turn the timer off; playback is then continuous, shown by the active infinity button. Hold a length and drag up or down to change it, from 1 minute to 24 hours.',
    'Countdown: The timer restarts whenever you start or switch a soundscape and holds while paused. Playback fades out to silence at the end, over a tenth of the length, at most five minutes, then stops.',
    'Time left: Shown in brackets under the name of the playing soundscape, for a timer or a schedule row.',
  ],
  Presets: [
    'Soundscapes: Tap one to play it. Hold and drag it to move it, or onto a schedule row or the plus button of the schedule.',
    'Plus button: Adds a copy of the playing soundscape. All changes are saved to the playing soundscape, factory ones included.',
    'Top row: Shows the playing soundscape. Tap its icon to choose another; hold it to restore the original. Hold the name to rename it.',
    'Reset button: Turns every channel off and resets the environment.',
    'Bin button: Hold to delete one of your own soundscapes. On a factory soundscape it is an undo arrow: hold it to restore the original.',
  ],
  Environment: [
    'Volume: The volume of this soundscape.',
    'Size: How large the space is: the delay, spacing and length of its echoes.',
    'Foliage: What fills the space. Bare gives clear echoes and a bright ring, like a valley; dense gives a dark, soft wash, like a forest. Combined with a small size: bare is a closed room, dense a padded room.',
    'Brilliance: The tone. Left is warm and soft, the middle neutral, right crisp with fuller bass. It does not change the volume.',
    'Amount: How much room sound you hear.',
    'Weather: A wind across the whole scene that rises into gusts and falls into calm. Gusts sets their strength, pace how often they come.',
    'Weather per channel: Each channel has a weather setting. The higher it is, the more the channel follows the wind: noise grows louder and brighter, rain heavier, fire stronger, chimes ring more, thunder comes sooner. At zero, the channel ignores the weather.',
  ],
  Channels: [
    'Channels: Eighteen sound sources, such as wind, rain, fire and chimes. Tap one to show its settings below.',
    'On and off: Hold a channel and release to turn it on or off.',
    'Solo: Double-tap a channel to hear only it. Double-tap again to hear all.',
    'Volume: Hold a channel that is on and drag up or down out of it.',
  ],
  Sound: ['The settings below shape how the selected channel sounds: its loudness and tone.'],
  Motion: ['The settings below shape how the selected channel changes over time: how much and how fast it swells and fades, and how regularly.'],
  Place: ['The settings below set where you hear the selected channel: its distance, width and drift from left to right.'],
}

/** A subsection's help as paragraphs; one opening "Label:" is drawn as a heading (SubsectionHelp). */
export function helpFor(heading: string): string[] | null {
  return HELP[heading] ?? null
}
