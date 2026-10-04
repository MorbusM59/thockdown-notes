import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserMockBridges } from './dev/installBrowserMockBridges.ts'
import { installPressTracking } from '@thockdown/interaction/pressTracking'
import { installScrollTrackTokens } from '@thockdown/interaction/scrollTrackGeometry'
import './fonts.css'
import './index.css'
import '@fortawesome/fontawesome-free/css/all.min.css'

installBrowserMockBridges()
installPressTracking()
installScrollTrackTokens()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
)
