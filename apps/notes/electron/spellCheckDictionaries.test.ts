// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { dictionaryStem, installedDictionaryId, SpellCheckDictionaries } from './spellCheckDictionaries'

describe('SpellCheckDictionaries', () => {
  it('serves the user dictionary and the four bundled ones', async () => {
    const service = new SpellCheckDictionaries(mkdtempSync(path.join(tmpdir(), 'dicts-')))
    expect((await service.list()).map((entry) => entry.label)).toEqual(['User Dictionary', 'English (US)', 'Spanish', 'French', 'German'])
    expect(await service.read('user')).toEqual({ aff: null, dic: null, added: [], removed: [] })
    for (const id of ['en', 'es', 'fr', 'de']) {
      const files = await service.read(id)
      expect(files?.aff?.length).toBeGreaterThan(0)
      expect(files?.dic?.length).toBeGreaterThan(0)
    }
  })

  it('installs a .dic/.aff pair under a name from its file, renames it, reads it back and removes it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dicts-'))
    const source = mkdtempSync(path.join(tmpdir(), 'dict-src-'))
    writeFileSync(path.join(source, 'it_IT.aff'), 'SET UTF-8\n')
    writeFileSync(path.join(source, 'it_IT.dic'), '1\nciao\n')
    const service = new SpellCheckDictionaries(root)
    expect(await service.install([path.join(source, 'it_IT.dic')])).toEqual([{ id: 'it_it', label: 'IT IT', icon: null, kind: 'custom' }])
    expect(new TextDecoder().decode((await service.read('it_it'))?.dic ?? undefined)).toBe('1\nciao\n')
    expect(await service.rename('it_it', 'Italiano')).toBe(true)
    expect(await service.rename('it_it', '  ')).toBe(false)
    expect(await service.rename('en', 'English')).toBe(true)
    const fresh = new SpellCheckDictionaries(root)
    expect((await fresh.list()).find((entry) => entry.id === 'it_it')?.label).toBe('Italiano')
    expect((await fresh.list()).find((entry) => entry.id === 'en')?.label).toBe('English')
    expect(await service.reset('it_it')).toBe(true)
    expect((await service.list()).map((entry) => entry.id)).not.toContain('it_it')
  })

  it('takes a pair picked together whatever its folder, and names index files after their folder', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dicts-'))
    const downloads = mkdtempSync(path.join(tmpdir(), 'dict-src-'))
    const folder = path.join(downloads, 'pl')
    mkdirSync(folder)
    writeFileSync(path.join(folder, 'index.aff'), '')
    writeFileSync(path.join(folder, 'index.dic'), '1\nkot\n')
    const service = new SpellCheckDictionaries(root)
    const installed = await service.install([path.join(folder, 'index.aff'), path.join(folder, 'index.dic')])
    expect(installed).toEqual([{ id: 'pl', label: 'PL', icon: null, kind: 'custom' }])
    // The same again does not overwrite the first.
    expect((await service.install([path.join(folder, 'index.dic')]))[0].id).toBe('pl-2')
  })

  it('installs the pairs inside an .oxt, naming a lone pair after the archive', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dicts-'))
    const source = mkdtempSync(path.join(tmpdir(), 'dict-src-'))
    const encode = (text: string) => new TextEncoder().encode(text)
    writeFileSync(path.join(source, 'dict-pl.oxt'), zipSync({
      'META-INF/manifest.xml': encode('<x/>'),
      'pl_PL.aff': encode('SET UTF-8\n'),
      'pl_PL.dic': encode('1\nkot\n'),
    }))
    writeFileSync(path.join(source, 'many.zip'), zipSync({
      'dictionaries/pt-BR/index.aff': encode(''), 'dictionaries/pt-BR/index.dic': encode('1\na\n'),
      'dictionaries/nl/index.aff': encode(''), 'dictionaries/nl/index.dic': encode('1\nb\n'),
      'dictionaries/half/index.dic': encode('1\nc\n'),
    }))
    const service = new SpellCheckDictionaries(root)
    expect(await service.install([path.join(source, 'dict-pl.oxt')])).toEqual([{ id: 'dict-pl', label: 'DICT-PL', icon: null, kind: 'custom' }])
    expect((await service.install([path.join(source, 'many.zip')])).map((entry) => entry.label).sort()).toEqual(['NL', 'PT-BR'])
  })

  it('refuses a .dic without its .aff, removing a bundled one, and any id that is a path', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dicts-'))
    const source = mkdtempSync(path.join(tmpdir(), 'dict-src-'))
    writeFileSync(path.join(source, 'lonely.dic'), '1\nx\n')
    const service = new SpellCheckDictionaries(root)
    expect(await service.install([path.join(source, 'lonely.dic')])).toEqual([])
    expect(await service.read('../escape')).toBeNull()
    expect(await service.reset('../escape')).toBe(false)
    expect(await service.addWords('../escape', ['x'])).toBe(false)
    expect(await service.rename('../escape', 'x')).toBe(false)
    expect(installedDictionaryId('a/b')).toBe('a_b')
    expect(dictionaryStem('/x/dictionaries/en-GB/index.dic')).toBe('en-GB')
  })

  it('adds and removes words, and resets each kind its own way', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dicts-'))
    const service = new SpellCheckDictionaries(root)
    expect(await service.addWords('user', ['Thockdown', 'two words', 'Thockdown', ''])).toBe(true)
    expect(await new SpellCheckDictionaries(root).listWords('user')).toEqual(['Thockdown'])
    expect(await service.removeWords('user', ['Thockdown'])).toBe(true)
    expect(await service.read('user')).toEqual({ aff: null, dic: null, added: [], removed: [] })

    // A bundled dictionary's removals are remembered, and a reset brings them back.
    const english = await service.listWords('en')
    expect(english).toContain('walk')
    await service.removeWords('en', ['walk'])
    await service.addWords('en', ['Thockdown'])
    await service.rename('en', 'Mine')
    await service.setIcon('en', 'fa-star')
    const edited = await service.listWords('en')
    expect(edited).not.toContain('walk')
    expect(edited).toContain('Thockdown')
    expect((await service.read('en'))?.removed).toEqual(['walk'])
    await service.reset('en')
    expect((await service.list())[1]).toEqual({ id: 'en', label: 'English (US)', icon: null, kind: 'bundled' })
    expect((await service.listWords('en')).length).toBe(english.length)

    // A created one starts empty, is named like a preset copy, and is deleted by a reset.
    const created = await service.create()
    expect(created).toEqual({ id: 'dictionary', label: 'Dictionary A', icon: null, kind: 'custom' })
    expect((await service.create())?.label).toBe('Dictionary B')
    await service.addWords('dictionary', ['kot'])
    expect(await service.listWords('dictionary')).toEqual(['kot'])
    expect(await service.reset('dictionary')).toBe(true)
    expect((await service.list()).map((entry) => entry.id)).not.toContain('dictionary')
    expect(await service.read('dictionary')).toBeNull()

    // Emptying the user dictionary keeps it.
    await service.addWords('user', ['a'])
    expect(await service.reset('user')).toBe(true)
    expect(await service.listWords('user')).toEqual([])
    expect((await service.list())[0].id).toBe('user')
  })
})
