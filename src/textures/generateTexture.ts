import type { TextureColorHsva, TextureMaterialSettings } from './types';

type MaterialPersonality = {
  persistence: number;
  lacunarity: number;
  octaves: number;
  warpStrength: number;
  warpAxisBias: [number, number];
  featureBias: number;
};

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (t: number): number => t * t * (3 - (2 * t));
const lerp = (min: number, max: number, t: number): number => min + ((max - min) * t);

function samplePersonality(rng: () => number): MaterialPersonality {
  return {
    persistence: lerp(0.25, 0.65, rng()),
    lacunarity: rng() < 0.5 ? 2 : 3,
    octaves: 2 + Math.floor(rng() * 5),
    warpStrength: rng() < 0.4 ? 0 : lerp(0.2, 1.5, rng()),
    warpAxisBias: [rng(), rng()],
    featureBias: lerp(-0.3, 0.3, rng()),
  };
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function wrap(value: number, max: number): number {
  if (max <= 0) return 0;
  const v = value % max;
  return v < 0 ? v + max : v;
}

function buildGrid(cols: number, rows: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < grid.length; i += 1) {
    grid[i] = rng();
  }
  return grid;
}

function valueNoise(gx: number, gy: number, grid: Float32Array, cols: number, rows: number): number {
  const gx0 = Math.floor(gx);
  const gy0 = Math.floor(gy);
  const gx1 = gx0 + 1;
  const gy1 = gy0 + 1;

  const tx = smoothstep(gx - gx0);
  const ty = smoothstep(gy - gy0);

  const x0 = wrap(gx0, cols);
  const x1 = wrap(gx1, cols);
  const y0 = wrap(gy0, rows);
  const y1 = wrap(gy1, rows);

  const a = grid[(y0 * cols) + x0];
  const b = grid[(y0 * cols) + x1];
  const c = grid[(y1 * cols) + x0];
  const d = grid[(y1 * cols) + x1];

  return (
    (a * (1 - tx) * (1 - ty)) +
    (b * tx * (1 - ty)) +
    (c * (1 - tx) * ty) +
    (d * tx * ty)
  );
}

function fbm(
  u: number,
  v: number,
  grid: Float32Array,
  cols: number,
  rows: number,
  baseFrequency: number,
  personality: MaterialPersonality,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let octave = 0; octave < personality.octaves; octave += 1) {
    const sampleX = fract(u) * cols * baseFrequency * frequency;
    const sampleY = fract(v) * rows * baseFrequency * frequency;
    value += valueNoise(sampleX, sampleY, grid, cols, rows) * amplitude;
    maxValue += amplitude;
    amplitude *= personality.persistence;
    frequency *= personality.lacunarity;
  }

  return maxValue > 0 ? value / maxValue : 0;
}

function shapeValue(raw: number, featureBias: number): number {
  const exponent = Math.max(0.2, 1 - featureBias);
  return Math.pow(Math.max(0, Math.min(1, raw)), exponent);
}

function quantizeValue(value: number, vSteps: number): number {
  const safeSteps = Math.max(2, Math.min(20, Math.round(vSteps)));
  return Math.round(value * (safeSteps - 1)) / (safeSteps - 1);
}

export function generateTextureRgba(params: {
  width: number;
  height: number;
  material: TextureMaterialSettings;
}): Uint8ClampedArray {
  const width = Math.max(1, Math.floor(params.width));
  const height = Math.max(1, Math.floor(params.height));
  const material = params.material;
  const granularity = Math.max(1, Math.min(20, material.granularity));

  const cols = Math.max(4, Math.round(width / granularity));
  const rows = Math.max(4, Math.round(height / granularity));
  const baseFrequency = Math.max(0.25, 16 / granularity);

  const spatialGrid = buildGrid(cols, rows, material.seed >>> 0);
  const personality = samplePersonality(mulberry32((material.seed ^ 0xdeadbeef) >>> 0));

  const out = new Uint8ClampedArray(width * height * 4);

  const WX0 = 1.7;
  const WY0 = 9.2;
  const WX1 = 8.3;
  const WY1 = 2.8;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const baseU = x / width;
      const baseV = y / height;
      let sampleU = baseU;
      let sampleV = baseV;

      if (personality.warpStrength > 0) {
        const wx = valueNoise(
          fract(baseU + (WX0 / width)) * cols,
          fract(baseV + (WY0 / height)) * rows,
          spatialGrid,
          cols,
          rows,
        );
        const wy = valueNoise(
          fract(baseU + (WX1 / width)) * cols,
          fract(baseV + (WY1 / height)) * rows,
          spatialGrid,
          cols,
          rows,
        );

        const warpU = ((wx - 0.5) * 2 * personality.warpStrength * personality.warpAxisBias[0]) / cols;
        const warpV = ((wy - 0.5) * 2 * personality.warpStrength * personality.warpAxisBias[1]) / rows;
        sampleU = fract(baseU + warpU);
        sampleV = fract(baseV + warpV);
      }

      const raw = fbm(sampleU, sampleV, spatialGrid, cols, rows, baseFrequency, personality);
      const shaped = shapeValue(raw, personality.featureBias);
      const stepped = quantizeValue(shaped, material.vSteps);
      const idx = (y * width + x) * 4;
      out[idx] = 255;
      out[idx + 1] = 255;
      out[idx + 2] = 255;
      out[idx + 3] = Math.round(Math.max(0, Math.min(1, stepped)) * 255);
    }
  }

  return out;
}

export function clampMaterialSettings(material: TextureMaterialSettings): TextureMaterialSettings {
  const color: TextureColorHsva = {
    h: Number.isFinite(material.color.h) ? Math.max(0, Math.min(360, material.color.h)) : 0,
    s: Number.isFinite(material.color.s) ? Math.max(0, Math.min(1, material.color.s)) : 0,
    v: Number.isFinite(material.color.v) ? Math.max(0, Math.min(1, material.color.v)) : 1,
    a: Number.isFinite(material.color.a) ? Math.max(0, Math.min(1, material.color.a)) : 1,
  };

  return {
    enabled: material.enabled !== false,
    seed: Number.isFinite(material.seed) ? Math.max(0, Math.round(material.seed)) : 0,
    granularity: Number.isFinite(material.granularity) ? Math.max(1, Math.min(20, material.granularity)) : 10,
    vSteps: Number.isFinite(material.vSteps) ? Math.max(1, Math.min(20, Math.round(material.vSteps))) : 8,
    color,
  };
}
