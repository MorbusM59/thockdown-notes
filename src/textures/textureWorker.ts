/// <reference lib="webworker" />

import { clampMaterialSettings, generateTextureRgba } from './generateTexture';
import type { TextureMaterialSettings, TextureWorkerRequest, TextureWorkerResponse } from './types';

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<TextureWorkerRequest>) => {
  const payload = event.data;
  const width = Math.max(1, Math.floor(payload.width));
  const height = Math.max(1, Math.floor(payload.height));

  const material: TextureMaterialSettings = clampMaterialSettings({
    seed: payload.seed,
    granularity: payload.granularity,
    vSteps: payload.vSteps,
    color: payload.color,
  });

  const rgba = generateTextureRgba({ width, height, material });

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const imageDataBytes = new Uint8ClampedArray(rgba);
    context.putImageData(new ImageData(imageDataBytes, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
    const buffer = await blob.arrayBuffer();
    const response: TextureWorkerResponse = { buffer, mimeType: 'image/webp' };
    workerScope.postMessage(response, [buffer]);
    return;
  }

  const fallbackBuffer = rgba.buffer instanceof ArrayBuffer
    ? rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)
    : new Uint8Array(rgba).buffer;
  const response: TextureWorkerResponse = { buffer: fallbackBuffer, mimeType: 'application/octet-stream' };
  workerScope.postMessage(response, [fallbackBuffer]);
};

export {};
