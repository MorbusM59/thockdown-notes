/**
 * Which device the system plays sound through, by name, for settings kept
 * per device (the beat pulse's visual delay). The music is played on the
 * system's default output, so the name is the default's: Chromium lists it as
 * an extra `default` entry sharing its `groupId` with the real device, whose
 * own label carries no localised "Default - " prefix. Re-read on every
 * `devicechange`, which is how plugging in headphones or switching the
 * default arrives. '' while unknown (no media devices, or nothing listed).
 */

import { useSyncExternalStore } from 'react'

let current = ''
const listeners = new Set<() => void>()
let watching = false

async function refresh(): Promise<void> {
  let name: string
  try {
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
    const fallback = outputs.find((d) => d.deviceId === 'default')
    const device = fallback ? outputs.find((d) => d.deviceId !== 'default' && d.groupId === fallback.groupId) : outputs[0]
    name = device?.label || fallback?.label || ''
  } catch {
    name = ''
  }
  if (name === current) return
  current = name
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!watching && typeof navigator !== 'undefined' && navigator.mediaDevices) {
    watching = true
    navigator.mediaDevices.addEventListener('devicechange', () => void refresh())
    void refresh()
  }
  return () => listeners.delete(listener)
}

const idle = () => () => {}

/**
 * The current output device's name, '' while unknown. Devices are only
 * watched once something `active` asks, so nothing is enumerated for a
 * reader who never turns the beat pulse on.
 */
export function useOutputDevice(active: boolean): string {
  return useSyncExternalStore(active ? subscribe : idle, () => current)
}
