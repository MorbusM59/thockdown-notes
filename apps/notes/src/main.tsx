import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserMockBridges } from './dev/installBrowserMockBridges.ts'
import { installHoverTracking } from '@thockdown/interaction/hoverTracking'
import { installPressTracking } from '@thockdown/interaction/pressTracking'
import { installTouchInput } from '@thockdown/interaction/touchInput'
import { setMusicListening } from '@thockdown/visualizer/sound/musicListening'
import { setMusicLibraryReads } from '@thockdown/visualizer/shared/musicLibraryReads'
import { desktopMusicListening, installDesktopSoundscapeSignals } from '@thockdown/visualizer/sound/desktopMusicListening'
import { installScrollTrackTokens } from '@thockdown/interaction/scrollTrackGeometry'
import { installTexturePorts } from '@thockdown/look/textures/textureStore'
import { beginBackgroundWork } from './shared/backgroundWork'
import { installEntryFieldOutsidePress } from './sidebar/entryFieldOutsidePress'
import { installFieldRightClickSelection } from './shared/fieldRightClickSelection'
import './fonts.css'
import './index.css'
import '@fortawesome/fontawesome-free/css/all.min.css'

installBrowserMockBridges()
// First: it must see every touch pointer event before any other window listener.
installTouchInput()
setMusicListening(desktopMusicListening)
installDesktopSoundscapeSignals()
if (window.thockdownAudioPlayer) {
  const library = window.thockdownAudioPlayer
  setMusicLibraryReads({
    getPlaylist: (slot) => library.getPlaylist(slot),
    getPool: (query) => library.getPool(query),     pathOfFile: (file) => window.thockdownExternalFiles?.getPathForFile(file) ?? '',
  })
}
// Generated texture masks are kept on disk between runs (IPC), and their
// generation turns the background-work indicator. Installed after the mock
// bridges, which supply the cache in a browser build.
installTexturePorts({
  cache: window.thockdownTextures
    ? {
        get: (request) => window.thockdownTextures!.getCachedTexture(request),
        save: (request, payload) => window.thockdownTextures!.saveCachedTexture(request, payload),
      }
    : undefined,
  beginWork: () => beginBackgroundWork('texture'),
})
installPressTracking()
installHoverTracking()
installScrollTrackTokens(1)
installEntryFieldOutsidePress()
installFieldRightClickSelection()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
)
