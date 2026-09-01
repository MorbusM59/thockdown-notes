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

import { DEFAULT_TEXTURE_MATERIALS, type TextureMaterialSettings, type TextureColorHsva } from '../textures/types';
import { DEFAULT_GLAZE_SETTINGS } from './glaze';
import { DEFAULT_CUSTOM_CURSOR_SETTINGS } from './cursorSettings';
import { DEFAULT_CARET_SETTINGS } from './caretSettings';
import type { UiLayoutLoadout } from './loadouts';

type PartialTextureMaterialSettings = Omit<Partial<TextureMaterialSettings>, 'color'> & {
  color?: Partial<TextureColorHsva>;
};

type UiLayoutLoadoutNestedOverrides = {
  glaze?: Partial<UiLayoutLoadout['glaze']>;
  highlightColors?: Partial<UiLayoutLoadout['highlightColors']>;
  editorTextColors?: Partial<UiLayoutLoadout['editorTextColors']>;
  textureMaterials?: Partial<{
    appGrid?: PartialTextureMaterialSettings;
    sidebarContent?: PartialTextureMaterialSettings;
    editorEditText?: PartialTextureMaterialSettings;
    editorRenderText?: PartialTextureMaterialSettings;
  }>;
};

type UiLayoutLoadoutOverrides = Partial<Omit<UiLayoutLoadout, 'glaze' | 'highlightColors' | 'editorTextColors' | 'textureMaterials'>> & UiLayoutLoadoutNestedOverrides;

function mergeTextureMaterialSettings(
  base: TextureMaterialSettings,
  override: PartialTextureMaterialSettings | undefined,
) {
  return {
    enabled: override?.enabled ?? base.enabled,
    seed: override?.seed ?? base.seed,
    granularity: override?.granularity ?? base.granularity,
    vSteps: override?.vSteps ?? base.vSteps,
    color: {
      h: override?.color?.h ?? base.color.h,
      s: override?.color?.s ?? base.color.s,
      v: override?.color?.v ?? base.color.v,
      a: override?.color?.a ?? base.color.a,
    },
  };
}

function buildPreset(overrides: UiLayoutLoadoutOverrides): UiLayoutLoadout {
  return {
    ...NEUTRAL_BASE,
    ...overrides,
    glaze: {
      ...NEUTRAL_BASE.glaze,
      ...overrides.glaze,
    },
    highlightColors: {
      ...NEUTRAL_BASE.highlightColors,
      ...overrides.highlightColors,
    },
    editorTextColors: {
      ...NEUTRAL_BASE.editorTextColors,
      ...overrides.editorTextColors,
    },
    textureMaterials: {
      appGrid: mergeTextureMaterialSettings(DEFAULT_TEXTURE_MATERIALS.appGrid, overrides.textureMaterials?.appGrid),
      sidebarContent: mergeTextureMaterialSettings(DEFAULT_TEXTURE_MATERIALS.sidebarContent, overrides.textureMaterials?.sidebarContent),
      editorEditText: mergeTextureMaterialSettings(DEFAULT_TEXTURE_MATERIALS.editorEditText, overrides.textureMaterials?.editorEditText),
      editorRenderText: mergeTextureMaterialSettings(DEFAULT_TEXTURE_MATERIALS.editorRenderText, overrides.textureMaterials?.editorRenderText),
    },
  };
}

