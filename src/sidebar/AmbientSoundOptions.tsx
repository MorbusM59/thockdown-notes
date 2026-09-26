import { useCallback, useEffect, useRef, useState } from 'react'
import { AccordionSection } from '../components/AccordionSection'
import { CompactScrollbarSlider } from '../components/CompactScrollbarSlider'
import {
  AMBIENT_CHANNEL_ROSTER,
  AMBIENT_CHIME_MATERIALS,
  AMBIENT_CHIME_PITCH_MAX_HZ,
  AMBIENT_CHIME_PITCH_MIN_HZ,
  AMBIENT_CHIME_RING_MAX_SEC,
  AMBIENT_CHIME_RING_MIN_SEC,
  AMBIENT_CHIME_TUBES_MAX,
  AMBIENT_CHIME_TUBES_MIN,
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_FIRE_PERIOD_MAX_SEC,
  AMBIENT_FIRE_PERIOD_MIN_SEC,
  AMBIENT_NOISE_BRIGHTNESS_MAX_HZ,
  AMBIENT_NOISE_BRIGHTNESS_MIN_HZ,
  AMBIENT_NOISE_SWEEP_OCTAVES,
  AMBIENT_PERIOD_MAX_SEC,
  AMBIENT_PERIOD_MIN_SEC,
  AMBIENT_RAIN_DRIPS_MAX_PER_SEC,
  AMBIENT_WATER_BUBBLES_PER_SEC,
  AMBIENT_RAIN_SURFACE_ANCHORS,
  AMBIENT_SKEW_MAX,
  AMBIENT_SKEW_MIN,
  AMBIENT_THUNDER_JITTER,
  AMBIENT_THUNDER_LENGTH_MAX_SEC,
  AMBIENT_THUNDER_LENGTH_MIN_SEC,
  AMBIENT_WEATHER_PACE_MAX_SEC,
  AMBIENT_WEATHER_PACE_MIN_SEC,
  DEFAULT_AMBIENT_SPACE,
  DEFAULT_AMBIENT_WEATHER,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientFaderDb,
  ambientPartDb,
  ambientSettingsSignature,
  applyAmbientPreset,
  chimeSemitoneHz,
  chimeSemitoneOf,
  chimeStrikesPerSecond,
  cloneSettings,
  createAmbientChannel,
  rainDropsPerSecond,
  type AmbientChannelKind,
  type AmbientChannelSettings,
  type AmbientPreferences,
  type AmbientPreset,
  type AmbientSettings,
} from '../shared/ambientSound'
import { spaceDecaySec } from '../shared/ambientSpace'
import { CHIME_SCALE_COUNT, CHIME_SCALES } from '../shared/ambientChimeScales'
import { armHold, HOLD_COMMIT_MS, HOLD_CONFIRM_MS } from '../shared/holdTiming'
import { newSoundscapeId, neutralSoundscape } from '../shared/ambientSoundscapeFile'
import { exportSoundscapes } from './soundscapeFileActions'
import { useNonPassiveWheel } from '../shared/useNonPassiveWheel'

const PRESET_ICONS: Record<string, string> = {
  'stormy-night': 'fa-cloud-moon-rain',
  street: 'fa-road',
  forest: 'fa-tree',
  tent: 'fa-umbrella',
  roof: 'fa-house',
  storm: 'fa-cloud-bolt',
  ocean: 'fa-water',
  wind: 'fa-wind',
  camp: 'fa-campground',
  fireside: 'fa-fire',
  rift: 'fa-infinity',
  pulse: 'fa-wave-square',
}

const KIND_LOOK: Record<AmbientChannelKind, { icon: string; label: string }> = {
  noise: { icon: 'fa-wave-square', label: 'Noise' },
  rain: { icon: 'fa-cloud-rain', label: 'Rain' },
  thunder: { icon: 'fa-bolt-lightning', label: 'Thunder' },
  water: { icon: 'fa-droplet', label: 'Water' },
  fire: { icon: 'fa-fire', label: 'Fire' },
  chimes: { icon: 'fa-bell', label: 'Chimes' },
}

const ENVIRONMENT_DEFAULTS = { ...DEFAULT_AMBIENT_SPACE, ...DEFAULT_AMBIENT_WEATHER } as unknown as Record<string, number>

// ---------------------------------------------------------------------------
// How values read.

const percent = (value: number) => `${Math.round(value * 100)}%`

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`
}

function formatSeconds(sec: number): string {
  return sec >= 10 ? `${Math.round(sec)} s` : `${sec.toFixed(1)} s`
}

function formatPan(value: number): string {
  return Math.abs(value) < 0.01 ? 'Center' : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? 'L' : 'R'}`
}

function formatVolume(value: number): string {
  const db = ambientFaderDb(value)
  return db === -Infinity ? 'Off' : `${Math.round(db)} dB`
}

