import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOut, PhoneDisconnect, X } from '@phosphor-icons/react'
import { PersonaAvatarIcon } from '../utils/personaIcons'

export default function PersonaVoiceChat({ callData, onClose }) {
  const { call_url, persona } = callData
  const iframeRef = useRef(null)
  // X-Frame-Options blocks iframes silently — we detect it via a load timeout.
  // bey.chat loads in ~2s; if the iframe fires no load event within 4s we assume blocked.
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setBlocked(true), 4000)
    function onLoad() { clearTimeout(timer) }
    const el = iframeRef.current
    if (el) el.addEventListener('load', onLoad)
    return () => {
      clearTimeout(timer)
      if (el) el.removeEventListener('load', onLoad)
      if (iframeRef.current) iframeRef.current.src = 'about:blank'
    }
  }, [])

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      zIndex: 1001,
      width: 340,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 20,
      boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface-soft)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: persona.color || 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <PersonaAvatarIcon iconKey={persona.icon} size={18} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{persona.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>AI Learning Companion · Live</div>
        </div>
        <a
          href={call_url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in new tab"
          style={{ color: 'var(--text-muted)', display: 'flex', padding: 4 }}
        >
          <ArrowSquareOut size={18} weight="bold" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="End call"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', padding: 4,
          }}
        >
          <X size={18} weight="bold" />
        </button>
      </div>

      {/* Iframe / fallback */}
      <div style={{ position: 'relative', width: '100%', height: 480, flexShrink: 0 }}>
        {blocked ? (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${persona.color || '#6366f1'}22, #00000044)`,
            gap: 16,
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: persona.color || 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PersonaAvatarIcon iconKey={persona.icon} size={34} color="#fff" />
            </div>
            <a
              href={call_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 999,
                background: 'var(--accent)', color: '#fff',
                fontWeight: 700, fontSize: '0.9rem',
                textDecoration: 'none',
              }}
            >
              <ArrowSquareOut size={16} weight="bold" />
              Open {persona.name}'s room
            </a>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', textAlign: 'center', maxWidth: 220, padding: '0 16px' }}>
              Your browser blocked the embedded view. Click above to open in a new tab.
            </span>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={call_url}
            title={`Talk with ${persona.name}`}
            allow="camera; microphone; autoplay; display-capture"
            style={{
              width: '100%', height: '100%',
              border: 'none',
              display: 'block',
            }}
          />
        )}
      </div>

      {/* End call button */}
      <div style={{
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface-soft)',
        flexShrink: 0,
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 20px', borderRadius: 999,
            border: 'none', background: '#ef4444', color: '#fff',
            fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer',
          }}
        >
          <PhoneDisconnect size={16} weight="fill" />
          End call
        </button>
      </div>
    </div>
  )
}
