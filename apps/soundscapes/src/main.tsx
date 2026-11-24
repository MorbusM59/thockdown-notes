import React from 'react'
import ReactDOM from 'react-dom/client'
import { MobileSoundscapeApp } from './MobileSoundscapeApp'
import { keepFocusOnPress } from '@thockdown/interaction/focusOwnership'
import { installHoverTracking } from '@thockdown/interaction/hoverTracking'
import { installPressTracking } from '@thockdown/interaction/pressTracking'
import { installScrollTrackTokens } from '@thockdown/interaction/scrollTrackGeometry'
import { installTexturePorts } from '@thockdown/look/textures/textureStore'
import { phoneTextureCache } from './textureCache'
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
installHoverTracking()
installScrollTrackTokens(1)
// The layouts' textures, generated on the device like the desktop's and kept
// in Cache Storage (textureCache.ts).
installTexturePorts({ cache: phoneTextureCache })
// mouse-default: focus suppression, which only the mousedown default controls
window.addEventListener('mousedown', keepFocusOnPress, { capture: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileSoundscapeApp />
  </React.StrictMode>,
)
