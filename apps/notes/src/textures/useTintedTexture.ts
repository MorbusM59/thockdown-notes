import { useMemo } from 'react';
import type { TextureMaterialSettings, TextureSurfaceKey } from '@thockdown/look/textureTypes';
import { loadMask, loadTinted, maskKeyOf, tintedKeyOf } from './textureStore';
import { useStoredImage } from './useTextureSurface';

/**
 * A surface's texture mask and its tint, composed ONCE into an ordinary
 * image, as a CSS image value.
 *
 * The scrolling sidebar draws its texture as a masked tint layer, a child
 * element it keeps in step with its scroll. Every other backdrop panel (the
 * toolbar, the window controls, input fields, scroll tracks) does not scroll,
 * and an input cannot hold a child at all, so they take the same texture as a
 * BACKGROUND IMAGE instead: this one image, shared through
 * `--backdrop-texture`, with no layer, mask or composited element per panel.
 * Both read the same material, so the two routes draw the same thing.
 *
 * The composition lives in the texture store (textureStore.ts), keyed by the
 * mask it is made from and the tint, so a layout switch prepares it with the
 * mask and it arrives in the same frame as the colours; while a changed tint
 * or material is being composed, the previous image stays. With no mask
 * (texture strength 0) the masked layer shows its tint whole, and so does
 * this: a flat gradient of the tint -- which is also what the masked layer
 * shows before its first mask has loaded.
 */
export function useTintedTexture(params: {
  enabled: boolean;
  surface: TextureSurfaceKey;
  material: TextureMaterialSettings;
  tintCss: string;
}): string {
  const { enabled, surface, material, tintCss } = params;
  const maskKey = useMemo(() => maskKeyOf(material, enabled), [material, enabled]);
  const key = maskKey === null ? null : tintedKeyOf(maskKey, tintCss);
  const url = useStoredImage(key, (isWanted, onReady) => {
    if (maskKey === null) return;
    void loadMask(surface, material, { usePersistentCache: true, isWanted })
      .then((maskUrl) => (maskUrl && isWanted() ? loadTinted(maskKey, maskUrl, tintCss) : null))
      .then((loaded) => {
        if (loaded) onReady();
      });
  });
  return url ? `url(${url})` : `linear-gradient(${tintCss}, ${tintCss})`;
}