function formatAmount(value: number, zero: string, one?: string): string {
  if (value < 0.005) return zero
  if (one && value > 0.995) return one
  return percent(value)
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
function formatPitch(hz: number): string {
  const midi = Math.round(69 + (12 * Math.log2(hz / 440)))
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1} · ${Math.round(hz)} Hz`
}

/** Between named points of a 0-1 scale: the name at a point, and how far from one toward the next. */
function formatScale(value: number, points: ReadonlyArray<{ name: string; at: number }>): string {
  const exact = points.find((point) => Math.abs(point.at - value) < 0.005)
  if (exact) return exact.name
  const upperIndex = points.findIndex((point) => point.at > value)
  const lower = points[upperIndex - 1]
  const upper = points[upperIndex]
  return `${lower.name} → ${upper.name.toLowerCase()} ${Math.round(((value - lower.at) / (upper.at - lower.at)) * 100)}%`
}

const SURFACE_NAMES: Record<(typeof AMBIENT_RAIN_SURFACE_ANCHORS)[number]['name'], string> = {
  forest: 'Leaves', canvas: 'Canvas', street: 'Street', tin: 'Tin', glass: 'Glass',
}
const SURFACE_POINTS = AMBIENT_RAIN_SURFACE_ANCHORS.map((anchor) => ({ name: SURFACE_NAMES[anchor.name], at: anchor.at }))
const MATERIAL_POINTS = AMBIENT_CHIME_MATERIALS.map((material) => ({ name: material.name[0].toUpperCase() + material.name.slice(1), at: material.at }))
const COLOUR_POINTS = [{ name: 'Brown', at: 0 }, { name: 'Pink', at: 0.5 }, { name: 'White', at: 1 }]

/** A part's level slider (ambientPartGain): off, as authored, or how far from it. */
function formatPartLevel(value: number): string {
  const db = ambientPartDb(value)
  if (db === -Infinity) return 'Off'
  return Math.abs(db) < 0.5 ? 'As is' : `${db > 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`
}

/** A tone slider: how far, in octaves, from the part as authored. */
function formatShift(value: number, octaves: number): string {
  const shift = (value - 0.5) * 2 * octaves
  return Math.abs(shift) < 0.02 ? 'As is' : `${shift > 0 ? '+' : '−'}${Math.abs(shift).toFixed(1)} oct`
}

function formatThunderShare(value: number): string {
  if (value < 0.0025) return 'Never'
  if (value > 0.9975) return 'No pause'
  if (value < 0.5) return `1 : ${Math.round((1 - value) / value)}`
  const ratio = value / (1 - value)
  return `${ratio < 9.95 ? ratio.toFixed(1) : Math.round(ratio)} : 1`
}

// ---------------------------------------------------------------------------
// The controls, per kind.

/**
 * One slider. The stored value is in the control's own units (hertz,
 * seconds, a share); `log` sliders move by equal RATIOS, so a range that
 * spans decades spends its travel evenly across them rather than cramming
 * the low end into the first few pixels.
 */
interface ControlSpec {
  key: string
  track: string
  tooltip: string
  min: number
  max: number
  step?: number
  log?: boolean
  /** A pitch in Hz stepped in equal-tempered semitones from A440: the slider moves one semitone per step. */
  semitones?: boolean
  format: (value: number) => string
}

interface ControlGroup {
  label: string
  /** Whether the label is shown above the group; it names the group for assistive technology either way. */
  hideLabel?: boolean
  controls: ControlSpec[]
}

const unit = (key: string, track: string, tooltip: string, format: (value: number) => string): ControlSpec => (
  { key, track, tooltip, min: 0, max: 1, format }
)

const VOLUME = unit('volume', 'vol', 'Volume; scroll the channel button to adjust', formatVolume)
const DISTANCE = unit('distance', 'distance', 'Near and distinct to far, darker and diffuse in the space', (value) => formatAmount(value, 'Near', 'Far'))
const PAN: ControlSpec = { key: 'pan', track: 'pan', tooltip: 'Where it is; toward a side it also narrows onto that side', min: -1, max: 1, format: formatPan }
const WEATHER = unit('weather', 'weather', 'How closely it follows the weather\'s gusts', (value) => formatAmount(value, 'Ignores', 'Fully'))

const CONTROLS: { [K in AmbientChannelKind]: ControlGroup[] } = {
  noise: [
    {
      label: 'Sound',
      controls: [
        VOLUME,
        unit('colour', 'colour', 'The noise itself: deep brown, balanced pink, bright white, and every blend between', (value) => formatScale(value, COLOUR_POINTS)),
        { key: 'brightnessHz', track: 'bright', tooltip: 'Where the filter sits: the cutoff of a darkening low-pass, or the pitch of the band when focused', min: AMBIENT_NOISE_BRIGHTNESS_MIN_HZ, max: AMBIENT_NOISE_BRIGHTNESS_MAX_HZ, log: true, format: (value) => (value >= AMBIENT_NOISE_BRIGHTNESS_MAX_HZ * 0.99 ? 'Open' : formatHz(value)) },
        unit('focus', 'focus', 'A gentle low-pass to a narrow resonant band: a whistle at the brightness', (value) => formatAmount(value, 'Broad', 'Whistle')),
      ],
    },
    {
      label: 'Motion',
      controls: [
        unit('depth', 'depth', 'How far the level rises and falls over a cycle', (value) => formatAmount(value, 'Steady')),
        { key: 'periodSec', track: 'period', tooltip: 'Seconds per cycle', min: AMBIENT_PERIOD_MIN_SEC, max: AMBIENT_PERIOD_MAX_SEC, log: true, format: formatSeconds },
        unit('curve', 'curve', 'A broad plateau with brief dips, a sine, or long quiet with a short swell', (value) => (Math.abs(value - 0.5) < 0.005 ? 'Sine' : value < 0.5 ? `Plateau ${Math.round(((0.5 - value) / 0.5) * 100)}%` : `Swell ${Math.round(((value - 0.5) / 0.5) * 100)}%`)),
        { key: 'skew', track: 'skew', tooltip: 'Where the peak falls: a fast rise and slow fall (a wave), or a slow build and sudden drop', min: AMBIENT_SKEW_MIN, max: AMBIENT_SKEW_MAX, format: (value) => (Math.abs(value - 0.5) < 0.005 ? 'Even' : value < 0.5 ? `Fast rise ${Math.round(((0.5 - value) / 0.4) * 100)}%` : `Fast fall ${Math.round(((value - 0.5) / 0.4) * 100)}%`) },
        { key: 'sweep', track: 'sweep', tooltip: 'How far the filter follows the swell: opening as it rises (a gust whistling higher, a wave brightening as it breaks), or closing', min: -1, max: 1, format: (value) => (Math.abs(value) < 0.005 ? 'Fixed' : `${value > 0 ? 'Opens' : 'Closes'} ${(Math.abs(value) * AMBIENT_NOISE_SWEEP_OCTAVES).toFixed(1)} oct`) },
        unit('variation', 'vary', 'How much each cycle departs from the last in length and height', (value) => formatAmount(value, 'Regular')),
      ],
    },
    {
      label: 'Place',
      controls: [
        DISTANCE,
        unit('width', 'width', 'Two unrelated sides, enveloping, to a single point', (value) => formatAmount(value, 'Point', 'Wide')),
        unit('sway', 'sway', 'How far it sways across the field, crossing centre at each peak', (value) => formatAmount(value, 'Still')),
        WEATHER,
      ],
    },
  ],
  rain: [
    {
      label: 'Sound',
      // Rows of three: the surface, then drops, wash, drips and splashes
      // each as amount, level and tone.
      controls: [
        VOLUME,
        unit('surface', 'surface', 'What it falls on, soft to hard: leaves, canvas, street, tin, glass, and every blend between', (value) => formatScale(value, SURFACE_POINTS)),
        unit('resonance', 'ring', 'How much the surface rings: only the impact, as it is, or twice as long', (value) => (value < 0.01 ? 'Dead' : Math.abs(value - 0.5) < 0.005 ? 'As is' : value > 0.99 ? 'Ringing' : percent(value))),
        unit('intensity', 'drops', 'The drops heard one by one: drizzle to downpour, how many and how heavy', (value) => `${rainDropsPerSecond(value) < 10 ? rainDropsPerSecond(value).toFixed(1) : Math.round(rainDropsPerSecond(value))} / s`),
        unit('dropLevel', 'level', 'How loud the drops are', formatPartLevel),
        unit('dropTone', 'tone', 'The drops\' pitch, an octave either way', (value) => formatShift(value, 1)),
        unit('washDensity', 'wash', 'The steady wash of rain too dense to hear drop by drop: a sparse patter to a smooth hiss', (value) => formatAmount(value, 'Patter', 'Hiss')),
        unit('washLevel', 'level', 'How loud the wash is; off leaves the drops alone, which sounds like dripping', formatPartLevel),
        unit('washTone', 'tone', 'The wash\'s pitch, two octaves either way', (value) => formatShift(value, 2)),
        unit('drips', 'drips', 'Large, heavy drops from gutters, eaves and branches', (value) => (value < 0.01 ? 'Off' : `${(value * AMBIENT_RAIN_DRIPS_MAX_PER_SEC).toFixed(1)} / s`)),
        unit('dripLevel', 'level', 'How loud the drips are', formatPartLevel),
        unit('dripTone', 'tone', 'The drips\' pitch, an octave either way', (value) => formatShift(value, 1)),
        unit('wetness', 'wet', 'Standing water: how many drops land in it, and how much its film deadens the surface', (value) => formatAmount(value, 'Dry', 'Soaked')),
        unit('splashLevel', 'level', 'How loud the splashes and the plip of trapped bubbles are', formatPartLevel),
        unit('splashTone', 'tone', 'The splashes\' pitch and the bubbles\' size, an octave either way', (value) => formatShift(value, 1)),
      ],
    },
    {
      label: 'Place',
      controls: [
        DISTANCE,
        PAN,
        unit('width', 'width', 'A point at its pan to as wide as its pan allows', (value) => formatAmount(value, 'Point', 'Wide')),
        WEATHER,
      ],
    },
  ],
  thunder: [
    {
      label: 'Sound',
      controls: [
        VOLUME,
        { key: 'share', track: 'share', tooltip: 'Rumbling to silence', min: 0, max: 1, step: 0.005, format: formatThunderShare },
        { key: 'lengthSec', track: 'length', tooltip: 'How long a peal rolls', min: AMBIENT_THUNDER_LENGTH_MIN_SEC, max: AMBIENT_THUNDER_LENGTH_MAX_SEC, step: 1, format: formatSeconds },
        unit('character', 'character', 'How the boom under the rumble breaks up: a smooth swell or a choppy growl', (value) => formatAmount(value, 'Smooth', 'Harsh')),
        { key: 'contrast', track: 'contrast', tooltip: 'Loud and quiet pushed apart, or drawn together', min: -1, max: 1, format: (value) => (Math.abs(value) < 0.005 ? 'Off' : `${value > 0 ? '+' : '−'}${percent(Math.abs(value))}`) },
        unit('randomness', 'random', 'How much each peal varies around these settings', (value) => (value < 0.005 ? 'Off' : `±${Math.round(value * AMBIENT_THUNDER_JITTER * 100)}%`)),
      ],
    },
    {
      label: 'Place',
      controls: [
        DISTANCE,
        PAN,
        unit('spread', 'spread', 'How much of the field a peal fills around its pan', (value) => formatAmount(value, 'Point', 'Wide')),
        { ...WEATHER, tooltip: 'How much gusts bring the next peal sooner' },
      ],
    },
  ],
  water: [
    {
      label: 'Sound',
      // Rows of three: the whole brook, then the bubbles (how many, how
      // loud, how big), their shape, and the rush beneath them.
      controls: [
        VOLUME,
        unit('turbulence', 'tumble', 'An even flow, or water arriving in bursts as it tumbles over stones; bunches the bubbles, and sways the rush a little', (value) => formatAmount(value, 'Even')),
        unit('width', 'width', 'A point at its pan to as wide as its pan allows', (value) => formatAmount(value, 'Point', 'Wide')),
        unit('bubbles', 'bubbles', 'How many bubbles: a few to a froth', (value) => {
          const perSec = AMBIENT_WATER_BUBBLES_PER_SEC[0] * ((AMBIENT_WATER_BUBBLES_PER_SEC[1] / AMBIENT_WATER_BUBBLES_PER_SEC[0]) ** value)
          return `${Math.round(perSec)} / s`
        }),
        unit('bubbleLevel', 'level', 'How loud the bubbles are', formatPartLevel),
        unit('size', 'size', 'Small, high, glassy bubbles to large, low gurgles', (value) => formatAmount(value, 'Fine', 'Deep')),
        unit('sizeSpread', 'spread', 'How much the bubbles vary in size: all alike, as authored, or far apart', (value) => (value < 0.005 ? 'Alike' : Math.abs(value - 0.5) < 0.005 ? 'As is' : percent(value))),
        unit('rise', 'rise', 'How far a bubble\'s pitch climbs as it rises: a flat plop to a chirp', (value) => (value < 0.005 ? 'Flat' : Math.abs(value - 0.5) < 0.005 ? 'As is' : `×${((2 * value) ** 2).toFixed(1)}`)),
        unit('ring', 'ring', 'How long a bubble rings: a dead plop to a ringing note', (value) => (Math.abs(value - 0.5) < 0.005 ? 'As is' : value < 0.5 ? 'Duller' : 'Longer')),
        unit('rush', 'rush', 'The texture of the flow beneath the bubbles: a sparse gravelly rattle to a smooth rush', (value) => formatAmount(value, 'Gravel', 'Smooth')),
        unit('rushLevel', 'level', 'How loud the rush is; off leaves the bubbles alone', formatPartLevel),
        unit('rushTone', 'tone', 'The rush\'s pitch, two octaves either way', (value) => formatShift(value, 2)),
      ],
    },
    { label: 'Place', controls: [DISTANCE, PAN] },
  ],
  fire: [
    {
      label: 'Sound',
      // Rows of three: the whole fire, then crackle, pops and hiss each as
      // amount, level and tone, then how the flames move.
      controls: [
        VOLUME,
        unit('size', 'size', 'Embers to a blaze: the weight and depth of the roar', (value) => formatAmount(value, 'Embers', 'Blaze')),
        unit('width', 'width', 'A point at its pan to as wide as its pan allows', (value) => formatAmount(value, 'Point', 'Wide')),
        unit('crackle', 'crackle', 'How often the wood crackles', (value) => formatAmount(value, 'Rarely', 'Constantly')),
        unit('crackleLevel', 'level', 'How loud the crackles are', formatPartLevel),
        unit('crackleTone', 'tone', 'The crackles\' pitch, two octaves either way', (value) => formatShift(value, 2)),
        unit('pops', 'pops', 'How often sap pops and sizzles', (value) => formatAmount(value, 'Never', 'Often')),
        unit('popLevel', 'level', 'How loud the pops are', formatPartLevel),
        unit('popTone', 'tone', 'A dull thud to a bright crack', (value) => formatAmount(value, 'Thud', 'Crack')),
        unit('sizzle', 'sizzle', 'The chance a pop opens a pocket of moisture that sizzles on at its place for a while (at most four at once)', (value) => (value < 0.005 ? 'Never' : value > 0.995 ? 'Every pop' : `${Math.round(value * 100)}% of pops`)),
        unit('sizzleLevel', 'level', 'How loud the sizzle is', formatPartLevel),
        unit('sizzleTone', 'tone', 'The pitch of the sizzle and its texture: low is frazzled, crackling with sparse bursts; high is a smooth hiss', (value) => `around ${formatHz(4000 * (2 ** value))}`),
        unit('flicker', 'flicker', 'How far the roar swings as the flames move: a steady burn, or surging and faltering', (value) => formatAmount(value, 'Steady', 'Guttering')),
        { key: 'flickerPeriodSec', track: 'period', tooltip: 'The average length of one movement of the flames', min: AMBIENT_FIRE_PERIOD_MIN_SEC, max: AMBIENT_FIRE_PERIOD_MAX_SEC, log: true, format: formatSeconds },
        unit('flickerDynamics', 'dynamics', 'Soft swells at an even pace, or sudden lurches at an uneven one', (value) => formatAmount(value, 'Gentle', 'Wild')),
      ],
    },
    { label: 'Place', controls: [DISTANCE, PAN, { ...WEATHER, tooltip: 'How much the wind fans the flames' }] },
  ],
  chimes: [
    {
      label: 'Sound',
      controls: [
        VOLUME,
        { key: 'pitchHz', track: 'pitch', tooltip: 'The lowest tube, in semitones from A440; the rest climb the scale', min: AMBIENT_CHIME_PITCH_MIN_HZ, max: AMBIENT_CHIME_PITCH_MAX_HZ, semitones: true, format: formatPitch },
        { key: 'tubes', track: 'tubes', tooltip: 'How many tubes', min: AMBIENT_CHIME_TUBES_MIN, max: AMBIENT_CHIME_TUBES_MAX, step: 1, format: (value) => `${Math.round(value)} tubes` },
        { key: 'ringSec', track: 'ring', tooltip: 'How long a struck tube rings (for metal; wood knocks far shorter, glass a little shorter, the veil longer)', min: AMBIENT_CHIME_RING_MIN_SEC, max: AMBIENT_CHIME_RING_MAX_SEC, log: true, format: formatSeconds },
        unit('activity', 'activity', 'How often the striker is set moving, before the wind has any say', (value) => `${chimeStrikesPerSecond(value).toFixed(chimeStrikesPerSecond(value) < 1 ? 2 : 1)} / s`),
        unit('hardness', 'hardness', 'A soft striker, warm and round, to a hard one, bright with a tick', (value) => formatAmount(value, 'Soft', 'Hard')),
        unit('unison', 'unison', 'How much the chimes sound together: single notes, or the striker rebounding across the ring into a cascade', (value) => formatAmount(value, 'Single', 'Cascade')),
        unit('material', 'material', 'What the tubes are made of: wood (bamboo), metal, glass, and a veil of shimmering, swelling tones, and every blend between', (value) => formatScale(value, MATERIAL_POINTS)),
        { key: 'scale', track: 'scale', tooltip: 'The scale the tubes are tuned to', min: 0, max: CHIME_SCALE_COUNT - 1, step: 1, format: (value) => CHIME_SCALES[Math.round(value)].name },
      ],
    },
    { label: 'Place', controls: [DISTANCE, PAN, { ...WEATHER, tooltip: 'How much gusts set the striker moving, harder and into more of the ring' }] },
  ],
}

/**
 * The environment: the space every channel plays in and the weather they may
 * follow -- settings across all channels, shown above them as one group.
 */
const ENVIRONMENT_CONTROLS: ControlGroup[] = [{
  label: 'Environment',
  hideLabel: true,
  controls: [
    unit('size', 'size', 'A small room to a wide valley: how long the space rings, and how late its first reflection', (value) => `${formatSeconds(spaceDecaySec(value))} decay`),
    unit('damping', 'damping', 'A bright tail, or one that darkens fast, as open air and foliage swallow the highs', (value) => formatAmount(value, 'Bright', 'Dark')),
    unit('echoes', 'echoes', 'Distinct echoes off walls, buildings or cliffs', (value) => formatAmount(value, 'None')),
    unit('amount', 'amount', 'How much of the space is heard', (value) => formatAmount(value, 'Dry', 'Full')),
    unit('gustiness', 'gusts', 'Calm to squally: how far a gust or a lull moves every layer that follows the weather', (value) => formatAmount(value, 'Calm', 'Squally')),
    { key: 'paceSec', track: 'pace', tooltip: 'Average seconds from one gust or lull to the next', min: AMBIENT_WEATHER_PACE_MIN_SEC, max: AMBIENT_WEATHER_PACE_MAX_SEC, log: true, format: formatSeconds },
  ],
}]

// ---------------------------------------------------------------------------

interface AmbientSoundOptionsProps {
  preferences: AmbientPreferences
  onChange: (preferences: AmbientPreferences) => void
}

/**
 * New settings, with the active preset re-derived from them: the preset stays
 * selected exactly while the settings still match it. Every edit goes
 * through here, the channel-button wheel included.
 */
function withSettings(preferences: AmbientPreferences, settings: AmbientSettings): AmbientPreferences {
  const signature = ambientSettingsSignature(settings)
  const matchingPreset = [...AMBIENT_FACTORY_PRESETS, ...preferences.customPresets].find((preset) => (
    ambientSettingsSignature(preset.settings) === signature
  ))
  return { ...preferences, settings, activePresetId: matchingPreset?.id ?? null }
}

function toPosition(spec: ControlSpec, value: number): number {
  if (spec.semitones) return chimeSemitoneOf(value)
  return spec.log ? Math.log(value / spec.min) / Math.log(spec.max / spec.min) : value
}

function fromPosition(spec: ControlSpec, position: number): number {
  if (spec.semitones) return chimeSemitoneHz(Math.round(position))
  const value = spec.log ? spec.min * ((spec.max / spec.min) ** position) : position
  return spec.step === 1 ? Math.round(value) : value
}

interface ControlGroupsProps {
  idPrefix: string
  groups: ControlGroup[]
  values: Record<string, number>
  defaults: Record<string, number>
  disabled: boolean
  name: string
  onCommit: (key: string, value: number) => void
}

function ControlGroups({ idPrefix, groups, values, defaults, disabled, name, onCommit }: ControlGroupsProps) {
  return (
    <>
      {groups.map((group) => (
        <div className="ambient-control-group" role="group" aria-label={`${name} ${group.label.toLowerCase()}`} key={group.label}>
          {!group.hideLabel && <div className="ambient-control-group-label" aria-hidden="true">{group.label}</div>}
          {group.controls.map((spec) => (
            <CompactScrollbarSlider
              key={spec.key}
              id={`${idPrefix}-${spec.key}`}
              min={spec.semitones ? chimeSemitoneOf(spec.min) : spec.log ? 0 : spec.min}
              max={spec.semitones ? chimeSemitoneOf(spec.max) : spec.log ? 1 : spec.max}
              step={spec.semitones ? 1 : spec.log ? 0.005 : spec.step ?? 0.01}
              value={toPosition(spec, values[spec.key])}
              trackLabel={spec.track}
              tooltipLabel={spec.tooltip}
              ariaLabel={`${name} ${spec.track}`}
              disabled={disabled}
              defaultValue={defaults[spec.key] === undefined ? undefined : toPosition(spec, defaults[spec.key])}
              formatValue={(position) => spec.format(fromPosition(spec, position))}
              onCommit={(position) => onCommit(spec.key, fromPosition(spec, position))}
            />
          ))}
        </div>
      ))}
    </>
  )
}

export function AmbientSoundOptions({ preferences, onChange }: AmbientSoundOptionsProps) {
  const [pendingDeletePresetId, setPendingDeletePresetId] = useState<string | null>(null)
  const channelSelectorRef = useRef<HTMLDivElement | null>(null)
  const channelHoldRef = useRef<{ pointerId: number; cancel: () => void } | null>(null)
  const suppressNextContextMenuRef = useRef(false)
  const [selectedId, setSelectedId] = useState<string>(() => AMBIENT_CHANNEL_ROSTER[0].id)
  // Holding right-click on a custom soundscape exports it, as it does on a
  // custom layout; a short right-click primes it for deletion instead. Which
  // one is decided on the RELEASE (the hold still pending there is a short
  // click), never by the contextmenu event, which Chromium fires on the press
  // on some platforms and on the release on others.
  const presetExportHoldRef = useRef<{ pointerId: number; cancel: () => void } | null>(null)
  const resetHoldRef = useRef<{ pointerId: number; cancel: () => void } | null>(null)
  useEffect(() => () => {
    channelHoldRef.current?.cancel()
    presetExportHoldRef.current?.cancel()
  }, [])
  const channels = preferences.settings.channels
  const selectedChannel = channels.find((channel) => channel.id === selectedId) ?? null
  const allPresets = [...AMBIENT_FACTORY_PRESETS, ...preferences.customPresets]
  const currentSignature = ambientSettingsSignature(preferences.settings)
  const matchingPresets = allPresets.filter((preset) => ambientSettingsSignature(preset.settings) === currentSignature)
  const selectedPresetId = matchingPresets.find((preset) => preset.id === preferences.activePresetId)?.id
    ?? matchingPresets[0]?.id
    ?? null
  const hasPendingChanges = matchingPresets.length === 0
  const canSave = hasPendingChanges && preferences.customPresets.length < MAX_AMBIENT_CUSTOM_PRESETS

  const commitSettings = (settings: AmbientSettings) => {
    onChange(withSettings(preferences, settings))
  }

  const updateChannel = (channelId: string, changes: Record<string, unknown>) => {
    commitSettings({
      ...preferences.settings,
      channels: channels.map((channel) => (
        channel.id === channelId ? { ...channel, ...changes } as AmbientChannelSettings : channel
      )),
    })
  }

  // One group, two stored records: each key belongs to exactly one of them.
  const environmentValues = { ...preferences.settings.space, ...preferences.settings.weather } as unknown as Record<string, number>
  const updateEnvironment = (key: string, value: number) => {
    const target = key in preferences.settings.space ? 'space' : 'weather'
    commitSettings({ ...preferences.settings, [target]: { ...preferences.settings[target], [key]: value } })
  }

  const toggleChannelSolo = (channelId: string) => {
    const channel = channels.find((item) => item.id === channelId)
    if (!channel) return
    const shouldSolo = !channel.solo
    // Soloing a channel is listening to it on its own, which is when its
    // controls are wanted, so it is shown too. Clearing solo leaves the view.
    if (shouldSolo) setSelectedId(channel.id)
    commitSettings({
      ...preferences.settings,
      channels: channels.map((item) => ({ ...item, solo: item.id === channelId && shouldSolo })),
    })
  }

  const startChannelHold = (channel: AmbientChannelSettings, button: number, pointerId: number) => {
    if ((button === 0 && channel.enabled) || (button === 2 && !channel.enabled)) return
    if (button !== 0 && button !== 2) return
    channelHoldRef.current?.cancel()
    const enabled = button === 0
    const cancel = armHold(() => {
      channelHoldRef.current = null
      if (button === 2) suppressNextContextMenuRef.current = true
      else setSelectedId(channel.id)
      updateChannel(channel.id, { enabled })
    }, HOLD_CONFIRM_MS)
    channelHoldRef.current = { pointerId, cancel }
  }

  const endChannelHold = (pointerId: number) => {
    const hold = channelHoldRef.current
    if (!hold || hold.pointerId !== pointerId) return
    hold.cancel()
    channelHoldRef.current = null
  }

  const handleChannelWheel = useCallback((event: WheelEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLButtonElement>('[data-ambient-channel-id]')
    const channelId = button?.dataset.ambientChannelId
    const channel = preferences.settings.channels.find((item) => item.id === channelId)
    if (!channel?.enabled) return

    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (delta === 0) return
    event.preventDefault()
    event.stopPropagation()

    const volume = Math.max(0, Math.min(1, Math.round((channel.volume + (delta < 0 ? 0.05 : -0.05)) * 100) / 100))
    if (volume === channel.volume) return
    onChange(withSettings(preferences, {
      ...preferences.settings,
      channels: preferences.settings.channels.map((item) => (item.id === channel.id ? { ...item, volume } : item)),
    }))
  }, [onChange, preferences])
  useNonPassiveWheel(channelSelectorRef, handleChannelWheel)

  const savePreset = () => {
    if (!canSave) return
    const id = newSoundscapeId()
    const settings = cloneSettings(preferences.settings)
    const saved: AmbientPreset = {
      id,
      name: `Soundscape ${preferences.customPresets.length + 1}`,
      settings: { ...settings, channels: settings.channels.map((channel) => ({ ...channel, solo: false })) },
    }
    onChange({ ...preferences, activePresetId: id, customPresets: [...preferences.customPresets, saved] })
  }

  const deletePreset = (presetId: string) => {
    onChange({
      ...preferences,
      activePresetId: preferences.activePresetId === presetId ? null : preferences.activePresetId,
      customPresets: preferences.customPresets.filter((preset) => preset.id !== presetId),
    })
    setPendingDeletePresetId(null)
  }

  const activatePreset = (preset: AmbientPreset) => {
    if (pendingDeletePresetId === preset.id) {
      deletePreset(preset.id)
      return
    }
    setPendingDeletePresetId(null)
    onChange(applyAmbientPreset(preferences, preset))
  }

  const rosterEntry = AMBIENT_CHANNEL_ROSTER.find((entry) => entry.id === selectedChannel?.id)
  const layerName = rosterEntry ? `${KIND_LOOK[rosterEntry.kind].label} layer ${rosterEntry.number}` : ''

  return (
    <AccordionSection
      className="sidebar-options-section-ambient"
      ariaLabel="Ambient Sound"
      heading="Ambient Sound"
    >
      <div className="utility-setting-slider-stack" aria-label="Ambient sound controls">
        {/* Space and weather belong to the whole soundscape rather than to a
            channel, so they stand above the soundscapes and channels,
            always shown, rather than behind a channel-like button. */}
        <div className="ambient-layer-controls ambient-scene-controls" role="group" aria-label="Environment, across all channels">
          <ControlGroups
            idPrefix="ambient-environment"
            groups={ENVIRONMENT_CONTROLS}
            values={environmentValues}
            defaults={ENVIRONMENT_DEFAULTS}
            disabled={false}
            name="Environment"
            onCommit={updateEnvironment}
          />
        </div>

        <div className="options-loadout-grid ambient-preset-grid" role="group" aria-label="Factory ambient soundscapes">
          {AMBIENT_FACTORY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn ambient-preset-btn${selectedPresetId === preset.id ? ' is-active' : ''}`}
              aria-label={preset.name}
              aria-pressed={selectedPresetId === preset.id}
              data-tooltip={preset.name}
              onClick={() => activatePreset(preset)}
            >
              <span className={`fa-solid ${PRESET_ICONS[preset.id]}`} aria-hidden="true" />
            </button>
          ))}
        </div>

        <div className="options-loadout-grid ambient-custom-presets-grid" role="group" aria-label="Custom ambient soundscapes">
          {preferences.customPresets.map((preset, index) => {
            const number = index + 1
            const isPrimed = pendingDeletePresetId === preset.id
            const label = `Custom soundscape ${number}`
            return (
              <button
                key={preset.id}
                type="button"
                className={`btn-icon options-color-swatch options-loadout-btn ambient-custom-preset-btn${selectedPresetId === preset.id ? ' is-active' : ''}${isPrimed ? ' primed' : ''}`}
                aria-label={isPrimed ? `Delete ${label}` : label}
                aria-pressed={selectedPresetId === preset.id}
                data-tooltip={isPrimed ? `Click to delete ${label}` : `${label}\nRight-click to mark for deletion, then click.\nHold right-click to export.`}
                data-secondary-press="action"
                onClick={() => activatePreset(preset)}
                onPointerDown={(event) => {
                  if (event.button !== 2) return
                  presetExportHoldRef.current?.cancel()
                  const cancel = armHold(() => {
                    presetExportHoldRef.current = null
                    setPendingDeletePresetId(null)
                    void exportSoundscapes([preset], preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
                  }, HOLD_COMMIT_MS)
                  presetExportHoldRef.current = { pointerId: event.pointerId, cancel }
                }}
                onPointerUp={(event) => {
                  if (event.button !== 2 || presetExportHoldRef.current?.pointerId !== event.pointerId) return
                  // Released before the hold completed: a short click, which primes deletion.
                  presetExportHoldRef.current.cancel()
                  presetExportHoldRef.current = null
                  setPendingDeletePresetId(preset.id)
                }}
                onPointerCancel={() => {
                  presetExportHoldRef.current?.cancel()
                  presetExportHoldRef.current = null
                }}
                onMouseLeave={() => {
                  presetExportHoldRef.current?.cancel()
                  presetExportHoldRef.current = null
                  setPendingDeletePresetId(null)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
              >
                <span className="options-loadout-index">{number}</span>
              </button>
            )
          })}
          <button
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn options-loadout-plus ambient-custom-preset-plus${hasPendingChanges ? ' is-active' : ''}`}
            aria-label="Save current soundscape as a custom preset"
            data-tooltip={`${preferences.customPresets.length >= MAX_AMBIENT_CUSTOM_PRESETS
              ? 'Custom soundscape limit reached'
              : hasPendingChanges ? 'Save current soundscape as a custom preset' : 'No unsaved soundscape changes'}\nHold right-click to reset every channel to its defaults and turn it off.`}
            // Not `disabled`: a disabled button receives no pointer events,
            // and the hold-to-reset below must work whether or not there is
            // anything to save.
            aria-disabled={!canSave}
            data-secondary-press="action"
            onClick={() => { if (canSave) savePreset() }}
            onPointerDown={(event) => {
              if (event.button !== 2) return
              resetHoldRef.current?.cancel()
              const cancel = armHold(() => {
                resetHoldRef.current = null
                // Every channel back to its defaults, and off; the space and the weather are left as they are.
                commitSettings({ ...preferences.settings, channels: neutralSoundscape().channels })
              }, HOLD_COMMIT_MS)
              resetHoldRef.current = { pointerId: event.pointerId, cancel }
            }}
            onPointerUp={(event) => {
              if (resetHoldRef.current?.pointerId !== event.pointerId) return
              resetHoldRef.current.cancel()
              resetHoldRef.current = null
            }}
            onPointerCancel={() => {
              resetHoldRef.current?.cancel()
              resetHoldRef.current = null
            }}
            onMouseLeave={() => {
              resetHoldRef.current?.cancel()
              resetHoldRef.current = null
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
          </button>
        </div>

        <div className="options-loadout-grid ambient-channel-selector" role="group" aria-label="Ambient channels" ref={channelSelectorRef}>
          {AMBIENT_CHANNEL_ROSTER.map((entry) => {
            const channel = channels.find((item) => item.id === entry.id)
            if (!channel) return null
            const look = KIND_LOOK[entry.kind]
            const layerTitle = `${look.label} layer ${entry.number}`
            const isSelected = channel.id === selectedId
            return (
              <button
                key={entry.id}
                type="button"
                className={`btn-icon options-color-swatch options-loadout-btn ambient-channel-selector-btn${isSelected ? ' is-active' : ''}${channel.enabled ? ' is-enabled' : ' is-disabled'}${channel.solo ? ' is-solo' : ''}`}
                aria-label={`${layerTitle}, ${channel.enabled ? 'enabled' : 'disabled'}${channel.solo ? ', solo' : ''}`}
                aria-pressed={isSelected}
                data-tooltip={`${layerTitle} is ${channel.enabled ? 'enabled' : 'disabled'}${channel.solo ? ', solo' : ''}\n${channel.solo ? 'Right-click to clear solo' : 'Right-click to solo'}; ${channel.enabled
                  ? 'hold right-click to disable; scroll to adjust volume'
                  : 'hold left-click to enable; settings are locked'}`}
                data-ambient-channel-id={channel.id}
                data-secondary-press="action"
                onClick={() => setSelectedId(channel.id)}
                onPointerDown={(event) => startChannelHold(channel, event.button, event.pointerId)}
                onPointerUp={(event) => endChannelHold(event.pointerId)}
                onPointerCancel={(event) => endChannelHold(event.pointerId)}
                onPointerLeave={(event) => endChannelHold(event.pointerId)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (suppressNextContextMenuRef.current) {
                    suppressNextContextMenuRef.current = false
                    return
                  }
                  toggleChannelSolo(channel.id)
                }}
              >
                <span className={`fa-solid ${look.icon}`} aria-hidden="true" />
              </button>
            )
          })}
        </div>

        {selectedChannel && rosterEntry && (
          <div
            className="ambient-layer-controls"
            key={selectedChannel.id}
            role="group"
            aria-label={`${layerName}${selectedChannel.enabled ? '' : ', disabled'}`}
          >
            <ControlGroups
              idPrefix={`ambient-${selectedChannel.id}`}
              groups={CONTROLS[rosterEntry.kind]}
              values={selectedChannel as unknown as Record<string, number>}
              defaults={createAmbientChannel(rosterEntry.id, rosterEntry.kind) as unknown as Record<string, number>}
              disabled={!selectedChannel.enabled}
              name={layerName}
              onCommit={(key, value) => updateChannel(selectedChannel.id, { [key]: value })}
            />
          </div>
        )}
      </div>
    </AccordionSection>
  )
}
