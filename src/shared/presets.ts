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
  editorGlyphPaddingPx: 1,
  borderRadiusRegularPx: 6,
  audioKeyVolume: 0.5,
  audioBassVolume: 0,
  audioTrebleVolume: 0,
  audioReverbStrength: 0,
  audioReverbSpace: 0,
  typingSoundEnabled: false,
  typingSoundSet: 'A',
  renderScrollDynamic: 4,
  renderScrollResponsiveness: 0.6,
  renderScrollTotalTimeSec: 0.4,
  renderScrollMaxSpeedPxPerSec: 30000,
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
    renderScrollMaxSpeedPxPerSec: 48000,
    renderScrollSkew: 0.62,
    filterSaturate: 0.498,
    glaze: { gloomPosition: -0.5, gloomShape: 1.08, radialCount: 3, radialSeed: 325650, sheenOpacity: 0.5 },
    highlightColors: {
      appButtons: 'rgba(255, 254, 254, 1)',
      background: 'rgba(0, 0, 0, 0.024)',
      base: 'rgba(249, 242, 238, 1)',
      bottomBackground: 'rgba(0, 0, 0, 0.079)',
      grid: 'rgba(249, 246, 244, 0.886)',
      gridOutline: 'rgba(0, 0, 0, 0.075)',
      inputFields: 'rgba(232, 234, 235, 1)',
      markdownBlockquote: 'rgba(255, 255, 0, 0.325)',
      markdownChecked: 'rgba(0, 255, 0, 0.325)',
      markdownHeadline: 'rgba(255, 0, 255, 0.325)',
      markdownList: 'rgba(0, 255, 255, 0.325)',
      markdownUnchecked: 'rgba(255, 0, 0, 0.325)',
      textBase: 'rgba(0, 0, 0, 0.871)',
      textEmbossEdit: 'rgba(255, 255, 255, 0.682)',
      textEmbossUi: 'rgba(255, 255, 255, 0.682)',
      topBackground: 'rgba(0, 0, 0, 0.079)',
    },
    editorTextColors: { editorEditText: 'rgba(0, 0, 0, 0.871)' },
    textureMaterials: { appGrid: { color: { a: 0.11372549019607843, h: 0, s: 0, v: 0 }, granularity: 1, vSteps: 20 } },
  }),
  // Layout 2: Sand
  buildPreset({ filterSepia: 0.38, filterHueRotate: 356, filterBrightness: 0.78, filterContrast: 1.3, filterSaturate: 0.498, filterColorize: 0.18, glaze: {"gloomOpacity":0.17500000000000002,"gloomPosition":-0.5,"gloomShape":1.08,"linearOpacity":0.015,"linearSeed":103429,"linearStackCount":5,"radialCount":3,"radialSeed":325650,"sheenOpacity":0.5,"sheenPosition":0.22999999999999998}, highlightColors: {"appButtons":"rgba(255, 254, 254, 1)","background":"rgba(0, 0, 0, 0.024)","base":"rgba(241, 234, 230, 1)","bottomBackground":"rgba(0, 0, 0, 0.079)","grid":"rgba(249, 246, 244, 0.886)","gridOutline":"rgba(0, 0, 0, 0.075)","inputFields":"rgba(211, 213, 214, 1)","markdownBlockquote":"rgba(255, 255, 0, 0.325)","markdownChecked":"rgba(0, 255, 0, 0.325)","markdownHeadline":"rgba(255, 0, 255, 0.325)","markdownList":"rgba(0, 255, 255, 0.325)","markdownUnchecked":"rgba(255, 0, 0, 0.325)","textBase":"rgba(0, 0, 0, 0.871)","textEmbossEdit":"rgba(255, 255, 255, 0.682)","textEmbossUi":"rgba(255, 255, 255, 0.682)","topBackground":"rgba(0, 0, 0, 0.079)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 0.871)"}, textureMaterials: {"appGrid":{"color":{"a":0.289,"h":29,"s":0,"v":0.4157},"granularity":4,"seed":895378,"vSteps":3},"editorEditText":{"color":{"a":0.1412,"h":166,"s":0,"v":0},"granularity":4,"seed":569082,"vSteps":5},"editorRenderText":{"color":{"a":0.1412,"h":166,"s":0,"v":0},"granularity":4,"seed":569082,"vSteps":5},"sidebarContent":{"color":{"a":0.1412,"h":166,"s":0,"v":0},"granularity":4,"seed":569082,"vSteps":5}} }),
  // Layout 3: Forest
  buildPreset({ audioKeyVolume: 0.2, audioTrebleVolume: 0.22, audioReverbStrength: 0.13, audioReverbSpace: 0.85, typingSoundEnabled: true, filterHueRotate: 26, filterContrast: 1.34, filterSaturate: 0.668, glaze: {"gloomOpacity":0.28,"gloomPosition":0.345,"gloomShape":0.62,"linearOpacity":0.02,"radialCount":3,"radialOpacity":0.08,"radialSeed":494605,"sheenOpacity":0.095,"sheenShape":0.5}, highlightColors: {"appButtons":"rgba(230, 246, 255, 0.769)","background":"rgba(59, 126, 147, 0.197)","base":"rgba(168, 226, 195, 1)","bottomBackground":"rgba(59, 126, 147, 0.197)","grid":"rgba(168, 226, 195, 1)","gridOutline":"rgba(35, 75, 88, 0.13)","inputFields":"rgba(209, 230, 242, 1)","markdownBlockquote":"rgba(0, 250, 255, 0.784)","markdownChecked":"rgba(47, 255, 0, 0.784)","markdownCode":"rgba(0, 250, 255, 0.784)","markdownHeadline":"rgba(0, 250, 255, 0.784)","markdownList":"rgba(0, 250, 255, 0.784)","markdownUnchecked":"rgba(255, 0, 0, 0.784)","textBase":"rgba(11, 14, 15, 1)","textEmbossEdit":"rgba(255, 255, 255, 0.518)","textEmbossUi":"rgba(255, 255, 255, 0.247)","topBackground":"rgba(59, 126, 147, 0.197)"}, editorTextColors: {"editorEditText":"rgba(11, 14, 15, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.3765,"h":148,"s":0.2566,"v":0.6078},"granularity":10,"seed":921308,"vSteps":20},"editorEditText":{"color":{"a":0.4459,"h":120,"s":0.0706,"v":0.9412},"granularity":8,"seed":881350,"vSteps":20},"editorRenderText":{"color":{"a":1,"h":148,"s":0.2566,"v":0.8863},"enabled":false},"sidebarContent":{"color":{"a":0.4459,"h":120,"s":0.0706,"v":0.9412},"seed":881350,"vSteps":20}} }),
  // Layout 4: Paper
  buildPreset({ audioBassVolume: 0.07, audioTrebleVolume: 0.09, typingSoundEnabled: true, renderScrollDynamic: 3, renderScrollResponsiveness: 1, renderScrollMaxSpeedPxPerSec: 20000, filterSepia: 0.86, filterHueRotate: 7, filterBrightness: 0.87, filterContrast: 1.43, filterSaturate: 0.10200000000000001, filterColorize: 0.92, glaze: {"gloomOpacity":0.46,"gloomPosition":1.5,"gloomShape":0,"linearOpacity":0.005,"linearSeed":643472,"linearStackCount":5,"radialCount":4,"radialOpacity":0.06,"radialSeed":3709,"sheenOpacity":0.5}, highlightColors: {"appButtons":"rgba(255, 255, 255, 1)","background":"rgba(0, 0, 0, 0.04)","bottomBackground":"rgba(0, 0, 0, 0.098)","grid":"rgba(249, 246, 244, 1)","gridOutline":"rgba(0, 0, 0, 0.079)","inputFields":"rgba(230, 230, 230, 1)","markdownBlockquote":"rgba(255, 255, 255, 1)","markdownChecked":"rgba(255, 255, 255, 1)","markdownCode":"rgba(255, 255, 255, 1)","markdownHeadline":"rgba(255, 255, 255, 1)","markdownList":"rgba(255, 255, 255, 1)","markdownUnchecked":"rgba(255, 255, 255, 1)","textBase":"rgba(0, 0, 0, 1)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(0, 0, 0, 0.098)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.0392,"h":0,"s":0,"v":0},"granularity":1,"seed":698383,"vSteps":6},"editorEditText":{"color":{"a":0.0392,"h":0,"s":0,"v":0},"granularity":1,"seed":698383,"vSteps":6},"sidebarContent":{"color":{"a":0.0392,"h":0,"s":0,"v":0},"granularity":1,"seed":698383,"vSteps":6}} }),
  // Layout 5: Gold
  buildPreset({ borderRadiusRegularPx: 20, audioBassVolume: 0.2, audioReverbStrength: 0.11, audioReverbSpace: 1, typingSoundEnabled: true, typingSoundSet: 'C', renderScrollDynamic: 3, renderScrollResponsiveness: 1, renderScrollMaxSpeedPxPerSec: 20000, filterSepia: 0.86, filterHueRotate: 360, filterBrightness: 0.87, filterContrast: 1.43, filterSaturate: 0.556, filterColorize: 0.92, glaze: {"gloomOpacity":0.46,"gloomPosition":1.5,"gloomShape":0,"linearOpacity":0.005,"linearSeed":643472,"linearStackCount":5,"radialCount":4,"radialOpacity":0.06,"radialSeed":3709,"sheenOpacity":0.5}, highlightColors: {"appButtons":"rgba(208, 208, 208, 1)","background":"rgba(0, 0, 0, 0.079)","base":"rgba(220, 217, 216, 1)","bottomBackground":"rgba(0, 0, 0, 0.13)","grid":"rgba(249, 246, 244, 1)","gridOutline":"rgba(0, 0, 0, 0.126)","inputFields":"rgba(0, 0, 0, 0.256)","markdownBlockquote":"rgba(255, 255, 255, 1)","markdownChecked":"rgba(255, 255, 255, 1)","markdownCode":"rgba(255, 255, 255, 1)","markdownHeadline":"rgba(255, 255, 255, 1)","markdownList":"rgba(255, 255, 255, 1)","markdownUnchecked":"rgba(255, 255, 255, 1)","textBase":"rgba(0, 0, 0, 1)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(0, 0, 0, 0.13)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.1733,"h":0,"s":0,"v":0},"granularity":20,"seed":789107,"vSteps":7},"editorEditText":{"color":{"a":1,"h":0,"s":0,"v":0.9137},"granularity":13,"seed":352551,"vSteps":4},"editorRenderText":{"color":{"a":1,"h":0,"s":0,"v":0.9137},"granularity":13,"seed":352551,"vSteps":4},"sidebarContent":{"color":{"a":1,"h":0,"s":0,"v":0.9137},"granularity":13,"seed":352551,"vSteps":4}} }),
];

export const DARK_FACTORY_PRESETS: UiLayoutLoadout[] = [
  // Layout 1: Dark (default)
  buildPreset({ audioKeyVolume: 0, audioBassVolume: 0.07, audioTrebleVolume: 0.07,typingSoundEnabled: true, typingSoundSet: 'B', filterInvert: 1, filterSaturate: 0.434, glaze: {"sheenOpacity":0.03,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(120, 115, 112, 0.8)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(235, 194, 156, 0.14)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(199, 94, 0, 0.27)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(0, 0, 0, 0.663)","textEmbossEdit":"rgba(255, 255, 255, 0.882)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 0.882)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 0.663)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"s":0.3362,"v":0.9216},"enabled":false},"sidebarContent":{"color":{"a":0.14,"h":29,"s":0.3362,"v":0.9216},"enabled":false}} }),
  // Layout 2: Vintage
  buildPreset({ audioKeyVolume: 0.5, typingSoundEnabled: true, typingSoundSet: 'B', renderScrollDynamic: 4, filterInvert: 1, filterSepia: 0.46, filterSaturate: 0.434, glaze: {"gloomOpacity":0.095,"linearOpacity":0.04,"linearSeed":210916,"radialOpacity":0.06,"sheenOpacity":0.05,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 246, 238, 0.36)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(102, 102, 102, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(102, 102, 102, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false},"sidebarContent":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false}} }),
  // Layout 3: Ocean
  buildPreset({ audioKeyVolume: 0.5, audioBassVolume: 0.07, audioReverbStrength: 0.29, typingSoundEnabled: true, typingSoundSet: 'C', renderScrollDynamic: 4.35, renderScrollResponsiveness: 0.35, renderScrollTotalTimeSec: 0.6, renderScrollMaxSpeedPxPerSec: 24000, renderScrollSkew: 0.2, filterInvert: 1, filterSepia: 0.46, filterHueRotate: 183, filterContrast: 1.06, filterSaturate: 0.366, filterColorize: 0.71, glaze: {"gloomOpacity":0.27,"linearOpacity":0.04,"linearSeed":50156,"radialOpacity":0.06,"radialSeed":845536,"sheenOpacity":0.03,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 246, 238, 0.36)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(83, 83, 83, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(83, 83, 83, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.051,"h":0,"s":0,"v":0},"seed":775509,"vSteps":12},"editorEditText":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false},"sidebarContent":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false}} }),
  // Layout 4: Bubblegum
  buildPreset({ audioKeyVolume: 0.15, audioBassVolume: 0.32, audioTrebleVolume: 0.03, audioReverbStrength: 0.14, typingSoundEnabled: true, renderScrollResponsiveness: 0.45, renderScrollTotalTimeSec: 0.5, renderScrollSkew: 0.72, filterInvert: 1, filterSepia: 0.21, filterHueRotate: 61, filterBrightness: 1.06, filterContrast: 1.3, filterSaturate: 0.634, filterColorize: 0.41000000000000003, glaze: {"gloomOpacity":0.135,"linearOpacity":0.07,"linearSeed":462061,"linearStackCount":1,"radialAboveLinear":true,"radialOpacity":0.105,"radialSeed":681823,"sheenOpacity":0.2,"sheenPosition":0.27}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 255, 255, 0.548)","markdownBlockquote":"rgba(236, 236, 236, 1)","markdownChecked":"rgba(255, 255, 255, 1)","markdownCode":"rgba(255, 255, 255, 1)","markdownHeadline":"rgba(255, 255, 255, 1)","markdownList":"rgba(255, 255, 255, 1)","markdownUnchecked":"rgba(255, 255, 255, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(81, 81, 81, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(81, 81, 81, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"a":1,"h":0,"s":0,"v":0.9373},"granularity":20,"seed":493181,"vSteps":20},"sidebarContent":{"color":{"a":1,"h":0,"s":0,"v":0.9373},"granularity":20,"seed":493181,"vSteps":20}} }),
  // Layout 5: Metal
  buildPreset({ audioKeyVolume: 0.52, audioBassVolume: 0.17, audioTrebleVolume: 0.29, audioReverbStrength: 0.13, typingSoundEnabled: true, typingSoundSet: 'B', renderScrollResponsiveness: 0.45, renderScrollTotalTimeSec: 0.3, renderScrollSkew: 0.9, filterInvert: 1, filterSepia: 0.78, filterHueRotate: 61, filterBrightness: 1.4000000000000001, filterContrast: 1.6500000000000001, filterSaturate: 0, filterColorize: 0.8200000000000001, glaze: {"gloomOpacity":0.325,"linearOpacity":0.15,"linearSeed":462061,"linearStackCount":4,"radialAboveLinear":true,"radialOpacity":0.105,"radialSeed":124469,"sheenOpacity":0.41500000000000004,"sheenPosition":0.27}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 255, 255, 0.548)","markdownBlockquote":"rgba(236, 236, 236, 1)","markdownChecked":"rgba(255, 255, 255, 1)","markdownCode":"rgba(255, 255, 255, 1)","markdownHeadline":"rgba(255, 255, 255, 1)","markdownList":"rgba(255, 255, 255, 1)","markdownUnchecked":"rgba(255, 255, 255, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(81, 81, 81, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(81, 81, 81, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"a":1,"h":0,"s":0,"v":0.9373},"granularity":20,"seed":493181,"vSteps":20},"sidebarContent":{"color":{"a":1,"h":0,"s":0,"v":0.9373},"granularity":20,"seed":493181,"vSteps":20}} }),
];

if (LIGHT_FACTORY_PRESETS.length !== 5 || DARK_FACTORY_PRESETS.length !== 5) {
  throw new Error('Expected exactly 5 factory presets per mode.');
}
