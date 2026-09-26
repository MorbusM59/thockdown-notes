/**
 * Ambient sound generator: the AudioWorklet that synthesises every ambient
 * layer, sample by sample, on the audio thread.
 *
 * It is plain JavaScript under public/ because an AudioWorklet module is
 * loaded by URL and cannot import the app's TypeScript. The settings it reads
 * are defined in src/shared/ambientSound.ts and resolved for it in
 * src/shared/ambientSoundDsp.ts (toWorkletConfiguration); the engine
 * (src/sound/AmbientSoundEngine.ts) posts them here as a `configure` message.
 *
 * Outputs: two stereo outputs -- 0 the DIRECT sound of every layer, 1 what
 * every layer SENDS to the space (the engine's reverb). Every layer, of every
 * kind, reaches them through one stage (placeLayer): its distance darkens it
 * and splits it between the two, by one rule (resolveAmbientSpace). Thunder
 * alone places itself, because a peal's distance is drawn per peal.
 *
 * Levels are absolute: a layer's `gain` (its fader times its kind's level) is
 * all that scales it. Enabling another layer does not change any other
 * layer's level.
 *
 * WEATHER is one slow gust signal for the whole scene (advanceWeather), and
 * each layer that has a `weather` amount follows it in its own terms: a noise
 * layer grows louder and brighter, rain heavier, chimes are struck more often
 * and harder, a fire is fanned, thunder comes sooner. One signal, so a gust
 * reaches all of them at once.
 *
 * Everything random is a seeded linear congruential generator, so a test can
 * render the same sound twice. The processor's root stream only seeds; each
 * channel draws from its own stream, the weather from its own, and each rain
 * voice's click noise from its own again. Streams keep every layer's sound
 * independent of the order the others are rendered in, which is what lets
 * rendering go a whole block per layer (see process).
 *
 * Render cost is the constraint everything here is written against: a block
 * is 128 frames, under 3 ms at 48 kHz, on a real-time thread shared with the
 * rest of the audio -- music included. A block that runs late is heard as a
 * tear, and it also delays the next `configure` message. Hence:
 * - work that repeats is done once. Noise is read from loops rendered on the
 *   main thread (src/shared/ambientNoiseLoops.ts); rain drops are played
 *   back from a per-layer bank of recordings, a quarter of them recorded
 *   live as they play so the bank keeps changing (addVoice); the noise
 *   filter's loudness compensation is a table built on the main thread.
 * - what changes slowly is computed slowly. A noise layer's level, pan and
 *   filter are computed every CONTROL_FRAMES samples and ramped between;
 *   the weather once a block.
 * - nothing large is allocated while playing: the garbage collector pauses
 *   this thread, so recording buffers are recycled (takeSpareRecording).
 * - no trigonometry per sample (oscillators are rotated sin/cos pairs), no
 *   work for a component that has gone silent, one tight loop per voice.
 */

/**
 * What rain falls on is one number, `surface`, from 0 to 1 -- softest to
 * hardest -- and every drop, on any surface, is the same model:
 * - `click`: the impact, a burst of noise whose amplitude and decay are
 *   drawn from the ranges given. `white` blends it from band-passed (0,
 *   centre and Q as given) to unfiltered white noise (1).
 * - `bass`, `body`, `treble`: banks of decaying sinusoidal modes -- the
 *   surface ringing. `count` modes per bank (an integer range), frequency
 *   log-uniform in `hz`, decay and amplitude uniform in theirs.
 * - `bed`: the dense wash of distant drops. Impulses at `ratePerSec` with a
 *   noise floor, band-passed around `centerHz`, slowly swelling by up to
 *   `swellDepth` so it does not sound like a static noise generator.
 * - `drip`: a large, slow drop. `gain` scales it, `pitchScale` lowers its
 *   frequencies.
 *
 * The surface is the MATERIAL only. Standing water on it is the layer's
 * `wetness`, and how much the material rings is its `resonance` (see
 * makeSurfaceVoice); both apply on top of any surface.
 *
 * Five ANCHORS pin the scale: forest (0: a soft, low pat on leaves, a small
 * thud, hardly a bubble), canvas (0.25: a taut membrane -- a dull, low thump
 * with its highs damped by the cloth), street (0.5: a sharp band-passed tick
 * on pavement), tin (0.75: a thin metal sheet -- a bright tick and a cluster
 * of ringing modes) and glass (1: a white-noise click and many long-ringing
 * modes -- hail on glass or on metal pipes).
 * Between two anchors every number is blended (surfaceProfile): frequencies,
 * times and rates geometrically, since that is how pitch and time are heard,
 * and everything else linearly.
 *
 * Every anchor must match AMBIENT_RAIN_SURFACE_ANCHORS in
 * src/shared/ambientSound.ts, name and position; ambient-generator.test.ts
 * checks that.
 */
const GLASS_TREBLE = { count: [1, 3], hz: [2100, 9200], decaySec: [0.004, 0.035], amplitude: [0.018, 0.075] };
const NO_TREBLE = { ...GLASS_TREBLE, count: [0, 0] };
const RAIN_SURFACE_ANCHORS = [
  {
    name: 'forest',
    at: 0,
    click: { white: 0, centerHz: [700, 2600], q: 1.3, decaySec: [0.004, 0.012], amplitude: [1, 1.8] },
    durationSec: 0.2,
    bass: { count: [1, 1], hz: [110, 320], decaySec: [0.015, 0.05], amplitude: [0.04, 0.09] },
    body: { count: [1, 2], hz: [450, 1400], decaySec: [0.004, 0.012], amplitude: [0.012, 0.035] },
    treble: NO_TREBLE,
    bed: { ratePerSec: 1700, centerHz: 1900, q: 0.8, floor: 0.16, gain: 0.6, swellDepth: 0.45 },
    drip: { gain: 3, pitchScale: 0.5 },
  },
  {
    // A membrane: the cloth moves as a whole, so the impact is a low thump
    // with little above a kilohertz, and the tension rings a low mode or two.
    name: 'canvas',
    at: 0.25,
    click: { white: 0, centerHz: [380, 950], q: 1.1, decaySec: [0.003, 0.008], amplitude: [1.3, 2.1] },
    durationSec: 0.18,
    bass: { count: [1, 2], hz: [85, 210], decaySec: [0.02, 0.06], amplitude: [0.08, 0.16] },
    body: { count: [1, 2], hz: [240, 700], decaySec: [0.008, 0.025], amplitude: [0.03, 0.06] },
    treble: NO_TREBLE,
    bed: { ratePerSec: 1500, centerHz: 950, q: 0.7, floor: 0.18, gain: 0.62, swellDepth: 0.35 },
    drip: { gain: 3, pitchScale: 0.6 },
  },
  {
    name: 'street',
    at: 0.5,
    click: { white: 0, centerHz: [2200, 7500], q: 0.9, decaySec: [0.0012, 0.004], amplitude: [1.1, 2] },
    durationSec: 0.12,
    bass: { count: [1, 1], hz: [70, 190], decaySec: [0.006, 0.02], amplitude: [0.03, 0.07] },
    body: { count: [0, 1], hz: [900, 2600], decaySec: [0.002, 0.006], amplitude: [0.01, 0.03] },
    treble: NO_TREBLE,
    bed: { ratePerSec: 2600, centerHz: 4200, q: 0.55, floor: 0.2, gain: 0.55, swellDepth: 0.3 },
    drip: { gain: 2.2, pitchScale: 0.6 },
  },
  {
    // A thin metal sheet: a bright tick, and a cluster of modes that ring
    // longer than pavement's but shorter and denser than glass's.
    name: 'tin',
    at: 0.75,
    click: { white: 0.5, centerHz: [3000, 8000], q: 0.8, decaySec: [0.0008, 0.002], amplitude: [0.5, 0.9] },
    durationSec: 0.45,
    bass: { count: [1, 1], hz: [120, 380], decaySec: [0.03, 0.08], amplitude: [0.03, 0.08] },
    body: { count: [3, 5], hz: [800, 4200], decaySec: [0.04, 0.16], amplitude: [0.02, 0.06] },
    treble: { count: [1, 2], hz: [2500, 7000], decaySec: [0.01, 0.05], amplitude: [0.015, 0.05] },
    bed: { ratePerSec: 1800, centerHz: 5000, q: 0.6, floor: 0.15, gain: 0.5, swellDepth: 0.3 },
    drip: { gain: 2, pitchScale: 0.55 },
  },
  {
    // The original rain model, exactly: its click and its three banks.
    name: 'glass',
    at: 1,
    click: { white: 1, centerHz: [6000, 9000], q: 0.7, decaySec: [0.00065, 0.00065], amplitude: [0.24, 0.44] },
    durationSec: 0.4,
    bass: { count: [1, 2], hz: [85, 460], decaySec: [0.025, 0.095], amplitude: [0.035, 0.14] },
    body: { count: [2, 4], hz: [360, 3400], decaySec: [0.009, 0.065], amplitude: [0.025, 0.105] },
    treble: GLASS_TREBLE,
    bed: { ratePerSec: 900, centerHz: 6500, q: 0.7, floor: 0.12, gain: 0.5, swellDepth: 0.25 },
    drip: { gain: 1.9, pitchScale: 0.55 },
  },
];

/**
 * The balance a drop's parts were authored at, relative to its body modes:
 * the low bank at AUTHORED_LOW_LEVEL, the click, high bank, bubble and splash
 * at AUTHORED_HIGH_LEVEL. (These were the defaults of the bass and treble
 * sliders that used to adjust them per layer.)
 */
const AUTHORED_LOW_LEVEL = 0.55;
const AUTHORED_HIGH_LEVEL = 0.45;

/** A layer's character when none is given: the surface as authored, dry. */
const NEUTRAL_CHARACTER = { wetness: 0, resonance: 0.5 };

/**
 * Wetness (see makeSurfaceVoice) at 1: the share of drops that land in water
 * and produce a bubble, and of drips; how much of a surface's ring a film of
 * water damps (its decay time shortened, its level lowered); and the
 * splash's level, the bright attack of a drop entering water.
 */
const WET_BUBBLE_CHANCE = 0.7;
const WET_DRIP_BUBBLE_CHANCE = 1;
const WET_DECAY_DAMPING = 0.6;
const WET_LEVEL_DAMPING = 0.4;
const SPLASH_LEVEL = [0.9, 1.6];
/** The splash: a very short burst of bright noise, band-passed high. */
const SPLASH = { centerHz: [6500, 11000], q: 0.8, decaySec: 0.0003 };
/** Spray: finer droplets after a splash -- how many, when, how loud. */
const SPRAY = { count: [1, 4], withinSec: [0.004, 0.045], level: [0.15, 0.45] };

/** Keys whose values blend geometrically (see RAIN_SURFACE_ANCHORS). */
const GEOMETRIC_KEYS = new Set(['centerHz', 'hz', 'decaySec', 'durationSec', 'ratePerSec']);

/** Two anchors' matching values blended at `t`, recursively. */
function blendProfile(a, b, t, key) {
  if (typeof a === 'number') {
    return GEOMETRIC_KEYS.has(key) && a > 0 && b > 0
      ? a * ((b / a) ** t)
      : a + ((b - a) * t);
  }
  if (Array.isArray(a)) return a.map((value, index) => blendProfile(value, b[index], t, key));
  if (a && typeof a === 'object') {
    const blended = {};
    for (const name of Object.keys(a)) {
      // A blend lies between two anchors and is neither of them.
      blended[name] = name === 'name' ? null : blendProfile(a[name], b[name], t, name);
    }
    return blended;
  }
  return a;
}

/** The drop model at `surface` (0-1), blended between its two anchors. */
function surfaceProfile(surface) {
  const at = Number.isFinite(surface) ? Math.max(0, Math.min(1, surface)) : 1;
  for (let index = 1; index < RAIN_SURFACE_ANCHORS.length; index += 1) {
    const lower = RAIN_SURFACE_ANCHORS[index - 1];
    const upper = RAIN_SURFACE_ANCHORS[index];
    if (at === lower.at) return lower;
    if (at === upper.at) return upper;
    if (at < upper.at) return blendProfile(lower, upper, (at - lower.at) / (upper.at - lower.at), '');
  }
  return RAIN_SURFACE_ANCHORS[RAIN_SURFACE_ANCHORS.length - 1];
}

/**
 * The drop bank (see addVoice): each rain layer keeps up to DROP_BANK_SIZE
 * drops (DRIP_BANK_SIZE drips) recorded at its current settings, and plays a
 * drop by reading one back. While the bank fills, and on one birth in
 * DROP_BANK_REFRESH_EVERY after that, a drop is instead synthesised live and
 * recorded as it plays -- so a new recording costs what playing it live
 * always cost, spread over its own life rather than rendered in one block;
 * the bank never stops changing, and a quarter of what is heard is new.
 *
 * A recording takes its slot when it is BORN, marked available from the
 * frame it will be complete on (birth plus its fixed length), and playback
 * chooses only among recordings already available. The bank's contents
 * therefore change only at births, which happen in time order, so what any
 * drop plays does not depend on where block boundaries fall.
 * Each playback also varies in level by up to +/-DROP_PLAYBACK_LEVEL_SPREAD,
 * symmetric so the mean level is unchanged, which keeps repeats of one baked
 * drop from sounding alike.
 */
const DROP_BANK_SIZE = 32;
const DRIP_BANK_SIZE = 12;
const DROP_BANK_REFRESH_EVERY = 4;
const DROP_PLAYBACK_LEVEL_SPREAD = 0.15;

/** Samples between re-derivations of a rising bubble's rotation (see makeBubble). */
const BUBBLE_RETUNE_FRAMES = 32;

/** What a noise layer reads when its noise type was not provided. */
const SILENT_LOOP = new Float32Array(1);

/** Below this a click or its filter tail is treated as silent (-140 dB). */
const SILENCE = 1e-7;

/**
 * Below this a voice's ringing parts are treated as silent and the voice
 * ends (-100 dB of full scale, a third of the smallest step 16-bit output can
 * represent -- and the voice is scaled down further by its layer's volume
 * before anyone hears it).
 */
const VOICE_SILENCE = 1e-5;

/**
 * Thunder (startPeal). A peal is rumbling only: several long rumbles of
 * brown noise, each through its own low-pass, staggered through the roll-in
 * so the peal builds -- it rises gently to a peak a quarter to two fifths of
 * the way through its length (THUNDER_PEAK_AT) and fades slowly over the
 * rest -- each drifting across the stereo field -- and one or two low
 * BOOMS (THUNDER_BOOMS) under them. Each part rolls unevenly in level
 * (THUNDER_ROLL), as a whole: rolled rumble by rumble, the dips and surges
 * average out in the sum and a harsh setting is heard as a smooth one. The
 * booms roll as harshly as character says, the rumbles above them always
 * smoothly: the break-up of thunder is in its low end, and the same drops
 * in the upper rumbles read as a jarring cut rather than as the storm.
 * Distance blends each figure geometrically
 * between its near and far end: far thunder is darker and quieter.
 * Short bright bursts on top (a crack, then clusters of strokes) were tried
 * and taken out: synthesised that way they read as something falling down
 * stairs, or popcorn, rather than as thunder.
 * Between peals a layer is silent for L x (1 - share) / share, L the peal's
 * length (see AmbientThunderChannelSettings); and before each peal the
 * layer's randomness varies that peal's controls (thunderPealSettings).
 */
