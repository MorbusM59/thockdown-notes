import type { TextureMaterialsBySurface } from '../textures/types';

export const LOADOUT_CHANNELS = {
  list: 'loadout:list',
  save: 'loadout:save',
} as const;

export type UiLayoutLoadout = {
  viewStyle: 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print';
  viewFontSize: 'xs' | 's' | 'm' | 'l' | 'xl';
  viewSpacing: 'tight' | 'compact' | 'cozy' | 'wide';
  editorStyle: 'syne' | 'redhat';
  editorFontSize: 'xs' | 's' | 'm' | 'l' | 'xl';
  editorSpacing: 'tight' | 'compact' | 'cozy' | 'wide';
  editorGlyphPaddingPx: number;
  audioKeyVolume: number;
  audioBassVolume: number;
  audioTrebleVolume: number;
  audioReverbAmount: number;
  typingSoundEnabled: boolean;
  typingSoundSet: 'A' | 'B' | 'C';
  renderScrollDynamic: number;
  renderScrollResponsiveness: number;
  renderScrollTotalTimeSec: number;
  renderScrollMaxSpeedPxPerSec: number;
  renderScrollSkew: number;
  highlightColors: {
    caret: string;
    search: string;
    selection: string;
    background: string;
    topBackground: string;
    bottomBackground: string;
    gridOutline: string;
  };
  textureMaterials: TextureMaterialsBySurface;
};

export interface UiLoadoutApi {
  listUiLoadouts(): Promise<UiLayoutLoadout[]>;
  saveUiLoadout(slot: number, loadout: UiLayoutLoadout): Promise<UiLayoutLoadout[]>;
}
