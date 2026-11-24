import type { InvokeChannels } from '@thockdown/visualizer/shared/ipcContract';
import type { TextureCacheHit, TextureCacheRequest } from '@thockdown/look/textureTypes';

export type { TextureCacheHit, TextureCacheRequest };

export const TEXTURE_CHANNELS = {
  getCachedTexture: 'texture:cache:get',
  saveCachedTexture: 'texture:cache:save',
  purgeCachedTextures: 'texture:cache:purge',
} as const satisfies InvokeChannels<TextureCacheApi>;


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
