// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { dictionaryIdForFile, installedDictionaryId, SpellCheckDictionaries } from './spellCheckDictionaries'

describe('SpellCheckDictionaries', () => {
  it('serves the four bundled dictionaries', async () => {
    const service = new SpellCheckDictionaries(mkdtempSync(path.join(tmpdir(), 'dicts-')))
    expect((await service.list()).map((entry) => entry.id)).toEqual(['en', 'es', 'fr', 'de'])
    for (const id of ['en', 'es', 'fr', 'de']) {
      const files = await service.read(id)
      expect(files?.aff.length).toBeGreaterThan(0)
      expect(files?.dic.length).toBeGreaterThan(0)
    }
  })

  it('installs a .dic/.aff pair, lists it, reads it back and removes it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dicts-'))
    const source = mkdtempSync(path.join(tmpdir(), 'dict-src-'))
    writeFileSync(path.join(source, 'it_IT.aff'), 'SET UTF-8\n')
    writeFileSync(path.join(source, 'it_IT.dic'), '1\nciao\n')
    const service = new SpellCheckDictionaries(root)
    expect(await service.install(path.join(source, 'it_IT.dic'))).toEqual({ id: 'it_IT', label: 'it_IT', bundled: false })
    expect((await service.list()).map((entry) => entry.id)).toContain('it_IT')
    expect(new TextDecoder().decode((await service.read('it_IT'))?.dic)).toBe('1\nciao\n')
    expect(await service.remove('it_IT')).toBe(true)
    expect((await service.list()).map((entry) => entry.id)).not.toContain('it_IT')
  })

  it('refuses a .dic without its .aff, a bundled name, and any id that is a path', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dicts-'))
    const source = mkdtempSync(path.join(tmpdir(), 'dict-src-'))
    writeFileSync(path.join(source, 'lonely.dic'), '1\nx\n')
    writeFileSync(path.join(source, 'en.dic'), '1\nx\n')
    writeFileSync(path.join(source, 'en.aff'), '')
    const service = new SpellCheckDictionaries(root)
    expect(await service.install(path.join(source, 'lonely.dic'))).toBeNull()
    expect(await service.install(path.join(source, 'en.dic'))).toBeNull()
    expect(await service.read('../escape')).toBeNull()
    expect(await service.remove('en')).toBe(false)
    expect(installedDictionaryId('/a/b/../c.dic')).toBe('c')
    expect(dictionaryIdForFile('/x/dictionaries/en-GB/index.dic')).toBe('en-GB')
    expect(dictionaryIdForFile('/x/de_AT.dic')).toBe('de_AT')
  })
})
