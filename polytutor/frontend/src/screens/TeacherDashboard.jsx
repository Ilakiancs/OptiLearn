import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard } from '../hooks/useDashboard'
import MasteryBadge from '../components/MasteryBadge'
import TopicHeatmap from '../components/TopicHeatmap'

function useSecondsAgo(dataUpdatedAt) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!dataUpdatedAt) return
    const tick = () => setSecs(Math.floor((Date.now() - dataUpdatedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [dataUpdatedAt])
  return secs
}

function relativeTime(isoString) {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
  return Math.floor(diff / 86400000) + 'd ago'
}

const CURRICULUM_TOPIC_COUNT = 5  // matches the 5 files we created

export default function TeacherDashboard() {
  const { data, isLoading, error, dataUpdatedAt } = useDashboard()
  const secsAgo = useSecondsAgo(dataUpdatedAt)

  const students = data?.students || []
  const totalSessions = data?.total_sessions || 0

  // Students needing attention: any topic mastery < 0.45
  const needsAttention = []
  for (const s of students) {
    for (const m of s.mastery_summary || []) {
      if (m.mastery < 0.45) {
        needsAttention.push({ student: s, topic: m.topic, mastery: m.mastery, level: m.level })
      }
    }
  }
  needsAttention.sort((a, b) => a.mastery - b.mastery)

  // Top topic per student
  function topTopic(student) {
    const m = student.mastery_summary
    return m?.length > 0 ? m[0] : null
  }

  const metricCardStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '20px 18px',
    textAlign: 'center',
    flex: 1,
    minWidth: 0,
  }

  const sectionHeadStyle = {
    fontSize: '1rem',
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '16px',
    marginTop: 0,
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Header */}
      <header style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <Link to="/" style={{
          color: 'var(--color-text-muted)', textDecoration: 'none',
          fontSize: '0.9rem', minHeight: 44, display: 'inline-flex', alignItems: 'center',
          paddingRight: 12,
        }}>
          ← Back
        </Link>
        <span style={{ fontWeight: 700, fontSize: '1.05rem', flex: 1 }}>
          PolyTutor — Teacher View
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-hint)', whiteSpace: 'nowrap' }}>
          {dataUpdatedAt
            ? secsAgo < 5 ? 'Just updated' : `Updated ${secsAgo}s ago`
            : isLoading ? 'Loading...' : '—'}
        </span>
      </header>

      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>
        {error && (
          <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>
            Error loading dashboard: {error.message}
          </p>
        )}

        {/* Metric cards */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '28px', flexWrap: 'wrap' }}>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>
              {isLoading ? '—' : students.length}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Total students</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>
              {isLoading ? '—' : totalSessions}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Total sessions</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>
              {CURRICULUM_TOPIC_COUNT}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Topics indexed</div>
          </div>
        </div>

        {/* Needs attention */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={sectionHeadStyle}>Students needing attention</h2>
          {isLoading ? (
            <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
          ) : needsAttention.length === 0 ? (
            <p style={{ color: 'var(--color-success)', fontSize: '0.95rem' }}>All students are on track.</p>
          ) : (
            <div style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {needsAttention.map(({ student, topic, mastery, level }, i) => (
                <div
                  key={`${student.id}-${topic}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    borderBottom: i < needsAttention.length - 1 ? '1px solid var(--color-border)' : 'none',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 600, flex: 1, minWidth: 80 }}>{student.name}</span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', flex: 1, minWidth: 80 }}>{topic}</span>
                  <span style={{ color: 'var(--color-danger)', fontSize: '0.9rem', minWidth: 40 }}>
                    {Math.round(mastery * 100)}%
                  </span>
                  <MasteryBadge level={level} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Heatmap */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={sectionHeadStyle}>Topic heatmap</h2>
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 16px',
          }}>
            {isLoading
              ? <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
              : <TopicHeatmap students={students} />
            }
          </div>
        </section>

        {/* All students table */}
        <section>
          <h2 style={sectionHeadStyle}>All students</h2>
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            overflowX: 'auto',
          }}>
            {isLoading ? (
              <p style={{ padding: 16, color: 'var(--color-text-muted)' }}>Loading...</p>
            ) : students.length === 0 ? (
              <p style={{ padding: 16, color: 'var(--color-text-muted)' }}>No students yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Name', 'Language', 'Grade', 'Top topic', 'Level', 'Last active'].map(h => (
                      <th key={h} style={{
                        padding: '12px 14px',
                        textAlign: 'left',
                        fontSize: '0.8rem',
                        color: 'var(--color-text-muted)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...students]
                    .sort((a, b) => new Date(b.last_active || 0) - new Date(a.last_active || 0))
                    .map((s, i) => {
                      const top = topTopic(s)
                      return (
                        <tr
                          key={s.id}
                          style={{ borderBottom: i < students.length - 1 ? '1px solid var(--color-border)' : 'none' }}
                        >
                          <td style={{ padding: '12px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.name}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)' }}>{s.language}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)' }}>{s.grade_level}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {top?.topic || '—'}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {top ? <MasteryBadge level={top.level} /> : <span style={{ color: 'var(--color-text-hint)' }}>—</span>}
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                            {relativeTime(s.last_active)}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
