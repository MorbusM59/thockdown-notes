import type { TextureCacheRequest, TextureCacheHit, TextureMaterialSettings, TextureSurfaceKey, TextureWorkerRequest, TextureWorkerResponse } from '../textureTypes';
import { clampMaterialSettings } from './generateTexture';

/**
 * What the store asks of the app it runs in, supplied once at start-up
 * (`installTexturePorts`): a PERSISTENT CACHE of generated masks (the desktop
 * keeps them on disk through IPC, the phone in the WebView's Cache Storage),
 * and an observer told when a generation starts and ends (the desktop's
 * background-work indicator). Both are optional: without a cache every mask is
 * generated once per run, without an observer nothing is told.
 */
export interface TexturePorts {
  cache?: {
    get(request: TextureCacheRequest): Promise<TextureCacheHit | null>;
    save(request: TextureCacheRequest, payload: TextureCacheHit): Promise<void>;
  };
  beginWork?: () => { done(): void };
}

let ports: TexturePorts = {};

export function installTexturePorts(next: TexturePorts): void {
  ports = next;
}

/**
 * Every texture image the app shows, held READY TO PAINT and looked up by
 * what it is made of.
 *
 * A layout switch changes colours, geometry and textures at once. The colours
 * are React state and reach the screen in the next commit; a texture is an
 * image that has to be read from the cache (IPC) or generated (a worker),
 * then decoded, and only then can a CSS `url()` paint it. When each surface
 * resolved that on its own after the colours had already been committed, a
 * switch showed the new colours over the old textures, then each of four
 * surfaces changing in its own frame, and the backdrop panels empty for up to
 * a second while their composed image was rebuilt (measured: four to six
 * distinct looks over 350–900ms for one press).
 *
 * So a texture is an entry here, keyed by its content, and the switch is one
 * transaction: `prepareLookTextures` brings every image the next look needs
 * into this store, decoded, and only then does the layout's state change. In
 * that render every surface finds its image here SYNCHRONOUSLY
 * (`readyTexture`), so colours and textures arrive in the same frame. A
 * texture that is not here (a slider being dragged) is loaded by its hook,
 * which keeps showing the previous image meanwhile, never nothing.
 *
 * Entries are blob URLs whose image has already been decoded once. Up to
 * `KEEP_ENTRIES` are kept, least recently used dropped first, except an entry
 * a surface is showing (`pinTexture`), which is never revoked under it.
 */

export const TEXTURE_ALGORITHM_VERSION = 5;
export const TEXTURE_REPEAT_TILE_SIZE = 512;

/** About three looks' worth of masks and composed backdrops. */
const KEEP_ENTRIES = 16;

const ready = new Map<string, string>();
const pins = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();

function trim(): void {
  if (ready.size <= KEEP_ENTRIES) return;
  for (const [key, url] of ready) {
    if (ready.size <= KEEP_ENTRIES) return;
    if (pins.has(key)) continue;
    ready.delete(key);
    URL.revokeObjectURL(url);
  }
}

function remember(key: string, url: string): void {
  ready.delete(key);
  ready.set(key, url);
  trim();
}

/** The image for `key` if it is ready to paint now, refreshed as recently used. */
export function readyTexture(key: string | null): string | null {
  if (key === null) return null;
  const url = ready.get(key);
  if (url === undefined) return null;
  ready.delete(key);
  ready.set(key, url);
  return url;
}

/** Keeps `key`'s image from being revoked while a surface shows it. */
export function pinTexture(key: string): () => void {
  pins.set(key, (pins.get(key) ?? 0) + 1);
  return () => {
    const count = (pins.get(key) ?? 1) - 1;
    if (count > 0) pins.set(key, count);
    else {
      pins.delete(key);
      trim();
    }
  };
}

/**
 * Decodes `url` before it is used: a CSS image whose URL just changed paints
 * nothing until it has been fetched and decoded, so a layer masked by it
 * showed its tint unmasked for a frame. An `Image` sharing the URL warms the
 * same decoded-image cache, and asks for CORS because CSS fetches a mask that
 * way and the cache keeps the two modes apart.
 */
async function decoded(url: string): Promise<void> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  try {
    await image.decode();
  } catch {
    // An image that will not decode will not paint either; using it is no
    // worse than keeping the old one.
  }
}

