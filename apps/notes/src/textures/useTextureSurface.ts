import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { TextureMaterialSettings, TextureSurfaceKey } from '@thockdown/look/textureTypes';
import { loadMask, maskKeyOf, pinTexture, readyTexture, type TextureJob } from './textureStore';

export { startTextureJob, TEXTURE_ALGORITHM_VERSION, TEXTURE_REPEAT_TILE_SIZE } from './textureStore';

/** How long a changed material must hold still before it is loaded (a slider being dragged). */
const SETTLE_MS = 40;

/**
 * The image a surface shows for `key`, read from the texture store
 * (textureStore.ts) IN RENDER, so a look whose textures were prepared before
 * it was applied shows them in the same frame as its colours. A key the store
 * does not have yet is loaded by `startLoad` once it has held still for
 * SETTLE_MS; until then the surface keeps the image it showed last, never
 * nothing. The shown entry is pinned so the store cannot revoke it.
 */
export function useStoredImage(
  key: string | null,
  startLoad: (isWanted: () => boolean, onReady: () => void) => (() => void) | void,
): string | null {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const shownRef = useRef<{ key: string; url: string } | null>(null);
  const readyUrl = readyTexture(key);
  const url = key === null ? null : readyUrl ?? shownRef.current?.url ?? null;
  const shownKey = key === null ? null : readyUrl ? key : shownRef.current?.key ?? null;

  useLayoutEffect(() => {
    shownRef.current = shownKey !== null && url !== null ? { key: shownKey, url } : null;
    if (shownKey === null) return;
    return pinTexture(shownKey);
  }, [shownKey, url]);

  const startLoadRef = useRef(startLoad);
  startLoadRef.current = startLoad;
  const missing = key !== null && readyUrl === null;
  useEffect(() => {
    if (!missing) return;
    let wanted = true;
    let release: (() => void) | void;
    const timer = window.setTimeout(() => {
      release = startLoadRef.current(() => wanted, () => { if (wanted) rerender(); });
    }, SETTLE_MS);
    return () => {
      wanted = false;
      window.clearTimeout(timer);
      release?.();
    };
  }, [key, missing]);

  return url;
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
  const { enabled, surface, material } = params;
  const usePersistentCache = params.usePersistentCache ?? true;
  const key = useMemo(() => maskKeyOf(material, enabled), [material, enabled]);
  const url = useStoredImage(key, (isWanted, onReady) => {
    let job: TextureJob | null = null;
    void loadMask(surface, material, {
      usePersistentCache,
      isWanted,
      onJob: (started) => { job = started; },
    }).then((loaded) => {
      if (loaded) onReady();
    });
    return () => (job as TextureJob | null)?.retire();
  });
  return url ? `url(${url})` : 'none';
}