// A neutral, untextured, unfiltered baseline shared by both default-custom
// loadouts. Dark mode's default-custom is this base with filterInvert = 1.
export const NEUTRAL_BASE: UiLayoutLoadout = {
  borderRadiusRegularPx: 6,
  spacingRegularPx: 4,
  borderAlphaPercent: 100,
  boxShadowAlphaPercent: 100,
  audioKeyVolume: 0.5,
  audioBassVolume: 0,
  audioTrebleVolume: 0,
  audioKeyVariance: 0,
  audioPitch: 0,
  audioReverbStrength: 0,
  audioReverbSpace: 0,
  pitchJitterAmount: 0,
  audioSpatial: 0,
  typingSoundEnabled: false,
  typingSoundSet: 'A',
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
    selectionEdit: 'rgba(0, 0, 0, 0.1)',
    selectionRender: 'rgba(0, 0, 0, 0.1)',
    textBase: '#000000DD',
    textEmbossEdit: '#ffffff',
    textEmbossRender: '#ffffff',
    textEmbossUi: '#ffffff',
    background: 'rgba(196, 187, 182, 0.2)',
    topBackground: 'rgba(196, 187, 182, 0.3)',
    bottomBackground: 'rgba(196, 187, 182, 0.3)',
    gridOutline: '#00000022',
    grid: '#f9f6f3',
    gutterBackground: 'rgba(196, 187, 182, 0.49)',
    reviewLine: 'rgba(255, 230, 0, 0.6)',
    warningLine: 'rgba(255, 50, 0, 0.2)',
    lineNumber: 'rgba(0, 0, 0, 0.6)',
    base: '#f9f6f4',
    inputFields: '#ffffff',
    appButtons: '#FFFFFFBB',
    markdownHeadline: 'rgba(255, 0, 255, 1)',
    markdownList: 'rgba(0, 255, 255, 1)',
    markdownBlockquote: 'rgba(255, 255, 0, 1)',
    markdownCode: 'rgba(255, 0, 127, 1)',
    markdownChecked: 'rgba(0, 255, 0, 1)',
    markdownUnchecked: 'rgba(255, 0, 0, 1)',
  },
  editorTextColors: {
    editorEditText: '#000000DD',
    editorRenderText: '#000000DD',
  },
  textureMaterials: DEFAULT_TEXTURE_MATERIALS,
  cursorDotColor: DEFAULT_CUSTOM_CURSOR_SETTINGS.dotColor,
  cursorCenterColor: DEFAULT_CUSTOM_CURSOR_SETTINGS.centerColor,
  cursorTrailColor: DEFAULT_CUSTOM_CURSOR_SETTINGS.trailColor,
  cursorDotCount: DEFAULT_CUSTOM_CURSOR_SETTINGS.dotCount,
  cursorRadiusPx: DEFAULT_CUSTOM_CURSOR_SETTINGS.radiusPx,
  cursorSpinHz: DEFAULT_CUSTOM_CURSOR_SETTINGS.spinHz,
  cursorTrailThicknessPx: DEFAULT_CUSTOM_CURSOR_SETTINGS.trailThicknessPx,
  cursorTrailFadeMs: DEFAULT_CUSTOM_CURSOR_SETTINGS.trailFadeMs,
  cursorDotSizePx: DEFAULT_CUSTOM_CURSOR_SETTINGS.dotSizePx,
  cursorCenterSizePx: DEFAULT_CUSTOM_CURSOR_SETTINGS.centerSizePx,
  cursorHaloColor: DEFAULT_CUSTOM_CURSOR_SETTINGS.haloColor,
  cursorHaloRadiusPx: DEFAULT_CUSTOM_CURSOR_SETTINGS.haloRadiusPx,
  cursorHaloFalloff: DEFAULT_CUSTOM_CURSOR_SETTINGS.haloFalloff,
  cursorPulseMagnitude: DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseMagnitude,
  cursorPulseHz: DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseHz,
  cursorClickRamp: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickRamp,
  cursorClickSkew: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSkew,
  cursorClickSpeedX: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSpeedX,
  cursorClickMaxSpeed: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMaxSpeed,
  cursorClickMinHoldMs: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMinHoldMs,
  cursorClickBalance: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickBalance,
  caretSizeDeviationPx: DEFAULT_CARET_SETTINGS.sizeDeviationPx,
  caretOutlineWidthPx: DEFAULT_CARET_SETTINGS.outlineWidthPx,
  caretOutlineColor: DEFAULT_CARET_SETTINGS.outlineColor,
  caretHaloSpreadPx: DEFAULT_CARET_SETTINGS.haloSpreadPx,
  caretHaloBlurPx: DEFAULT_CARET_SETTINGS.haloBlurPx,
  caretHaloColor: DEFAULT_CARET_SETTINGS.haloColor,
  caretAnimationPreset: DEFAULT_CARET_SETTINGS.animationPreset,
  caretAnimationDurationMs: DEFAULT_CARET_SETTINGS.animationDurationMs,
  caretFrameDurationMs: DEFAULT_CARET_SETTINGS.frameDurationMs,
  caretEffectStrengthPercent: DEFAULT_CARET_SETTINGS.effectStrengthPercent,
};

