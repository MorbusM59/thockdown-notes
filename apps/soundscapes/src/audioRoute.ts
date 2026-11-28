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

/** The Font Awesome classes of an output kind's icon (Bluetooth's is a brand glyph). */
export function audioOutputIcon(kind: AudioOutputKind): string {
  switch (kind) {
    case 'speaker': return 'fa-solid fa-volume-high'
    case 'wired': return 'fa-solid fa-plug'
    case 'bluetooth': return 'fa-brands fa-bluetooth-b'
    case 'hdmi': return 'fa-solid fa-tv'
    case 'hearing': return 'fa-solid fa-ear-listen'
  }
}

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
