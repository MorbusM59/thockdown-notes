/**
 * Writes the factory soundscapes, as the session entries the web page would
 * publish for a listener with no soundscapes of their own, into the Android
 * app's assets (factory-soundscapes.json). SoundscapeSession reads it when
 * nothing has been published yet -- a fresh install or an update opened from
 * Android Auto before the app has run -- so the car's list is never empty.
 * The entries come from sessionEntries, the function the page publishes
 * with, so the two cannot disagree. Generated; not committed
 * (android/.gitignore).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { sessionEntries } from '../src/sessionEntries'

const target = path.resolve(__dirname, '../android/app/src/main/assets/factory-soundscapes.json')
mkdirSync(path.dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify({ entries: sessionEntries([]) }))
