// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import type { TextureCacheRequest } from '../src/shared/textures'

describe('texture cache', () => {
  let dataRoot: string
  let db: DatabaseService

  const request: TextureCacheRequest = {
    surface: 'appGrid',
    width: 512,
    height: 512,
    seed: 137,
    textureStrength: 1,
    granularity: 9,
    vSteps: 8,
    algorithmVersion: 4,
  }

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-texture-cache-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('keeps cache entries for different texture strengths separate', () => {
    const full = { ...request, textureStrength: 1 }
    const half = { ...request, textureStrength: 0.5 }
    db.saveTextureCache(full, { data: new Uint8Array([1]), mimeType: 'application/octet-stream' })
    db.saveTextureCache(half, { data: new Uint8Array([2]), mimeType: 'application/octet-stream' })

    expect(db.getTextureCache(full)?.data).toEqual(new Uint8Array([1]))
    expect(db.getTextureCache(half)?.data).toEqual(new Uint8Array([2]))
  })

})
