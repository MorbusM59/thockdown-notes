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
  buildPreset({ filterSepia: 0.2, filterBrightness: 1.05 }),
  buildPreset({ filterContrast: 1.15, filterSaturate: 0.7 }),
  buildPreset({ filterHueRotate: 30, filterSaturate: 0.6 }),
  buildPreset({ filterBrightness: 1.1, glaze: { linearStackCount: 2, radialCount: 1, gloomOpacity: 0.65 } }),
];

export const DARK_FACTORY_PRESETS: UiLayoutLoadout[] = [
  // Layout 1: Dark (default)
  buildPreset({ filterInvert: 1, filterSepia: 0.18, filterSaturate: 0.434, glaze: {"sheenOpacity":0.01,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 246, 238, 0.36)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(102, 102, 102, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(102, 102, 102, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false},"sidebarContent":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false}} }),
  // Layout 2: Slate
  buildPreset({ audioKeyVolume: 0, audioBassVolume: 0.07, audioTrebleVolume: 0.07,typingSoundEnabled: true, typingSoundSet: 'B', filterInvert: 1, filterSaturate: 0.434, glaze: {"sheenOpacity":0.03,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(120, 115, 112, 0.8)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(235, 194, 156, 0.14)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(199, 94, 0, 0.27)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(0, 0, 0, 0.663)","textEmbossEdit":"rgba(255, 255, 255, 0.882)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 0.882)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(0, 0, 0, 0.663)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"s":0.3362,"v":0.9216},"enabled":false},"sidebarContent":{"color":{"a":0.14,"h":29,"s":0.3362,"v":0.9216},"enabled":false}} }),
  // Layout 3: Vintage
  buildPreset({ audioKeyVolume: 0.5, typingSoundEnabled: true, typingSoundSet: 'B', renderScrollDynamic: 4, filterInvert: 1, filterSepia: 0.46, filterSaturate: 0.434, glaze: {"gloomOpacity":0.095,"linearOpacity":0.04,"linearSeed":210916,"radialOpacity":0.06,"sheenOpacity":0.05,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 246, 238, 0.36)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(102, 102, 102, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(102, 102, 102, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"editorEditText":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false},"sidebarContent":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false}} }),
  // Layout 4: Ocean
  buildPreset({ audioKeyVolume: 0.5, audioBassVolume: 0.07, audioReverbStrength: 0.29, typingSoundEnabled: true, typingSoundSet: 'C', renderScrollDynamic: 4.35, renderScrollResponsiveness: 0.35, renderScrollTotalTimeSec: 0.6, renderScrollMaxSpeedPxPerSec: 24000, renderScrollSkew: 0.2, filterInvert: 1, filterSepia: 0.46, filterHueRotate: 183, filterContrast: 1.06, filterSaturate: 0.366, filterColorize: 0.71, glaze: {"gloomOpacity":0.27,"linearOpacity":0.04,"linearSeed":50156,"radialOpacity":0.06,"radialSeed":845536,"sheenOpacity":0.03,"sheenPosition":0.12}, highlightColors: {"appButtons":"rgba(255, 244, 235, 0.681)","background":"rgba(196, 187, 182, 0.196)","base":"rgba(237, 234, 232, 1)","bottomBackground":"rgba(196, 187, 182, 0)","caret":"rgba(0, 0, 0, 0.326)","grid":"rgba(255, 252, 249, 1)","gridOutline":"rgba(0, 0, 0, 0.051)","inputFields":"rgba(255, 246, 238, 0.36)","markdownBlockquote":"rgba(11, 120, 236, 0.635)","markdownChecked":"rgba(255, 0, 103, 0.446)","markdownCode":"rgba(255, 0, 0, 1)","markdownHeadline":"rgba(255, 165, 165, 1)","markdownList":"rgba(38, 255, 0, 0.321)","markdownUnchecked":"rgba(0, 255, 254, 1)","search":"rgba(199, 94, 0, 0.27)","selectionEdit":"rgba(0, 0, 0, 0.071)","selectionRender":"rgba(199, 94, 0, 0.27)","textBase":"rgba(83, 83, 83, 0.827)","textEmbossEdit":"rgba(255, 255, 255, 1)","textEmbossRender":"rgba(255, 255, 255, 1)","textEmbossUi":"rgba(255, 255, 255, 1)","topBackground":"rgba(196, 187, 182, 0)"}, editorTextColors: {"editorEditText":"rgba(83, 83, 83, 0.827)","editorRenderText":"rgba(51, 51, 51, 1)"}, textureMaterials: {"appGrid":{"color":{"a":0.051,"h":0,"s":0,"v":0},"seed":775509,"vSteps":12},"editorEditText":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false},"sidebarContent":{"color":{"a":0.3596,"h":28,"s":0.0667,"v":1},"enabled":false}} }),
  // Layout 5: 
  buildPreset({ filterBrightness: 1.1, glaze: { linearStackCount: 2, radialCount: 1, gloomOpacity: 0.65 } }),
];

if (LIGHT_FACTORY_PRESETS.length !== 5 || DARK_FACTORY_PRESETS.length !== 5) {
  throw new Error('Expected exactly 5 factory presets per mode.');
}
