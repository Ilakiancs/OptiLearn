import { useState, useEffect } from 'react'
import { RocketLaunch, X } from '@phosphor-icons/react'
import { getPrompt, clearPrompt, subscribe, unsubscribe } from '../pwaInstall'

const KEY_INSTALLED = 'optilearn_pwa_installed'
const KEY_DISMISSED = 'optilearn_pwa_install_dismissed'

function migrateOldKeys() {
  if (localStorage.getItem('pwa_installed') && !localStorage.getItem(KEY_INSTALLED)) {
    localStorage.setItem(KEY_INSTALLED, '1')
  }
  if (localStorage.getItem('pwa_install_dismissed') && !localStorage.getItem(KEY_DISMISSED)) {
    localStorage.setItem(KEY_DISMISSED, '1')
  }
  localStorage.removeItem('pwa_installed')
  localStorage.removeItem('pwa_install_dismissed')
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function isDesktopApp() {
  return sessionStorage.getItem('optilearn_desktop_mode') === '1'
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function getPlatformInstructions() {
  if (isIOS()) {
    return 'Tap the Share button (□↑) at the bottom of Safari, then tap "Add to Home Screen" and tap "Add".'
  }
  if (/android/i.test(navigator.userAgent)) {
    return 'Tap the ⋮ menu (three dots) in Chrome, then tap "Add to Home screen" or "Install app".'
  }
  return 'Click the ⊕ install icon in Chrome\'s address bar, or open the Chrome menu and select "Install OptiLearn".'
}

export default function GetAppBanner({ compact = false }) {
  const [deferredPrompt, setDeferredPrompt] = useState(() => getPrompt())
  const [showModal, setShowModal] = useState(false)

  // Never show in standalone (already installed) or inside the desktop VBS app
  if (isStandalone() || isDesktopApp()) return null

  useEffect(() => {
    migrateOldKeys()
    const onPrompt = (evt) => setDeferredPrompt(evt)
    subscribe(onPrompt)
    const onInstalled = () => {
      localStorage.setItem(KEY_INSTALLED, '1')
      clearPrompt()
    }
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      unsubscribe(onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function handleInstall() {
    const prompt = deferredPrompt || getPrompt()
    if (prompt) {
      prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') {
        localStorage.setItem(KEY_INSTALLED, '1')
        clearPrompt()
      }
      setDeferredPrompt(null)
    } else {
      setShowModal(true)
    }
  }

  const modal = showModal && (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 9000, padding: 16 }}
      onClick={() => setShowModal(false)}
    >
      <div
        style={{ background: 'var(--color-surface, var(--surface))', borderRadius: 16, padding: 24, maxWidth: 340, width: '100%', display: 'grid', gap: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: 'rgba(42,141,191,0.12)', color: '#2a8dbf', borderRadius: 10, padding: 8, display: 'flex' }}>
            <RocketLaunch size={20} weight="duotone" />
          </span>
          <strong style={{ fontSize: '1rem' }}>Add OptiLearn to Home Screen</strong>
        </div>
        <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--color-text-muted, var(--text-muted))', lineHeight: 1.6 }}>
          {getPlatformInstructions()}
        </p>
        <button
          type="button"
          onClick={() => setShowModal(false)}
          style={{ background: '#2a8dbf', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 700, cursor: 'pointer' }}
        >
          Got it
        </button>
      </div>
    </div>
  )

  if (compact) {
    return (
      <>
        <button
          type="button"
          className="pill-button"
          onClick={handleInstall}
          style={{ color: 'var(--color-primary, #2a8dbf)', fontWeight: 700 }}
        >
          <RocketLaunch size={18} weight="duotone" />
          <span>Add to Home Screen</span>
        </button>
        {modal}
      </>
    )
  }

  return (
    <>
      <div style={{ background: 'var(--accent)', borderRadius: 14, padding: '18px 20px', margin: '14px 0', color: 'white', position: 'relative', boxShadow: '0 4px 18px rgba(42,141,191,0.28)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 10, padding: 9, display: 'flex' }}>
            <RocketLaunch size={22} weight="duotone" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.97rem' }}>Add OptiLearn to Home Screen</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>Access your classes offline, anytime</div>
          </div>
        </div>
        <button
          onClick={handleInstall}
          style={{ width: '100%', padding: '11px 0', background: 'white', color: '#2a8dbf', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <RocketLaunch size={17} weight="duotone" />
          Add to Home Screen
        </button>
      </div>
      {modal}
    </>
  )
}
