// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { imageTagsFromFolders } from '../src/shared/images'
import { imageFilesIn } from './imageDrop'

describe('images dropped from the file manager', () => {
  let directory = ''
  afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })

  it('tags a file by its folder and that folder\'s parent, never above the dropped folder', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'thockdown-image-drop-'))
    const pets = path.join(directory, 'pets')
    mkdirSync(path.join(pets, 'cats'), { recursive: true })
    mkdirSync(path.join(pets, 'dogs', 'puppies'), { recursive: true })
    writeFileSync(path.join(pets, 'top.png'), '')
    writeFileSync(path.join(pets, 'cats', 'a.jpg'), '')
    writeFileSync(path.join(pets, 'dogs', 'puppies', 'b.webp'), '')
    writeFileSync(path.join(pets, 'cats', 'notes.txt'), '')
    const loose = path.join(directory, 'loose.gif')
    writeFileSync(loose, '')

    const found = await imageFilesIn([pets, loose, path.join(directory, 'missing')])
    const tags = Object.fromEntries(found.map(({ filePath, folders }) => [path.basename(filePath), imageTagsFromFolders(folders)]))

    expect(tags).toEqual({
      'top.png': ['pets'],
      'a.jpg': ['pets', 'cats'],
      'b.webp': ['dogs', 'puppies'],
      'loose.gif': [],
    })
  })
})
