import type { TextureSurfaceKey } from '../textures/types';

export const TEXTURE_CHANNELS = {
  getCached: 'texture:cache:get',
  saveCached: 'texture:cache:save',
  purgeCached: 'texture:cache:purge',
} as const;

export type TextureCacheRequest = {
  surface: TextureSurfaceKey;
  width: number;
  height: number;
  seed: number;
  granularity: number;
  vSteps: number;
  algorithmVersion: number;
};

export type TextureCacheHit = {
  data: Uint8Array;
  mimeType: string;
};

export type TextureCachePurgeRequest = {
  keep?: TextureCacheRequest[];
  maxEntries?: number;
  maxAgeMs?: number;
};

export interface TextureCacheApi {
  getCachedTexture(request: TextureCacheRequest): Promise<TextureCacheHit | null>;
  saveCachedTexture(request: TextureCacheRequest, payload: TextureCacheHit): Promise<void>;
  purgeCachedTextures(request?: TextureCachePurgeRequest): Promise<number>;
}
