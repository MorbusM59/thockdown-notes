import { useEffect, useState } from 'react';
import { TEXTURE_REPEAT_TILE_SIZE } from './useTextureSurface';

/**
 * A texture's mask tile and its tint, composed ONCE into an ordinary image, as
 * a CSS image value.
 *
 * The scrolling sidebar draws its texture as a masked tint layer, a child
 * element it keeps in step with its scroll. Every other backdrop panel (the
 * toolbar, the window controls, input fields, scroll tracks) does not scroll,
 * and an input cannot hold a child at all, so they take the same texture as a
 * BACKGROUND IMAGE instead: this one image, shared through
 * `--backdrop-texture`, with no layer, mask or composited element per panel.
 * Both read the same material, so the two routes draw the same thing.
 *
 * The mask is used through its alpha (CSS's default `mask-mode` for an image),
 * so `source-in` under the tint gives exactly what the masked layer shows.
 * With no mask (`'none'`, texture strength 0) the masked layer shows its tint
 * whole, and so does this: a flat gradient of the tint. Composed only when the
 * mask or the tint changes; the previous image is revoked a frame after the
 * new one is in use.
 */
export function useTintedTexture(maskCss: string, tintCss: string): string {
  const maskUrl = /^url\((.*)\)$/.exec(maskCss)?.[1] ?? null;
  const [composed, setComposed] = useState<{ key: string; url: string } | null>(null);
  const key = `${maskUrl}|${tintCss}`;

  useEffect(() => {
    if (!maskUrl) return;
    let cancelled = false;
    const run = async () => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = maskUrl;
      try {
        await image.decode();
      } catch {
        return;
      }
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = TEXTURE_REPEAT_TILE_SIZE;
      canvas.height = TEXTURE_REPEAT_TILE_SIZE;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = tintCss;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob || cancelled) return;
      const url = URL.createObjectURL(blob);
      const decoded = new Image();
      decoded.src = url;
      try {
        await decoded.decode();
      } catch {
        // Shown anyway: no worse than the previous image.
      }
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      setComposed((previous) => {
        if (previous) window.requestAnimationFrame(() => URL.revokeObjectURL(previous.url));
        return { key, url };
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [key, maskUrl, tintCss]);

  useEffect(() => () => {
    setComposed((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
  }, []);

  if (!maskUrl) return `linear-gradient(${tintCss}, ${tintCss})`;
  // Until the new composition is ready the previous one stays on screen, as
  // the masked layer keeps its old mask until the new one has decoded.
  return composed ? `url(${composed.url})` : `linear-gradient(transparent, transparent)`;
}
