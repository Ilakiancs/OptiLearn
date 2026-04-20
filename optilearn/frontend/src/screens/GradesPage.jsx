import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getStudentProgress } from '../api/client'

function relativeTime(iso) {
  if (!iso) return ''
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return 'Just now'
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago'
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago'
  return Math.floor(d / 86400000) + 'd ago'
}

function MasteryBar({ value, color }) {
  return (
    <div style={{ height: 8, background: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${Math.round(value * 100)}%`, background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
    </div>
  )
}

function levelInfo(mastery) {
  if (mastery >= 0.75) return { label: 'Advanced', color: '#22c55e', icon: '🏆' }
  if (mastery >= 0.40) return { label: 'Intermediate', color: '#f59e0b', icon: '📈' }
  return { label: 'Beginner', color: '#6c63ff', icon: '🌱' }
}

export default function GradesPage() {
  const { studentId } = useOutletContext()
  const { data: progress, isLoading } = useQuery({
    queryKey: ['student-progress', studentId],
    queryFn: () => getStudentProgress(studentId),
  })

  const mastery = progress?.mastery_by_topic || []
  const quizzes = progress?.recent_quizzes || []
  const avgMastery = mastery.length
    ? mastery.reduce((a, m) => a + m.mastery, 0) / mastery.length
    : null
  const { label: levelLabel, color: levelColor } = avgMastery !== null ? levelInfo(avgMastery) : { label: '—', color: '#6c63ff' }

  return (
    <div style={{ padding: '28px 24px', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>📊 Grades & Progress</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
          Your mastery by topic and recent quiz results
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        {[
          { icon: '📊', label: 'Avg Mastery', value: avgMastery !== null ? `${Math.round(avgMastery * 100)}%` : '—', color: '#22c55e' },
          { icon: '📚', label: 'Topics Tracked', value: mastery.length, color: 'var(--color-primary)' },
          { icon: '📝', label: 'Quizzes Taken', value: quizzes.length, color: '#f59e0b' },
          { icon: '🏅', label: 'Level', value: progress?.level ? progress.level.charAt(0).toUpperCase() + progress.level.slice(1) : '—', color: levelColor },
        ].map(c => (
          <div key={c.label} style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)', padding: '16px 18px', flex: 1, minWidth: 110,
          }}>
            <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{c.icon}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: c.color }}>{isLoading ? '…' : c.value}</div>
            <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Topic mastery */}
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)', padding: '20px', marginBottom: 20,
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 16 }}>📚 Mastery by Topic</div>
        {isLoading ? (
          <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem' }}>Loading…</div>
        ) : mastery.length === 0 ? (
          <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem', padding: '16px 0', textAlign: 'center' }}>
            📭 No mastery data yet. Start completing quizzes!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mastery.map((m, i) => {
              const info = levelInfo(m.mastery)
              const pct = Math.round(m.mastery * 100)
              return (
                <div key={i}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: '1rem' }}>{info.icon}</span>
                    <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>{m.topic}</span>
                    <span style={{ fontSize: '0.78rem', color: info.color, fontWeight: 700 }}>{pct}%</span>
                    <span style={{
                      fontSize: '0.68rem', padding: '2px 8px', borderRadius: 99,
                      background: info.color + '22', color: info.color, fontWeight: 700,
                    }}>{info.label}</span>
                  </div>
                  <MasteryBar value={m.mastery} color={info.color} />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent quiz history */}
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)', padding: '20px',
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 16 }}>⚡ Recent Quiz Results</div>
        {isLoading ? (
          <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem' }}>Loading…</div>
        ) : quizzes.length === 0 ? (
          <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem', padding: '16px 0', textAlign: 'center' }}>
            📭 No quizzes taken yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 100px 100px 80px',
              padding: '6px 0', borderBottom: '1px solid var(--color-border)',
              fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-hint)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <div>Topic</div><div style={{ textAlign: 'center' }}>Score</div>
              <div style={{ textAlign: 'center' }}>Grade</div><div style={{ textAlign: 'right' }}>When</div>
            </div>
            {quizzes.map((q, i) => {
              const pct = Math.round((q.score || 0) * 100)
              const color = pct >= 75 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444'
              const grade = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'E'
              return (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr 100px 100px 80px',
                  padding: '11px 0', borderBottom: i < quizzes.length - 1 ? '1px solid var(--color-border)' : 'none',
                  alignItems: 'center',
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>{q.topic}</div>
                  <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', color }}>{pct}%</div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '0.78rem', padding: '2px 10px', borderRadius: 99, background: color + '22', color, fontWeight: 700 }}>{grade}</span>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.74rem', color: 'var(--color-text-hint)' }}>{relativeTime(q.timestamp)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
