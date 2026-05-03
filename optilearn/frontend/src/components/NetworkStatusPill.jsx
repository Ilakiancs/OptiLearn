import { useEffect, useRef, useState } from 'react'
import { getNetworkMode, setNetworkMode } from '../api/client'

const POLL_MS = 30000

function readDisplay(status) {
  const network = status?.network || {}
  if (network.use_26b) {
    return {
      label: 'Online',
      dot: '#2e7d32',
      pulse: true,
    }
  }
  if (network.connected) {
    return {
      label: 'Offline',
      dot: 'var(--color-primary)',
      pulse: false,
    }
  }
  return {
    label: 'Offline',
    dot: 'rgba(255,255,255,0.72)',
    pulse: false,
  }
}

export default function NetworkStatusPill({
  variant = 'fixed-center',
  fullWidth = false,
  dropdownAlign = 'center',
  style,
}) {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [selectedMode, setSelectedMode] = useState('auto')
  const [toast, setToast] = useState('')
  const rootRef = useRef(null)
  const toastTimerRef = useRef(null)

  async function refreshStatus() {
    try {
      const data = await getNetworkMode()
      setStatus(data)
      setSelectedMode(data.mode || 'auto')
    } catch (_) {
      setStatus({ mode: 'auto', network: { connected: false, latency_ms: null, use_26b: false } })
    }
  }

  function showToast(message) {
    setToast(message)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(''), 3000)
  }

  async function applyMode() {
    try {
      const data = await setNetworkMode(selectedMode)
      setStatus(data)
      setOpen(false)
      showToast(selectedMode === 'offline' ? 'Offline mode on' : 'Auto mode on')
    } catch (_) {
      showToast('Mode was not changed')
    }
  }

  useEffect(() => {
    refreshStatus()
    const interval = setInterval(refreshStatus, POLL_MS)
    const onModelSwitch = () => {
      showToast('Offline mode on')
      refreshStatus()
    }
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    window.addEventListener('optilearn:model-switch', onModelSwitch)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      clearInterval(interval)
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      window.removeEventListener('optilearn:model-switch', onModelSwitch)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  const display = readDisplay(status)
  const fixed = variant === 'fixed-center'
  const dropdownPosition = dropdownAlign === 'left'
    ? { left: 0 }
    : dropdownAlign === 'right'
      ? { right: 0 }
      : { left: '50%', transform: 'translateX(-50%)' }

  return (
    <div
      ref={rootRef}
      style={{
        position: fixed ? 'fixed' : 'relative',
        top: fixed ? 16 : undefined,
        left: fixed ? '50%' : undefined,
        transform: fixed ? 'translateX(-50%)' : undefined,
        zIndex: fixed ? 500 : 30,
        display: fullWidth ? 'block' : 'inline-flex',
        width: fullWidth ? '100%' : 'auto',
        ...style,
      }}
    >
      <style>{`
        @keyframes optilearn-network-pulse {
          0% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.35); }
          70% { box-shadow: 0 0 0 7px rgba(46, 125, 50, 0); }
          100% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0); }
        }
      `}</style>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        style={{
          height: fullWidth ? 46 : 28,
          borderRadius: 14,
          padding: fullWidth ? '9px 14px' : '4px 12px',
          border: fullWidth ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.22)',
          background: fullWidth ? 'var(--color-surface-2)' : 'var(--color-primary)',
          color: fullWidth ? 'var(--text)' : 'white',
          fontSize: fullWidth ? '0.92rem' : 12,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          cursor: 'pointer',
          boxShadow: fullWidth ? 'none' : '0 6px 18px rgba(15, 39, 48, 0.08)',
          width: fullWidth ? '100%' : 'auto',
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: display.dot,
            border: '1px solid rgba(255,255,255,0.55)',
            animation: display.pulse ? 'optilearn-network-pulse 1.6s infinite' : 'none',
          }}
        />
        {display.label}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            width: fullWidth ? '100%' : 200,
            padding: 12,
            borderRadius: fullWidth ? 14 : 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 14px 30px rgba(13, 52, 70, 0.16)',
            color: 'var(--color-text)',
            ...dropdownPosition,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
            <input
              type="radio"
              name="network-mode"
              value="auto"
              checked={selectedMode === 'auto'}
              onChange={() => setSelectedMode('auto')}
            />
            Auto
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
            <input
              type="radio"
              name="network-mode"
              value="offline"
              checked={selectedMode === 'offline'}
              onChange={() => setSelectedMode('offline')}
            />
            Force offline
          </label>
          <button
            type="button"
            onClick={applyMode}
            style={{
              width: '100%',
              border: 0,
              borderRadius: 8,
              padding: '8px 10px',
              background: 'var(--color-primary)',
              color: 'white',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
        </div>
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: open ? 162 : 'calc(100% + 8px)',
            ...(dropdownAlign === 'left'
              ? { left: 0 }
              : dropdownAlign === 'right'
                ? { right: 0 }
                : { left: '50%', transform: 'translateX(-50%)' }),
            minWidth: fullWidth ? '100%' : 180,
            borderRadius: fullWidth ? 14 : 8,
            padding: '9px 12px',
            background: 'var(--color-surface)',
            color: 'var(--color-primary)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 14px 30px rgba(13, 52, 70, 0.14)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
