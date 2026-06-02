import type { TextureColorHsva, TextureSurfaceKey } from '../textures/types';

export const TEXTURE_CHANNELS = {
  getCached: 'texture:cache:get',
  saveCached: 'texture:cache:save',
} as const;

export type TextureCacheRequest = {
  surface: TextureSurfaceKey;
  width: number;
  height: number;
  seed: number;
  granularity: number;
  vSteps: number;
  color: TextureColorHsva;
  algorithmVersion: number;
};

export type TextureCacheHit = {
  data: Uint8Array;
  mimeType: string;
};

export interface TextureCacheApi {
  getCachedTexture(request: TextureCacheRequest): Promise<TextureCacheHit | null>;
  saveCachedTexture(request: TextureCacheRequest, payload: TextureCacheHit): Promise<void>;
}
