export type TextureSurfaceKey = 'appGrid' | 'sidebarContent' | 'editorEditText' | 'editorRenderText';

export type TextureColorHsva = {
  h: number;
  s: number;
  v: number;
  a: number;
};

export type TextureMaterialSettings = {
  seed: number;
  granularity: number;
  vSteps: number;
  color: TextureColorHsva;
};

export type TextureMaterialsBySurface = Record<TextureSurfaceKey, TextureMaterialSettings>;

export const TEXTURE_SURFACES: TextureSurfaceKey[] = ['appGrid', 'sidebarContent', 'editorEditText', 'editorRenderText'];

export const DEFAULT_TEXTURE_MATERIALS: TextureMaterialsBySurface = {
  appGrid: {
    seed: 137,
    granularity: 9,
    vSteps: 8,
    color: { h: 32, s: 0.12, v: 0.95, a: 0.16 },
  },
  sidebarContent: {
    seed: 211,
    granularity: 8,
    vSteps: 7,
    color: { h: 30, s: 0.11, v: 0.93, a: 0.17 },
  },
  editorEditText: {
    seed: 389,
    granularity: 10,
    vSteps: 9,
    color: { h: 29, s: 0.1, v: 0.92, a: 0.14 },
  },
  editorRenderText: {
    seed: 467,
    granularity: 11,
    vSteps: 9,
    color: { h: 31, s: 0.1, v: 0.94, a: 0.12 },
  },
};

export type TextureWorkerRequest = {
  width: number;
  height: number;
  seed: number;
  granularity: number;
  vSteps: number;
  color: TextureColorHsva;
};

export type TextureWorkerResponse = {
  buffer: ArrayBuffer;
  mimeType: string;
};
