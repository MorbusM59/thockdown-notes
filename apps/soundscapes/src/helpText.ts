/**
 * What help mode says under each subsection heading (the help button in the
 * Tools row): a concise account of the controls the text stands in for,
 * for a finger. Keyed by the heading as it is shown. The soundscape panel's
 * own subsections are reached through its `help` option (SoundscapeControls).
 */
const HELP: Record<string, string[]> = {
  Tools: [
    'Playback modes: Soundscapes play in one of two modes, manual or scheduled. Both are controlled from the Dashboard.',
    'Manual: Starts when you select a soundscape or tap the soundscape button in the Dashboard\'s dock, and overrides the schedule while in effect. Tapping that button pauses and resumes playback but keeps manual control. Holding it stops playback and ends manual control, so a scheduled soundscape can take over. An expired timer does the same.',
    'Scheduled: Active whenever manual playback is stopped, while the Dashboard\'s clock button is on. Each schedule row plays during its time slot. Where rows compete for a time slot, the top one plays; drag soundscape icons to change the order.',
    'Files button: Tap to load soundscapes from a file. Hold to save your own soundscapes to a file.',
    'Record button: Tap to save the playing soundscape as an audio file. Hold and drag up or down to set the length: 2, 5, 15, 30 or 60 minutes.',
  ],
  Schedule: [
    'Rows: Each row plays a song set, a soundscape, or both, from its start time to its stop time on its active days. A stop time earlier than the start time ends on the next day. Equal start and stop times play for 24 hours.',
    'Overlaps: Music and soundscapes are scheduled separately. Where two rows with a song set overlap, the top one plays; the same goes for soundscapes. A row with only a song set plays alongside a lower row\'s soundscape. Music you start yourself takes priority over the schedule.',
    'Plus button: Tap to add a row for the playing soundscape. Drag a soundscape from Presets onto it to add a row for that soundscape.',
    'Large button: Shows what the row plays: its song set, its soundscape, or both split diagonally, the set at the top left. Tap it to choose both below the row; the first button of each clears it. Hold and drag it onto another row to move the row there. Drag a soundscape from Presets onto it to change what the row plays.',
    'Start button: Shows a note for a song set, the soundscape icon for a soundscape, or play for both. Tap to turn the row on or off.',
    'Times: Tap an hour or minute to advance it one step. Hold and drag up or down to change it faster.',
    'Days: Tap a day to turn it on or off. The calendar button sets all days for the moment: tap for every day, hold for none, tap again to return to your days. Changing a day meanwhile keeps the days as shown.',
    'Bin: Hold to delete the row.',
    'Fades: A row fades in at its start time and is silent at its stop time. Each fade lasts a tenth of the length of the row, at most five minutes.',
  ],
  Timer: [
    'Timer buttons: Tap a length to limit playback to it. Tap the active length again to turn the timer off; playback is then continuous, shown by the active infinity button. Hold a length and drag up or down to change it, from 1 minute to 24 hours.',
    'Countdown: The timer restarts whenever you start or switch a soundscape and holds while paused. Playback fades out at the end, over a tenth of the length, at most five minutes, then stops; a schedule row due then crossfades in instead.',
    'Time left: Shown in brackets under the name of the playing soundscape, for a timer or a schedule row.',
  ],
  Presets: [
    'Soundscapes: Tap one to play it. Hold and drag it to move it, or onto a schedule row or the plus button of the schedule.',
    'Plus button: Adds a copy of the playing soundscape. All changes are saved to the playing soundscape, factory ones included.',
    'Active Soundscape: Shows the playing soundscape. Tap its icon to choose another; hold it to restore the original. Hold the name to rename it.',
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
