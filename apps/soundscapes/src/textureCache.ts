import type { TexturePorts } from '@thockdown/look/textures/textureStore'
import type { TextureCacheRequest } from '@thockdown/look/textureTypes'

/**
 * The phone's persistent cache of generated texture masks
 * (`@thockdown/look/textures/textureStore.ts`'s port): the WebView's Cache
 * Storage, keyed by everything a mask is made of, so each of the shipped
 * layouts' textures is generated once on this device and read back on every
 * later launch. The desktop keeps the same masks on disk through its main
 * process. Cache Storage is a browser feature with no permission, and its
 * entries go with the app's data.
 */
const CACHE_NAME = 'thockdown-textures'

function keyOf(request: TextureCacheRequest): string {
  const { surface, width, height, seed, textureStrength, granularity, vSteps, algorithmVersion } = request
  // A mask depends on its material, never on its surface (textureStore.ts's
  // maskKeyOf), so two surfaces of one material share an entry.
  void surface
  return `/texture/${algorithmVersion}/${width}x${height}/${seed}/${textureStrength}/${granularity}/${vSteps}`
}

function openCache(): Promise<Cache> | null {
  return typeof caches === 'undefined' ? null : caches.open(CACHE_NAME)
}

export const phoneTextureCache: TexturePorts['cache'] = {
  async get(request) {
    const cache = await openCache()
    const response = await cache?.match(keyOf(request))
    if (!response) return null
    return { data: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get('content-type') ?? 'image/webp' }
  },
  async save(request, payload) {
    const cache = await openCache()
    if (!cache) return
    const body = new Uint8Array(payload.data.byteLength)
    body.set(payload.data)
    await cache.put(keyOf(request), new Response(body, { headers: { 'content-type': payload.mimeType } }))
  },
}
