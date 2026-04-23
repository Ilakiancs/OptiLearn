import MasteryBadge from './MasteryBadge'

function relativeTime(isoString) {
  if (!isoString) return null
  const diff = Date.now() - new Date(isoString).getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
  return Math.floor(diff / 86400000) + 'd ago'
}

export default function StudentCard({ student, onSelect, isLoading }) {
  const mastery = student.mastery_summary || []
  const topMastery = mastery.length > 0 ? mastery[0] : null
  const lastActive = relativeTime(student.last_active)

  return (
    <div
      onClick={() => !isLoading && onSelect(student)}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 18px',
        cursor: isLoading ? 'default' : 'pointer',
        position: 'relative',
        minHeight: '120px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        transition: 'border-color 0.15s',
        userSelect: 'none',
      }}
    >
      {isLoading && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(15,17,23,0.6)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1,
        }}>
          <div style={{
            width: '24px', height: '24px',
            border: '3px solid var(--color-border)',
            borderTopColor: 'var(--color-primary)',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text)' }}>
          {student.name}
        </span>
        <span style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '1px 7px',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          {student.language}
        </span>
      </div>

      {topMastery
        ? <MasteryBadge level={topMastery.level} />
        : <span style={{ fontSize: '0.8rem', color: 'var(--color-text-hint)' }}>New student</span>
      }

      {lastActive && (
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-hint)', marginTop: 'auto' }}>
          {lastActive}
        </span>
      )}
    </div>
  )
}
