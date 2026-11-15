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
    'Record button: Tap to save a recording of the soundscape you are hearing as an audio file. Before that, hold the button and then drag up or down to choose how long the recording is: 2, 5, 15 or 30 minutes, or 1 hour. Longer recordings take longer to make.',
    'Look button: Tap to switch between light and dark mode. Hold it and then drag up or down to try the other colour themes.',
    'Volume: The slider sets the overall volume of the app.',
  ],
  Schedule: [
    'How it works: Each row plays a soundscape from a start time to a stop time on the days you choose. A stop time earlier than the start runs into the next morning. The same start and stop time plays the whole day. Where two rows overlap, the higher one plays.',
    'New rows: Tap the plus at the bottom to add a row for the soundscape that is playing, or hold a soundscape in the Presets section and slide it onto the plus.',
    'The soundscape button: Tap it to switch the row on or off. Hold it and slide it onto another row to move the row there, or slide a soundscape from the Presets section onto it to change what the row plays.',
    'Times: Tap an hour or a minute to move it on by one step. Hold it and then drag up or down to move it further.',
    'Days: Tap a day to switch it on or off. Tap the calendar to play every day, hold it to play no day, and tap it again to go back to your days.',
    'Bin: Hold it to delete the row.',
    'What you hear: When the schedule is on, a run fades in at its start and has faded out by its end, and one row blends into the next where it gives way. Each fade takes a tenth of the play time of the row, at most five minutes. While you play a soundscape yourself, the schedule waits; it takes over again once you stop, or once your timer runs out.',
  ],
  Timer: [
    'How long a soundscape you play runs: tap one of the five lengths to set it, and tap it again to play without end, like the infinity button. It counts from when you start or switch to a soundscape, stops counting while paused, and fades the soundscape out so it is silent at the end, over a tenth of the length, at most five minutes. Then the schedule takes over again.',
    'Lengths: Hold one and then drag up or down to change it, from 1 minute to 24 hours.',
    'Time left: Shown under the name of the soundscape that plays, for the timer or a scheduled row.',
  ],
  Presets: [
    'Soundscapes: Tap one to play it. Hold one and then slide your finger to move it to a new place, or onto a schedule row or its plus.',
    'Plus button: Makes a new soundscape of your own, a copy of the one playing. Changes you make go straight into the soundscape that plays, factory ones included.',
    'The row above: It always shows the soundscape that plays. Tap its icon to choose another icon, or hold it to go back to the original one. Hold the name to rename it.',
    'Reset button: Turns every channel off and puts the environment back to normal, for building a soundscape from scratch.',
    'Bin and undo button: Hold the bin to delete one of your own soundscapes. On a factory soundscape it is an undo arrow instead: hold it to bring the soundscape back the way it shipped.',
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
    'On and off: Hold a channel and let go to switch it on or off.',
    'Listening to one: Double-tap a channel to hear only that one. Double-tap it again to hear all of them.',
    'Volume: Hold a channel that is on and then drag up or down out of it to make it louder or quieter.',
  ],
  Sound: ['The settings below change how the selected channel sounds, such as its loudness and its tone.'],
  Motion: ['The settings below change how the selected channel changes over time: how much and how quickly it swells and fades, and how steady or irregular that is.'],
  Place: ['The settings below change where you hear the selected channel: how close it is, how wide it spreads, and how it drifts from left to right. Its weather setting decides how much it reacts to the wind.'],
}

/** A subsection's help as paragraphs; one opening "Label:" is drawn as a heading (SubsectionHelp). */
export function helpFor(heading: string): string[] | null {
  return HELP[heading] ?? null
}
