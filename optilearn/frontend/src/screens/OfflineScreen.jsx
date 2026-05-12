import { useEffect, useState } from 'react'

export default function OfflineScreen({ onRecover }) {
  const [dots, setDots] = useState(0)

  useEffect(() => {
    const tick = setInterval(() => setDots((d) => (d + 1) % 4), 500)
    return () => clearInterval(tick)
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: 'var(--bg, #f0f4f8)',
        color: 'var(--text, #1a202c)',
        padding: 32,
        textAlign: 'center',
      }}
    >
      <style>{`
        @keyframes ol-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.88); }
        }
      `}</style>

      {/* Logo */}
      <div
        style={{
          width: 80, height: 80,
          borderRadius: 22,
          overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(42,141,191,0.28)',
          flexShrink: 0,
        }}
      >
        <img src="/icons/icon-192x192.png" alt="OptiLearn" style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>

      <div>
        <div
          style={{
            fontSize: 22, fontWeight: 700,
            color: 'var(--text, #1a202c)',
            marginBottom: 8,
          }}
        >
          Not connected to the OptiLearn network
        </div>
        <div style={{ fontSize: 15, color: 'var(--text-muted, #64748b)', lineHeight: 1.6, maxWidth: 360 }}>
          Connect to the OptiLearn Wi-Fi and the app will resume automatically.
        </div>
      </div>

      {/* Animated retry dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <div
          style={{
            width: 12, height: 12, borderRadius: '50%',
            background: 'var(--accent, #2a8dbf)',
            animation: 'ol-pulse 1.2s ease-in-out infinite',
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
          {`Retrying${'.'.repeat(dots)}`}
        </span>
      </div>
    </div>
  )
}
