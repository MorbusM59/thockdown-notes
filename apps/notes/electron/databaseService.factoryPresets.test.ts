import { describe, expect, it } from 'vitest';
import { DARK_FACTORY_PRESETS, LIGHT_FACTORY_PRESETS } from '@thockdown/look/presets';
import type { UiLayoutLoadout } from '@thockdown/look/loadouts';
import { normalizeUiLayoutLoadout } from './databaseService';

// Selecting a preset applies its stored payload to the live state, and the live
// state is captured back and compared with it by signature. A colour the preset
// leaves out is filled in by the renderer, so the capture differs and every
// selection reads as unsaved changes. Every factory preset must therefore carry
// every colour a normalized layout has, and be a fixed point of normalization.
describe('factory presets', () => {
  // Every key the type names, optional ones included: the compiler fails this
  // list when a colour is added, so a new one cannot be left out of the presets.
  const KEYS: Record<keyof Required<UiLayoutLoadout['highlightColors']>, true> = {
    caret: true,
    search: true,
    selectionEdit: true,
    selectionRender: true,
    textBase: true,
    textEmbossEdit: true,
    textEmbossRender: true,
    textEmbossUi: true,
    background: true,
    topBackground: true,
    bottomBackground: true,
    gridOutline: true,
    grid: true,
    gutterBackground: true,
    immersiveScrollThumb: true,
    flowTrail: true,
    spellCheck: true,
    reviewLine: true,
    warningLine: true,
    lineNumber: true,
    base: true,
    inputFields: true,
    appButtons: true,
    markdownHeadline: true,
    markdownList: true,
    markdownBlockquote: true,
    markdownCode: true,
    markdownChecked: true,
    markdownUnchecked: true,
  };
  const expectedKeys = Object.keys(KEYS).sort();
  const presets = [...LIGHT_FACTORY_PRESETS, ...DARK_FACTORY_PRESETS];

  it.each(presets.map((preset, index) => [index, preset] as const))('preset %i carries every highlight colour', (_index, preset) => {
    const normalized = normalizeUiLayoutLoadout(preset)!;
    expect(Object.keys(preset.highlightColors).sort()).toEqual(expectedKeys);
    expect(Object.keys(normalized.highlightColors).sort()).toEqual(expectedKeys);
    for (const key of expectedKeys) expect(typeof (preset.highlightColors as Record<string, unknown>)[key]).toBe('string');
    expect(normalizeUiLayoutLoadout(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
  });
});
