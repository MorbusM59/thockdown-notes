import React from 'react'
import ReactDOM from 'react-dom/client'
import { MobileSoundscapeApp } from './MobileSoundscapeApp'
import { keepFocusOnPress } from '../../src/shared/focusOwnership'
import { installPressTracking } from '../../src/shared/pressTracking'
// The desktop app's stylesheet, whole: the soundscape panel is the desktop
// panel unchanged, and its look is defined there rather than restated here.
import '../../src/index.css'
import '../../src/App.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './mobile.css'

// The desktop's rules for every button, so the shared panel behaves the
// same here: the pressed look is app state (pressTracking.ts, since no
// stylesheet uses :active), and a press does not move focus
// (focusOwnership.ts) -- without it every tapped button kept focus.
installPressTracking()
window.addEventListener('mousedown', keepFocusOnPress, { capture: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileSoundscapeApp />
  </React.StrictMode>,
)
