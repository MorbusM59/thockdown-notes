// Factory presets and default-custom loadouts for the Presets / Custom
// Presets system. Every value here is a complete, valid UiLayoutLoadout so
// the UI is fully functional immediately — content is placeholder and
// expected to be redesigned later.
//
// Naming maps directly onto the loadout ID scheme in loadouts.ts:
//   LIGHT_FACTORY_PRESETS[0..4]  -> light ids +1..+5
//   DARK_FACTORY_PRESETS[0..4]   -> dark ids  -1..-5
//   DEFAULT_CUSTOM_LIGHT         -> light id  +6
//   DEFAULT_CUSTOM_DARK          -> dark id   -6

import { DEFAULT_TEXTURE_MATERIALS } from '../textures/types';
import { DEFAULT_GLAZE_SETTINGS } from './glaze';
import type { UiLayoutLoadout } from './loadouts';

// A neutral, untextured, unfiltered baseline shared by both default-custom
// loadouts. Dark mode's default-custom is this base with filterInvert = 1.
const NEUTRAL_BASE: UiLayoutLoadout = {
  viewStyle: 'modern',
  viewFontSize: 'm',
  viewSpacing: 'cozy',
  editorStyle: 'syne',
  editorFontSize: 'm',
  editorSpacing: 'cozy',
  editorGlyphPaddingPx: 1,
  audioKeyVolume: 0.5,
  audioBassVolume: 0,
  audioTrebleVolume: 0,
  audioReverbStrength: 0,
  audioReverbSpace: 0,
  typingSoundEnabled: false,
  typingSoundSet: 'A',
  renderScrollDynamic: 3,
  renderScrollResponsiveness: 1,
  renderScrollTotalTimeSec: 0.4,
  renderScrollMaxSpeedPxPerSec: 20000,
  renderScrollSkew: 0.5,
  glaze: DEFAULT_GLAZE_SETTINGS,
  darkMode: 'none',
  filterInvert: 0,
  filterSepia: 0,
  filterHueRotate: 0,
  filterBrightness: 1,
  filterContrast: 1,
  filterSaturate: 0.5,
  filterColorize: 0,
  highlightColors: {
    caret: 'rgba(0, 0, 0, 0.3)',
    search: 'rgba(255, 221, 105, 0.55)',
    selection: 'rgba(0, 0, 0, 0.1)',
    background: 'rgba(196, 187, 182, 0.2)',
    topBackground: 'rgba(196, 187, 182, 0.3)',
    bottomBackground: 'rgba(196, 187, 182, 0.3)',
    gridOutline: '#00000022',
  },
  editorTextColors: {
    editorEditText: '#000000DD',
    editorRenderText: '#000000DD',
  },
  textureMaterials: DEFAULT_TEXTURE_MATERIALS,
};

export const DEFAULT_CUSTOM_LIGHT: UiLayoutLoadout = {
  ...NEUTRAL_BASE,
};

export const DEFAULT_CUSTOM_DARK: UiLayoutLoadout = {
  ...NEUTRAL_BASE,
  filterInvert: 1,
};

// --- Placeholder factory presets -------------------------------------------
// Each preset is the neutral base with a couple of distinguishing tweaks so
// they're visually distinct in the UI before real designs replace them.

export const LIGHT_FACTORY_PRESETS: UiLayoutLoadout[] = [
  { ...NEUTRAL_BASE },
  { ...NEUTRAL_BASE, filterSepia: 0.2, filterBrightness: 1.05 },
  { ...NEUTRAL_BASE, filterContrast: 1.15, filterSaturate: 0.7 },
  { ...NEUTRAL_BASE, filterHueRotate: 30, filterSaturate: 0.6 },
  { ...NEUTRAL_BASE, filterBrightness: 1.1, glaze: { ...NEUTRAL_BASE.glaze, linearStackCount: 2, radialCount: 1, bellyOpacity: 0.65 } },
];

export const DARK_FACTORY_PRESETS: UiLayoutLoadout[] = [
  { ...NEUTRAL_BASE, filterInvert: 1 },
  { ...NEUTRAL_BASE, filterInvert: 1, filterSepia: 0.3, filterHueRotate: 200, filterSaturate: 0.6 },
  { ...NEUTRAL_BASE, filterInvert: 1, filterContrast: 1.1, filterBrightness: 0.85 },
  { ...NEUTRAL_BASE, filterInvert: 1, filterSepia: 0.5, filterHueRotate: 280, filterSaturate: 0.7 },
  { ...NEUTRAL_BASE, filterInvert: 1, filterBrightness: 0.8, glaze: { ...NEUTRAL_BASE.glaze, linearStackCount: 4, radialCount: 2, linearOpacity: 0.15 } },
];

if (LIGHT_FACTORY_PRESETS.length !== 5 || DARK_FACTORY_PRESETS.length !== 5) {
  throw new Error('Expected exactly 5 factory presets per mode.');
}
