import { useEffect, useRef, useState } from 'react'
import { Users, X, Waveform } from '@phosphor-icons/react'
import { getPersonas } from '../api/client'

const EMOJI_FALLBACK = ['🌸', '⭐', '🌿', '📚', '🔥', '🎯']

export default function PersonaPickerPopup({ onSelect, onDismiss }) {
  const [personas, setPersonas] = useState([])
  const [loading, setLoading] = useState(true)
  const overlayRef = useRef(null)

  useEffect(() => {
    getPersonas()
      .then(d => setPersonas(d.personas || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onDismiss()
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        width: '100%', maxWidth: 520,
        padding: '24px 20px',
        position: 'relative',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
      }}>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          style={{
            position: 'absolute', top: 14, right: 14,
            background: 'none', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: '50%',
          }}
        >
          <X size={20} weight="bold" />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Waveform size={24} weight="duotone" color="var(--accent)" />
          <span style={{ fontWeight: 800, fontSize: '1.12rem' }}>Talk with a learning companion</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 20, lineHeight: 1.5 }}>
          Choose someone to talk with. They will listen, explain, and help you learn — in your language.
        </p>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32, color: 'var(--text-muted)' }}>
            Loading companions…
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
          }}>
            {personas.map((p, i) => (
              <PersonaCard
                key={p.id}
                persona={p}
                fallbackEmoji={EMOJI_FALLBACK[i] || '🤝'}
                onSelect={() => onSelect(p)}
              />
            ))}
          </div>
        )}

        <div style={{
          marginTop: 18,
          padding: '10px 14px',
          background: 'var(--surface-soft)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: '0.82rem', color: 'var(--text-muted)',
        }}>
          <Users size={16} weight="duotone" />
          <span>Your conversation is private and never shared with anyone.</span>
        </div>
      </div>
    </div>
  )
}

function PersonaCard({ persona, fallbackEmoji, onSelect }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--accent-soft)' : 'var(--surface-soft)',
        border: `2px solid ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 16,
        padding: '16px 12px',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        transition: 'all 0.15s ease',
        textAlign: 'center',
      }}
    >
      <div style={{
        width: 52, height: 52, borderRadius: '50%',
        background: persona.color || 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.6rem',
        flexShrink: 0,
      }}>
        {persona.emoji || fallbackEmoji}
      </div>
      <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text)' }}>
        {persona.name}
      </div>
      <div style={{
        fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4,
        display: '-webkit-box', WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {persona.style}
      </div>
    </button>
  )
}
