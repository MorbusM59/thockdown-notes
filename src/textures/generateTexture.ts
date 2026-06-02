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
    lacunarity: lerp(1.8, 2.5, rng()),
    octaves: 2 + Math.floor(rng() * 5),
    warpStrength: rng() < 0.4 ? 0 : lerp(0.2, 1.5, rng()),
    warpAxisBias: [rng(), rng()],
    featureBias: lerp(-0.3, 0.3, rng()),
  };
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
  x: number,
  y: number,
  grid: Float32Array,
  cols: number,
  rows: number,
  cellSize: number,
  personality: MaterialPersonality,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let octave = 0; octave < personality.octaves; octave += 1) {
    value += valueNoise((x * frequency) / cellSize, (y * frequency) / cellSize, grid, cols, rows) * amplitude;
    maxValue += amplitude;
    amplitude *= personality.persistence;
    frequency *= personality.lacunarity;
  }

  return maxValue > 0 ? value / maxValue : 0;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const val = Math.max(0, Math.min(1, v));

  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c; g = x;
  } else if (hue < 120) {
    r = x; g = c;
  } else if (hue < 180) {
    g = c; b = x;
  } else if (hue < 240) {
    g = x; b = c;
  } else if (hue < 300) {
    r = x; b = c;
  } else {
    r = c; b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function shapeValue(raw: number, featureBias: number): number {
  const exponent = Math.max(0.2, 1 - featureBias);
  return Math.pow(Math.max(0, Math.min(1, raw)), exponent);
}

function quantizeValue(value: number, vSteps: number): number {
  const safeSteps = Math.max(2, Math.min(16, Math.round(vSteps)));
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
  const granularity = Math.max(1, Math.min(40, material.granularity));

  const cols = Math.max(4, Math.ceil(width / granularity) + 4);
  const rows = Math.max(4, Math.ceil(height / granularity) + 4);

  const spatialGrid = buildGrid(cols, rows, material.seed >>> 0);
  const personality = samplePersonality(mulberry32((material.seed ^ 0xdeadbeef) >>> 0));

  const out = new Uint8ClampedArray(width * height * 4);

  const WX0 = 1.7;
  const WY0 = 9.2;
  const WX1 = 8.3;
  const WY1 = 2.8;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sampleX = x;
      let sampleY = y;

      if (personality.warpStrength > 0) {
        const wx = valueNoise((x + WX0) / granularity, (y + WY0) / granularity, spatialGrid, cols, rows);
        const wy = valueNoise((x + WX1) / granularity, (y + WY1) / granularity, spatialGrid, cols, rows);
        sampleX += wx * personality.warpStrength * personality.warpAxisBias[0] * granularity;
        sampleY += wy * personality.warpStrength * personality.warpAxisBias[1] * granularity;
      }

      const raw = fbm(sampleX, sampleY, spatialGrid, cols, rows, granularity, personality);
      const shaped = shapeValue(raw, personality.featureBias);
      const stepped = quantizeValue(shaped, material.vSteps);
      const pixelV = stepped * Math.max(0, Math.min(1, material.color.v));

      const [r, g, b] = hsvToRgb(material.color.h, material.color.s, pixelV);
      const idx = (y * width + x) * 4;
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      out[idx + 3] = Math.round(Math.max(0, Math.min(1, material.color.a)) * 255);
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
    seed: Number.isFinite(material.seed) ? Math.max(0, Math.round(material.seed)) : 0,
    granularity: Number.isFinite(material.granularity) ? Math.max(1, Math.min(40, material.granularity)) : 10,
    vSteps: Number.isFinite(material.vSteps) ? Math.max(2, Math.min(16, Math.round(material.vSteps))) : 8,
    color,
  };
}
