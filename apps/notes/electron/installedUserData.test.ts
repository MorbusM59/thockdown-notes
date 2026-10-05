import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { INSTALLED_USER_DATA_DIR_NAME, installedUserDataPath } from './installedUserData'

describe('installed user-data folder', () => {
  // Every install up to 0.7.1 wrote its notes under %APPDATA%\thockdownnotes.
  // A different value here opens an empty database for every existing user.
  it('is the folder every existing install already uses', () => {
    expect(INSTALLED_USER_DATA_DIR_NAME).toBe('thockdownnotes')
    expect(installedUserDataPath(path.join('C:', 'Users', 'joe', 'AppData', 'Roaming')))
      .toBe(path.join('C:', 'Users', 'joe', 'AppData', 'Roaming', 'thockdownnotes'))
  })
})