const THUNDER_PEAK_AT = [0.22, 0.4];
const THUNDER_LEVEL = { near: 1, far: 0.6 };
const THUNDER_RUMBLES = [3, 6];
const THUNDER_CUTOFF_HZ = { near: 420, far: 80 };
/**
 * The two parts split the spectrum: the booms own everything below this,
 * and each upper rumble is high-passed here (four poles: brown noise rises
 * 6 dB an octave downward, so two poles would leave it falling only 6 dB an
 * octave below the split), its low-pass cutoff kept at
 * least THUNDER_BODY_MIN_OCTAVE above it. Without the split the upper
 * rumbles -- brown noise, most of its power at the bottom -- filled every
 * gap in the booms and character's break-up could not be heard. The booms
 * are low-passed at the same frequency, also with four poles, for the
 * converse reason: a resonant band-pass falls only 6 dB an octave above its
 * centre, and at the booms' level that skirt carried their break-up into
 * the mid range, where it sounds like a cut rather than like the storm.
 */
const THUNDER_BODY_FLOOR_HZ = 110;
const THUNDER_BODY_MIN_OCTAVE = 0.6;
/**
 * The roll in a peal's level, at character 0 (`smooth`) and 1 (`harsh`),
 * blended geometrically: seconds between targets, the lowest target, and
 * how fast the level glides to each (per second). Each target is either a
 * GAP, down at the floor, with a chance that grows linearly with character
 * to THUNDER_ROLL_GAP_CHANCE, or else a surge between the floor (at least
 * half) and full. Smooth is a slow, shallow undulation; harsh alternates
 * surges and near-silence several times a second and lurches between them
 * -- the choppy growl of close thunder. A plain draw between floor and full
 * was tried: dips deep enough to hear were too rare and too brief.
 */
const THUNDER_ROLL = {
  smooth: { sec: [0.25, 0.7], floor: 0.7, glidePerSec: 6 },
  harsh: { sec: [0.05, 0.2], floor: 0.04, glidePerSec: 120 },
};
const THUNDER_ROLL_GAP_CHANCE = 0.45;
/**
 * How far along THUNDER_ROLL the character slider reaches at its top: the
 * full harsh end breaks the boom up more than sounds like thunder.
 */
const THUNDER_CHARACTER_REACH = 0.5;
/**
 * The boom: one or two rumbles per peal through a resonant BAND-pass
 * centred at 45-90 Hz (lower for far thunder), swelling into the peak --
 * the weight a peal's upper rumbles lack. A band and not a low-pass: most
 * of a low-passed brown noise lies far below its cutoff, under the thunder
 * high-pass, where it adds nothing that is heard.
 */
const THUNDER_BOOMS = [1, 2];
const THUNDER_BOOM_CENTER_HZ = { near: 90, far: 45 };
const THUNDER_BOOM_Q = 1.6;
const THUNDER_BOOM_LEVEL = 3;
/**
 * Contrast (renderThunder): the layer's level is followed over
 * THUNDER_CONTRAST_FOLLOW_SEC, and compared with a PIVOT -- its own recent
 * level, rising over THUNDER_CONTRAST_PIVOT_SEC.rise and falling over
 * .fall. The pivot rises fast so a peal's onset is not read as a peak far
 * above a silent past and boosted: this plays beside someone concentrating.
 * Contrast acts on the surges and breaks of a peal, a tenth of a second
 * and up; below that, rumble flickers in level by nature, and flattening
 * that would distort it. The two ends are not symmetric: at 1 a peal's
 * swing about doubles, at -1 it loses about a fifth.
 * The gain is (level / pivot) ^ (contrast x THUNDER_CONTRAST_EXPONENT):
 * at contrast 1 each doubling of the level against the pivot doubles
 * again; at -1 half of each is taken away. It is capped at
 * THUNDER_CONTRAST_GAIN so neither end can blow up or vanish, and the
 * upper cap spares the shared limiter the music also goes through.
 */
const THUNDER_CONTRAST_FOLLOW_SEC = 0.03;
const THUNDER_CONTRAST_PIVOT_SEC = { rise: 0.3, fall: 3 };
const THUNDER_CONTRAST_EXPONENT = 1;
const THUNDER_CONTRAST_GAIN = [0.1, 4];

/** A peal's overall scale, set so its peaks stay about where they were before the boom. */
const THUNDER_PEAL_SCALE = 0.6;
/**
 * A thunder layer's output is high-passed here. The brown loop is a leaky
 * random walk, flat down to about 23 Hz at 48 kHz, so without this most of
 * a rumble's power sits below where it is heard as a boom -- felt at most,
 * and spending the headroom the boom needs before the shared limiter.
 */
const THUNDER_HIGH_PASS_HZ = 30;
/** The first peal of a storm that has just started comes within this many seconds. */
const THUNDER_FIRST_PEAL_SEC = [4, 12];

/**
 * A layer's stereo image: the positions its sources are placed between.
 * Its pan places the image's centre and also bounds how wide it can be --
 * 1 - |pan| to either side, so an image in the centre can fill the whole
 * field from left to right, and one panned toward a side narrows onto that
 * side, to a point at the edge. `width` (0..1) is how much of that room it
 * takes. A rain layer takes all of it (each drop placed anywhere within,
 * the wash two independent noises at its edges); a thunder layer takes its
 * `spread` (each upper rumble drifting between two places within, the
 * booms at its centre).
 */
function stereoImage(pan, width) {
  const centre = Math.max(-1, Math.min(1, pan ?? 0));
  const halfWidth = (1 - Math.abs(centre)) * Math.max(0, Math.min(1, width));
  return { from: centre - halfWidth, to: centre + halfWidth };
}

/**
 * A rain layer's `mix` (0 wash only, 1 drops only) as the two gains: each
 * is full up to the middle and fades only on the other side of it, so the
 * middle plays both at full rather than dipping.
 */
function rainMixGains(mix) {
  const value = Math.max(0, Math.min(1, mix ?? 0.5));
  return { wash: Math.min(1, 2 * (1 - value)), drops: Math.min(1, 2 * value) };
}

/** Equal-power gains for a position from -1 (left) to 1 (right). */
function panGains(position) {
  const angle = (position + 1) * Math.PI / 4;
  return { left: Math.SQRT2 * Math.cos(angle), right: Math.SQRT2 * Math.sin(angle) };
}

/** The most rain voices one layer keeps ringing at once. */
const MAX_RAIN_VOICES = 48;

/** Large drops per second at `drips` = 1; mirrors AMBIENT_RAIN_DRIPS_MAX_PER_SEC. */
const RAIN_DRIPS_MAX_PER_SEC = 3;

/** Average seconds between the bed's swell targets. */
const BED_SWELL_PERIOD_SEC = 2.5;


/**
 * A fader position (0-1) as a gain; mirrors ambientFaderGain in
 * src/shared/ambientSound.ts, which ambient-generator.test.ts holds it to.
 * Thunder needs it here because randomness moves each peal's fader.
 */
const FADER_RANGE_DB = 48;
function faderGain(position) {
  if (!(position > 0)) return 0;
  return 10 ** ((-FADER_RANGE_DB * (1 - Math.min(1, position))) / 20);
}

/**
 * A noise layer's `variation` (0-1) at full: how far one cycle's period may
 * stretch or shrink (as a power of two, so 1 is anywhere from half to
 * double) and the largest share of the swell's rise one cycle may lose.
 * Its `sway` at full: the furthest the sway takes it from centre.
 */
const VARIATION_PERIOD_OCTAVES = 1;
const VARIATION_RISE_LOSS = 0.5;
const SWAY_PAN_REACH = 0.8;

/**
 * A noise layer's level, pan and filter move over periods of half a second
 * or more, so they are computed every CONTROL_FRAMES samples and ramped
 * linearly in between (see beginControlSegment) -- a ramp of under a
 * millisecond. The filter's coefficients are stepped, not ramped: the
 * state-variable filter is stable under modulation and a step of a few
 * cents every 32 samples is inaudible.
 */
const CONTROL_FRAMES = 32;
/** The lowest a noise layer's filter may be pushed by sweep and weather together. */
const NOISE_CUTOFF_FLOOR_HZ = 40;

/**
 * The weather (advanceWeather): gusts and lulls as targets drawn in -1..1,
 * one on average every `paceSec`, the signal gliding toward each over
 * WEATHER_GLIDE_SHARE of the pace. What a layer does with a full gust
 * (its `weather` amount x the scene's gustiness x the signal, -1..1):
 */
const WEATHER_GLIDE_SHARE = 0.35;
/** A noise layer's level: +/- this many octaves of gain (6 dB each). */
const WEATHER_NOISE_LEVEL_OCTAVES = 1;
/** A noise layer's filter: +/- this many octaves of cutoff. */
const WEATHER_NOISE_BRIGHT_OCTAVES = 1;
/** A rain layer's intensity: +/- this much of the slider. */
const WEATHER_RAIN_REACH = 0.3;
/** Thunder's pauses: shortened (gust) or lengthened (lull) by up to this many octaves. */
const WEATHER_THUNDER_OCTAVES = 1.5;
/** Chimes: strike rate +/- this many octaves, force +/- this share. */
const WEATHER_CHIME_RATE_OCTAVES = 2;
const WEATHER_CHIME_FORCE = 0.5;
/** A fire: size and crackle +/- this much of their sliders. */
const WEATHER_FIRE_REACH = 0.3;

/**
 * A rain layer's intensity (0-1), beyond its drop rate (dropsRange, set on
 * the main thread): the wash rises by WASH_INTENSITY_DB over the slider, and
 * the drops weigh more -- played louder -- by DROP_INTENSITY_LEVEL.
 */
const WASH_INTENSITY_DB = 15;
const DROP_INTENSITY_LEVEL = [0.75, 1.25];

/**
 * Water (renderWater): bubbles, each van den Doel's model (makeBubble) --
 * ringing near 3/r Hz, damped by r, rising in pitch -- born at a rate `flow`
 * sets, in bursts `turbulence` sets, with radii drawn from a power law
 * between two bounds `size` sets (small bubbles far outnumber large ones in
 * running water). Under them, the RUSH: pink noise band-passed low, the
 * sound of the flow itself.
 */
const WATER_BUBBLES_PER_SEC = [15, 500];
const WATER_RADIUS_MIN_MM = [0.4, 1.5];
const WATER_RADIUS_MAX_MM = [1.6, 7];
/** p(r) proportional to r^-WATER_RADIUS_EXPONENT between the bounds. */
const WATER_RADIUS_EXPONENT = 2;
/** Mean seconds between the burst process's targets; its glide, in seconds. */
const WATER_BURST_SEC = 0.22;
const WATER_BURST_GLIDE_SEC = 0.03;
/** The burst multiplier's spread (log-normal sigma) at turbulence 1. */
const WATER_BURST_SIGMA = 1.3;
const WATER_RUSH_HZ = [900, 320];
const WATER_RUSH_LEVEL = 0.3;
const MAX_WATER_BUBBLES = 96;

/**
 * Fire (renderFire), after Farnell's model: a ROAR (brown noise low-passed,
 * fluttering in level as the flames lap), a HISS (white noise high-passed,
 * flickering erratically), CRACKLES (sub-millisecond to few-millisecond
 * bursts of noise through a resonant band, often in small clusters) and POPS
 * (louder, lower, longer bursts, each followed by a short sizzle of crackles
 * -- sap boiling out of the wood).
 */
const FIRE_ROAR_HZ = [420, 150];
const FIRE_ROAR_LEVEL = [0.25, 1];
const FIRE_FLUTTER_SEC = [0.06, 0.25];
const FIRE_FLUTTER_RANGE = [0.45, 1.3];
const FIRE_HISS_HZ = 2600;
const FIRE_HISS_LEVEL = [0.015, 0.08];
const FIRE_HISS_FLICKER_SEC = [0.02, 0.08];
const FIRE_CRACKLES_PER_SEC = [0.3, 30];
const FIRE_CRACKLE_CLUSTER_CHANCE = 0.45;
const FIRE_CRACKLE_CLUSTER_SEC = [0.005, 0.04];
const FIRE_CRACKLE = { hz: [1500, 7000], q: [1.5, 4], decaySec: [0.0003, 0.0025], level: [0.1, 1] };
const FIRE_POPS_PER_SEC = 1.2;
const FIRE_POP = { hz: [350, 1400], q: [5, 9], decaySec: [0.006, 0.02], level: [1.2, 2.2], sizzle: [3, 8], sizzleSec: [0.05, 0.2] };
const MAX_FIRE_BURSTS = 48;

/**
 * Chimes (renderChimes): each tube a free-free bar, its modes at these
 * ratios of its fundamental (Euler-Bernoulli: (2n+1)^2 approximately, the
 * first four), each a DOUBLET -- two oscillators a fraction of a hertz apart,
 * as the slight asymmetry of a real tube splits every mode -- which is the
 * slow shimmer a struck chime has and a pure sine does not. Higher modes die
 * faster (CHIME_MODE_DECAY_EXPONENT). A tube is one object: striking it again
 * adds to what it is already ringing rather than starting a new voice.
 */
const CHIME_MODE_RATIOS = [1, 2.756, 5.404, 8.933];
const CHIME_MODE_WEIGHTS = [1, 0.55, 0.35, 0.2];
const CHIME_MODE_DECAY_EXPONENT = 0.7;
/** How far a soft clapper (hardness 0) suppresses the upper modes: weight x ratio^-this. */
const CHIME_SOFT_TILT = 1.3;
const CHIME_DOUBLET_HZ = [0.2, 1.4];
const CHIME_DETUNE_CENTS = 6;
/** A clapper bounces: the chance of a second strike on a neighbouring tube, and how soon. */
const CHIME_BOUNCE_CHANCE = 0.4;
const CHIME_BOUNCE_SEC = [0.07, 0.3];
const CHIME_STRIKE_FORCE = [0.35, 1];
const CHIME_CLICK = { hz: [2500, 5500], q: [1.2, 2], decaySec: [0.0006, 0.0015], level: [0.2, 0.3] };

/**
 * A state-variable filter's coefficients and state (the topology-preserving
 * "TPT" form, stable at any frequency below Nyquist). One filter has band-
 * and low-pass outputs: v1 and v2 of the step in bandPass. Band-pass is read
 * through bandPass; the low-pass (distance's darkening) is read inline in
 * renderNoise, unrolled for cost.
 */
function stateVariableFilter(centerHz, q) {
  const safeHz = Math.max(20, Math.min(centerHz, sampleRate * 0.45));
  const g = Math.tan((Math.PI * safeHz) / sampleRate);
  const k = 1 / q;
  const a1 = 1 / (1 + (g * (g + k)));
  return { a1, a2: g * a1, a3: g * g * a1, s1: 0, s2: 0 };
}

/** One sample through a stateVariableFilter; returns its low-pass output. */
function lowPassStep(filter, input) {
  const v3 = input - filter.s2;
  const v1 = (filter.a1 * filter.s1) + (filter.a2 * v3);
  const v2 = filter.s2 + (filter.a2 * filter.s1) + (filter.a3 * v3);
  filter.s1 = (2 * v1) - filter.s1;
  filter.s2 = (2 * v2) - filter.s2;
  return v2;
}

/** One sample through a stateVariableFilter (q = SQRT1_2 for Butterworth); returns its high-pass output. */
function highPassStep(filter, input) {
  const v3 = input - filter.s2;
  const v1 = (filter.a1 * filter.s1) + (filter.a2 * v3);
  const v2 = filter.s2 + (filter.a2 * filter.s1) + (filter.a3 * v3);
  filter.s1 = (2 * v1) - filter.s1;
  filter.s2 = (2 * v2) - filter.s2;
  return input - (Math.SQRT2 * v1) - v2;
}

/** One sample through a stateVariableFilter; returns its band-pass output. */
function bandPass(filter, input) {
  const v3 = input - filter.s2;
  const v1 = (filter.a1 * filter.s1) + (filter.a2 * v3);
  const v2 = filter.s2 + (filter.a2 * filter.s1) + (filter.a3 * v3);
  filter.s1 = (2 * v1) - filter.s1;
  filter.s2 = (2 * v2) - filter.s2;
  return v1;
}

