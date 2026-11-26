/**
 * Which device the system plays sound through, by name, for settings kept
 * per device (the beat pulse's visual delay). Where the name comes from is a
 * PORT (`setOutputDeviceSource`): the phone installs its native route
 * (apps/soundscapes/src/audioRoute.ts), since its sound is not the page's.
 * The default source is the page's own media devices. The music is played on the
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

/** Starts watching the output device, once, handing each name it finds (repeats allowed) to `publish`. */
export type OutputDeviceSource = (publish: (name: string) => void) => void

function publish(name: string): void {
  if (name === current) return
  current = name
  for (const listener of listeners) listener()
}

/** The page's media devices, re-read on every `devicechange`. */
const mediaDevicesSource: OutputDeviceSource = (found) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
  const refresh = () => void readMediaDevices().then(found)
  navigator.mediaDevices.addEventListener('devicechange', refresh)
  refresh()
}

let source: OutputDeviceSource = mediaDevicesSource

/** Replaces where the device's name comes from; call before anything asks for it. */
export function setOutputDeviceSource(next: OutputDeviceSource): void {
  source = next
}

async function readMediaDevices(): Promise<string> {
  let name: string
  try {
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
    const fallback = outputs.find((d) => d.deviceId === 'default')
    const device = fallback ? outputs.find((d) => d.deviceId !== 'default' && d.groupId === fallback.groupId) : outputs[0]
    name = device?.label || fallback?.label || ''
  } catch {
    name = ''
  }
  return name
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!watching) {
    watching = true
    source(publish)
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
