/**
 * What help mode says (the help button at the bottom right of every dock): a
 * tab's help section (Dashboard, Songs, Visualizer, Soundstages) or, on
 * Soundscapes and Schedules, the text under each subsection heading; a
 * concise account of the controls it stands in for, for a finger. Keyed by
 * the heading as it is shown. The soundscape panel's
 * own subsections are reached through its `help` option (SoundscapeControls).
 */
const HELP: Record<string, string[]> = {
  Dashboard: [
    'Tabs: The Dashboard picks what plays. The other tabs create and edit the choices.',
    'Song Sets: Tap a song set to add it to the songs that play, or to take it out. Hold one to make it the only set. Neither starts playback.',
    'Soundscape: Tap one to choose it. While a soundscape plays, it fades into the one you chose; otherwise the play button starts it.',
    'Timer: Tap a length to limit playback to it. Tap it again for continuous playback. Hold a length and drag up or down to change it.',
    'Soundstage: Tap one to choose how the music sounds. Edit them on the Soundstages tab.',
    'Layout: The moon switches dark mode. Tap a look to use it.',
    'Visualizer: The eye opens the visualizer; the back gesture closes it. The phone button shows it upright or sideways.',
    'Tools: The files button loads soundscapes from a file; hold it to save your own soundscapes to a file. The record button saves the soundscape you picked as an audio file; hold it and drag up or down to set the length: 2, 5, 15, 30 or 60 minutes.',
    'Debugging: Tools for tracing problems.',
    'About: The version, licenses and credits.',
    'Sliders: The music volume, then the soundscape volume.',
    'Music button: Switches the music in or out of the mix. While it is in, the dock also shows the filter chip, the song and its position.',
    'Soundscape button: Switches the soundscape in or out of the mix. A channel that is switched out stays silent, whether you or the schedule plays it.',
    'Filter chip: Between the sliders. Switches the song filter on and off. While it is on, its field shows below the sliders, and only songs whose title, artist, album or folder contain every word you type are picked. Start with $ for artists, § for albums, # for titles. Switching the filter on or off changes the next song, never the one playing.',
    'Filter field: Leaving the field applies what you typed and plays the first song that matches, unless the playing song does. The button at its end applies it while you type, and clears the filter otherwise.',
    'Song: The title of the song that plays, then its artist and album.',
    'Position: Shows how far into the song playback is, and its length. Tap or drag to move through the song. The buttons at its ends play the previous and the next song.',
    'Play button: Plays or pauses the music and the soundscape together. Hold it to stop both. While playback runs with a timer, it shows the time left.',
    'Playback modes: Soundscapes play in one of two modes, manual or scheduled. Both are controlled from the Dashboard.',
    'Manual: Starts when you tap the play button, or choose a soundscape while one plays, and overrides the schedule while in effect. Tapping that button pauses and resumes playback but keeps manual control. Holding it stops playback and ends manual control, so a scheduled soundscape can take over. An expired timer does the same.',
    'Scheduled: Active whenever manual playback is stopped, while the clock button is on. Each schedule row plays during its time slot. Where rows compete for a time slot, the top one plays; drag the grip of a row to change the order.',
    'Help button: Explains the tab you are on. Tap it again to return.',
  ],
  Songs: [
    'Song sets: Tap a set to edit it: its songs show below. Which sets play is chosen on the Dashboard. The plus button creates a set.',
    'Open set: Shown in the dock with its song count. Tap its icon to choose another; hold the name to rename it. The folder button adds a folder and everything under it, with a bar above the dock while its songs are read; a hold on the trash deletes the set, or restores a factory set.',
    'Songs: Tap a song to play it; the music then carries on with the sets chosen on the Dashboard. Hold its cross to remove it from the set; the cross on a group removes the whole group.',
    'Grouping: The dock groups the songs by folder or by artist.',
  ],
  Visualizer: [
    'Presets: Tap one to use it; the plus copies the one in use. Every setting on this tab belongs to the preset in use, except the delay. The dock renames it, changes its icon, resets it, and a hold on the trash deletes it.',
    'Delay: Play a calibration loop and set the delay until the flashes land on the beat you hear.',
    'Signal: How loud the music must be for a full response, and what counts as a hit: the low end, sharp sounds cutting through, and the busy top.',
    'Scene settings: The sections below tune the visualizer: its edge, pane, glaze, wave, pulse and spectrum. It is opened from the Dashboard.',
  ],
  Soundstages: [
    'Soundstages: Create and edit the soundstages the Dashboard picks from. The active one shows in the dock.',
    'Equalization: Drag a point to shape how the music sounds.',
    'Room Parameters: The width of the music and the room it plays in.',
  ],
  Schedule: [
    'Rows: Each row plays a song set, a soundscape, or both, from its start time to its stop time on its active days. A stop time earlier than the start time ends on the next day. Equal start and stop times play for 24 hours.',
    'Overlaps: Music and soundscapes are scheduled separately. Where two rows with a song set overlap, the top one plays; the same goes for soundscapes. A row with only a song set plays alongside a lower row\'s soundscape. Music you start yourself takes priority over the schedule.',
    'Plus button: Tap to add an empty row. Drag a soundscape from Presets onto it to add a row for that soundscape.',
    'Check button: Tap to turn the row on or off. A row that is off is dimmed.',
    'Song set and soundscape: Each button shows what the row plays. Tap one to choose below the row; the first choice clears it. Drag a soundscape from Presets onto the soundscape button to change it.',
    'Times: Tap an hour or a minute to pick it from the chips that take the row\'s place. Tap outside to keep it.',
    'Grip: Hold it and drag onto another row to move the row there.',
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
