// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import type { TextureCacheRequest } from '../src/shared/textures'

type RawDatabase = {
  prepare: (sql: string) => {
    all: () => unknown
    run: (...args: unknown[]) => unknown
  }
  exec: (sql: string) => void
}

const rawOf = (db: DatabaseService) => (db as unknown as { requireDb: () => RawDatabase }).requireDb()

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

  it('rebuilds the disposable cache table when upgrading its key', async () => {
    const raw = rawOf(db)
    raw.exec(`
      DROP TABLE texture_pattern_cache;
      CREATE TABLE texture_pattern_cache (
        surface TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        granularity REAL NOT NULL,
        vSteps INTEGER NOT NULL,
        algorithmVersion INTEGER NOT NULL,
        data BLOB NOT NULL,
        mimeType TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (surface, width, height, seed, granularity, vSteps, algorithmVersion)
      );
      INSERT INTO texture_pattern_cache
        (surface, width, height, seed, granularity, vSteps, algorithmVersion, data, mimeType, createdAt)
      VALUES ('appGrid', 512, 512, 137, 9, 8, 3, X'01', 'application/octet-stream', 1);
    `)
    db.close()
    db = new DatabaseService(dataRoot)
    await db.initialize()

    const columns = rawOf(db).prepare('PRAGMA table_info(texture_pattern_cache)').all() as Array<{ name: string; pk: number }>
    expect(columns.find((column) => column.name === 'textureStrength')?.pk).toBeGreaterThan(0)
    expect(db.getTextureCache(request)).toBeNull()
  })
})
