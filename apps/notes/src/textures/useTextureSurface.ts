import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextureCacheRequest } from '../shared/textures';
import type { TextureMaterialSettings, TextureSurfaceKey, TextureWorkerRequest, TextureWorkerResponse } from '@thockdown/look/textureTypes';
import { clampMaterialSettings } from './generateTexture';
import { beginBackgroundWork } from '../shared/backgroundWork';

export const TEXTURE_ALGORITHM_VERSION = 3;
export const TEXTURE_REPEAT_TILE_SIZE = 512;

function revokeUrl(url: string | null): void {
  if (!url) return;
  URL.revokeObjectURL(url);
}

function createBlobUrl(data: Uint8Array, mimeType: string): string {
  const blobBytes = new Uint8Array(data.byteLength);
  blobBytes.set(data);
  const blob = new Blob([blobBytes], { type: mimeType || 'image/webp' });
  return URL.createObjectURL(blob);
}

/**
 * Replaces the shown texture with `nextUrl` once it is ready to paint.
 *
 * A CSS image whose URL has just changed is fetched and decoded after the
 * style commits, and until it is, the layer it belongs to paints nothing: a
 * texture used as a mask showed its tint unmasked for a frame, a bright flash
 * on every change. So the new image is decoded first (an `Image` sharing the
 * URL warms the same decoded-image cache the style will read), and only then
 * does the style switch to it; the old image stays on screen until that
 * moment. The `Image` asks for CORS because CSS fetches a mask image that
 * way, and the decoded-image cache keeps the two modes apart: without it the
 * decode warmed an entry the mask never read, and the flash stayed. `isCurrent` is asked after the decode, because the settings may
 * have changed while it ran, and a texture nobody wants any more is revoked
 * instead of shown. The previous URL is revoked a frame after the switch,
 * once the new one has painted.
 */
async function swapUrl(
  nextUrl: string,
  isCurrent: () => boolean,
  currentUrlRef: React.MutableRefObject<string | null>,
  setUrl: (value: string | null) => void,
): Promise<void> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = nextUrl;
  try {
    await image.decode();
  } catch {
    // An image that will not decode will not paint either; showing it is no
    // worse than keeping the old one, and keeps the hook's state truthful.
  }
  if (!isCurrent()) {
    revokeUrl(nextUrl);
    return;
  }
  const previousUrl = currentUrlRef.current;
  currentUrlRef.current = nextUrl;
  setUrl(nextUrl);
  if (previousUrl && previousUrl !== nextUrl) {
    window.requestAnimationFrame(() => {
      revokeUrl(previousUrl);
    });
  }
}

/**
 * One texture worker and the request it is answering, owned together.
 *
 * `Worker.terminate()` ends a worker without firing `message` or `error`, so a
 * promise waiting on either never settles once the worker is terminated from
 * outside -- and a `finally` behind that promise never runs. This hook
 * terminates its worker whenever the texture's settings change mid-generation
 * or the surface unmounts, so ending the background-work entry in the
 * awaiting code's `finally` leaked one entry per cancelled generation and
 * left the sidebar's cogwheel turning for the rest of the session. A fresh
 * install, which has no cached texture and settles its settings during the
 * first generation, did this on every launch until a texture reached the
 * cache.
 *
 * So the only way to end a worker is `retire`, which terminates it, ends the
 * background-work entry and rejects the pending request in one step. It is
 * idempotent: the answer arriving and a later cleanup both retire.
 */
interface TextureJob {
  answer: Promise<TextureWorkerResponse>;
  retire: () => void;
}