class AmbientGenerator extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.rootStream = { seed: (processorOptions.seed ?? 1) >>> 0 };
    // One seamless loop per noise type, rendered on the main thread
    // (src/shared/ambientNoiseLoops.ts), and the gain that brings each to
    // the same audible level (noiseLoopGains).
    this.noiseLoops = processorOptions.noiseLoops ?? {};
    this.noiseGains = processorOptions.noiseGains ?? {};
    // The stream `random()` draws from: the channel being configured or
    // rendered, else the root. Set by withStream.
    this.stream = this.rootStream;
    this.channels = [];
    this.soloChannelId = null;
    this.weather = {
      stream: { seed: Math.floor(this.random() * 0x100000000) >>> 0 },
      gustiness: 0,
      paceSec: 12,
      value: 0,
      target: 0,
      framesLeft: 0,
    };
    // The scene's gust this block, -1..1: the weather signal x gustiness.
    this.gust = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'configure') return;
      this.configure(event.data.channels ?? [], event.data.weather ?? null);
    };
  }

  random() {
    const stream = this.stream;
    stream.seed = (1664525 * stream.seed + 1013904223) >>> 0;
    return stream.seed / 0x100000000;
  }

  /** Run `work` with `random()` drawing from `stream`, then restore. */
  withStream(stream, work) {
    const previous = this.stream;
    this.stream = stream;
    try {
      return work();
    } finally {
      this.stream = previous;
    }
  }

  between(range) {
    return range[0] + (this.random() * (range[1] - range[0]));
  }

  /** Frames until the next event of a Poisson process at `ratePerSecond`. */
  eventDelayFrames(ratePerSecond) {
    const safeRate = Math.max(0.1, ratePerSecond);
    return Math.max(1, Math.floor((-Math.log(Math.max(1e-9, 1 - this.random())) / safeRate) * sampleRate));
  }

  makeChannel(settings) {
    const stream = { seed: Math.floor(this.random() * 0x100000000) >>> 0 };
    return this.withStream(stream, () => this.initChannel(settings, stream));
  }


  initChannel(settings, stream) {
    const channel = {
      ...settings,
      stream,
      // Distance's darkening (configureSpace): a two-pole low-pass per side.
      darkLeft: null,
      darkRight: null,
      directGain: 1,
      reverbSend: 0,
    };
    switch (channel.kind) {
      case 'noise':
        this.initNoise(channel);
        break;
      case 'rain':
        channel.activeVoices = [];
        channel.nextDripFrame = Infinity;
        channel.bed = null;
        this.updateRainIntensity(channel);
        channel.nextEventFrame = currentFrame + this.eventDelayFrames(channel.dropsPerSecond);
        this.configureRain(channel, null);
        break;
      case 'thunder':
        this.configureThunder(channel, null);
        break;
      case 'water':
        this.initWater(channel);
        break;
      case 'fire':
        this.initFire(channel);
        break;
      case 'chimes':
        this.configureChimes(channel, null);
        break;
      default:
        break;
    }
    this.configureSpace(channel);
    return channel;
  }

  /**
   * Replace the channel list and the weather. A channel that keeps its id
   * keeps its running state (voices, filter memory, the noise cycle's phase,
   * a tube's ring) so a slider move does not click; only a change to a rate
   * reschedules what that rate drives.
   */
  configure(settings, weather) {
    if (weather) {
      this.weather.gustiness = Math.max(0, Math.min(1, weather.gustiness ?? 0));
      this.weather.paceSec = Math.max(0.1, weather.paceSec ?? 12);
    }
    this.soloChannelId = settings.find((channel) => channel.solo)?.id ?? null;
    const activeSettings = settings.filter((channel) => channel.enabled !== false);
    const previousById = new Map(this.channels.map((channel) => [channel.id, channel]));
    this.channels = activeSettings.map((next) => {
      const previous = previousById.get(next.id);
      if (!previous || previous.kind !== next.kind) return this.makeChannel(next);
      return this.withStream(previous.stream, () => {
        const before = { ...previous };
        Object.assign(previous, next);
        if (previous.kind === 'noise') this.configureNoise(previous);
        if (previous.kind === 'rain') {
          this.updateRainIntensity(previous);
          if (before.intensity !== previous.intensity) {
            previous.nextEventFrame = currentFrame + this.eventDelayFrames(previous.dropsPerSecond);
          }
          this.configureRain(previous, before);
        }
        if (previous.kind === 'thunder') this.configureThunder(previous, before);
        if (previous.kind === 'water') this.configureWater(previous);
        if (previous.kind === 'fire') this.configureFire(previous, before);
        if (previous.kind === 'chimes') this.configureChimes(previous, before);
        this.configureSpace(previous);
        return previous;
      });
    });
  }

  /**
   * A layer's distance, turned into what placeLayer needs: its direct and
   * reverb-send gains, and its darkening -- a two-pole low-pass at Q 0.707
   * per side. Distance arrives resolved (`space`, resolveAmbientSpace). At
   * distance 0 there is no darkening filter at all, so a near layer is
   * untouched. Thunder places each peal itself and has none of this.
   */
  configureSpace(channel) {
    if (channel.kind === 'thunder') return;
    const space = channel.space ?? { cutoffHz: 18000, directGain: 1, reverbSend: 0 };
    channel.directGain = space.directGain;
    channel.reverbSend = space.reverbSend;
    if ((channel.distance ?? 0) <= 0) {
      channel.darkLeft = null;
      channel.darkRight = null;
      return;
    }
    // Keep the filters' memory through a slider move; only the coefficients change.
    const left = stateVariableFilter(space.cutoffHz, Math.SQRT1_2);
    const right = stateVariableFilter(space.cutoffHz, Math.SQRT1_2);
    if (channel.darkLeft) {
      left.s1 = channel.darkLeft.s1;
      left.s2 = channel.darkLeft.s2;
      right.s1 = channel.darkRight.s1;
      right.s2 = channel.darkRight.s2;
    }
    channel.darkLeft = left;
    channel.darkRight = right;
  }

  /**
   * A layer's block, from `left`/`right` (which it darkens in place) into
   * the direct and send outputs, at its gain. The one way every layer but
   * thunder reaches the outputs.
   */
  placeLayer(channel, left, right, length, direct, send) {
    const dark = channel.darkLeft;
    if (dark) {
      // stateVariableFilter's step, read at its low-pass output v2, with the
      // state in locals for the block (a per-sample object read and write
      // cost three times the rest of a noise layer).
      const a1 = dark.a1;
      const a2 = dark.a2;
      const a3 = dark.a3;
      let leftS1 = dark.s1;
      let leftS2 = dark.s2;
      let rightS1 = channel.darkRight.s1;
      let rightS2 = channel.darkRight.s2;
      for (let index = 0; index < length; index += 1) {
        let v3 = left[index] - leftS2;
        let v1 = (a1 * leftS1) + (a2 * v3);
        let v2 = leftS2 + (a2 * leftS1) + (a3 * v3);
        leftS1 = (2 * v1) - leftS1;
        leftS2 = (2 * v2) - leftS2;
        left[index] = v2;
        v3 = right[index] - rightS2;
        v1 = (a1 * rightS1) + (a2 * v3);
        v2 = rightS2 + (a2 * rightS1) + (a3 * v3);
        rightS1 = (2 * v1) - rightS1;
        rightS2 = (2 * v2) - rightS2;
        right[index] = v2;
      }
      dark.s1 = leftS1;
      dark.s2 = leftS2;
      channel.darkRight.s1 = rightS1;
      channel.darkRight.s2 = rightS2;
    }
    const directScale = channel.gain * channel.directGain;
    const sendScale = channel.gain * channel.reverbSend;
    const directLeft = direct[0];
    const directRight = direct[1] ?? directLeft;
    for (let index = 0; index < length; index += 1) {
      directLeft[index] += left[index] * directScale;
      if (directRight !== directLeft) directRight[index] += right[index] * directScale;
    }
    if (!send?.[0] || sendScale <= 0) return;
    const sendLeft = send[0];
    const sendRight = send[1] ?? sendLeft;
    for (let index = 0; index < length; index += 1) {
      sendLeft[index] += left[index] * sendScale;
      if (sendRight !== sendLeft) sendRight[index] += right[index] * sendScale;
    }
  }

  // -------------------------------------------------------------------------
  // Weather.

  /**
   * Move the scene's gust signal on by one block. A new target, anywhere in
   * -1 (a lull) .. 1 (a gust), is drawn on average once every `paceSec`, and
   * the signal glides toward it with a time constant of WEATHER_GLIDE_SHARE
   * of the pace, so a gust builds and falls away rather than switching. It
   * draws from its own stream, so it is the same whichever layers play.
   */
  advanceWeather(length) {
    const weather = this.weather;
    weather.framesLeft -= length;
    if (weather.framesLeft <= 0) {
      this.withStream(weather.stream, () => {
        weather.target = (this.random() * 2) - 1;
        weather.framesLeft = Math.max(1, Math.round(-Math.log(Math.max(1e-9, 1 - this.random())) * weather.paceSec * sampleRate));
      });
    }
    const glide = 1 - Math.exp(-length / (WEATHER_GLIDE_SHARE * weather.paceSec * sampleRate));
    weather.value += (weather.target - weather.value) * glide;
    this.gust = weather.gustiness * weather.value;
  }

  /** How far the weather moves this layer now, -1..1: its `weather` amount x the scene's gust. */
  weatherFactor(channel) {
    return (channel.weather ?? 0) * this.gust;
  }

  // -------------------------------------------------------------------------
  // Noise.

  initNoise(channel) {
    // Where this layer reads the noise loops, as a fraction of them; the
    // right side reads half a loop away, so the two are unrelated.
    channel.loopStart = this.random();
    channel.loopLeft = -1;
    channel.loopRight = -1;
    channel.controlFramesLeft = 0;
    channel.controlReady = false;
    channel.level = 0;
    channel.levelStep = 0;
    channel.gainLeft = 1;
    channel.gainLeftStep = 0;
    channel.gainRight = 1;
    channel.gainRightStep = 0;
    channel.phase = this.random();
    // Variation's and sway's per-cycle draw (see startCycle); neutral values
    // make a layer with neither play exactly as a plain cycle.
    channel.periodFactor = 1;
    channel.riseFactor = 1;
    channel.swaySide = 0;
    channel.panFrom = 0;
    channel.panTo = 0;
    // The filter's state per side, and its coefficients (set per control segment).
    channel.filterLeft = { s1: 0, s2: 0 };
    channel.filterRight = { s1: 0, s2: 0 };
    channel.filterA1 = 1;
    channel.filterA2 = 0;
    channel.filterA3 = 0;
    this.configureNoise(channel);
  }

  /**
   * A noise layer's width and colour, turned into what renderNoise needs.
   *
   * Width blends the two unrelated noise reads: each side takes cos(t) of
   * its own and sin(t) of the other, t = (1 - width) * pi/4. cos^2 + sin^2 =
   * 1, so for unrelated noise the level is the same at every width.
   *
   * Colour arrives as the three loops' crossfade weights (noiseColourWeights),
   * each folded here with its loop's level-matching gain.
   */
  configureNoise(channel) {
    const angle = (1 - (channel.width ?? 1)) * Math.PI / 4;
    channel.widthDirect = Math.cos(angle);
    channel.widthCross = Math.sin(angle);
    const weights = channel.colourWeights ?? [0, 1, 0];
    channel.mixBrown = weights[0] * (this.noiseGains.brown ?? 1);
    channel.mixPink = weights[1] * (this.noiseGains.pink ?? 1);
    channel.mixWhite = weights[2] * (this.noiseGains.white ?? 1);
    const focus = Math.max(0, Math.min(1, channel.focus ?? 0));
    const k = 1 / (channel.q ?? Math.SQRT1_2);
    channel.filterK = k;
    // Low-pass and unity-peak band-pass, blended by focus
    // (ambientSoundDsp.ts's noiseFilterPower is this response).
    channel.lowMix = 1 - focus;
    channel.bandMix = focus * k;
    // A filter change must reach the next segment's coefficients.
    channel.controlReady = false;
  }

  /**
   * A new cycle has begun (the phase just wrapped, so the level is at its
   * trough and flat): roll this cycle's deviations.
   * - variation: the period is multiplied by 2^(variation * u), u uniform in
   *   -1..1, so the mean tempo is still the period set; the rise above the
   *   trough keeps a random share of itself, never less than 1 - variation *
   *   VARIATION_RISE_LOSS -- the trough stays where it is, so the swap
   *   cannot make the level jump.
   * - sway: the layer heads to the OTHER side of centre from where it was
   *   heading, by a random reach up to sway * SWAY_PAN_REACH, starting from
   *   wherever it is now. The first cycle picks a side at random, so several
   *   layers do not all swing together.
   * Neither draws anything from the stream at 0.
   */
  startCycle(channel) {
    const variation = channel.variation ?? 0;
    if (variation > 0) {
      channel.periodFactor = 2 ** (variation * VARIATION_PERIOD_OCTAVES * ((this.random() * 2) - 1));
      channel.riseFactor = 1 - (variation * VARIATION_RISE_LOSS * this.random());
    } else {
      channel.periodFactor = 1;
      channel.riseFactor = 1;
    }
    channel.panFrom = channel.panTo;
    const sway = channel.sway ?? 0;
    if (sway > 0) {
      channel.swaySide = channel.swaySide === 0 ? (this.random() < 0.5 ? -1 : 1) : -channel.swaySide;
      channel.panTo = channel.swaySide * sway * SWAY_PAN_REACH * (0.5 + (0.5 * this.random()));
    } else {
      channel.panTo = 0;
    }
  }

  /**
   * Where the sway is at `phase`: travelling from panFrom to panTo so that
   * it is halfway exactly at the swell's peak (phase = skew), on a
   * smoothstep so it leaves and arrives at rest. The sound therefore sweeps
   * past while it is loudest, like a gust going by.
   */
  swayAt(channel, phase) {
    const peak = channel.skew ?? 0.5;
    const progress = phase <= peak
      ? (peak > 0 ? 0.5 * (phase / peak) : 0.5)
      : 0.5 + (0.5 * ((phase - peak) / Math.max(1e-9, 1 - peak)));
    const eased = progress * progress * (3 - (2 * progress));
    return channel.panFrom + ((channel.panTo - channel.panFrom) * eased);
  }

  /** The loop for a noise type; a type the engine did not provide plays as silence. */
  noiseLoop(type) {
    return this.noiseLoops[type] ?? SILENT_LOOP;
  }

  /**
   * The noise cycle's value (-1..1) at `phase` (0..1), interpolated from the
   * table the engine built (src/shared/ambientSoundDsp.ts's buildNoiseCycle).
   * A layer configured without one plays a plain sine.
   */
  cycleAt(channel, phase) {
    const cycle = channel.cycle;
    if (!cycle?.length) return -Math.cos(2 * Math.PI * phase);
    const position = phase * (cycle.length - 1);
    const low = Math.floor(position);
    const high = Math.min(cycle.length - 1, low + 1);
    return cycle[low] + ((cycle[high] - cycle[low]) * (position - low));
  }


  /**
   * The gain that holds a noise layer's loudness with its filter at
   * `cutoffHz`, read by the log of the cutoff from the table the main thread
   * built for its colour and focus (ambientSoundDsp.ts's buildNoiseToneTable).
   */
  toneGainAt(channel, cutoffHz) {
    const table = channel.toneTable;
    const range = channel.toneTableRangeHz;
    if (!table?.length || !range) return 1;
    const span = Math.log(range[1] / range[0]);
    const position = Math.max(0, Math.min(table.length - 1, (Math.log(cutoffHz / range[0]) / span) * (table.length - 1)));
    const low = Math.floor(position);
    const high = Math.min(table.length - 1, low + 1);
    return table[low] + ((table[high] - table[low]) * (position - low));
  }

  /**
   * A noise layer's level, pan gains and filter cutoff at its current phase.
   *
   * The swing (the cycle, -1 at the trough to 1 at the peak, with this
   * cycle's rise) moves the level by `depth` and the cutoff by `sweepOctaves`
   * -- so a swell can open the filter as it rises, as a gust whistles higher
   * or a wave brightens as it breaks. The weather moves both again, by the
   * layer's share of the scene's gust. The level carries the filter's
   * loudness compensation at that cutoff, so the ramp between segments
   * carries it too.
   */
  noiseControl(channel) {
    const cycleValue = this.cycleAt(channel, channel.phase);
    // riseFactor scales only the part of the swing above the trough
    // (cycleValue + 1), so the trough is 1 - depth whatever it is.
    const swing = channel.riseFactor === 1 ? cycleValue : (channel.riseFactor * (cycleValue + 1)) - 1;
    const factor = this.weatherFactor(channel);
    const octaves = ((channel.sweepOctaves ?? 0) * swing) + (WEATHER_NOISE_BRIGHT_OCTAVES * factor);
    const cutoff = Math.max(NOISE_CUTOFF_FLOOR_HZ, Math.min(sampleRate * 0.45, (channel.brightnessHz ?? 18000) * (2 ** octaves)));
    const level = Math.max(0, 1 + ((channel.depth ?? 0) * swing))
      * (2 ** (WEATHER_NOISE_LEVEL_OCTAVES * factor))
      * this.toneGainAt(channel, cutoff);
    const pan = channel.panFrom === 0 && channel.panTo === 0 ? 0 : this.swayAt(channel, channel.phase);
    // Equal-power balance, normalised so centre is unity on both sides.
    const gainLeft = pan === 0 ? 1 : Math.SQRT2 * Math.cos((pan + 1) * Math.PI / 4);
    const gainRight = pan === 0 ? 1 : Math.SQRT2 * Math.sin((pan + 1) * Math.PI / 4);
    return { level, gainLeft, gainRight, cutoff };
  }

  /** The filter's coefficients (stateVariableFilter's) at `cutoffHz`, with the layer's own Q. */
  setNoiseFilter(channel, cutoffHz) {
    const g = Math.tan((Math.PI * cutoffHz) / sampleRate);
    const a1 = 1 / (1 + (g * (g + channel.filterK)));
    channel.filterA1 = a1;
    channel.filterA2 = g * a1;
    channel.filterA3 = g * g * a1;
  }

  /**
   * The next CONTROL_FRAMES samples: advance the cycle to their end (a new
   * cycle begins here if it wraps), set per-sample steps that take the level
   * and gains from where they are to where they will be, and set the filter
   * for the segment. Segments are counted per channel from its first sample,
   * so they fall on the same frames whatever the block size.
   */
  beginControlSegment(channel) {
    if (!channel.controlReady) {
      const start = this.noiseControl(channel);
      channel.level = start.level;
      channel.gainLeft = start.gainLeft;
      channel.gainRight = start.gainRight;
      channel.controlReady = true;
    }
    channel.phase += CONTROL_FRAMES / ((channel.periodSec ?? 12) * channel.periodFactor * sampleRate);
    if (channel.phase >= 1) {
      channel.phase -= 1;
      this.startCycle(channel);
    }
    const target = this.noiseControl(channel);
    this.setNoiseFilter(channel, target.cutoff);
    channel.levelStep = (target.level - channel.level) / CONTROL_FRAMES;
    channel.gainLeftStep = (target.gainLeft - channel.gainLeft) / CONTROL_FRAMES;
    channel.gainRightStep = (target.gainRight - channel.gainRight) / CONTROL_FRAMES;
    channel.controlFramesLeft = CONTROL_FRAMES;
  }

  /**
   * A noise layer's block, written into `left`/`right` (overwritten): the
   * three loops read at the layer's own offsets and blended to its colour,
   * its width, its ramped level and gains, through its filter.
   */
  renderNoise(channel, left, right, length) {
    const brown = this.noiseLoop('brown');
    const pink = this.noiseLoop('pink');
    const white = this.noiseLoop('white');
    // The loops are all NOISE_LOOP_SECONDS long; the shortest bounds the read.
    const loopLength = Math.min(brown.length, pink.length, white.length);
    if (channel.loopLeft < 0 || channel.loopLeft >= loopLength) {
      channel.loopLeft = Math.floor(channel.loopStart * loopLength) % loopLength;
      channel.loopRight = (channel.loopLeft + Math.floor(loopLength / 2)) % loopLength;
    }
    let readLeft = channel.loopLeft;
    let readRight = channel.loopRight;
    const mixBrown = channel.mixBrown;
    const mixPink = channel.mixPink;
    const mixWhite = channel.mixWhite;
    const direct = channel.widthDirect;
    const cross = channel.widthCross;
    const lowMix = channel.lowMix;
    const bandMix = channel.bandMix;
    let leftS1 = channel.filterLeft.s1;
    let leftS2 = channel.filterLeft.s2;
    let rightS1 = channel.filterRight.s1;
    let rightS2 = channel.filterRight.s2;
    for (let index = 0; index < length; index += 1) {
      if (channel.controlFramesLeft === 0) this.beginControlSegment(channel);
      channel.controlFramesLeft -= 1;
      const a1 = channel.filterA1;
      const a2 = channel.filterA2;
      const a3 = channel.filterA3;
      const a = (brown[readLeft] * mixBrown) + (pink[readLeft] * mixPink) + (white[readLeft] * mixWhite);
      const b = (brown[readRight] * mixBrown) + (pink[readRight] * mixPink) + (white[readRight] * mixWhite);
      const level = channel.level;
      const inLeft = (cross === 0 ? a : (direct * a) + (cross * b)) * level * channel.gainLeft;
      const inRight = (cross === 0 ? b : (direct * b) + (cross * a)) * level * channel.gainRight;
      // stateVariableFilter's step: low-pass v2, band-pass v1 (x k for unity peak).
      let v3 = inLeft - leftS2;
      let v1 = (a1 * leftS1) + (a2 * v3);
      let v2 = leftS2 + (a2 * leftS1) + (a3 * v3);
      leftS1 = (2 * v1) - leftS1;
      leftS2 = (2 * v2) - leftS2;
      left[index] = (lowMix * v2) + (bandMix * v1);
      v3 = inRight - rightS2;
      v1 = (a1 * rightS1) + (a2 * v3);
      v2 = rightS2 + (a2 * rightS1) + (a3 * v3);
      rightS1 = (2 * v1) - rightS1;
      rightS2 = (2 * v2) - rightS2;
      right[index] = (lowMix * v2) + (bandMix * v1);
      channel.level += channel.levelStep;
      channel.gainLeft += channel.gainLeftStep;
      channel.gainRight += channel.gainRightStep;
      readLeft = readLeft + 1 === loopLength ? 0 : readLeft + 1;
      readRight = readRight + 1 === loopLength ? 0 : readRight + 1;
    }
    channel.loopLeft = readLeft;
    channel.loopRight = readRight;
    channel.filterLeft.s1 = leftS1;
    channel.filterLeft.s2 = leftS2;
    channel.filterRight.s1 = rightS1;
    channel.filterRight.s2 = rightS2;
  }

  // -------------------------------------------------------------------------
  // Rain intensity.

  /**
   * A rain layer's intensity now -- the slider, moved by the weather -- as
   * what the layer plays with: its drop rate (dropsRange, geometric), the
   * wash's level (WASH_INTENSITY_DB over the slider) and the drops' weight
   * (DROP_INTENSITY_LEVEL). All of them act at playback, none is baked into
   * a recorded drop, so the weather moving them never empties the drop bank.
   */
  updateRainIntensity(channel) {
    const intensity = Math.max(0, Math.min(1, (channel.intensity ?? 0.5) + (WEATHER_RAIN_REACH * this.weatherFactor(channel))));
    const [low, high] = channel.dropsRange ?? [1, 100];
    channel.dropsPerSecond = low * ((high / low) ** intensity);
    channel.washLevel = 10 ** (((intensity - 1) * WASH_INTENSITY_DB) / 20);
    channel.dropLevel = DROP_INTENSITY_LEVEL[0] + ((DROP_INTENSITY_LEVEL[1] - DROP_INTENSITY_LEVEL[0]) * intensity);
  }

  /**
   * Bring a rain channel's surface-dependent state in line with its
   * settings. `before` is the channel as it was (null for a new one): the
   * bed filter is rebuilt only when the surface changed, so it keeps its
   * memory through other edits, and the drip clock is rescheduled only when
   * the drip rate changed.
   */
  configureRain(channel, before) {
    const profile = surfaceProfile(channel.surface);
    channel.profile = profile;
    if (!channel.bed || before?.surface !== channel.surface) {
      channel.bed = {
        // Its own stream, so the bed's per-sample draws and the voices'
        // births each stay in time order whatever the block size.
        stream: { seed: Math.floor(this.random() * 0x100000000) >>> 0 },
        // One filter per edge of the image: two independent noises.
        filterA: stateVariableFilter(profile.bed.centerHz, profile.bed.q),
        filterB: stateVariableFilter(profile.bed.centerHz, profile.bed.q),
        swell: 1,
        swellTarget: 1,
        swellFrames: 0,
      };
    }
    // A baked drop has the surface and the bass and treble levels in it, so
    // a change to any of them empties the bank (drops already playing keep
    // theirs). It refills from the drops that fall next.
    // Recordings still under way go with them: they keep playing, but into
    // an entry nothing refers to any more.
    if (!channel.dropBank || !before || before.surface !== channel.surface
      || before.wetness !== channel.wetness || before.resonance !== channel.resonance) {
      if (!channel.spareRecordings) channel.spareRecordings = [];
      for (const entry of [...(channel.dropBank ?? []), ...(channel.dripBank ?? [])]) {
        this.evictRecording(channel, entry);
      }
      channel.dropBank = [];
      channel.dripBank = [];
    }
    const dripRate = (channel.drips ?? 0) * RAIN_DRIPS_MAX_PER_SEC;
    if (!before || before.drips !== channel.drips) {
      channel.nextDripFrame = dripRate > 0
        ? currentFrame + this.eventDelayFrames(dripRate)
        : Infinity;
    }
  }

  /**
   * `count` decaying sinusoids, frequencies log-uniform in the range, each
   * advanced by rotating a (sin, cos) pair so no trigonometry runs per
   * sample.
   */
  makeRainModes(count, minFrequency, maxFrequency, minDecay, maxDecay, minAmplitude, maxAmplitude) {
    const highestFrequency = Math.max(minFrequency, Math.min(maxFrequency, sampleRate * 0.45));
    const modes = [];
    for (let index = 0; index < count; index += 1) {
      const frequency = minFrequency * Math.pow(highestFrequency / minFrequency, this.random());
      const phase = this.random() * Math.PI * 2;
      const angle = (Math.PI * 2 * frequency) / sampleRate;
      const decaySeconds = minDecay + (this.random() * (maxDecay - minDecay));
      modes.push({
        frequency,
        sin: Math.sin(phase),
        cos: Math.cos(phase),
        rotationSin: Math.sin(angle),
        rotationCos: Math.cos(angle),
        amplitude: minAmplitude + (this.random() * (maxAmplitude - minAmplitude)),
        decay: Math.exp(-1 / (sampleRate * decaySeconds)),
      });
    }
    return modes;
  }

  /**
   * A bank of modes from a profile's spec: an integer count drawn uniformly
   * from its range, frequencies scaled by `pitchScale` (a drip is lower).
   */
  makeModesFromSpec(spec, pitchScale) {
    const low = Math.round(spec.count[0]);
    const high = Math.round(spec.count[1]);
    const count = low + Math.floor(this.random() * (high - low + 1));
    return this.makeRainModes(
      count,
      spec.hz[0] * pitchScale,
      spec.hz[1] * pitchScale,
      spec.decaySec[0],
      spec.decaySec[1],
      spec.amplitude[0],
      spec.amplitude[1],
    );
  }

  sampleRainModes(modes) {
    let sample = 0;
    for (const mode of modes) {
      sample += mode.sin * mode.amplitude;
      const nextSin = (mode.sin * mode.rotationCos) + (mode.cos * mode.rotationSin);
      mode.cos = (mode.cos * mode.rotationCos) - (mode.sin * mode.rotationSin);
      mode.sin = nextSin;
      mode.amplitude *= mode.decay;
    }
    return sample;
  }



  /**
   * A bubble resonance, after van den Doel's model of liquid sounds: a
   * bubble of radius r rings near 3/r Hz (Minnaert), damps at a rate set by
   * r, and its pitch rises linearly as it nears the surface.
   */
  makeBubble(radiusMm, gain) {
    const radius = radiusMm / 1000;
    const damping = (0.13 / radius) + (0.0072 * (radius ** -1.5));
    const rise = (0.05 + (this.random() * 0.15)) * damping;
    const bubble = {
      ringFrames: Math.ceil((5 * sampleRate) / damping),
      // Advanced like a mode: a (sin, cos) pair rotated by a fixed angle per
      // sample, so no trigonometry runs per sample. The pitch rise is far
      // too slow to hear within BUBBLE_RETUNE_FRAMES, so the rotation is
      // re-derived only that often, jumping the frequency by the rise those
      // frames have accumulated.
      sin: 0,
      cos: 1,
      rotationSin: 0,
      rotationCos: 1,
      frequency: Math.min(3 / radius, sampleRate * 0.4),
      retuneFactor: (1 + (rise / sampleRate)) ** BUBBLE_RETUNE_FRAMES,
      framesToRetune: BUBBLE_RETUNE_FRAMES,
      amplitude: gain * Math.min(1, radiusMm / 2.5) * 0.35,
      decay: Math.exp(-damping / sampleRate),
    };
    this.tuneBubble(bubble);
    return bubble;
  }

  tuneBubble(bubble) {
    const angle = (2 * Math.PI * bubble.frequency) / sampleRate;
    bubble.rotationSin = Math.sin(angle);
    bubble.rotationCos = Math.cos(angle);
  }

  sampleBubble(bubble) {
    const sample = bubble.sin * bubble.amplitude;
    const nextSin = (bubble.sin * bubble.rotationCos) + (bubble.cos * bubble.rotationSin);
    bubble.cos = (bubble.cos * bubble.rotationCos) - (bubble.sin * bubble.rotationSin);
    bubble.sin = nextSin;
    bubble.amplitude *= bubble.decay;
    bubble.framesToRetune -= 1;
    if (bubble.framesToRetune === 0) {
      bubble.framesToRetune = BUBBLE_RETUNE_FRAMES;
      bubble.frequency = Math.min(bubble.frequency * bubble.retuneFactor, sampleRate * 0.45);
      this.tuneBubble(bubble);
    }
    return sample;
  }

  /**
   * One drop on the surface `profile` describes (surfaceProfile), shaped by
   * the layer's `character`:
   * - `resonance` (0-1): how much the material rings. 0.5 is the surface as
   *   authored; below it the modes grow quieter, reaching none at 0 (only
   *   the impact); above it they ring longer, up to twice as long at 1.
   *   Decay time scales by 2^(2 * resonance - 1), level by
   *   min(1, 2 * resonance).
   * - `wetness` (0-1): standing water. It damps the ring (a film of water
   *   deadens a surface), sends a share of drops into the water, where they
   *   splash -- a very short bright attack, then a few finer spray ticks --
   *   and trap a bubble, whose rising "plip" follows.
   * A drip is the same drop made larger: louder, lower, its click slower and
   * its life twice as long, and likelier to land in water.
   */
  makeSurfaceVoice(profile, isDrip, character = NEUTRAL_CHARACTER) {
    const click = profile.click;
    const wetness = character.wetness;
    const resonance = character.resonance;
    const pitchScale = isDrip ? profile.drip.pitchScale : 1;
    const decaySec = this.between(click.decaySec) * (isDrip ? 1.8 : 1);
    const ringDecay = (2 ** ((2 * resonance) - 1)) * (1 - (WET_DECAY_DAMPING * wetness));
    const ringLevel = Math.min(1, 2 * resonance) * (1 - (WET_LEVEL_DAMPING * wetness));
    const voice = {
      age: 0,
      durationFrames: Math.ceil(sampleRate * profile.durationSec * (isDrip ? 2 : 1) * Math.max(1, ringDecay)),
      gain: isDrip ? profile.drip.gain : 1,
      transientAmplitude: this.between(click.amplitude),
      transientDecay: Math.exp(-1 / (sampleRate * decaySec)),
      // Fully white needs no filter at all; anything less blends one in.
      transientFilter: click.white >= 1 ? null : stateVariableFilter(this.between(click.centerHz) * pitchScale, click.q),
      transientWhite: click.white,
      clickSeed: 0,
      bassModes: this.shapeModes(this.makeModesFromSpec(profile.bass, pitchScale), ringLevel, ringDecay),
      bodyModes: this.shapeModes(this.makeModesFromSpec(profile.body, pitchScale), ringLevel, ringDecay),
      trebleModes: this.shapeModes(this.makeModesFromSpec(profile.treble, pitchScale), ringLevel, ringDecay),
      bubble: null,
      splashAmplitude: 0,
      splashDecay: Math.exp(-1 / (sampleRate * SPLASH.decaySec)),
      splashFilter: null,
      sprayFrames: [],
      sprayLevels: [],
    };
    const bubbleChance = Math.min(1, wetness * (isDrip ? WET_DRIP_BUBBLE_CHANCE : WET_BUBBLE_CHANCE));
    if (bubbleChance > 0 && this.random() < bubbleChance) {
      const radiusMm = isDrip ? this.between([2.5, 5]) : this.between([0.8, 2.6]);
      voice.bubble = this.makeBubble(radiusMm, 1);
      voice.durationFrames = Math.max(voice.durationFrames, voice.bubble.ringFrames);
      voice.splashAmplitude = this.between(SPLASH_LEVEL) * wetness;
      voice.splashFilter = stateVariableFilter(this.between(SPLASH.centerHz), SPLASH.q);
      const sprays = Math.round(SPRAY.count[0] + (this.random() * (SPRAY.count[1] - SPRAY.count[0]) * wetness));
      for (let index = 0; index < sprays; index += 1) {
        voice.sprayFrames.push(Math.round(this.between(SPRAY.withinSec) * sampleRate));
        voice.sprayLevels.push(this.between(SPRAY.level) * voice.splashAmplitude);
      }
    }
    return voice;
  }

  /** A bank of modes with its level and decay time scaled (see makeSurfaceVoice). */
  shapeModes(modes, level, decayScale) {
    for (const mode of modes) {
      mode.amplitude *= level;
      // decay is exp(-1 / (sampleRate * t)): scaling t by k raises it to 1/k.
      mode.decay = mode.decay ** (1 / decayScale);
    }
    return level > 0 ? modes : [];
  }

  /**
   * The bed, a block at a time, added into `left`/`right`: sparse random
   * impulses plus a noise floor, band-passed, with a slow random swell --
   * twice, independently, one at each edge of the layer's image (stereoImage),
   * each at half the impulse rate and half the power, so together they are
   * the one bed spread across the image, at the level the layer's mix gives
   * it (rainMixGains) and the layer's intensity (washLevel). Nothing is drawn
   * while that is 0.
   */
  renderBed(channel, left, right, length) {
    const wash = rainMixGains(channel.mix).wash * (channel.washLevel ?? 1);
    if (wash <= 0) return;
    this.withStream(channel.bed.stream, () => this.renderBedFrom(channel, left, right, length, wash));
  }

  renderBedFrom(channel, left, right, length, wash) {
    const spec = channel.profile.bed;
    const bed = channel.bed;
    const filterA = bed.filterA;
    const filterB = bed.filterB;
    const image = stereoImage(channel.pan, 1);
    const edgeA = panGains(image.from);
    const edgeB = panGains(image.to);
    const impulseChance = spec.ratePerSec / (2 * sampleRate);
    const swellRate = 1 / (sampleRate * 0.8);
    const scale = spec.gain * wash * Math.SQRT1_2;
    for (let index = 0; index < length; index += 1) {
      if (bed.swellFrames <= 0) {
        bed.swellTarget = 1 - (spec.swellDepth * this.random());
        bed.swellFrames = this.eventDelayFrames(1 / BED_SWELL_PERIOD_SEC);
      }
      bed.swellFrames -= 1;
      bed.swell += (bed.swellTarget - bed.swell) * swellRate;
      const level = scale * bed.swell;
      const impulseA = this.random() < impulseChance ? ((this.random() * 2) - 1) : 0;
      const a = bandPass(filterA, impulseA + (((this.random() * 2) - 1) * spec.floor)) * level;
      const impulseB = this.random() < impulseChance ? ((this.random() * 2) - 1) : 0;
      const b = bandPass(filterB, impulseB + (((this.random() * 2) - 1) * spec.floor)) * level;
      left[index] += (a * edgeA.left) + (b * edgeB.left);
      right[index] += (a * edgeA.right) + (b * edgeB.right);
    }
  }

  /**
   * Start the drops and drips whose time falls inside this block. A voice
   * born mid-block records the frame it starts on (`startOffset`) and is
   * silent before it, so timing is still sample-accurate.
   */
  birthVoices(channel, blockStart, length) {
    const blockEnd = blockStart + length;
    // A clock that fell behind -- its layer was paused at volume 0 -- starts
    // afresh from now rather than delivering every drop it missed at once.
    if (channel.nextEventFrame < blockStart) {
      channel.nextEventFrame = blockStart + this.eventDelayFrames(channel.dropsPerSecond);
    }
    if (channel.nextDripFrame < blockStart) {
      channel.nextDripFrame = blockStart + this.eventDelayFrames(channel.drips * RAIN_DRIPS_MAX_PER_SEC);
    }
    // Drops and drips are born in time order, whichever clock is next, so
    // the channel's stream is drawn in the same order whatever the block
    // size (a drip born after a later drop would reorder the draws at block
    // boundaries and change every drop that follows).
    for (;;) {
      const isDrip = channel.nextDripFrame < channel.nextEventFrame;
      const at = isDrip ? channel.nextDripFrame : channel.nextEventFrame;
      if (at >= blockEnd) break;
      this.addVoice(channel, isDrip, at - blockStart, at);
      if (isDrip) channel.nextDripFrame += this.eventDelayFrames(channel.drips * RAIN_DRIPS_MAX_PER_SEC);
      else channel.nextEventFrame += this.eventDelayFrames(channel.dropsPerSecond);
    }
  }

  /**
   * Start one drop (or drip) at absolute frame `at`, `offset` frames into
   * the block: play one back from the layer's bank, or synthesise a new one
   * live and record it -- while the bank is filling, and on one birth in
   * DROP_BANK_REFRESH_EVERY once it is full. A live drop with nothing ready
   * to play back yet (early in a fill) is synthesised without recording.
   */
  addVoice(channel, isDrip, offset, at) {
    if (channel.activeVoices.length >= MAX_RAIN_VOICES) return;
    const bank = isDrip ? channel.dripBank : channel.dropBank;
    const size = isDrip ? DRIP_BANK_SIZE : DROP_BANK_SIZE;
    const startOffset = Math.max(0, offset);
    // Where in the layer's image this drop falls, drawn first so every birth
    // draws it in the same place in the stream.
    const image = stereoImage(channel.pan, 1);
    const gains = panGains(image.from + ((image.to - image.from) * this.random()));
    let slot = -1;
    if (bank.length < size) {
      slot = bank.length;
    } else if (this.random() * DROP_BANK_REFRESH_EVERY < 1) {
      slot = Math.floor(this.random() * size);
    }
    if (slot < 0) {
      const ready = this.readyRecordings(bank, at);
      if (ready.length > 0) {
        const entry = ready[Math.floor(this.random() * ready.length)];
        entry.users += 1;
        channel.activeVoices.push({
          live: null,
          entry,
          position: 0,
          startOffset,
          level: 1 + (DROP_PLAYBACK_LEVEL_SPREAD * ((this.random() * 2) - 1)),
          gainLeft: gains.left,
          gainRight: gains.right,
        });
        return;
      }
    }
    const live = this.makeSurfaceVoice(channel.profile, isDrip, channel);
    live.startOffset = startOffset;
    live.clickSeed = Math.floor(this.random() * 0x100000000) >>> 0;
    let entry = null;
    if (slot >= 0) {
      const buffer = this.takeSpareRecording(channel, live.durationFrames);
      entry = {
        buffer,
        samples: buffer.subarray(0, live.durationFrames),
        audibleLength: live.durationFrames,
        availableFrom: at + live.durationFrames,
        // The recording voice is its first user; inBank until replaced.
        users: 1,
        inBank: true,
      };
      if (bank[slot]) this.evictRecording(channel, bank[slot]);
      bank[slot] = entry;
    }
    channel.activeVoices.push({
      live, entry, position: 0, startOffset, level: 1, gainLeft: gains.left, gainRight: gains.right,
    });
  }

  /**
   * Recording buffers are recycled rather than left to the garbage
   * collector, whose pauses on this thread are heard as tears: a recording
   * returns its buffer to the layer's spares once it is out of the bank AND
   * no voice is playing it, and a new recording takes a spare first.
   */
  takeSpareRecording(channel, length) {
    const spares = channel.spareRecordings;
    for (let index = spares.length - 1; index >= 0; index -= 1) {
      if (spares[index].length >= length) {
        const buffer = spares[index];
        spares[index] = spares[spares.length - 1];
        spares.pop();
        return buffer;
      }
    }
    return new Float32Array(length);
  }

  evictRecording(channel, entry) {
    entry.inBank = false;
    this.releaseRecordingIfUnused(channel, entry);
  }

  releaseRecording(channel, entry) {
    entry.users -= 1;
    this.releaseRecordingIfUnused(channel, entry);
  }

  releaseRecordingIfUnused(channel, entry) {
    if (entry.inBank || entry.users > 0 || !entry.buffer) return;
    // At most a bank's worth of spares; beyond that the buffer is let go.
    if (channel.spareRecordings.length < DROP_BANK_SIZE + DRIP_BANK_SIZE) channel.spareRecordings.push(entry.buffer);
    entry.buffer = null;
  }

  /** The recordings in `bank` complete by frame `at`. */
  readyRecordings(bank, at) {
    const ready = [];
    for (let index = 0; index < bank.length; index += 1) {
      if (bank[index].availableFrom <= at) ready.push(bank[index]);
    }
    return ready;
  }

  /**
   * A live drop for the rest of this block: synthesised into scratch, added
   * to the mix, and -- if it is being recorded -- copied into its entry. A
   * recorded drop plays its full length (never retiring early as silent) so
   * it is complete exactly when its entry said it would be; once it is, the
   * entry's playback length is cut back to its last audible sample.
   */
  playLiveDrop(voice, channel, left, right, length) {
    const scratch = this.dropScratch;
    const start = voice.startOffset;
    scratch.fill(0, start, length);
    const live = voice.live;
    const before = live.age;
    const alive = this.renderVoice(live, scratch, length, voice.entry === null);
    const end = start + (live.age - before);
    const gainLeft = voice.gainLeft;
    const gainRight = voice.gainRight;
    for (let index = start; index < end; index += 1) {
      left[index] += scratch[index] * gainLeft;
      right[index] += scratch[index] * gainRight;
    }
    if (voice.entry) voice.entry.samples.set(scratch.subarray(start, end), voice.position);
    voice.position += end - start;
    voice.startOffset = 0;
    if (alive) return true;
    if (voice.entry) {
      voice.entry.audibleLength = this.audibleLength(voice.entry.samples);
      this.releaseRecording(channel, voice.entry);
    }
    return false;
  }

  /** How much of a recording is above VOICE_SILENCE; the rest need not be played. */
  audibleLength(samples) {
    for (let index = samples.length - 1; index >= 0; index -= 1) {
      if (Math.abs(samples[index]) > VOICE_SILENCE) return index + 1;
    }
    return 0;
  }

  /**
   * A recorded drop for the rest of this block; false once it has ended.
   * The recording is mono: where it falls is the voice's, not the take's.
   */
  playDrop(voice, left, right, length) {
    const samples = voice.entry.samples;
    const playLength = voice.entry.audibleLength;
    const levelLeft = voice.level * voice.gainLeft;
    const levelRight = voice.level * voice.gainRight;
    let position = voice.position;
    const start = voice.startOffset;
    voice.startOffset = 0;
    const end = Math.min(length, start + (playLength - position));
    for (let index = start; index < end; index += 1) {
      const sample = samples[position];
      left[index] += sample * levelLeft;
      right[index] += sample * levelRight;
      position += 1;
    }
    voice.position = position;
    return position < playLength;
  }


  /**
   * One voice for the rest of this block, added into `out`, in one loop with
   * the voice's state in locals. The click draws from the voice's own seed
   * and stops -- no draws, no filtering -- once it and its filter have
   * decayed below hearing, which for most drops is within a few ms of a
   * life of up to 0.4 s. Returns false when the voice has finished: at its
   * nominal length, or earlier once silent if `retireWhenSilent` (a voice
   * being recorded must run its full length -- see addVoice).
   */
  renderVoice(voice, out, length, retireWhenSilent = true) {
    const gain = voice.gain;
    const splashFilter = voice.splashFilter;
    const splashDecay = voice.splashDecay;
    let splashAmplitude = voice.splashAmplitude;
    let splashActive = splashFilter !== null && (splashAmplitude > 0 || voice.sprayFrames.length > 0
      || Math.abs(splashFilter.s1) + Math.abs(splashFilter.s2) > SILENCE);
    let age = voice.age;
    const filter = voice.transientFilter;
    const white = voice.transientWhite ?? 0;
    const decay = voice.transientDecay;
    let clickAmplitude = voice.transientAmplitude;
    let seed = voice.clickSeed;
    let filterActive = filter !== null && (clickAmplitude > 0 || Math.abs(filter.s1) + Math.abs(filter.s2) > SILENCE);
    const start = voice.startOffset;
    voice.startOffset = 0;
    const end = Math.min(length, start + (voice.durationFrames - voice.age));
    for (let index = start; index < end; index += 1) {
      let high = 0;
      if (clickAmplitude > 0) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        const click = ((seed / 0x100000000) * 2 - 1) * clickAmplitude;
        clickAmplitude *= decay;
        if (clickAmplitude < SILENCE) clickAmplitude = 0;
        high = filter ? (white * click) + ((1 - white) * bandPass(filter, click)) : click;
      } else if (filterActive) {
        high = (1 - white) * bandPass(filter, 0);
        filterActive = Math.abs(filter.s1) + Math.abs(filter.s2) > SILENCE;
      }
      if (splashActive) {
        // Spray ticks re-strike the splash at their frames (sorted not
        // needed: each is checked on its own frame).
        const sprays = voice.sprayFrames;
        for (let spray = sprays.length - 1; spray >= 0; spray -= 1) {
          if (sprays[spray] === age) {
            splashAmplitude += voice.sprayLevels[spray];
            sprays.splice(spray, 1);
            voice.sprayLevels.splice(spray, 1);
          }
        }
        let splash = 0;
        if (splashAmplitude > 0) {
          seed = (1664525 * seed + 1013904223) >>> 0;
          splash = ((seed / 0x100000000) * 2 - 1) * splashAmplitude;
          splashAmplitude *= splashDecay;
          if (splashAmplitude < SILENCE) splashAmplitude = 0;
        }
        high += bandPass(splashFilter, splash);
        splashActive = splashAmplitude > 0 || sprays.length > 0
          || Math.abs(splashFilter.s1) + Math.abs(splashFilter.s2) > SILENCE;
      }
      high += this.sampleRainModes(voice.trebleModes);
      if (voice.bubble) high += this.sampleBubble(voice.bubble);
      out[index] += (
        this.sampleRainModes(voice.bodyModes)
        + (this.sampleRainModes(voice.bassModes) * AUTHORED_LOW_LEVEL)
        + (high * AUTHORED_HIGH_LEVEL)
      ) * gain;
      age += 1;
    }
    voice.splashAmplitude = splashAmplitude;
    voice.transientAmplitude = clickAmplitude;
    voice.clickSeed = seed;
    voice.age += end - start;
    const silent = !splashActive && this.voiceIsSilent(voice, filterActive);
    return voice.age < voice.durationFrames && !(retireWhenSilent && silent);
  }

  /**
   * Whether nothing left in a voice can be heard, so it can end before its
   * nominal duration: the click and its filter done, and every oscillator
   * below SILENCE. Checked once per block, so a finished voice costs at most
   * one more block.
   */
  voiceIsSilent(voice, filterActive) {
    if (voice.transientAmplitude > 0 || filterActive) return false;
    if (voice.bubble && voice.bubble.amplitude > VOICE_SILENCE) return false;
    return this.modesAreSilent(voice.bassModes)
      && this.modesAreSilent(voice.bodyModes)
      && this.modesAreSilent(voice.trebleModes);
  }

  modesAreSilent(modes) {
    for (let index = 0; index < modes.length; index += 1) {
      if (modes[index].amplitude > VOICE_SILENCE) return false;
    }
    return true;
  }

  /** A rain layer's block, written into `left`/`right` (overwritten). */
  renderRain(channel, left, right, blockStart, length) {
    this.updateRainIntensity(channel);
    if (!this.dropScratch || this.dropScratch.length < length) this.dropScratch = new Float64Array(length);
    left.fill(0, 0, length);
    right.fill(0, 0, length);
    this.birthVoices(channel, blockStart, length);
    const voices = channel.activeVoices;
    for (let index = voices.length - 1; index >= 0; index -= 1) {
      const voice = voices[index];
      const alive = voice.live
        ? this.playLiveDrop(voice, channel, left, right, length)
        : this.playDrop(voice, left, right, length);
      if (!alive && !voice.live) this.releaseRecording(channel, voice.entry);
      if (!alive) {
        // Order does not matter to the mix, so the last voice fills the gap.
        voices[index] = voices[voices.length - 1];
        voices.pop();
      }
    }
    // The drops' side of the mix, applied to what the voices wrote before
    // the bed is added (the bed takes its own side in renderBed).
    const drops = rainMixGains(channel.mix).drops * (channel.dropLevel ?? 1);
    if (drops !== 1) {
      for (let index = 0; index < length; index += 1) {
        left[index] *= drops;
        right[index] *= drops;
      }
    }
    this.renderBed(channel, left, right, length);
  }

  /**
   * A thunder layer's clock and mixing gains. A storm that has just started
   * (or had its rate changed) peals within THUNDER_FIRST_PEAL_SEC -- waiting
   * the mean interval of minutes would read as nothing happening -- and at
   * random after that. Its distance's direct and reverb-send gains are the
   * shared rule's (resolveAmbientSpace), per peal; its darkening is not applied on top,
   * because the rumble's own low-pass (startPeal) already is that darkening.
   */
  configureThunder(channel, before) {
    if (!channel.peals) channel.peals = [];
    if (!channel.highPass) {
      // Direct left and right, send left and right.
      channel.highPass = Array.from({ length: 4 }, () => stateVariableFilter(THUNDER_HIGH_PASS_HZ, Math.SQRT1_2));
    }
    if (!channel.contrastFollow) {
      channel.contrastFollow = {
        level: 0,
        pivot: 0,
        rate: 1 - Math.exp(-1 / (THUNDER_CONTRAST_FOLLOW_SEC * sampleRate)),
        rise: 1 - Math.exp(-1 / (THUNDER_CONTRAST_PIVOT_SEC.rise * sampleRate)),
        fall: 1 - Math.exp(-1 / (THUNDER_CONTRAST_PIVOT_SEC.fall * sampleRate)),
      };
    }
    if (channel.share <= 0) {
      channel.nextPealFrame = Infinity;
    } else if (!before || before.share <= 0 || !Number.isFinite(channel.nextPealFrame)) {
      channel.nextPealFrame = currentFrame + Math.round(this.between(THUNDER_FIRST_PEAL_SEC) * sampleRate);
    }
  }

  /**
   * The controls one peal plays with: the layer's own, each moved by up to
   * `randomness` x `jitter` of its range either way and capped at the
   * range's ends. Drawn around the SETTING every time, so a storm wanders
   * about where it was put rather than drifting off.
   */
  thunderPealSettings(channel) {
    const reach = (channel.randomness ?? 0) * (channel.jitter ?? 0);
    const vary = (value, low, high) => (reach <= 0
      ? value
      : Math.max(low, Math.min(high, value + (reach * (high - low) * ((this.random() * 2) - 1)))));
    const [lengthLow, lengthHigh] = channel.lengthRangeSec ?? [channel.lengthSec, channel.lengthSec];
    return {
      volume: vary(channel.volume, 0, 1),
      // A layer that plays at all keeps playing: its share is not moved to 0.
      share: Math.max(0.001, vary(channel.share, 0, 1)),
      distance: vary(channel.distance, 0, 1),
      pan: vary(channel.pan, -1, 1),
      spread: vary(channel.spread, 0, 1),
      lengthSec: vary(channel.lengthSec, lengthLow, lengthHigh),
      character: vary(channel.character ?? 0.5, 0, 1),
      contrast: vary(channel.contrast ?? 0, -1, 1),
    };
  }

  /** resolveAmbientSpace at `distance`, from the table the main thread built. */
  thunderSpaceAt(channel, distance) {
    const table = channel.spaceTable;
    if (!table || table.length === 0) return { directGain: 1, reverbSend: 0 };
    return table[Math.round(distance * (table.length - 1))];
  }

  /** Geometric blend from `near` to `far` at distance `d`. */
  byDistance(range, d) {
    return range.near * ((range.far / range.near) ** d);
  }

  /**
   * A roll in level at `harshness` along THUNDER_ROLL (0 smooth, 1 harsh),
   * blended geometrically between the two ends; the gap chance linearly.
   */
  makeThunderRoll(harshness) {
    const blend = (smooth, harsh) => smooth * ((harsh / smooth) ** harshness);
    return {
      sec: [blend(THUNDER_ROLL.smooth.sec[0], THUNDER_ROLL.harsh.sec[0]), blend(THUNDER_ROLL.smooth.sec[1], THUNDER_ROLL.harsh.sec[1])],
      floor: blend(THUNDER_ROLL.smooth.floor, THUNDER_ROLL.harsh.floor),
      glide: blend(THUNDER_ROLL.smooth.glidePerSec, THUNDER_ROLL.harsh.glidePerSec) / sampleRate,
      gapChance: THUNDER_ROLL_GAP_CHANCE * harshness,
      seed: Math.floor(this.random() * 0x100000000) >>> 0,
      value: 1,
      target: 1,
      frames: 0,
    };
  }

  /** One sample of a roll (makeThunderRoll); returns its level. */
  stepThunderRoll(roll) {
    if (roll.frames <= 0) {
      roll.seed = (1664525 * roll.seed + 1013904223) >>> 0;
      const isGap = (roll.seed / 0x100000000) < roll.gapChance;
      roll.seed = (1664525 * roll.seed + 1013904223) >>> 0;
      const surgeFloor = Math.max(roll.floor, 0.5);
      roll.target = isGap ? roll.floor : surgeFloor + ((1 - surgeFloor) * (roll.seed / 0x100000000));
      roll.seed = (1664525 * roll.seed + 1013904223) >>> 0;
      roll.frames = Math.round((roll.sec[0] + ((roll.sec[1] - roll.sec[0]) * (roll.seed / 0x100000000))) * sampleRate);
    }
    roll.frames -= 1;
    roll.value += (roll.target - roll.value) * roll.glide;
    return roll.value;
  }

  /**
   * A new peal, starting at this sample, played with `settings`
   * (thunderPealSettings). Everything random is drawn now, into a list of
   * rumbles sorted by start; renderThunder only plays them.
   */
  startPeal(channel, settings) {
    const d = settings.distance;
    const spread = settings.spread;
    const lengthSec = settings.lengthSec;
    const peakSec = lengthSec * this.between(THUNDER_PEAK_AT);
    const fadeTau = Math.max(0.1, (lengthSec - peakSec) / 5);
    const space = this.thunderSpaceAt(channel, d);
    const image = stereoImage(settings.pan, spread);
    const panAround = () => image.from + ((image.to - image.from) * this.random());
    const brown = this.noiseLoop('brown');
    const count = THUNDER_RUMBLES[0] + Math.floor(this.random() * (THUNDER_RUMBLES[1] - THUNDER_RUMBLES[0] + 1));
    // Several rumbles together are about as loud as three were, and the
    // whole peal is scaled so the boom adds weight rather than loudness.
    const level = this.byDistance(THUNDER_LEVEL, d) * Math.sqrt(3 / count) * THUNDER_PEAL_SCALE;
    const booms = THUNDER_BOOMS[0] + Math.floor(this.random() * (THUNDER_BOOMS[1] - THUNDER_BOOMS[0] + 1));
    const rumbles = [];
    for (let index = 0; index < count + booms; index += 1) {
      const isBoom = index >= count;
      // Each swells to about the peak from its own start in the roll-in,
      // and fades with the peal after it.
      // A boom starts later and swells faster, landing on the peak.
      const startSec = peakSec * (isBoom ? 0.5 + (0.3 * this.random()) : 0.7 * this.random());
      const attackSec = Math.max(0.05, (peakSec - startSec) * (0.8 + (0.4 * this.random())));
      const tauSec = fadeTau * (0.8 + (0.4 * this.random()));
      const lifeSec = attackSec + (5 * tauSec);
      rumbles.push({
        start: Math.round(startSec * sampleRate),
        age: 0,
        attack: Math.max(1, Math.round(attackSec * sampleRate)),
        decay: Math.exp(-1 / (tauSec * sampleRate)),
        life: Math.max(2, Math.round(lifeSec * sampleRate)),
        tail: 1,
        level: level * (isBoom ? THUNDER_BOOM_LEVEL : 0.6 + (0.4 * this.random())),
        filter: isBoom
          ? stateVariableFilter(this.byDistance(THUNDER_BOOM_CENTER_HZ, d) * (0.85 + (0.3 * this.random())), THUNDER_BOOM_Q)
          : stateVariableFilter(Math.max(
            THUNDER_BODY_FLOOR_HZ * (2 ** THUNDER_BODY_MIN_OCTAVE),
            this.byDistance(THUNDER_CUTOFF_HZ, d) * (0.6 + (1.2 * this.random())),
          ), 0.8),
        lowPass: isBoom ? [
          stateVariableFilter(THUNDER_BODY_FLOOR_HZ, Math.SQRT1_2),
          stateVariableFilter(THUNDER_BODY_FLOOR_HZ, Math.SQRT1_2),
        ] : null,
        highPass: isBoom ? null : [
          stateVariableFilter(THUNDER_BODY_FLOOR_HZ, Math.SQRT1_2),
          stateVariableFilter(THUNDER_BODY_FLOOR_HZ, Math.SQRT1_2),
        ],
        read: Math.floor(this.random() * brown.length),
        band: isBoom,
        // A boom stays at the peal's pan: bass is barely heard as coming
        // from anywhere, and one or two of them carry most of a peal's
        // power, so a boom drawn to one side leans the whole peal there.
        panFrom: isBoom ? settings.pan : panAround(),
        panTo: isBoom ? settings.pan : panAround(),
        gainLeft: 0,
        gainRight: 0,
      });
    }
    rumbles.sort((a, b) => a.start - b.start);
    channel.peals.push({
      rumbles,
      next: 0,
      age: 0,
      // The volume slider stays live through a peal: the peal keeps only
      // how far randomness moved it, and adds that to the current setting.
      volumeOffset: settings.volume - channel.volume,
      bodyRoll: this.makeThunderRoll(0),
      boomRoll: this.makeThunderRoll(settings.character * THUNDER_CHARACTER_REACH),
      direct: space.directGain,
      send: space.reverbSend,
    });
  }

  /**
   * A thunder layer's block: the direct sound into `left`/`right` and what
   * goes to the reverb into `sendLeft`/`sendRight` (all overwritten). A
   * storm between peals costs one comparison per sample and nothing else.
   */
  renderThunder(channel, left, right, sendLeft, sendRight, length) {
    left.fill(0, 0, length);
    right.fill(0, 0, length);
    sendLeft.fill(0, 0, length);
    sendRight.fill(0, 0, length);
    const brown = this.noiseLoop('brown');
    for (let index = 0; index < length; index += 1) {
      if (currentFrame + index >= channel.nextPealFrame) {
        const settings = this.thunderPealSettings(channel);
        this.startPeal(channel, settings);
        // Contrast acts on the layer's mix, so the latest peal's draw of it
        // holds until the next; the offset from the setting keeps the slider
        // live, as for volume.
        channel.contrastOffset = settings.contrast - (channel.contrast ?? 0);
        // Silent for the peal's length x (1 - share) / share after it ends.
        // A gust brings the next peal sooner, a lull puts it off.
        const pauseSec = settings.lengthSec * ((1 - settings.share) / settings.share)
          * (2 ** (-WEATHER_THUNDER_OCTAVES * this.weatherFactor(channel)));
        channel.nextPealFrame = currentFrame + index + Math.max(1, Math.round((settings.lengthSec + pauseSec) * sampleRate));
      }
      if (channel.peals.length === 0) continue;
      let directLeft = 0;
      let directRight = 0;
      let wetLeft = 0;
      let wetRight = 0;
      for (let pealIndex = channel.peals.length - 1; pealIndex >= 0; pealIndex -= 1) {
        const peal = channel.peals[pealIndex];
        // Rumbles become live in start order; `next` is the first not yet live.
        while (peal.next < peal.rumbles.length && peal.rumbles[peal.next].start <= peal.age) peal.next += 1;
        peal.age += 1;
        const bodyRoll = this.stepThunderRoll(peal.bodyRoll);
        const boomRoll = this.stepThunderRoll(peal.boomRoll);
        let sumLeft = 0;
        let sumRight = 0;
        let live = 0;
        for (let rumbleIndex = 0; rumbleIndex < peal.next; rumbleIndex += 1) {
          const rumble = peal.rumbles[rumbleIndex];
          if (rumble.age >= rumble.life) continue;
          live += 1;
          // Where it is in the field moves every 1024 samples.
          if ((rumble.age & 1023) === 0) {
            const progress = Math.min(1, rumble.age / rumble.life);
            const pan = rumble.panFrom + ((rumble.panTo - rumble.panFrom) * progress);
            rumble.gainLeft = Math.SQRT2 * Math.cos((pan + 1) * Math.PI / 4);
            rumble.gainRight = Math.SQRT2 * Math.sin((pan + 1) * Math.PI / 4);
          }
          let envelope;
          if (rumble.age < rumble.attack) {
            const x = rumble.age / rumble.attack;
            envelope = x * x * (3 - (2 * x));
          } else {
            rumble.tail *= rumble.decay;
            envelope = rumble.tail;
          }
          const noise = brown[rumble.read];
          const sample = (rumble.band
            ? lowPassStep(rumble.lowPass[1], lowPassStep(rumble.lowPass[0], bandPass(rumble.filter, noise)))
            : highPassStep(rumble.highPass[1], highPassStep(rumble.highPass[0], lowPassStep(rumble.filter, noise)))) * rumble.level * envelope;
          rumble.read = rumble.read + 1 === brown.length ? 0 : rumble.read + 1;
          const rolled = sample * (rumble.band ? boomRoll : bodyRoll);
          sumLeft += rolled * rumble.gainLeft;
          sumRight += rolled * rumble.gainRight;
          rumble.age += 1;
        }
        const volume = faderGain(Math.max(0, Math.min(1, channel.volume + peal.volumeOffset))) * (channel.kindGain ?? 1);
        directLeft += sumLeft * volume * peal.direct;
        directRight += sumRight * volume * peal.direct;
        wetLeft += sumLeft * volume * peal.send;
        wetRight += sumRight * volume * peal.send;
        if (live === 0 && peal.next === peal.rumbles.length) {
          channel.peals[pealIndex] = channel.peals[channel.peals.length - 1];
          channel.peals.pop();
        }
      }
      const contrast = Math.max(-1, Math.min(1, (channel.contrast ?? 0) + (channel.contrastOffset ?? 0)));
      if (contrast !== 0) {
        // Followed as power, so the exponent on the ratio is halved.
        const power = 0.5 * ((directLeft * directLeft) + (directRight * directRight));
        const follow = channel.contrastFollow;
        follow.level += (power - follow.level) * follow.rate;
        follow.pivot += (follow.level - follow.pivot) * (follow.level > follow.pivot ? follow.rise : follow.fall);
        if (follow.pivot > 1e-12) {
          const gain = Math.max(THUNDER_CONTRAST_GAIN[0], Math.min(THUNDER_CONTRAST_GAIN[1],
            (follow.level / follow.pivot) ** (0.5 * contrast * THUNDER_CONTRAST_EXPONENT)));
          directLeft *= gain;
          directRight *= gain;
          wetLeft *= gain;
          wetRight *= gain;
        }
      }
      const highPass = channel.highPass;
      left[index] = highPassStep(highPass[0], directLeft);
      right[index] = highPassStep(highPass[1], directRight);
      sendLeft[index] = highPassStep(highPass[2], wetLeft);
      sendRight[index] = highPassStep(highPass[3], wetRight);
    }
  }


  // -------------------------------------------------------------------------
  // Bursts: short noise bursts through a resonant band, shared by the fire's
  // crackles and pops and the chimes' strike clicks.

  /**
   * Queue one burst `offset` frames into the current block (an offset past
   * the block carries into the next; see renderBursts). `spec` gives the
   * band's centre and Q ranges, the decay range and the level range; the
   * burst is placed at `pan` (-1..1).
   */
  spawnBurst(bursts, max, offset, spec, levelScale, pan) {
    if (bursts.length >= max) return;
    const q = this.between(spec.q);
    const gains = panGains(pan);
    bursts.push({
      amplitude: this.between(spec.level) * levelScale,
      decay: Math.exp(-1 / (sampleRate * this.between(spec.decaySec))),
      filter: stateVariableFilter(spec.hz[0] * ((spec.hz[1] / spec.hz[0]) ** this.random()), q),
      k: 1 / q,
      seed: Math.floor(this.random() * 0x100000000) >>> 0,
      startOffset: Math.max(0, offset),
      gainLeft: gains.left,
      gainRight: gains.right,
    });
  }

  /** Every queued burst for this block, added into `left`/`right`; spent ones are dropped. */
  renderBursts(bursts, left, right, length) {
    for (let index = bursts.length - 1; index >= 0; index -= 1) {
      const burst = bursts[index];
      if (burst.startOffset >= length) {
        burst.startOffset -= length;
        continue;
      }
      const filter = burst.filter;
      let amplitude = burst.amplitude;
      let seed = burst.seed;
      const decay = burst.decay;
      const k = burst.k;
      for (let frame = burst.startOffset; frame < length; frame += 1) {
        let x = 0;
        if (amplitude > 0) {
          seed = (1664525 * seed + 1013904223) >>> 0;
          x = ((seed / 0x100000000) * 2 - 1) * amplitude;
          amplitude *= decay;
          if (amplitude < SILENCE) amplitude = 0;
        }
        const y = bandPass(filter, x) * k;
        left[frame] += y * burst.gainLeft;
        right[frame] += y * burst.gainRight;
      }
      burst.startOffset = 0;
      burst.amplitude = amplitude;
      burst.seed = seed;
      if (amplitude <= 0 && Math.abs(filter.s1) + Math.abs(filter.s2) <= SILENCE) {
        bursts[index] = bursts[bursts.length - 1];
        bursts.pop();
      }
    }
  }

  /**
   * A slowly wandering level (a flame's flutter, the hiss's flicker, the
   * water's bursts): toward a target drawn every `sec` range, gliding with a
   * one-pole of `glideSec`, moved on by one control segment. Returns the
   * level at the segment's start and end, for a linear ramp across it.
   */
  stepWander(wander, secRange, glideSec, draw) {
    const length = CONTROL_FRAMES;
    const from = wander.value;
    wander.framesLeft -= length;
    if (wander.framesLeft <= 0) {
      wander.target = draw();
      wander.framesLeft = Math.max(1, Math.round(this.between(secRange) * sampleRate));
    }
    wander.value += (wander.target - wander.value) * (1 - Math.exp(-length / (glideSec * sampleRate)));
    return [from, wander.value];
  }

  /**
   * Walk a block in spans that never cross a CONTROL_FRAMES boundary of the
   * channel's OWN clock (counted from its first sample, as a noise layer's
   * segments are), calling `begin()` at each boundary and `span(offset,
   * count, position)` for each piece, `position` being how far into its
   * segment the piece starts. Control values computed in `begin` therefore
   * change on the same frames whatever the block size.
   */
  forEachSegment(channel, length, begin, span) {
    let offset = 0;
    while (offset < length) {
      if (!(channel.segmentLeft > 0)) {
        begin();
        channel.segmentLeft = CONTROL_FRAMES;
      }
      const count = Math.min(channel.segmentLeft, length - offset);
      span(offset, count, CONTROL_FRAMES - channel.segmentLeft);
      offset += count;
      channel.segmentLeft -= count;
    }
  }

  // -------------------------------------------------------------------------
  // Water.

  initWater(channel) {
    channel.bubbles = [];
    channel.nextBubbleFrame = currentFrame + 1;
    channel.burst = { value: 1, target: 1, framesLeft: 0 };
    channel.rushStart = this.random();
    channel.rushRead = -1;
    channel.rushLeft = null;
    channel.rushRight = null;
    this.configureWater(channel);
  }

  /** The rush's band follows the bubble size: bigger water, lower rush. Filter memory is kept. */
  configureWater(channel) {
    const size = Math.max(0, Math.min(1, channel.size ?? 0.5));
    const centre = WATER_RUSH_HZ[0] * ((WATER_RUSH_HZ[1] / WATER_RUSH_HZ[0]) ** size);
    const left = stateVariableFilter(centre, 0.6);
    const right = stateVariableFilter(centre, 0.6);
    if (channel.rushLeft) {
      left.s1 = channel.rushLeft.s1;
      left.s2 = channel.rushLeft.s2;
      right.s1 = channel.rushRight.s1;
      right.s2 = channel.rushRight.s2;
    }
    channel.rushLeft = left;
    channel.rushRight = right;
    channel.radiusMinMm = WATER_RADIUS_MIN_MM[0] * ((WATER_RADIUS_MIN_MM[1] / WATER_RADIUS_MIN_MM[0]) ** size);
    channel.radiusMaxMm = WATER_RADIUS_MAX_MM[0] * ((WATER_RADIUS_MAX_MM[1] / WATER_RADIUS_MAX_MM[0]) ** size);
  }

  /**
   * A bubble radius from p(r) ~ r^-WATER_RADIUS_EXPONENT between the layer's
   * bounds, by inverting its cumulative distribution.
   */
  waterRadius(channel) {
    const low = channel.radiusMinMm;
    const high = channel.radiusMaxMm;
    const e = 1 - WATER_RADIUS_EXPONENT;
    const u = this.random();
    return ((low ** e) + (u * ((high ** e) - (low ** e)))) ** (1 / e);
  }

  /**
   * A water layer's block, written into `left`/`right` (overwritten). The
   * burst process multiplies the bubble rate by a log-normal factor of mean
   * 1 -- flat at turbulence 0, clumped into bursts and gaps at 1 -- so the
   * average flow is what `flow` says whatever the turbulence.
   */
  renderWater(channel, left, right, blockStart, length) {
    left.fill(0, 0, length);
    right.fill(0, 0, length);
    const sigma = Math.max(0, Math.min(1, channel.turbulence ?? 0)) * WATER_BURST_SIGMA;
    const flow = Math.max(0, Math.min(1, channel.flow ?? 0.5));
    const baseRate = WATER_BUBBLES_PER_SEC[0] * ((WATER_BUBBLES_PER_SEC[1] / WATER_BUBBLES_PER_SEC[0]) ** flow);
    const image = stereoImage(channel.pan, 1);
    const pink = this.noiseLoop('pink');
    const loopLength = pink.length;
    if (channel.rushRead < 0 || channel.rushRead >= loopLength) channel.rushRead = Math.floor(channel.rushStart * loopLength) % loopLength;
    const half = Math.floor(loopLength / 2);
    const rushBase = WATER_RUSH_LEVEL * (flow ** 1.2) * (this.noiseGains.pink ?? 1);
    const rushK = 1 / 0.6;
    if (channel.nextBubbleFrame < blockStart) channel.nextBubbleFrame = blockStart + this.eventDelayFrames(baseRate);
    let burstFrom = 1;
    let burstTo = 1;
    this.forEachSegment(channel, length, () => {
      [burstFrom, burstTo] = this.stepWander(channel.burst, [WATER_BURST_SEC * 0.3, WATER_BURST_SEC * 1.7], WATER_BURST_GLIDE_SEC, () => {
        if (sigma <= 0) return 1;
        // Box-Muller: one standard normal from two uniforms.
        const gaussian = Math.sqrt(-2 * Math.log(Math.max(1e-9, this.random()))) * Math.cos(2 * Math.PI * this.random());
        return Math.exp((sigma * gaussian) - ((sigma * sigma) / 2));
      });
    }, (offset, count, position) => {
      const rate = baseRate * burstTo;
      const spanEnd = blockStart + offset + count;
      while (channel.nextBubbleFrame < spanEnd) {
        const radius = this.waterRadius(channel);
        const place = image.from + ((image.to - image.from) * this.random());
        const bubble = this.makeBubble(radius, 0.6 + (0.4 * this.random()));
        if (channel.bubbles.length < MAX_WATER_BUBBLES) {
          const gains = panGains(place);
          bubble.age = 0;
          bubble.startOffset = channel.nextBubbleFrame - blockStart;
          bubble.gainLeft = gains.left;
          bubble.gainRight = gains.right;
          channel.bubbles.push(bubble);
        }
        channel.nextBubbleFrame += this.eventDelayFrames(rate);
      }
      // The rush: pink noise, band-passed low, breathing with the bursts.
      let read = channel.rushRead;
      for (let step = 0; step < count; step += 1) {
        const burst = burstFrom + ((burstTo - burstFrom) * ((position + step) / CONTROL_FRAMES));
        const level = rushBase * Math.sqrt(burst);
        const readRight = read + half >= loopLength ? read + half - loopLength : read + half;
        left[offset + step] += bandPass(channel.rushLeft, pink[read]) * rushK * level;
        right[offset + step] += bandPass(channel.rushRight, pink[readRight]) * rushK * level;
        read = read + 1 === loopLength ? 0 : read + 1;
      }
      channel.rushRead = read;
    });
    const bubbles = channel.bubbles;
    for (let index = bubbles.length - 1; index >= 0; index -= 1) {
      const bubble = bubbles[index];
      const start = bubble.startOffset;
      bubble.startOffset = 0;
      const end = Math.min(length, start + (bubble.ringFrames - bubble.age));
      let sin = bubble.sin;
      let cos = bubble.cos;
      let rotationSin = bubble.rotationSin;
      let rotationCos = bubble.rotationCos;
      let amplitude = bubble.amplitude;
      let framesToRetune = bubble.framesToRetune;
      const decay = bubble.decay;
      const gainLeft = bubble.gainLeft;
      const gainRight = bubble.gainRight;
      for (let frame = start; frame < end; frame += 1) {
        const sample = sin * amplitude;
        left[frame] += sample * gainLeft;
        right[frame] += sample * gainRight;
        const nextSin = (sin * rotationCos) + (cos * rotationSin);
        cos = (cos * rotationCos) - (sin * rotationSin);
        sin = nextSin;
        amplitude *= decay;
        framesToRetune -= 1;
        if (framesToRetune === 0) {
          framesToRetune = BUBBLE_RETUNE_FRAMES;
          bubble.frequency = Math.min(bubble.frequency * bubble.retuneFactor, sampleRate * 0.45);
          const angle = (2 * Math.PI * bubble.frequency) / sampleRate;
          rotationSin = Math.sin(angle);
          rotationCos = Math.cos(angle);
        }
      }
      bubble.sin = sin;
      bubble.cos = cos;
      bubble.rotationSin = rotationSin;
      bubble.rotationCos = rotationCos;
      bubble.amplitude = amplitude;
      bubble.framesToRetune = framesToRetune;
      bubble.age += end - start;
      if (bubble.age >= bubble.ringFrames || amplitude < VOICE_SILENCE) {
        bubbles[index] = bubbles[bubbles.length - 1];
        bubbles.pop();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Fire.

  initFire(channel) {
    channel.bursts = [];
    channel.flutter = { value: 1, target: 1, framesLeft: 0 };
    channel.flicker = { value: 1, target: 1, framesLeft: 0 };
    channel.fireStart = this.random();
    channel.fireRead = -1;
    channel.roarLeft = null;
    channel.roarRight = null;
    channel.hissLeft = stateVariableFilter(FIRE_HISS_HZ, Math.SQRT1_2);
    channel.hissRight = stateVariableFilter(FIRE_HISS_HZ, Math.SQRT1_2);
    channel.nextCrackleFrame = currentFrame + this.eventDelayFrames(this.fireCrackleRate(channel));
    channel.nextPopFrame = Infinity;
    this.configureFire(channel, null);
  }

  /** The fire's size now (the slider, fanned by the weather). */
  fireSize(channel) {
    return Math.max(0, Math.min(1, (channel.size ?? 0.5) + (WEATHER_FIRE_REACH * this.weatherFactor(channel))));
  }

  fireCrackleRate(channel) {
    const crackle = Math.max(0, Math.min(1, (channel.crackle ?? 0.5) + (WEATHER_FIRE_REACH * this.weatherFactor(channel))));
    return FIRE_CRACKLES_PER_SEC[0] * ((FIRE_CRACKLES_PER_SEC[1] / FIRE_CRACKLES_PER_SEC[0]) ** crackle);
  }

  /** The roar's cutoff follows the size: a bigger fire roars lower. Filter memory is kept. */
  configureFire(channel, before) {
    const cutoff = FIRE_ROAR_HZ[0] * ((FIRE_ROAR_HZ[1] / FIRE_ROAR_HZ[0]) ** Math.max(0, Math.min(1, channel.size ?? 0.5)));
    const left = stateVariableFilter(cutoff, 0.8);
    const right = stateVariableFilter(cutoff, 0.8);
    if (channel.roarLeft) {
      left.s1 = channel.roarLeft.s1;
      left.s2 = channel.roarLeft.s2;
      right.s1 = channel.roarRight.s1;
      right.s2 = channel.roarRight.s2;
    }
    channel.roarLeft = left;
    channel.roarRight = right;
    if (!before || before.pops !== channel.pops) {
      const rate = (channel.pops ?? 0) * FIRE_POPS_PER_SEC;
      channel.nextPopFrame = rate > 0 ? currentFrame + this.eventDelayFrames(rate) : Infinity;
    }
  }

  /**
   * A fire layer's block, written into `left`/`right` (overwritten).
   * Crackles and pops are born in time order, whichever clock is next, so
   * the stream is drawn in the same order whatever the block size (the rule
   * rain's drops and drips follow).
   */
  renderFire(channel, left, right, blockStart, length) {
    left.fill(0, 0, length);
    right.fill(0, 0, length);
    const image = stereoImage(channel.pan, 1);
    const placeAt = () => image.from + ((image.to - image.from) * this.random());
    const crackleRate = this.fireCrackleRate(channel);
    const popRate = (channel.pops ?? 0) * FIRE_POPS_PER_SEC;
    if (channel.nextCrackleFrame < blockStart) channel.nextCrackleFrame = blockStart + this.eventDelayFrames(crackleRate);
    if (channel.nextPopFrame < blockStart) channel.nextPopFrame = popRate > 0 ? blockStart + this.eventDelayFrames(popRate) : Infinity;
    const size = this.fireSize(channel);
    const roarLevel = FIRE_ROAR_LEVEL[0] * ((FIRE_ROAR_LEVEL[1] / FIRE_ROAR_LEVEL[0]) ** size) * (this.noiseGains.brown ?? 1);
    const hissLevel = (FIRE_HISS_LEVEL[0] + ((FIRE_HISS_LEVEL[1] - FIRE_HISS_LEVEL[0]) * size)) * (this.noiseGains.white ?? 1);
    const brown = this.noiseLoop('brown');
    const white = this.noiseLoop('white');
    const loopLength = Math.min(brown.length, white.length);
    if (channel.fireRead < 0 || channel.fireRead >= loopLength) channel.fireRead = Math.floor(channel.fireStart * loopLength) % loopLength;
    const half = Math.floor(loopLength / 2);
    let flutterFrom = 1;
    let flutterTo = 1;
    let flickerFrom = 1;
    let flickerTo = 1;
    this.forEachSegment(channel, length, () => {
      [flutterFrom, flutterTo] = this.stepWander(channel.flutter, FIRE_FLUTTER_SEC, 0.02, () => this.between(FIRE_FLUTTER_RANGE));
      [flickerFrom, flickerTo] = this.stepWander(channel.flicker, FIRE_HISS_FLICKER_SEC, 0.008, () => this.between(FIRE_FLUTTER_RANGE));
    }, (offset, count, position) => {
      // Crackles and pops are born in time order, whichever clock is next,
      // so the stream is drawn in the same order whatever the block size
      // (the rule rain's drops and drips follow).
      const spanEnd = blockStart + offset + count;
      for (;;) {
        const isPop = channel.nextPopFrame < channel.nextCrackleFrame;
        const at = isPop ? channel.nextPopFrame : channel.nextCrackleFrame;
        if (at >= spanEnd) break;
        const burstOffset = at - blockStart;
        if (isPop) {
          this.spawnBurst(channel.bursts, MAX_FIRE_BURSTS, burstOffset, FIRE_POP, 1, placeAt());
          // The sizzle: a few crackles over the next moments, sap boiling out.
          const sizzle = Math.round(this.between(FIRE_POP.sizzle));
          const sizzleFrames = this.between(FIRE_POP.sizzleSec) * sampleRate;
          for (let spark = 0; spark < sizzle; spark += 1) {
            this.spawnBurst(channel.bursts, MAX_FIRE_BURSTS, burstOffset + Math.round(this.random() * sizzleFrames), FIRE_CRACKLE, 0.5, placeAt());
          }
          channel.nextPopFrame += this.eventDelayFrames(popRate);
        } else {
          // Loudness is skewed low: most crackles are faint, a few are sharp.
          const skew = this.random();
          this.spawnBurst(channel.bursts, MAX_FIRE_BURSTS, burstOffset, FIRE_CRACKLE, 0.25 + (0.75 * skew * skew), placeAt());
          channel.nextCrackleFrame += this.random() < FIRE_CRACKLE_CLUSTER_CHANCE
            ? Math.max(1, Math.round(this.between(FIRE_CRACKLE_CLUSTER_SEC) * sampleRate))
            : this.eventDelayFrames(crackleRate);
        }
      }
      // The roar and the hiss.
      let read = channel.fireRead;
      for (let step = 0; step < count; step += 1) {
        const t = (position + step) / CONTROL_FRAMES;
        const flutter = flutterFrom + ((flutterTo - flutterFrom) * t);
        const flicker = flickerFrom + ((flickerTo - flickerFrom) * t);
        const readRight = read + half >= loopLength ? read + half - loopLength : read + half;
        const roar = roarLevel * flutter;
        const hiss = hissLevel * flicker * flicker;
        const frame = offset + step;
        left[frame] += (lowPassStep(channel.roarLeft, brown[read]) * roar) + (highPassStep(channel.hissLeft, white[readRight]) * hiss);
        right[frame] += (lowPassStep(channel.roarRight, brown[readRight]) * roar) + (highPassStep(channel.hissRight, white[read]) * hiss);
        read = read + 1 === loopLength ? 0 : read + 1;
      }
      channel.fireRead = read;
    });
    this.renderBursts(channel.bursts, left, right, length);
  }

  // -------------------------------------------------------------------------
  // Chimes.

  /**
   * Build or retune a chimes layer's tubes. A tube keeps its oscillators'
   * state (phase and ring) through a retune, so moving pitch or ring length
   * while tubes are sounding bends them rather than cutting them off. Each
   * tube draws its detune and its modes' doublet splits once, when it is
   * first made, so it is the same object for as long as the layer lives.
   */
  configureChimes(channel, before) {
    const frequencies = channel.tubeHz ?? [];
    const old = channel.tubeState ?? [];
    const ringSec = Math.max(0.1, channel.ringSec ?? 6);
    const image = stereoImage(channel.pan, 1);
    channel.tubeState = frequencies.map((hz, index) => {
      const tube = old[index] ?? {
        detune: 2 ** ((CHIME_DETUNE_CENTS * ((this.random() * 2) - 1)) / 1200),
        splits: CHIME_MODE_RATIOS.map(() => this.between(CHIME_DOUBLET_HZ)),
        placement: (index + 0.25 + (0.5 * this.random())) / Math.max(1, frequencies.length),
        oscillators: CHIME_MODE_RATIOS.flatMap(() => [0, 1].map(() => ({ sin: 0, cos: 1, rotationSin: 0, rotationCos: 1, amplitude: 0, decay: 1, audible: true }))),
        active: false,
      };
      const fundamental = hz * tube.detune;
      CHIME_MODE_RATIOS.forEach((ratio, mode) => {
        const decay = Math.exp(-6.9078 / (ringSec * (ratio ** -CHIME_MODE_DECAY_EXPONENT) * sampleRate));
        [0, 1].forEach((half) => {
          const oscillator = tube.oscillators[(mode * 2) + half];
          const frequency = (fundamental * ratio) + (half === 1 ? tube.splits[mode] : 0);
          oscillator.audible = frequency < sampleRate * 0.45;
          const angle = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
          oscillator.rotationSin = Math.sin(angle);
          oscillator.rotationCos = Math.cos(angle);
          oscillator.decay = decay;
          if (!oscillator.audible) oscillator.amplitude = 0;
        });
      });
      tube.pan = image.from + ((image.to - image.from) * tube.placement);
      const gains = panGains(tube.pan);
      tube.gainLeft = gains.left;
      tube.gainRight = gains.right;
      return tube;
    });
    if (!channel.bursts) channel.bursts = [];
    if (!before || before.activity !== channel.activity || !Number.isFinite(channel.nextStrikeFrame)) {
      channel.nextStrikeFrame = currentFrame + this.eventDelayFrames(this.chimeStrikeRate(channel));
    }
    if (!channel.bounce) channel.bounce = { frame: Infinity, tube: 0 };
  }

  chimeStrikeRate(channel) {
    const [low, high] = channel.strikeRange ?? [0.05, 4];
    const activity = Math.max(0, Math.min(1, channel.activity ?? 0.3));
    return low * ((high / low) ** activity) * (2 ** (WEATHER_CHIME_RATE_OCTAVES * this.weatherFactor(channel)));
  }

  /**
   * Strike a tube. A strike is an impulse: it starts each mode from rest at
   * zero displacement, so it is ADDED to what the mode is already doing as a
   * phasor -- (amplitude x cos, amplitude x sin) plus (strike, 0) -- which
   * leaves the output at that instant exactly where it was: no click, and a
   * second strike on a ringing tube reinforces or partly cancels it, as it
   * does on a real one. A hard clapper excites the upper modes; a soft one
   * mostly the fundamental.
   */
  strikeTube(channel, tube, force) {
    const hardness = Math.max(0, Math.min(1, channel.hardness ?? 0.5));
    CHIME_MODE_RATIOS.forEach((ratio, mode) => {
      const weight = CHIME_MODE_WEIGHTS[mode] * (ratio ** (-(1 - hardness) * CHIME_SOFT_TILT)) * force * (0.8 + (0.4 * this.random()));
      const share = 0.35 + (0.3 * this.random());
      [share, 1 - share].forEach((part, half) => {
        const oscillator = tube.oscillators[(mode * 2) + half];
        if (!oscillator.audible) return;
        const x = (oscillator.amplitude * oscillator.cos) + (weight * part);
        const y = oscillator.amplitude * oscillator.sin;
        const amplitude = Math.hypot(x, y);
        oscillator.amplitude = amplitude;
        oscillator.sin = amplitude > 0 ? y / amplitude : 0;
        oscillator.cos = amplitude > 0 ? x / amplitude : 1;
      });
    });
    tube.active = true;
  }

  /** The tubes, from frame `from` to `to` of the block, added into `left`/`right`. */
  renderTubes(channel, left, right, from, to) {
    for (const tube of channel.tubeState) {
      if (!tube.active) continue;
      const oscillators = tube.oscillators;
      let loudest = 0;
      for (const oscillator of oscillators) {
        if (oscillator.amplitude <= VOICE_SILENCE) {
          oscillator.amplitude = 0;
          continue;
        }
        let sin = oscillator.sin;
        let cos = oscillator.cos;
        let amplitude = oscillator.amplitude;
        const rotationSin = oscillator.rotationSin;
        const rotationCos = oscillator.rotationCos;
        const decay = oscillator.decay;
        const gainLeft = tube.gainLeft;
        const gainRight = tube.gainRight;
        for (let frame = from; frame < to; frame += 1) {
          const sample = sin * amplitude;
          left[frame] += sample * gainLeft;
          right[frame] += sample * gainRight;
          const nextSin = (sin * rotationCos) + (cos * rotationSin);
          cos = (cos * rotationCos) - (sin * rotationSin);
          sin = nextSin;
          amplitude *= decay;
        }
        oscillator.sin = sin;
        oscillator.cos = cos;
        oscillator.amplitude = amplitude;
        loudest = Math.max(loudest, amplitude);
      }
      if (loudest <= VOICE_SILENCE) tube.active = false;
    }
  }

  /**
   * A chimes layer's block, written into `left`/`right` (overwritten). The
   * clapper strikes at a rate `activity` sets and the weather moves; after a
   * strike it may bounce onto a neighbouring tube. The tubes are rendered in
   * segments between strikes, so each strike lands on its own frame and the
   * sound does not depend on the block size.
   */
  renderChimes(channel, left, right, blockStart, length) {
    left.fill(0, 0, length);
    right.fill(0, 0, length);
    const tubes = channel.tubeState;
    const blockEnd = blockStart + length;
    const rate = this.chimeStrikeRate(channel);
    const factor = this.weatherFactor(channel);
    if (channel.nextStrikeFrame < blockStart) channel.nextStrikeFrame = blockStart + this.eventDelayFrames(rate);
    if (channel.bounce.frame < blockStart) channel.bounce.frame = Infinity;
    let position = 0;
    for (;;) {
      const isBounce = channel.bounce.frame < channel.nextStrikeFrame;
      const at = isBounce ? channel.bounce.frame : channel.nextStrikeFrame;
      if (at >= blockEnd) break;
      const offset = at - blockStart;
      this.renderTubes(channel, left, right, position, offset);
      position = offset;
      if (tubes.length > 0) {
        const index = isBounce ? channel.bounce.tube : Math.floor(this.random() * tubes.length);
        const force = Math.max(0.05, this.between(CHIME_STRIKE_FORCE) * (1 + (WEATHER_CHIME_FORCE * factor)) * (isBounce ? 0.5 : 1));
        this.strikeTube(channel, tubes[index], force);
        // The clapper's tick, as bright as it is hard.
        this.spawnBurst(channel.bursts, 16, offset, CHIME_CLICK, force * (channel.hardness ?? 0.5), tubes[index].pan);
        if (!isBounce && tubes.length > 1 && this.random() < CHIME_BOUNCE_CHANCE) {
          const neighbour = index === 0 ? 1 : index === tubes.length - 1 ? index - 1 : index + (this.random() < 0.5 ? -1 : 1);
          channel.bounce = { frame: at + Math.max(1, Math.round(this.between(CHIME_BOUNCE_SEC) * sampleRate)), tube: neighbour };
        } else if (isBounce) {
          channel.bounce = { frame: Infinity, tube: 0 };
        }
      }
      if (!isBounce) channel.nextStrikeFrame += this.eventDelayFrames(rate);
    }
    this.renderTubes(channel, left, right, position, length);
    this.renderBursts(channel.bursts, left, right, length);
  }


  /**
   * One block. Each layer is rendered whole into scratch, from its own
   * random stream, and placed (placeLayer) into the direct and send outputs;
   * thunder writes its own direct and send. A layer that is not the soloed
   * one is still rendered, so its voices and clocks keep running and
   * un-soloing does not restart it. A layer at gain 0 is not rendered at
   * all: nothing it would render could be heard, so its clocks pause and
   * resume from where they stood.
   */
  process(_inputs, outputs) {
    const direct = outputs[0];
    const send = outputs[1];
    const length = direct[0].length;
    for (const output of outputs) {
      for (const outputChannel of output) outputChannel.fill(0);
    }
    if (!this.scratchLeft || this.scratchLeft.length < length) {
      this.scratchLeft = new Float64Array(length);
      this.scratchRight = new Float64Array(length);
      this.scratchSendLeft = new Float64Array(length);
      this.scratchSendRight = new Float64Array(length);
    }
    const left = this.scratchLeft;
    const right = this.scratchRight;
    this.advanceWeather(length);

    for (const channel of this.channels) {
      if (!(channel.gain > 0)) continue;
      const audible = this.soloChannelId === null || channel.id === this.soloChannelId;
      this.stream = channel.stream;
      switch (channel.kind) {
        case 'noise':
          this.renderNoise(channel, left, right, length);
          break;
        case 'rain':
          this.renderRain(channel, left, right, currentFrame, length);
          break;
        case 'water':
          this.renderWater(channel, left, right, currentFrame, length);
          break;
        case 'fire':
          this.renderFire(channel, left, right, currentFrame, length);
          break;
        case 'chimes':
          this.renderChimes(channel, left, right, currentFrame, length);
          break;
        case 'thunder': {
          this.renderThunder(channel, left, right, this.scratchSendLeft, this.scratchSendRight, length);
          if (!audible) continue;
          const directLeft = direct[0];
          const directRight = direct[1] ?? directLeft;
          for (let index = 0; index < length; index += 1) {
            directLeft[index] += left[index];
            if (directRight !== directLeft) directRight[index] += right[index];
          }
          if (send?.[0]) {
            const sendLeft = send[0];
            const sendRight = send[1] ?? sendLeft;
            for (let index = 0; index < length; index += 1) {
              sendLeft[index] += this.scratchSendLeft[index];
              if (sendRight !== sendLeft) sendRight[index] += this.scratchSendRight[index];
            }
          }
          continue;
        }
        default:
          continue;
      }
      if (audible) this.placeLayer(channel, left, right, length, direct, send);
    }
    this.stream = this.rootStream;
    return true;
  }
}

registerProcessor('ambient-generator', AmbientGenerator);
