import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readPngSize(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath)

  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR')

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

describe('packaging icon assets', () => {
  it('keeps the macOS icon source at least 512x512 for electron-builder', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url))
    const iconPath = path.resolve(testDir, '..', 'assets', 'icon.png')
    const { width, height } = readPngSize(iconPath)

    expect(width).toBeGreaterThanOrEqual(512)
    expect(height).toBeGreaterThanOrEqual(512)
  })
})
