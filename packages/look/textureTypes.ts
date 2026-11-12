export type TextureSurfaceKey = 'appGrid' | 'sidebarContent' | 'editorEditText' | 'editorRenderText';

export type TextureColorHsva = {
  h: number;
  s: number;
  v: number;
  a: number;
};

export type TextureMaterialSettings = {
  seed: number;
  textureStrength: number;
  granularity: number;
  vSteps: number;
  color: TextureColorHsva;
};

export type TextureMaterialsBySurface = Record<TextureSurfaceKey, TextureMaterialSettings>;

export const TEXTURE_SURFACES: TextureSurfaceKey[] = ['appGrid', 'sidebarContent', 'editorEditText', 'editorRenderText'];

export const TEXTURE_GRANULARITY_MIN = 1;
export const TEXTURE_GRANULARITY_MAX = 20;
export const TEXTURE_VSTEPS_MIN = 1;
export const TEXTURE_VSTEPS_MAX = 20;
export const TEXTURE_STRENGTH_MIN = 0;
export const TEXTURE_STRENGTH_MAX = 1;
/** The slider's step, and the grain a strength is rounded to before it names a texture (and a cache row). */
export const TEXTURE_STRENGTH_STEP = 0.01;

export const DEFAULT_TEXTURE_MATERIALS: TextureMaterialsBySurface = {
  appGrid: {
    seed: 137,
    textureStrength: 1,
    granularity: 9,
    vSteps: 8,
    color: { h: 32, s: 0.12, v: 0.95, a: 0.16 },
  },
  sidebarContent: {
    seed: 211,
    textureStrength: 1,
    granularity: 8,
    vSteps: 7,
    color: { h: 30, s: 0.11, v: 0.93, a: 0.17 },
  },
  editorEditText: {
    seed: 389,
    textureStrength: 1,
    granularity: 10,
    vSteps: 9,
    color: { h: 29, s: 0.1, v: 0.92, a: 0.14 },
  },
  editorRenderText: {
    seed: 467,
    textureStrength: 1,
    granularity: 11,
    vSteps: 9,
    color: { h: 31, s: 0.1, v: 0.94, a: 0.12 },
  },
};

export type TextureWorkerRequest = {
  width: number;
  height: number;
  seed: number;
  textureStrength: number;
  granularity: number;
  vSteps: number;
};

export type TextureWorkerResponse = {
  buffer: ArrayBuffer;
  mimeType: string;
};