/** One loader per key at a time: a hook and a switch asking together share it. */
function load(key: string, produce: () => Promise<string | null>): Promise<string | null> {
  const known = readyTexture(key);
  if (known) return Promise.resolve(known);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = produce()
    .then(async (url) => {
      if (url === null) return null;
      await decoded(url);
      remember(key, url);
      return url;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function createBlobUrl(data: Uint8Array, mimeType: string): string {
  const blobBytes = new Uint8Array(data.byteLength);
  blobBytes.set(data);
  return URL.createObjectURL(new Blob([blobBytes], { type: mimeType || 'image/webp' }));
}

/**
 * One texture worker and the request it is answering, owned together.
 *
 * `Worker.terminate()` ends a worker without firing `message` or `error`, so a
 * promise waiting on either never settles once the worker is terminated from
 * outside, and a `finally` behind it never runs: ending the background-work
 * entry there leaked one entry per cancelled generation and left the
 * sidebar's cogwheel turning. So the only way to end a worker is `retire`,
 * which terminates it, ends the background-work entry and rejects the pending
 * request in one step. It is idempotent.
 */
export interface TextureJob {
  answer: Promise<TextureWorkerResponse>;
  retire: () => void;
}

export function startTextureJob(request: TextureWorkerRequest): TextureJob {
  const worker = new Worker(new URL('./textureWorker.ts', import.meta.url), { type: 'module' });
  const work = ports.beginWork?.() ?? { done: () => {} };
  let settle: ((error?: unknown) => void) | null = null;
  const answer = new Promise<TextureWorkerResponse>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<TextureWorkerResponse>) => {
      resolve(event.data);
      retire();
    };
    worker.onerror = (error) => {
      reject(error);
      retire();
    };
    settle = reject;
  });
  let retired = false;
  const retire = () => {
    if (retired) return;
    retired = true;
    worker.terminate();
    work.done();
    settle?.(new Error('texture worker retired'));
  };
  worker.postMessage(request);
  return { answer, retire };
}

/**
 * The store key of a surface's mask, or null when it has none: at strength 0
 * every mask pixel would be opaque, which is exactly what `mask-image: none`
 * draws. The image depends only on the material's shape, never on the
 * surface, so two surfaces of one material share it.
 */
export function maskKeyOf(material: TextureMaterialSettings, enabled: boolean): string | null {
  const { seed, textureStrength, granularity, vSteps } = clampMaterialSettings(material);
  if (!enabled || textureStrength <= 0) return null;
  return `mask:${TEXTURE_ALGORITHM_VERSION}:${seed}:${textureStrength}:${granularity}:${vSteps}`;
}

/**
 * Loads a surface's mask into the store: the persistent cache first, then a
 * worker (whose result is saved to the cache). `isWanted` is asked before the
 * worker starts and the worker is retired if it stops being wanted, so a
 * slider dragged past a value does not finish generating it.
 */
export function loadMask(
  surface: TextureSurfaceKey,
  rawMaterial: TextureMaterialSettings,
  options: { usePersistentCache: boolean; isWanted: () => boolean; onJob?: (job: TextureJob) => void },
): Promise<string | null> {
  const key = maskKeyOf(rawMaterial, true);
  if (key === null) return Promise.resolve(null);
  const { seed, textureStrength, granularity, vSteps } = clampMaterialSettings(rawMaterial);
  return load(key, async () => {
    const cacheKey: TextureCacheRequest = {
      surface,
      width: TEXTURE_REPEAT_TILE_SIZE,
      height: TEXTURE_REPEAT_TILE_SIZE,
      seed,
      textureStrength,
      granularity,
      vSteps,
      algorithmVersion: TEXTURE_ALGORITHM_VERSION,
    };
    const cache = options.usePersistentCache ? ports.cache : undefined;
    if (cache) {
      const cached = await cache.get(cacheKey);
      if (cached) return createBlobUrl(cached.data, cached.mimeType);
    }
    if (!options.isWanted()) return null;
    const job = startTextureJob({ width: TEXTURE_REPEAT_TILE_SIZE, height: TEXTURE_REPEAT_TILE_SIZE, seed, textureStrength, granularity, vSteps });
    options.onJob?.(job);
    const response = await job.answer;
    const data = new Uint8Array(response.buffer);
    if (cache) {
      void cache.save(cacheKey, { data, mimeType: response.mimeType }).catch(() => {});
    }
    return createBlobUrl(data, response.mimeType);
  });
}

/** The store key of a mask composed under a tint (`loadTinted`). */
export function tintedKeyOf(maskKey: string, tintCss: string): string {
  return `tinted:${maskKey}|${tintCss}`;
}

/**
 * A mask and its tint composed ONCE into an ordinary image, for the backdrop
 * panels that take the texture as a background image rather than as a masked
 * layer. The mask is used through its alpha (CSS's default `mask-mode` for an
 * image), so `source-in` under the tint gives exactly what the masked layer
 * shows.
 */
export function loadTinted(maskKey: string, maskUrl: string, tintCss: string): Promise<string | null> {
  return load(tintedKeyOf(maskKey, tintCss), async () => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = maskUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_REPEAT_TILE_SIZE;
    canvas.height = TEXTURE_REPEAT_TILE_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = tintCss;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
  });
}

/**
 * Brings every image a look needs into the store, decoded: each surface's
 * mask and, for each `tinted` surface, its mask composed under its tint. The
 * caller applies the look once this settles, so the look's first render finds
 * all of them ready. Generation is not cancelled here: a switch that was
 * superseded still leaves a cached texture behind, and the next visit to that
 * layout is immediate.
 */
export async function prepareLookTextures(
  surfaces: ReadonlyArray<{ surface: TextureSurfaceKey; material: TextureMaterialSettings; tintCss?: string }>,
  enabled: boolean,
): Promise<void> {
  await Promise.all(surfaces.map(async ({ surface, material, tintCss }) => {
    const maskKey = maskKeyOf(material, enabled);
    if (maskKey === null) return;
    const maskUrl = await loadMask(surface, material, { usePersistentCache: true, isWanted: () => true });
    if (maskUrl && tintCss !== undefined) await loadTinted(maskKey, maskUrl, tintCss);
  }));
}
