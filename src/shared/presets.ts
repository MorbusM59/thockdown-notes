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
  renderScrollDynamic: 1.5,
  renderScrollResponsiveness: 0.6,
  renderScrollTotalTimeSec: 0.4,
  renderScrollMaxSpeedPxPerSec: 6000,
  renderScrollSkew: 0.5,
  glazeMode: 'none',
  darkMode: 'none',
  filterInvert: 0,
  filterSepia: 0,
  filterHueRotate: 0,
  filterBrightness: 1,
  filterContrast: 1,
  filterSaturate: 0.5,
  filterColorize: 0,
  highlightColors: {
    caret: 'rgba(120, 115, 112, 0.8)',
    search: 'rgba(255, 221, 105, 0.55)',
    selection: 'rgba(199, 94, 0, 0.49)',
    background: '#e9e6e3',
    topBackground: 'rgba(196, 187, 182, 0.49)',
    bottomBackground: 'rgba(196, 187, 182, 0.49)',
    gridOutline: '#00000022',
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
  { ...NEUTRAL_BASE, glazeMode: 'light', filterBrightness: 1.1 },
];

export const DARK_FACTORY_PRESETS: UiLayoutLoadout[] = [
  { ...NEUTRAL_BASE, filterInvert: 1 },
  { ...NEUTRAL_BASE, filterInvert: 1, filterSepia: 0.3, filterHueRotate: 200, filterSaturate: 0.6 },
  { ...NEUTRAL_BASE, filterInvert: 1, filterContrast: 1.1, filterBrightness: 0.85 },
  { ...NEUTRAL_BASE, filterInvert: 1, filterSepia: 0.5, filterHueRotate: 280, filterSaturate: 0.7 },
  { ...NEUTRAL_BASE, filterInvert: 1, glazeMode: 'medium', filterBrightness: 0.8 },
];

if (LIGHT_FACTORY_PRESETS.length !== 5 || DARK_FACTORY_PRESETS.length !== 5) {
  throw new Error('Expected exactly 5 factory presets per mode.');
}
