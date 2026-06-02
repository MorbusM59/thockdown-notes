import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextureCacheRequest } from '../shared/textures';
import type { TextureMaterialSettings, TextureSurfaceKey, TextureWorkerRequest, TextureWorkerResponse } from './types';
import { clampMaterialSettings } from './generateTexture';

export const TEXTURE_ALGORITHM_VERSION = 1;

function quantizeDimension(value: number): number {
  const safe = Math.max(64, Math.floor(value));
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

export function useTextureSurface(params: {
  enabled: boolean;
  surface: TextureSurfaceKey;
  width: number;
  height: number;
  material: TextureMaterialSettings;
}): string {
  const { enabled, surface } = params;
  const material = useMemo(() => clampMaterialSettings(params.material), [params.material]);
  const width = useMemo(() => quantizeDimension(params.width), [params.width]);
  const height = useMemo(() => quantizeDimension(params.height), [params.height]);
  const [url, setUrl] = useState<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
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
      seed: material.seed,
      granularity: material.granularity,
      vSteps: material.vSteps,
      color: material.color,
      algorithmVersion: TEXTURE_ALGORITHM_VERSION,
    };

    const run = async () => {
      const textureApi = window.measlyTextures;
      try {
        if (textureApi) {
          const cached = await textureApi.getCachedTexture(cacheKey);
          if (cached && !cancelled) {
            const cachedUrl = createBlobUrl(cached.data, cached.mimeType);
            revokeUrl(currentUrlRef.current);
            currentUrlRef.current = cachedUrl;
            setUrl(cachedUrl);
            return;
          }
        }

        const worker = new Worker(new URL('./textureWorker.ts', import.meta.url), { type: 'module' });
        const workerRequest: TextureWorkerRequest = {
          width,
          height,
          seed: material.seed,
          granularity: material.granularity,
          vSteps: material.vSteps,
          color: material.color,
        };

        const response = await new Promise<TextureWorkerResponse>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<TextureWorkerResponse>) => resolve(event.data);
          worker.onerror = (error) => reject(error);
          worker.postMessage(workerRequest);
        });
        worker.terminate();

        if (cancelled) return;

        const data = new Uint8Array(response.buffer);
        const generatedUrl = createBlobUrl(data, response.mimeType);
        revokeUrl(currentUrlRef.current);
        currentUrlRef.current = generatedUrl;
        setUrl(generatedUrl);

        if (textureApi) {
          await textureApi.saveCachedTexture(cacheKey, {
            data,
            mimeType: response.mimeType,
          });
        }
      } catch {
        if (!cancelled) {
          revokeUrl(currentUrlRef.current);
          currentUrlRef.current = null;
          setUrl(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [enabled, height, material, surface, width]);

  useEffect(() => {
    return () => {
      revokeUrl(currentUrlRef.current);
      currentUrlRef.current = null;
    };
  }, []);

  return url ? `url(${url})` : 'none';
}
