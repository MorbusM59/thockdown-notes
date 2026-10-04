import React from 'react'
import ReactDOM from 'react-dom/client'
import { MobileSoundscapeApp } from './MobileSoundscapeApp'
import { keepFocusOnPress } from '@thockdown/interaction/focusOwnership'
import { installPressTracking } from '@thockdown/interaction/pressTracking'
import { installScrollTrackTokens } from '@thockdown/interaction/scrollTrackGeometry'
// The shared packages' styles: the soundscape panel is the desktop panel
// unchanged, and each package carries the rules for what it renders.
import './app.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './mobile.css'

// The desktop's rules for every button, so the shared panel behaves the
// same here: the pressed look is app state (pressTracking.ts, since no
// stylesheet uses :active), and a press does not move focus
// (focusOwnership.ts) -- without it every tapped button kept focus.
installPressTracking()
installScrollTrackTokens()
window.addEventListener('mousedown', keepFocusOnPress, { capture: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileSoundscapeApp />
  </React.StrictMode>,
)
