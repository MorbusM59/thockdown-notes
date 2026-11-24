/**
 * What help mode says (the help button at the bottom right of every dock): a
 * tab's help section (Dashboard, Songs, Visualizer, Settings) or, on
 * Soundscapes and Schedules, the text under each subsection heading; a
 * concise account of the controls it stands in for, for a finger. Keyed by
 * the heading as it is shown. The soundscape panel's
 * own subsections are reached through its `help` option (SoundscapeControls).
 */
const HELP: Record<string, string[]> = {
  Dashboard: [
    'Tabs: The Dashboard picks what plays. The other tabs create and edit the choices.',
    'Music: Tap a song set to add it to the songs that play, or to take it out. Hold one to make it the only set. Neither starts playback.',
    'Soundscape: Tap one to choose it. While a soundscape plays, it fades into the one you chose; otherwise the play button starts it.',
    'Timer: Tap a length to limit playback to it. Tap it again for continuous playback. Hold a length and drag up or down to change it.',
    'Soundstage: Tap one to choose how the music sounds. Edit them in Settings.',
    'Layout: The moon switches dark mode. Tap a look to use it.',
    'Sliders: The music volume, then the soundscape volume.',
    'Filter chip: Between the sliders. Switches the song filter on and off. While it is on, its field shows below the sliders, and only songs whose title, artist, album or folder contain every word you type are picked. Start with $ for artists, § for albums, # for titles. Switching the filter on or off changes the next song, never the one playing.',
    'Filter field: Leaving the field applies what you typed and plays the first song that matches, unless the playing song does. The button at its end applies it while you type, and clears the filter otherwise.',
    'Skip button: Plays the next song.',
    'Music and soundscape buttons: The disc and the podcast switch the music and the soundscape in and out of the mix. A channel that is switched out stays silent, whether you or the schedule plays it.',
    'Play button: Plays or pauses the music and the soundscape together. Hold it to stop both.',
    'Playback modes: Soundscapes play in one of two modes, manual or scheduled. Both are controlled from the Dashboard.',
    'Manual: Starts when you tap the play button, or choose a soundscape while one plays, and overrides the schedule while in effect. Tapping that button pauses and resumes playback but keeps manual control. Holding it stops playback and ends manual control, so a scheduled soundscape can take over. An expired timer does the same.',
    'Scheduled: Active whenever manual playback is stopped, while the clock button is on. Each schedule row plays during its time slot. Where rows compete for a time slot, the top one plays; drag soundscape icons to change the order.',
    'Help button: Explains the tab you are on. Tap it again to return.',
  ],
  Songs: [
    'Song sets: Tap a set to edit it: its songs show below. Which sets play is chosen on the Dashboard. The plus button creates a set.',
    'Open set: Shown in the dock. Tap its icon to choose another; hold the name to rename it. Its buttons add songs or a folder of songs, and a hold on the last one deletes the set, or restores a factory set.',
    'Songs: Tap a song to play it; the music then carries on with the sets chosen on the Dashboard. Hold its cross to remove it from the set; the cross on a group removes the whole group.',
    'Grouping: The dock groups the songs by folder or by artist.',
  ],
  Visualizer: [
    'Eye button: Opens the visualizer. The back gesture closes it.',
    'Phone button: Shows the visualizer upright or sideways.',
    'Scene settings: The rest of this tab tunes the scene: its font, glaze, wave, pulse and spectrum.',
  ],
  Settings: [
    'Soundstages: Create and edit the soundstages the Dashboard picks from. The active one shows in the dock while the section is open.',
    'Beat Detection: How the visualizer follows the beat. Play a calibration loop and set the delay until the flashes land on the beat you hear.',
    'Debugging: Tools for tracing problems.',
    'About: The version, licenses and credits.',
  ],
  Tools: [
    'Files button: Tap to load soundscapes from a file. Hold to save your own soundscapes to a file.',
    'Record button: Tap to save the soundscape you are editing as an audio file. Hold and drag up or down to set the length: 2, 5, 15, 30 or 60 minutes.',
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
    'Soundscapes: Tap one to edit it. Which one plays is chosen on the Dashboard; changes to the playing one are heard at once. Hold and drag a soundscape to move it, or onto a schedule row or the plus button of the schedule.',
    'Plus button: Adds a copy of the soundscape you are editing. All changes are saved to the soundscape you are editing, factory ones included.',
    'Active Soundscape: Shows the soundscape you are editing. Tap its icon to choose another; hold it to restore the original. Hold the name to rename it.',
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
