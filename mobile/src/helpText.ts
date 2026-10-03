/**
 * What help mode says under each subsection heading (the help button in the
 * Master row): a concise account of the controls the text stands in for,
 * for a finger. Keyed by the heading as it is shown. The soundscape panel's
 * own subsections are reached through its `help` option (SoundscapeControls).
 */
const HELP: Record<string, string[]> = {
  Master: [
    'Play button: Tap to start or pause the soundscape you picked. The icon tells you whether it is playing, paused or stopped. Hold the button to stop playback completely; if a scheduled soundscape is due at this time, it takes over.',
    'Clock button: Turns the daily schedule on or off. A dashed frame around it means you are listening to a scheduled soundscape right now.',
    'Files button: Tap to load soundscapes from a file. Hold it to save the soundscapes you made yourself into a file.',
    'Record button: Tap to save a recording of the soundscape you are hearing as an audio file. Before that, drag up or down on the button to choose how long the recording is: 2, 5, 15 or 30 minutes, or 1 hour. Longer recordings take longer to make.',
    'Look button: Tap to switch between light and dark mode. Drag up or down on it to try the other colour themes.',
    'Volume: The slider sets the overall volume of the app.',
  ],
  Schedule: [
    'How it works: The schedule plays soundscapes for you at set times of day. There is one slot for every hour: the top row is midnight to 11 in the morning, the bottom row is noon to 11 at night. The slot for the current hour has an outline.',
    'Filling slots: Hold a soundscape in the Presets section until it is picked up. Then tap the slots you want it to play in. Tap anywhere else when you are done.',
    'Turning slots on and off: Tap a filled slot to switch it on or off; a slot that is off keeps its soundscape, shown faded. To empty a slot, drag your finger out of it while it is off. To empty several, start on an empty slot and drag sideways across them.',
    'Making a run longer: Drag sideways out of a slot that is on, and the soundscape is copied into every hour you pass over.',
    'Exact start and stop times: The first and last slot of a run show the minute it starts and stops. Drag up or down out of one of them to move that time by 5 minutes.',
    'What you hear: When the schedule is on, a run fades in at its start, fades out at its end, and blends into the next soundscape on the hour, each over a minute. If you are playing or have paused a soundscape yourself, that comes first: the schedule waits until you stop it.',
  ],
  Presets: [
    'Soundscapes: Tap one to play it. Hold one to pick it up for the schedule.',
    'Plus button: Saves the current settings as a new soundscape of your own. Hold it instead to switch every channel off and reset it.',
    'Deleting: When one of your own soundscapes is picked up, the plus button turns into a bin. Tap it to delete that soundscape.',
  ],
  Environment: [
    'Volume: How loud this soundscape is overall.',
    'Size: How big the place is: how long sound takes to come back, how far apart its echoes are, and how long it rings.',
    'Foliage: What fills the place. Bare and hard gives clear echoes and a bright ring, like a mountain valley; dense and soft scatters every echo into a dark, gentle wash and muffles distant sounds, like a forest. Read it together with size: small and bare is a closed room, small and dense a room lined with foam.',
    'Brilliance: How sharply you hear it all. Left is soft and warm, the middle is neutral, right is crisp and sparkling with fuller bass. It changes the character, not the volume.',
    'Amount: How much of the room sound you hear at all.',
    'Weather: A wind that blows through the whole scene, picking up into gusts and dying down into calm spells. Gusts sets how strong those swings are; pace sets how often they come.',
    'How the weather affects channels: Each channel has its own weather control. The higher it is set, the more that channel reacts to the wind: wind and other noise get louder and brighter, rain gets heavier, a fire flares up, chimes ring more often and harder, and thunder comes sooner. All channels react at the same moment, so a gust is heard across the whole scene. A channel with its weather control at zero is not affected at all.',
  ],
  Channels: [
    'Sound sources: There are eighteen, such as wind, rain, fire and chimes. Tap one to show its settings in the sections below.',
    'On and off: Hold a channel to switch it on or off.',
    'Listening to one: Double-tap a channel to hear only that one. Double-tap it again to hear all of them.',
    'Volume: Put your finger on a channel and drag up or down out of it to make it louder or quieter.',
  ],
  Sound: ['The settings below change how the selected channel sounds, such as its loudness and its tone.'],
  Motion: ['The settings below change how the selected channel changes over time: how much and how quickly it swells and fades, and how steady or irregular that is.'],
  Place: ['The settings below change where you hear the selected channel: how close it is, how wide it spreads, and how it drifts from left to right. Its weather setting decides how much it reacts to the wind.'],
}

/** A subsection's help as paragraphs; one opening "Label:" is drawn as a heading (SubsectionHelp). */
export function helpFor(heading: string): string[] | null {
  return HELP[heading] ?? null
}
