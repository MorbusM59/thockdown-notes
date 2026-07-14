import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserMockBridges } from './dev/installBrowserMockBridges.ts'
import './index.css'
import '@fortawesome/fontawesome-free/css/all.min.css'

installBrowserMockBridges()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
)
