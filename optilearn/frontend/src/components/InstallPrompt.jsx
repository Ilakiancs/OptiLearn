import { useState, useEffect } from 'react'
import { DownloadSimple, X, DeviceMobile } from '@phosphor-icons/react'

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    if (standalone) {
      setIsInstalled(true)
      return
    }

    const ios = (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !window.MSStream
    setIsIOS(ios)

    if (localStorage.getItem('pwa_install_dismissed')) return

    const installedHandler = () => {
      setIsInstalled(true)
      setShowPrompt(false)
      localStorage.setItem('pwa_installed', 'true')
    }
    window.addEventListener('appinstalled', installedHandler)

    if (ios) {
      const timer = window.setTimeout(() => setShowPrompt(true), 2000)
      return () => {
        window.clearTimeout(timer)
        window.removeEventListener('appinstalled', installedHandler)
      }
    }

    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowPrompt(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const result = await deferredPrompt.userChoice
      if (result.outcome === 'accepted') {
        setShowPrompt(false)
        localStorage.setItem('pwa_installed', 'true')
      }
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    setShowPrompt(false)
    localStorage.setItem('pwa_install_dismissed', 'true')
  }

  if (!showPrompt || isInstalled) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a73e8 0%, #0d47a1 100%)',
      borderRadius: '16px',
      padding: '20px',
      margin: '16px 0',
      color: 'white',
      position: 'relative',
      boxShadow: '0 4px 20px rgba(26,115,232,0.3)'
    }}>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        style={{
          position: 'absolute', top: '12px', right: '12px',
          background: 'rgba(255,255,255,0.2)', border: 'none',
          borderRadius: '50%', width: '28px', height: '28px',
          cursor: 'pointer', color: 'white', display: 'flex',
          alignItems: 'center', justifyContent: 'center'
        }}
      >
        <X size={14} weight="bold" />
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <div style={{
          background: 'rgba(255,255,255,0.2)', borderRadius: '12px',
          padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <DeviceMobile size={24} weight="duotone" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '16px' }}>Install OptiLearn</div>
          <div style={{ fontSize: '13px', opacity: 0.85 }}>
            Access your classes offline, anytime
          </div>
        </div>
      </div>

      {isIOS ? (
        <div style={{ fontSize: '13px', lineHeight: 1.6, opacity: 0.9 }}>
          Tap <strong>Share</strong> - <strong>Add to Home Screen</strong> to install OptiLearn as an app.
        </div>
      ) : (
        <button
          onClick={handleInstall}
          style={{
            width: '100%', padding: '12px',
            background: 'white', color: '#1a73e8',
            border: 'none', borderRadius: '10px',
            fontWeight: 700, fontSize: '15px',
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}
        >
          <DownloadSimple size={18} weight="duotone" />
          Install App
        </button>
      )}
    </div>
  )
}
