import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextureCacheRequest } from '../shared/textures';
import type { TextureMaterialSettings, TextureSurfaceKey, TextureWorkerRequest, TextureWorkerResponse } from './types';
import { clampMaterialSettings } from './generateTexture';
import { beginBackgroundWork } from '../shared/backgroundWork';

export const TEXTURE_ALGORITHM_VERSION = 2;
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

function swapUrl(nextUrl: string, currentUrlRef: React.MutableRefObject<string | null>, setUrl: (value: string | null) => void): void {
  const previousUrl = currentUrlRef.current;
  currentUrlRef.current = nextUrl;
  setUrl(nextUrl);

  // Keep the previously rendered frame alive through this paint to avoid
  // brief blanking while style updates commit to the new blob URL.
  if (previousUrl && previousUrl !== nextUrl) {
    window.requestAnimationFrame(() => {
      revokeUrl(previousUrl);
    });
  }
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
  const workerRef = useRef<Worker | null>(null);
  const generationTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (generationTimeoutRef.current !== null) {
        window.clearTimeout(generationTimeoutRef.current);
        generationTimeoutRef.current = null;
      }
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
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
            swapUrl(cachedUrl, currentUrlRef, setUrl);
            return;
          }
        }

        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }

        const worker = new Worker(new URL('./textureWorker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        // Announced to the reader through the one register of work in flight
        // (shared/backgroundWork.ts), which is what turns the sidebar's
        // cogwheel. Ended in `finally` rather than after the await, because
        // this path has three exits -- resolved, rejected into the catch, and
        // cancelled -- and a register that leaks an entry leaves the wheel
        // turning forever.
        const work = beginBackgroundWork('texture');
        const workerRequest: TextureWorkerRequest = {
          width: TEXTURE_REPEAT_TILE_SIZE,
          height: TEXTURE_REPEAT_TILE_SIZE,
          seed: materialSeed,
          granularity: materialGranularity,
          vSteps: materialVSteps,
        };

        let response: TextureWorkerResponse;
        try {
          response = await new Promise<TextureWorkerResponse>((resolve, reject) => {
            worker.onmessage = (event: MessageEvent<TextureWorkerResponse>) => resolve(event.data);
            worker.onerror = (error) => reject(error);
            worker.postMessage(workerRequest);
          });
        } finally {
          work.done();
        }
        worker.terminate();
        workerRef.current = null;

        if (cancelled) return;

        const data = new Uint8Array(response.buffer);
        const generatedUrl = createBlobUrl(data, response.mimeType);
        swapUrl(generatedUrl, currentUrlRef, setUrl);

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
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
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
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      revokeUrl(currentUrlRef.current);
      currentUrlRef.current = null;
    };
  }, []);

  return url ? `url(${url})` : 'none';
}
