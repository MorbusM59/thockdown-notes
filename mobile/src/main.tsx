import React from 'react'
import ReactDOM from 'react-dom/client'
import { MobileSoundscapeApp } from './MobileSoundscapeApp'
// The desktop app's stylesheet, whole: the soundscape panel is the desktop
// panel unchanged, and its look is defined there rather than restated here.
import '../../src/index.css'
import '../../src/App.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './mobile.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileSoundscapeApp />
  </React.StrictMode>,
)