export function startTextureJob(request: TextureWorkerRequest): TextureJob {
  const worker = new Worker(new URL('./textureWorker.ts', import.meta.url), { type: 'module' });
  // Announced through the one register of work in flight
  // (shared/backgroundWork.ts), which is what turns the sidebar's cogwheel.
  const work = beginBackgroundWork('texture');
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
 * A texture for one surface, as a CSS `url(...)`. Every surface is one
 * TEXTURE_REPEAT_TILE_SIZE square tile that the stylesheets repeat
 * (`mask-repeat: repeat` at `--texture-tile-size`), so how big the surface is
 * on screen never changes what is generated -- which is why this takes no
 * size, and why nothing needs to watch a surface being resized.
 */
export function useTextureSurface(params: {
  enabled: boolean;
  surface: TextureSurfaceKey;
  material: TextureMaterialSettings;
  usePersistentCache?: boolean;
}): string {
  const { enabled, surface } = params;
  const usePersistentCache = params.usePersistentCache ?? true;
  const material = useMemo(() => clampMaterialSettings(params.material), [params.material]);
  const materialSeed = material.seed;
  const materialGranularity = material.granularity;
  const materialVSteps = material.vSteps;
  const [url, setUrl] = useState<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const jobRef = useRef<TextureJob | null>(null);
  const generationTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (generationTimeoutRef.current !== null) {
        window.clearTimeout(generationTimeoutRef.current);
        generationTimeoutRef.current = null;
      }
      jobRef.current?.retire();
      jobRef.current = null;
      revokeUrl(currentUrlRef.current);
      currentUrlRef.current = null;
      setUrl(null);
      return;
    }

    let cancelled = false;

    const cacheKey: TextureCacheRequest = {
      surface,
      width: TEXTURE_REPEAT_TILE_SIZE,
      height: TEXTURE_REPEAT_TILE_SIZE,
      seed: materialSeed,
      granularity: materialGranularity,
      vSteps: materialVSteps,
      algorithmVersion: TEXTURE_ALGORITHM_VERSION,
    };

    const run = async () => {
      const textureApi = window.thockdownTextures;
      try {
        if (textureApi && usePersistentCache) {
          const cached = await textureApi.getCachedTexture(cacheKey);
          if (cached && !cancelled) {
            const cachedUrl = createBlobUrl(cached.data, cached.mimeType);
            await swapUrl(cachedUrl, () => !cancelled, currentUrlRef, setUrl);
            return;
          }
        }

        // The cache lookup is awaited, and the effect may have been cleaned up
        // meanwhile; a job started now would have no cleanup left to retire it.
        if (cancelled) return;
        jobRef.current?.retire();
        jobRef.current = null;

        const job = startTextureJob({
          width: TEXTURE_REPEAT_TILE_SIZE,
          height: TEXTURE_REPEAT_TILE_SIZE,
          seed: materialSeed,
          granularity: materialGranularity,
          vSteps: materialVSteps,
        });
        jobRef.current = job;
        const response = await job.answer;
        if (jobRef.current === job) jobRef.current = null;

        if (cancelled) return;

        const data = new Uint8Array(response.buffer);
        const generatedUrl = createBlobUrl(data, response.mimeType);
        await swapUrl(generatedUrl, () => !cancelled, currentUrlRef, setUrl);

        if (textureApi && usePersistentCache) {
          await textureApi.saveCachedTexture(cacheKey, {
            data,
            mimeType: response.mimeType,
          });
        }
      } catch {
        // Keep the last successful frame visible on generation/cache errors.
      }
    };

    generationTimeoutRef.current = window.setTimeout(() => {
      generationTimeoutRef.current = null;
      void run();
    }, 40);

    return () => {
      cancelled = true;
      if (generationTimeoutRef.current !== null) {
        window.clearTimeout(generationTimeoutRef.current);
        generationTimeoutRef.current = null;
      }
      jobRef.current?.retire();
      jobRef.current = null;
    };
  }, [
    enabled,
    materialGranularity,
    materialSeed,
    materialVSteps,
    surface,
    usePersistentCache,
  ]);

  useEffect(() => {
    return () => {
      if (generationTimeoutRef.current !== null) {
        window.clearTimeout(generationTimeoutRef.current);
        generationTimeoutRef.current = null;
      }
      jobRef.current?.retire();
      jobRef.current = null;
      revokeUrl(currentUrlRef.current);
      currentUrlRef.current = null;
    };
  }, []);

  return url ? `url(${url})` : 'none';
}