export const DEFAULT_CUSTOM_LIGHT: UiLayoutLoadout = {
  ...NEUTRAL_BASE,
};

export const DEFAULT_CUSTOM_DARK: UiLayoutLoadout = {
  ...NEUTRAL_BASE,
  filterInvert: 1,
};

// --- Placeholder factory presets -------------------------------------------
// Each preset is based on neutral base with only changed values specified.

export const LIGHT_FACTORY_PRESETS: UiLayoutLoadout[] = [
  // Layout 1: Light (default)
  buildPreset({
    borderAlphaPercent: 74,
    boxShadowAlphaPercent: 58,
    glaze: { gloomOpacity: 0.05, gloomPosition: -0.5, gloomShape: 1.08, radialCount: 4, radialSeed: 931194, sheenOpacity: 0.39 },
    highlightColors: {
      appButtons: 'rgba(255, 255, 255, 0.643)',
      background: 'rgba(0, 0, 0, 0.023)',
      base: 'rgba(221, 208, 208, 1)',
      bottomBackground: 'rgba(0, 0, 0, 0)',
      grid: 'rgba(241, 241, 241, 1)',
      gridOutline: 'rgba(0, 0, 0, 0.047)',
      inputFields: 'rgba(235, 228, 223, 1)',
      markdownBlockquote: 'rgba(255, 255, 0, 0.325)',
      markdownChecked: 'rgba(0, 255, 0, 0.325)',
      markdownHeadline: 'rgba(255, 0, 255, 0.325)',
      markdownList: 'rgba(0, 255, 255, 0.325)',
      markdownUnchecked: 'rgba(255, 0, 0, 0.325)',
      textBase: 'rgba(0, 0, 0, 0.871)',
      textEmbossEdit: 'rgba(255, 255, 255, 0.682)',
      textEmbossUi: 'rgba(255, 255, 255, 0.682)',
      topBackground: 'rgba(0, 0, 0, 0)',
    },
    editorTextColors: { editorEditText: 'rgba(0, 0, 0, 0.871)' },
    textureMaterials: {
      appGrid: { color: { a: 0.1176, h: 0, s: 0.0275, v: 0.4196 }, granularity: 1, seed: 211, vSteps: 7 },
      editorEditText: { color: { a: 0.3176, h: 47, s: 0.0706, v: 1 }, enabled: false },
      editorRenderText: { color: { a: 0.2902, h: 47, s: 0.0706, v: 1 }, enabled: false },
      sidebarContent: { color: { a: 0.3176, h: 47, s: 0.0706, v: 1 }, enabled: false },
    },
  }),
  // Layout 2: Sand
  buildPreset({ borderRadiusRegularPx: 12, borderAlphaPercent: 75, audioKeyVolume: 0, audioKeyVariance: 0.3, audioPitch: -50, audioBassVolume: 0.33, audioTrebleVolume: 0.13, audioReverbStrength: 0.25, audioReverbSpace: 0.8, pitchJitterAmount: 0.05, audioSpatial: -50, typingSoundEnabled: true, filterSepia: 0.38, filterHueRotate: 356, filterBrightness: 0.78, filterContrast: 1.3, filterSaturate: 0.498, filterColorize: 0.18, cursorDotColor: 'rgba(102, 81, 51, 0)', cursorCenterColor: 'rgba(0, 0, 0, 0.673)', cursorTrailColor: 'rgba(255, 237, 210, 1)', cursorDotCount: 5, cursorSpinHz: 0.3, cursorTrailThicknessPx: 3, cursorTrailFadeMs: 1000, cursorCenterSizePx: 2, cursorHaloColor: 'rgba(255, 237, 210, 0.6)', cursorPulseMagnitude: 0.2, cursorPulseHz: 0.4, cursorClickBalance: 0.2, caretOutlineWidthPx: 1, caretOutlineColor: 'rgba(255, 255, 255, 1)', caretHaloSpreadPx: 6, caretHaloBlurPx: 16, caretHaloColor: 'rgba(255, 255, 255, 1)', caretAnimationPreset: 'fadeEarly', caretAnimationDurationMs: 600, caretEffectStrengthPercent: 60, glaze: {"gloomOpacity":0.17500000000000002,"gloomPosition":-0.5,"gloomShape":1.08,"linearOpacity":0.015,"linearSeed":103429,"linearStackCount":5,"radialCount":3,"radialSeed":325650,"sheenOpacity":0.5,"sheenPosition":0.22999999999999998}, highlightColors: {"appButtons":"rgba(255, 254, 254, 1)","background":"rgba(0, 0, 0, 0.024)","base":"rgba(241, 234, 230, 1)","bottomBackground":"rgba(0, 0, 0, 0.079)","caret":"rgba(1, 1, 1, 0.116)","grid":"rgba(249, 246, 244, 0.886)","gridOutline":"rgba(0, 0, 0, 0.075)","inputFields":"rgba(211, 213, 214, 1)","markdownBlockquote":"rgba(255, 255, 0, 0.325)","markdownChecked":"rgba(0, 255, 0, 0.325)","markdownHeadline":"rgba(255, 0, 255, 0.325)","markdownList":"rgba(0, 255, 255, 0.325)","markdownUnchecked":"rgba(255, 0, 0, 0.325)","textBase":"rgba(0, 0, 0, 0.871)","textEmbossEdit":"rgba(255, 255, 255, 0.682)","textEmbossUi":"rgba(255, 255, 255, 0.682)","topBackground":"rgba(0, 0, 0, 0.079)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 0.871)"}, textureMaterials: {"appGrid":{"color":{"a":0.289,"h":29,"s":0,"v":0.4157},"granularity":4,"seed":895378,"vSteps":3},"editorEditText":{"color":{"a":0.1412,"h":166,"s":0,"v":0},"granularity":4,"seed":569082,"vSteps":5},"editorRenderText":{"color":{"a":0.1412,"h":166,"s":0,"v":0},"granularity":4,"seed":569082,"vSteps":5},"sidebarContent":{"color":{"a":0.1412,"h":166,"s":0,"v":0},"granularity":4,"seed":569082,"vSteps":5}} }),
  // Layout 3: Sky (replaces the former Forest preset)
  buildPreset({ borderRadiusRegularPx: 4, borderAlphaPercent: 130, boxShadowAlphaPercent: 70, audioKeyVolume: 0.2, audioTrebleVolume: 0.22, audioReverbStrength: 0.13, audioReverbSpace: 0.85, typingSoundEnabled: true, filterHueRotate: 145, filterContrast: 1.34, filterSaturate: 0.669, cursorDotColor: 'rgba(255, 134, 213, 0.6)', cursorCenterColor: 'rgba(255, 211, 240, 1)', cursorTrailColor: 'rgba(255, 251, 254, 0.637)', cursorDotCount: 2, cursorSpinHz: 0.2, cursorTrailThicknessPx: 3, cursorTrailFadeMs: 2300, cursorCenterSizePx: 4, cursorHaloColor: 'rgba(255, 147, 217, 1)', caretSizeDeviationPx: -1, caretOutlineWidthPx: 1, caretOutlineColor: 'rgba(45, 45, 45, 0.438)', caretHaloSpreadPx: 13, caretHaloBlurPx: 20, caretHaloColor: 'rgba(252, 255, 245, 1)', caretAnimationPreset: 'fadeEarly', caretEffectStrengthPercent: 70, glaze: {"gloomOpacity":0.28,"gloomPosition":0.345,"gloomShape":0.62,"linearOpacity":0.02,"radialCount":3,"radialOpacity":0.08,"radialSeed":494605,"sheenOpacity":0.095,"sheenShape":0.5}, highlightColors: {"appButtons":"rgba(230, 246, 255, 0.769)","background":"rgba(38, 80, 94, 0.139)","base":"rgba(211, 223, 226, 0.984)","bottomBackground":"rgba(59, 126, 147, 0.299)","caret":"rgba(255, 255, 255, 1)","grid":"rgba(209, 226, 217, 0.984)","gridOutline":"rgba(60, 54, 48, 0.079)","inputFields":"rgba(209, 230, 242, 1)","markdownBlockquote":"rgba(0, 250, 255, 0.784)","markdownChecked":"rgba(47, 255, 0, 0.784)","markdownCode":"rgba(0, 250, 255, 0.784)","markdownHeadline":"rgba(0, 250, 255, 0.784)","markdownList":"rgba(0, 250, 255, 0.784)","markdownUnchecked":"rgba(255, 0, 0, 0.784)","reviewLine":"rgba(255, 230, 0, 0.09)","textBase":"rgba(11, 14, 15, 1)","textEmbossEdit":"rgba(0, 0, 0, 0)","textEmbossRender":"rgba(255, 255, 255, 0.482)","textEmbossUi":"rgba(0, 0, 0, 0)","topBackground":"rgba(59, 126, 147, 0.299)","warningLine":"rgba(0, 165, 255, 0.225)"}, editorTextColors: {"editorEditText":"rgba(11, 14, 15, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.4,"h":50,"s":0.1137,"v":0.4686},"granularity":20,"seed":513013,"vSteps":20},"editorEditText":{"color":{"a":0.4459,"h":120,"s":0.0706,"v":0.9412},"granularity":8,"seed":881350,"vSteps":20},"editorRenderText":{"color":{"a":0.9843,"h":192,"s":0.0664,"v":0.8863},"enabled":false},"sidebarContent":{"color":{"a":0.4459,"h":120,"s":0.0706,"v":0.9412},"seed":881350,"vSteps":20}} }),
  // Layout 4: Paper
  buildPreset({ borderRadiusRegularPx: 2, borderAlphaPercent: 170, boxShadowAlphaPercent: 50, audioBassVolume: 0.07, audioTrebleVolume: 0.09, typingSoundEnabled: true, filterSepia: 0.86, filterHueRotate: 7, filterBrightness: 0.87, filterContrast: 1.43, filterSaturate: 0.10200000000000001, filterColorize: 0.92, cursorCenterColor: 'rgba(0, 0, 0, 0.746)', cursorTrailColor: 'rgba(0, 0, 0, 1)', cursorDotCount: 8, cursorRadiusPx: 15, cursorSpinHz: 0.1, cursorTrailThicknessPx: 1, cursorTrailFadeMs: 1550, cursorDotSizePx: 0, cursorCenterSizePx: 3, cursorHaloColor: 'rgba(255, 255, 255, 0.59)', cursorHaloRadiusPx: 10, cursorHaloFalloff: 25, cursorPulseMagnitude: 0, cursorClickSkew: 0.59, cursorClickMaxSpeed: 1, caretSizeDeviationPx: -1, caretOutlineWidthPx: 1, caretHaloSpreadPx: 4, caretHaloBlurPx: 4, caretHaloColor: 'rgba(255, 255, 255, 1)', caretAnimationPreset: 'fadeMid', caretAnimationDurationMs: 700, caretEffectStrengthPercent: 66, glaze: {"gloomOpacity":0.46,"gloomPosition":1.5,"gloomShape":0,"linearOpacity":0.005,"linearSeed":643472,"linearStackCount":5,"radialCount":4,"radialOpacity":0.06,"radialSeed":3709,"sheenOpacity":0.5}, highlightColors: {"appButtons":"rgba(255, 255, 255, 1)","background":"rgba(0, 0, 0, 0.04)","bottomBackground":"rgba(0, 0, 0, 0.098)","caret":"rgba(255, 255, 255, 0.784)","grid":"rgba(249, 246, 244, 1)","gridOutline":"rgba(0, 0, 0, 0.079)","inputFields":"rgba(230, 230, 230, 1)","markdownBlockquote":"rgba(255, 255, 255, 1)","markdownChecked":"rgba(255, 255, 255, 1)","markdownCode":"rgba(255, 255, 255, 1)","markdownHeadline":"rgba(255, 255, 255, 1)","markdownList":"rgba(255, 255, 255, 1)","markdownUnchecked":"rgba(255, 255, 255, 1)","textBase":"rgba(0, 0, 0, 1)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(0, 0, 0, 0.098)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.0392,"h":0,"s":0,"v":0},"granularity":1,"seed":698383,"vSteps":6},"editorEditText":{"color":{"a":0.0392,"h":0,"s":0,"v":0},"granularity":1,"seed":698383,"vSteps":6},"sidebarContent":{"color":{"a":0.0392,"h":0,"s":0,"v":0},"granularity":1,"seed":698383,"vSteps":6}} }),
  // Layout 5: Gold
  buildPreset({ borderRadiusRegularPx: 20, audioBassVolume: 0.2, audioReverbStrength: 0.11, audioReverbSpace: 1, typingSoundEnabled: true, typingSoundSet: 'C', filterSepia: 0.86, filterHueRotate: 360, filterBrightness: 0.87, filterContrast: 1.43, filterSaturate: 0.556, filterColorize: 0.92, glaze: {"gloomOpacity":0.46,"gloomPosition":1.5,"gloomShape":0,"linearOpacity":0.005,"linearSeed":643472,"linearStackCount":5,"radialCount":4,"radialOpacity":0.06,"radialSeed":3709,"sheenOpacity":0.5}, highlightColors: {"appButtons":"rgba(208, 208, 208, 1)","background":"rgba(0, 0, 0, 0.079)","base":"rgba(220, 217, 216, 1)","bottomBackground":"rgba(0, 0, 0, 0.13)","grid":"rgba(249, 246, 244, 1)","gridOutline":"rgba(0, 0, 0, 0.126)","inputFields":"rgba(0, 0, 0, 0.256)","markdownBlockquote":"rgba(255, 255, 255, 1)","markdownChecked":"rgba(255, 255, 255, 1)","markdownCode":"rgba(255, 255, 255, 1)","markdownHeadline":"rgba(255, 255, 255, 1)","markdownList":"rgba(255, 255, 255, 1)","markdownUnchecked":"rgba(255, 255, 255, 1)","textBase":"rgba(0, 0, 0, 1)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(0, 0, 0, 0.13)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.1733,"h":0,"s":0,"v":0},"granularity":20,"seed":789107,"vSteps":7},"editorEditText":{"color":{"a":1,"h":0,"s":0,"v":0.9137},"granularity":13,"seed":352551,"vSteps":4},"editorRenderText":{"color":{"a":1,"h":0,"s":0,"v":0.9137},"granularity":13,"seed":352551,"vSteps":4},"sidebarContent":{"color":{"a":1,"h":0,"s":0,"v":0.9137},"granularity":13,"seed":352551,"vSteps":4}} }),
];

export const DARK_FACTORY_PRESETS: UiLayoutLoadout[] = [
  // Layout 1: Dark (default)
  buildPreset({ audioKeyVolume: 0, audioBassVolume: 0.07, audioTrebleVolume: 0.07,typingSoundEnabled: true, typingSoundSet: 'B', filterInvert: 1, filterSaturate: 0.434, glaze: {"sheenOpacity":0.03,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(120, 115, 112, 0.8)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(235, 194, 156, 0.14)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(199, 94, 0, 0.27)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(0, 0, 0, 0.663)","textEmbossEdit":"rgba(255, 255, 255, 0.882)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 0.882)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 0.663)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"s":0.3362,"v":0.9216},"enabled":false},"sidebarContent":{"color":{"a":0.14,"h":29,"s":0.3362,"v":0.9216},"enabled":false}} }),
  // Layout 2: Vintage
  buildPreset({ audioKeyVolume: 0.5, typingSoundEnabled: true, typingSoundSet: 'B', filterInvert: 1, filterSepia: 0.46, filterSaturate: 0.434, glaze: {"gloomOpacity":0.095,"linearOpacity":0.04,"linearSeed":210916,"radialOpacity":0.06,"sheenOpacity":0.05,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 246, 238, 0.36)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(102, 102, 102, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(102, 102, 102, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false},"sidebarContent":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false}} }),
  // Layout 3: Ocean
  buildPreset({ audioKeyVolume: 0.5, audioBassVolume: 0.07, audioReverbStrength: 0.29, typingSoundEnabled: true, typingSoundSet: 'C', filterInvert: 1, filterSepia: 0.46, filterHueRotate: 183, filterContrast: 1.06, filterSaturate: 0.366, filterColorize: 0.71, glaze: {"gloomOpacity":0.27,"linearOpacity":0.04,"linearSeed":50156,"radialOpacity":0.06,"radialSeed":845536,"sheenOpacity":0.03,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 246, 238, 0.36)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(83, 83, 83, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(83, 83, 83, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.051,"h":0,"s":0,"v":0},"seed":775509,"vSteps":12},"editorEditText":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false},"sidebarContent":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false}} }),
  // Layout 4: Bubblegum
  buildPreset({ audioKeyVolume: 0.15, audioBassVolume: 0.32, audioTrebleVolume: 0.03, audioReverbStrength: 0.14, typingSoundEnabled: true, filterInvert: 1, filterSepia: 0.21, filterHueRotate: 61, filterBrightness: 1.06, filterContrast: 1.3, filterSaturate: 0.634, filterColorize: 0.41000000000000003, glaze: {"gloomOpacity":0.135,"linearOpacity":0.07,"linearSeed":462061,"linearStackCount":1,"radialAboveLinear":true,"radialOpacity":0.105,"radialSeed":681823,"sheenOpacity":0.2,"sheenPosition":0.27}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 255, 255, 0.548)","markdownBlockquote":"rgba(236, 236, 236, 1)","markdownChecked":"rgba(255, 255, 255, 1)","markdownCode":"rgba(255, 255, 255, 1)","markdownHeadline":"rgba(255, 255, 255, 1)","markdownList":"rgba(255, 255, 255, 1)","markdownUnchecked":"rgba(255, 255, 255, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(81, 81, 81, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(81, 81, 81, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"a":1,"h":0,"s":0,"v":0.9373},"granularity":20,"seed":493181,"vSteps":20},"sidebarContent":{"color":{"a":1,"h":0,"s":0,"v":0.9373},"granularity":20,"seed":493181,"vSteps":20}} }),
  // Layout 5: Metal
  buildPreset({ audioKeyVolume: 0.52, audioBassVolume: 0.17, audioTrebleVolume: 0.29, audioReverbStrength: 0.13, typingSoundEnabled: true, typingSoundSet: 'B', filterInvert: 1, filterSepia: 0.78, filterHueRotate: 61, filterBrightness: 1.4000000000000001, filterContrast: 1.6500000000000001, filterSaturate: 0, filterColorize: 0.8200000000000001, glaze: {"gloomOpacity":0.325,"linearOpacity":0.15,"linearSeed":462061,"linearStackCount":4,"radialAboveLinear":true,"radialOpacity":0.105,"radialSeed":124469,"sheenOpacity":0.41500000000000004,"sheenPosition":0.27}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 255, 255, 0.548)","markdownBlockquote":"rgba(236, 236, 236, 1)","markdownChecked":"rgba(255, 255, 255, 1)","markdownCode":"rgba(255, 255, 255, 1)","markdownHeadline":"rgba(255, 255, 255, 1)","markdownList":"rgba(255, 255, 255, 1)","markdownUnchecked":"rgba(255, 255, 255, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(81, 81, 81, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(81, 81, 81, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"a":1,"h":0,"s":0,"v":0.9373},"granularity":20,"seed":493181,"vSteps":20},"sidebarContent":{"color":{"a":1,"h":0,"s":0,"v":0.9373},"granularity":20,"seed":493181,"vSteps":20}} }),
];

if (LIGHT_FACTORY_PRESETS.length !== 5 || DARK_FACTORY_PRESETS.length !== 5) {
  throw new Error('Expected exactly 5 factory presets per mode.');
}
