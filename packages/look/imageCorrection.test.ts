import { describe, expect, it } from 'vitest'
import { imageCorrectionMatrix, mapThroughScene, type SceneEffect } from './imageCorrection'

function applyCorrection(values: string, rgb: number[]): number[] {
  const v = values.split(' ').map(Number)
  return [0, 1, 2].map((r) => v[r * 5] * rgb[0] + v[r * 5 + 1] * rgb[1] + v[r * 5 + 2] * rgb[2] + v[r * 5 + 4])
}

const withoutUndone = (scene: SceneEffect[]) =>
  scene.filter((e) => !(e.kind === 'invert' || e.kind === 'hue-rotate'))

// Scenes shaped like the factory dark presets: invert first, then the
// decorative chain in themeFrame's order.
const SCENES: SceneEffect[][] = [
  [{ kind: 'invert', amount: 1 }],
  [{ kind: 'hue-rotate', deg: 356 }],
  [{ kind: 'invert', amount: 1 }, { kind: 'sepia', amount: 0.46 }, { kind: 'hue-rotate', deg: 183 }, { kind: 'contrast', amount: 1.06 }, { kind: 'saturate', amount: 0.73 }],
  [{ kind: 'invert', amount: 1 }, { kind: 'sepia', amount: 0.21 }, { kind: 'hue-rotate', deg: 61 }, { kind: 'brightness', amount: 1.06 }, { kind: 'contrast', amount: 1.3 }, { kind: 'saturate', amount: 1.2 }],
  [{ kind: 'invert', amount: 0.8 }, { kind: 'hue-rotate', deg: 90 }],
]

describe('imageCorrectionMatrix', () => {
  it('needs nothing when the scene has no invert or hue-rotate', () => {
    expect(imageCorrectionMatrix([])).toBeNull()
    expect(imageCorrectionMatrix([{ kind: 'sepia', amount: 0.4 }, { kind: 'contrast', amount: 1.2 }])).toBeNull()
    expect(imageCorrectionMatrix([{ kind: 'hue-rotate', deg: 360 }])).toBeNull()
  })

  it('makes the scene show an image exactly as the scene without invert and hue-rotate would', () => {
    for (const scene of SCENES) {
      const values = imageCorrectionMatrix(scene)!
      for (let i = 0; i < 200; i += 1) {
        const rgb = [(i * 37) % 101, (i * 53) % 101, (i * 71) % 101].map((x) => x / 100)
        const seen = mapThroughScene(scene, applyCorrection(values, rgb))
        const wanted = mapThroughScene(withoutUndone(scene), rgb)
        seen.forEach((x, c) => expect(x).toBeCloseTo(wanted[c], 3))
      }
    }
  })

  it('stays finite where the scene flattens colour (saturate 0, invert 0.5)', () => {
    for (const scene of [
      [{ kind: 'invert', amount: 1 }, { kind: 'saturate', amount: 0 }],
      [{ kind: 'invert', amount: 0.5 }],
    ] as SceneEffect[][]) {
      const values = imageCorrectionMatrix(scene)!.split(' ').map(Number)
      expect(values.every((x) => Number.isFinite(x) && Math.abs(x) < 1e4)).toBe(true)
    }
  })

  it('turns a greyscale negative into a greyscale positive', () => {
    const scene: SceneEffect[] = [{ kind: 'invert', amount: 1 }, { kind: 'saturate', amount: 0 }]
    const values = imageCorrectionMatrix(scene)!
    const dark = mapThroughScene(scene, applyCorrection(values, [0.1, 0.1, 0.1]))
    const light = mapThroughScene(scene, applyCorrection(values, [0.9, 0.9, 0.9]))
    expect(dark[0]).toBeLessThan(light[0])
  })
})
