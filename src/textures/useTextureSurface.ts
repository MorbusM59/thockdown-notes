import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextureCacheRequest } from '../shared/textures';
import type { TextureMaterialSettings, TextureSurfaceKey, TextureWorkerRequest, TextureWorkerResponse } from './types';
import { clampMaterialSettings } from './generateTexture';

export const TEXTURE_ALGORITHM_VERSION = 1;

function quantizeDimension(value: number): number {
  const safe = Math.max(64, Math.min(4096, Math.floor(value)));
  return Math.ceil(safe / 64) * 64;
}

function revokeUrl(url: string | null): void {
  if (!url) return;
  URL.revokeObjectURL(url);
}

function createBlobUrl(data: Uint8Array, mimeType: string): string {
  const blob = new Blob([data], { type: mimeType || 'image/webp' });
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

export function useTextureSurface(params: {
  enabled: boolean;
  surface: TextureSurfaceKey;
  width: number;
  height: number;
  material: TextureMaterialSettings;
}): string {
  const { enabled, surface } = params;
  const material = useMemo(() => clampMaterialSettings(params.material), [params.material]);
  const materialSeed = material.seed;
  const materialGranularity = material.granularity;
  const materialVSteps = material.vSteps;
  const materialColorH = material.color.h;
  const materialColorS = material.color.s;
  const materialColorV = material.color.v;
  const materialColorA = material.color.a;
  const width = useMemo(() => quantizeDimension(params.width), [params.width]);
  const height = useMemo(() => quantizeDimension(params.height), [params.height]);
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
      width,
      height,
      seed: materialSeed,
      granularity: materialGranularity,
      vSteps: materialVSteps,
      color: {
        h: materialColorH,
        s: materialColorS,
        v: materialColorV,
        a: materialColorA,
      },
      algorithmVersion: TEXTURE_ALGORITHM_VERSION,
    };

    const run = async () => {
      const textureApi = window.measlyTextures;
      try {
        if (textureApi) {
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
        const workerRequest: TextureWorkerRequest = {
          width,
          height,
          seed: materialSeed,
          granularity: materialGranularity,
          vSteps: materialVSteps,
          color: {
            h: materialColorH,
            s: materialColorS,
            v: materialColorV,
            a: materialColorA,
          },
        };

        const response = await new Promise<TextureWorkerResponse>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<TextureWorkerResponse>) => resolve(event.data);
          worker.onerror = (error) => reject(error);
          worker.postMessage(workerRequest);
        });
        worker.terminate();
        workerRef.current = null;

        if (cancelled) return;

        const data = new Uint8Array(response.buffer);
        const generatedUrl = createBlobUrl(data, response.mimeType);
        swapUrl(generatedUrl, currentUrlRef, setUrl);

        if (textureApi) {
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
    height,
    materialColorA,
    materialColorH,
    materialColorS,
    materialColorV,
    materialGranularity,
    materialSeed,
    materialVSteps,
    surface,
    width,
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
