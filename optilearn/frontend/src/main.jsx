import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { _setPrompt } from './pwaInstall'
import './styles/app.css'

// Capture beforeinstallprompt before React mounts so the event is never missed
// regardless of when GetAppBanner mounts.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  _setPrompt(e)
})

// Store desktop-app flag from query param into sessionStorage so it persists
// across React Router navigations (the ?desktop=1 param comes from desktop.py).
if (new URLSearchParams(window.location.search).get('desktop') === '1') {
  sessionStorage.setItem('optilearn_desktop_mode', '1')
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true)
  },
  onRegisteredSW(_swUrl, registration) {
    registration?.update()
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
