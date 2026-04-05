import { useState } from 'react'

function masteryColor(value) {
  if (value === null || value === undefined) return 'var(--color-border)'
  if (value < 0.45) return '#7f1d1d'
  if (value < 0.75) return '#78350f'
  return '#14532d'
}

function masteryLevel(value) {
  if (value === null || value === undefined) return 'no data'
  if (value < 0.45) return 'beginner'
  if (value < 0.75) return 'intermediate'
  return 'advanced'
}

export default function TopicHeatmap({ students }) {
  const [tooltip, setTooltip] = useState(null)

  // Collect all unique topics
  const topicSet = new Set()
  for (const s of students) {
    for (const m of s.mastery_summary || []) {
      topicSet.add(m.topic)
    }
  }
  const topics = Array.from(topicSet).sort()

  if (topics.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-hint)', fontSize: '0.9rem' }}>
        No topic data yet.
      </p>
    )
  }

  // Build lookup: studentId → topic → masteryValue
  const lookup = {}
  for (const s of students) {
    lookup[s.id] = {}
    for (const m of s.mastery_summary || []) {
      lookup[s.id][m.topic] = m
    }
  }

  const CELL = 24
  const NAME_WIDTH = 100
  const HEADER_HEIGHT = 80

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <div style={{
        display: 'inline-block',
        minWidth: NAME_WIDTH + topics.length * (CELL + 4),
      }}>
        {/* Topic headers */}
        <div style={{ display: 'flex', marginLeft: NAME_WIDTH }}>
          {topics.map(topic => (
            <div
              key={topic}
              style={{
                width: CELL,
                marginRight: 4,
                height: HEADER_HEIGHT,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                paddingBottom: 4,
              }}
            >
              <span style={{
                display: 'block',
                transform: 'rotate(-45deg)',
                transformOrigin: 'bottom center',
                fontSize: '0.7rem',
                color: 'var(--color-text-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '72px',
              }}>
                {topic.slice(0, 10)}
              </span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {students.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <span style={{
              width: NAME_WIDTH,
              fontSize: '0.8rem',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              paddingRight: 8,
              flexShrink: 0,
            }}>
              {s.name.slice(0, 12)}
            </span>
            {topics.map(topic => {
              const entry = lookup[s.id]?.[topic]
              const val = entry?.mastery ?? null
              return (
                <div
                  key={topic}
                  onMouseEnter={e => setTooltip({
                    x: e.clientX, y: e.clientY,
                    text: `${s.name} — ${topic}: ${val !== null ? Math.round(val * 100) + '%' : 'no data'} (${masteryLevel(val)})`
                  })}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={e => setTooltip(
                    tooltip ? null : {
                      x: e.clientX, y: e.clientY,
                      text: `${s.name} — ${topic}: ${val !== null ? Math.round(val * 100) + '%' : 'no data'} (${masteryLevel(val)})`
                    }
                  )}
                  style={{
                    width: CELL,
                    height: CELL,
                    marginRight: 4,
                    borderRadius: 'var(--radius-sm)',
                    background: masteryColor(val),
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>

      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x + 12,
          top: tooltip.y - 8,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontSize: '0.8rem',
          color: 'var(--color-text)',
          pointerEvents: 'none',
          zIndex: 100,
          maxWidth: 240,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
