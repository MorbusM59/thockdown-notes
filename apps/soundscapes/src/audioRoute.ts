/**
 * The phone's output device for the settings kept per device (the beat
 * delay): AudioRoutePlugin's name for the output media plays through, and
 * its "change" event, installed as `outputDevice.ts`'s source. The WebView
 * cannot tell: its media devices list no labels, and its audio is not what
 * the app plays (AudioOutput.java is). In a browser the web source stays.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { setOutputDeviceSource } from '@thockdown/visualizer/sound/outputDevice'

interface AudioRoutePlugin {
  get(): Promise<{ name: string }>
  addListener(event: 'change', listener: (data: { name: string }) => void): Promise<PluginListenerHandle>
}

export function installAudioRoute(): void {
  if (!Capacitor.isNativePlatform()) return
  const plugin = registerPlugin<AudioRoutePlugin>('AudioRoute')
  setOutputDeviceSource((publish) => {
    void plugin.addListener('change', ({ name }) => publish(name))
    void plugin.get().then(({ name }) => publish(name), () => {})
  })
}
