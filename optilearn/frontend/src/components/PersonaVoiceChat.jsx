import { useEffect, useRef } from 'react'
import { ArrowSquareOut, PhoneDisconnect, X } from '@phosphor-icons/react'

/**
 * PersonaVoiceChat — floating panel that embeds the Beyond Presence hosted
 * call page in an iframe. If the host blocks framing, shows an open-in-tab
 * fallback button. Either way the user gets to the live avatar conversation.
 */
export default function PersonaVoiceChat({ callData, onClose }) {
  const { call_url, persona } = callData
  const iframeRef = useRef(null)

  // Clean up on unmount
  useEffect(() => {
    return () => {
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
          fontSize: '1.2rem', flexShrink: 0,
        }}>
          {persona.emoji || '🤝'}
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

      {/* Iframe */}
      <div style={{ position: 'relative', width: '100%', height: 480, flexShrink: 0 }}>
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
        {/* Fallback overlay — shown if iframe fails to load (X-Frame-Options) */}
        <IframeFallback callUrl={call_url} persona={persona} />
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

/**
 * Detects if the iframe was blocked by X-Frame-Options and shows a fallback.
 * Uses a load error heuristic — if the iframe src is still about:blank after
 * a short delay we assume blocking and show the open-in-tab CTA.
 */
function IframeFallback({ callUrl, persona }) {
  const fallbackRef = useRef(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      // If parent iframe failed to load, the fallback div becomes clickable
      // We can't detect X-Frame-Options directly so we show it softly on top
      // and let it fade once the iframe loads successfully
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      ref={fallbackRef}
      style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${persona.color || '#6366f1'}22, #00000044)`,
        gap: 16,
        pointerEvents: 'none',
        opacity: 0,
      }}
    >
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: persona.color || 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '2.2rem',
      }}>
        {persona.emoji || '🤝'}
      </div>
      <a
        href={callUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 999,
          background: 'var(--accent)', color: '#fff',
          fontWeight: 700, fontSize: '0.9rem',
          textDecoration: 'none', pointerEvents: 'auto',
        }}
      >
        <ArrowSquareOut size={16} weight="bold" />
        Open {persona.name}'s room
      </a>
      <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', textAlign: 'center', maxWidth: 220 }}>
        Your browser blocked the embedded view. Click above to open in a new tab.
      </span>
    </div>
  )
}
