import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserMockBridges } from './dev/installBrowserMockBridges.ts'
import { installHoverTracking } from '@thockdown/interaction/hoverTracking'
import { installPressTracking } from '@thockdown/interaction/pressTracking'
import { installTouchInput } from '@thockdown/interaction/touchInput'
import { installScrollTrackTokens } from '@thockdown/interaction/scrollTrackGeometry'
import './fonts.css'
import './index.css'
import '@fortawesome/fontawesome-free/css/all.min.css'

installBrowserMockBridges()
// First: it must see every touch pointer event before any other window listener.
installTouchInput()
installPressTracking()
installHoverTracking()
installScrollTrackTokens()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
)
