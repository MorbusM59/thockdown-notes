/**
 * The phone's AUDIO DEVICE CONNECTION (AudioConnection.java, through
 * AudioRoutePlugin): the output media plays through, published as
 * `outputDevice.ts`'s source for the settings kept per device (the beat
 * delay); whether that output is connected (a disconnect halts everything
 * heard without touching what plays or the schedule, and a reconnect or the
 * listener's resume carries on); and the outputs the listener can pick.
 * The WebView cannot tell any of it: its media devices list no labels, and
 * its audio is not what the app plays (AudioOutput.java is). In a browser
 * the web source stays and the connection reads as always connected.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { setOutputDeviceSource } from '@thockdown/visualizer/sound/outputDevice'

/** How the app draws an output: speaker, a cable (jack, USB, line), Bluetooth, HDMI, a hearing aid. */
export type AudioOutputKind = 'speaker' | 'wired' | 'bluetooth' | 'hdmi' | 'hearing'

export interface AudioOutputChoice {
  id: number
  kind: AudioOutputKind
  name: string
  /** Media plays through it now. */
  active: boolean
}

export interface AudioConnectionState {
  name: string
  connected: boolean
  outputs: readonly AudioOutputChoice[]
}

interface AudioRoutePlugin {
  get(): Promise<AudioConnectionState>
  resume(options: { id?: number }): Promise<void>
  addListener(event: 'change', listener: (data: AudioConnectionState) => void): Promise<PluginListenerHandle>
}

let plugin: AudioRoutePlugin | null = null
let state: AudioConnectionState = { name: '', connected: true, outputs: [] }
const listeners = new Set<() => void>()

function publishState(next: AudioConnectionState): void {
  state = next
  for (const listener of listeners) listener()
}

export function subscribeAudioConnection(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readAudioConnection(): AudioConnectionState {
  return state
}

/** Connected again: on the output `id`, or without one on whatever the system routes to. */
export function resumeAudioConnection(id?: number): void {
  void plugin?.resume(id === undefined ? {} : { id })
}

/** The Font Awesome solid icon of an output kind; Bluetooth's is a brand glyph, drawn by `AudioOutputIcon` from its SVG path rather than shipping the whole brands font for it. */
export function audioOutputIcon(kind: AudioOutputKind): string {
  switch (kind) {
    case 'speaker': return 'fa-volume-high'
    case 'wired': return 'fa-plug'
    case 'bluetooth': return 'fa-bluetooth-b'
    case 'hdmi': return 'fa-tv'
    case 'hearing': return 'fa-ear-listen'
  }
}

/** Font Awesome Free's bluetooth-b (CC BY 4.0), viewBox 0 0 256 512. */
export const BLUETOOTH_B_PATH = 'M164.9 260L257.5 156.7 111.6 0 111.6 206.3 25.4 120.2-6 151.6 102.1 260-6 368.4 25.4 399.8 111.6 313.7 114.3 512 262.8 363.4 164.9 260zm40.9-103l-50 50-.3-100.3 50.3 50.3zm-50 156l50 50-50.3 50.3 .3-100.3z'

export function installAudioRoute(): void {
  if (!Capacitor.isNativePlatform()) return
  const registered = registerPlugin<AudioRoutePlugin>('AudioRoute')
  plugin = registered
  setOutputDeviceSource((publish) => {
    const take = (next: AudioConnectionState) => {
      publishState(next)
      publish(next.name)
    }
    void registered.addListener('change', take)
    void registered.get().then(take, () => {})
  })
}
