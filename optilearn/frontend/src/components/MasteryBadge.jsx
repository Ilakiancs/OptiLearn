const LEVEL_STYLES = {
  beginner: { background: '#1e3a5f', color: '#60a5fa' },
  intermediate: { background: '#3b2e0a', color: '#fbbf24' },
  advanced: { background: '#14532d', color: '#4ade80' },
}

export default function MasteryBadge({ level }) {
  if (!level || !LEVEL_STYLES[level]) return null
  return (
    <span style={{
      ...LEVEL_STYLES[level],
      padding: '2px 10px',
      borderRadius: 'var(--radius-sm)',
      fontSize: '0.75rem',
      fontWeight: 600,
      textTransform: 'capitalize',
      display: 'inline-block',
    }}>
      {level}
    </span>
  )
}
