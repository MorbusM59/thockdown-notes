import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserMockBridges } from './dev/installBrowserMockBridges.ts'
import { installPressTracking } from './shared/pressTracking.ts'
import { installScrollTrackTokens } from './shared/scrollTrackGeometry.ts'
import './index.css'
import '@fortawesome/fontawesome-free/css/all.min.css'

installBrowserMockBridges()
installPressTracking()
installScrollTrackTokens()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
)
