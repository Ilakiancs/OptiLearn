import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getTeacherStudents, getTeacherHeatmap, downloadWeeklyReport } from '../api/client'
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

const ALERT_LABELS = {
  inactive_3_days: 'Inactive 3+ days',
  stuck_on_topic: 'Stuck on a topic',
  level_dropped: 'Level dropped',
}

function AlertIcon() {
  return (
    <span title="Has alerts" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: '50%', background: '#7f1d1d',
      color: '#fca5a5', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
    }}>!</span>
  )
}

export default function TeacherDashboard() {
  const {
    data: students, isLoading, error, dataUpdatedAt,
  } = useQuery({
    queryKey: ['teacher-students'],
    queryFn: getTeacherStudents,
    refetchInterval: 10000,
    staleTime: 5000,
  })

  const { data: heatmapData } = useQuery({
    queryKey: ['teacher-heatmap'],
    queryFn: getTeacherHeatmap,
    refetchInterval: 10000,
    staleTime: 5000,
  })

  const secsAgo = useSecondsAgo(dataUpdatedAt)
  const allStudents = students || []
  const alertedStudents = allStudents.filter(s => s.alerts?.length > 0)

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
    <div className="page-shell">
      {/* Header */}
      <header style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <Link to="/" style={{
          color: 'var(--color-text-muted)', textDecoration: 'none',
          fontSize: '0.9rem', minHeight: 44, display: 'inline-flex', alignItems: 'center',
          paddingRight: 12,
        }}>
          ← Back
        </Link>
        <span style={{ fontWeight: 700, fontSize: '1.05rem', flex: 1 }}>
          OptiLearn — Teacher View
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link to="/teacher/materials" style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.85rem',
            display: 'inline-flex', alignItems: 'center', minHeight: 36,
          }}>
            Upload Materials
          </Link>
          <Link to="/teacher/quiz-builder" style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.85rem',
            display: 'inline-flex', alignItems: 'center', minHeight: 36,
          }}>
            Quiz Builder
          </Link>
          <button
            onClick={() => downloadWeeklyReport()}
            style={{
              padding: '6px 14px', borderRadius: 'var(--radius-md)',
              background: 'var(--color-primary)', border: 'none',
              color: '#fff', fontSize: '0.85rem', cursor: 'pointer', minHeight: 36,
            }}
          >
            Download Report PDF
          </button>
        </div>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-hint)', whiteSpace: 'nowrap' }}>
          {dataUpdatedAt
            ? secsAgo < 5 ? 'Just updated' : `Updated ${secsAgo}s ago`
            : isLoading ? 'Loading...' : '—'}
        </span>
      </header>

      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 16px' }}>
        {error && (
          <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>
            Error loading dashboard: {error.message}
          </p>
        )}

        {/* Metric cards */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '28px', flexWrap: 'wrap' }}>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>
              {isLoading ? '—' : allStudents.length}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Total students</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: alertedStudents.length > 0 ? '#EF9F27' : 'var(--color-success)' }}>
              {isLoading ? '—' : alertedStudents.length}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Flagged students</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>
              {isLoading ? '—' : (heatmapData?.topics?.length ?? '—')}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Topics tracked</div>
          </div>
        </div>

        {/* Alerts panel */}
        {alertedStudents.length > 0 && (
          <section style={{ marginBottom: '32px' }}>
            <h2 style={sectionHeadStyle}>Alerts</h2>
            <div style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {alertedStudents.map((student, i) => (
                <div
                  key={student.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '14px 16px', flexWrap: 'wrap',
                    borderBottom: i < alertedStudents.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}
                >
                  <AlertIcon />
                  <Link
                    to={`/teacher/student/${student.id}`}
                    style={{ fontWeight: 600, flex: 1, minWidth: 80, color: 'var(--color-text)', textDecoration: 'none' }}
                  >
                    {student.name}
                  </Link>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {student.alerts.map(a => (
                      <span key={a} style={{
                        padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                        background: '#3a1a00', color: '#fb923c',
                        fontSize: '0.78rem', fontWeight: 600,
                      }}>
                        {ALERT_LABELS[a] || a}
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    {Math.round((student.mastery_avg || 0) * 100)}% avg mastery
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Heatmap */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={sectionHeadStyle}>Topic Heatmap</h2>
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 16px',
          }}>
            {isLoading
              ? <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
              : heatmapData
                ? <HeatmapFromApi data={heatmapData} />
                : <TopicHeatmap students={allStudents} />
            }
          </div>
        </section>

        {/* All students table */}
        <section>
          <h2 style={sectionHeadStyle}>All Students</h2>
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            overflowX: 'auto',
          }}>
            {isLoading ? (
              <p style={{ padding: 16, color: 'var(--color-text-muted)' }}>Loading...</p>
            ) : allStudents.length === 0 ? (
              <p style={{ padding: 16, color: 'var(--color-text-muted)' }}>No students yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['', 'Name', 'Language', 'Grade', 'Mastery Avg', 'Level', 'Last Active'].map(h => (
                      <th key={h} style={{
                        padding: '12px 14px', textAlign: 'left',
                        fontSize: '0.8rem', color: 'var(--color-text-muted)',
                        fontWeight: 600, whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allStudents.map((s, i) => (
                    <tr
                      key={s.id}
                      style={{ borderBottom: i < allStudents.length - 1 ? '1px solid var(--color-border)' : 'none' }}
                    >
                      <td style={{ padding: '12px 8px 12px 14px', width: 24 }}>
                        {s.alerts?.length > 0 && <AlertIcon />}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <Link to={`/teacher/student/${s.id}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                          {s.name}
                        </Link>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)' }}>{s.language}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)' }}>{s.grade_level}</td>
                      <td style={{ padding: '12px 14px' }}>{Math.round((s.mastery_avg || 0) * 100)}%</td>
                      <td style={{ padding: '12px 14px' }}>
                        {s.mastery_summary?.length > 0
                          ? <MasteryBadge level={s.mastery_summary[0]?.level} />
                          : <span style={{ color: 'var(--color-text-hint)' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {relativeTime(s.last_active)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function HeatmapFromApi({ data }) {
  const { topics, students, grid } = data
  if (!topics?.length) return <p style={{ color: 'var(--color-text-hint)', fontSize: '0.9rem' }}>No topic data yet.</p>

  const COLOR_MAP = {
    red:   '#7f1d1d',
    amber: '#78350f',
    green: '#14532d',
    grey:  'var(--color-border)',
  }

  const CELL = 24
  const NAME_W = 100
  const HEADER_H = 80

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'inline-block', minWidth: NAME_W + topics.length * (CELL + 4) }}>
        <div style={{ display: 'flex', marginLeft: NAME_W }}>
          {topics.map(t => (
            <div key={t} style={{ width: CELL, marginRight: 4, height: HEADER_H, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
              <span style={{ display: 'block', transform: 'rotate(-45deg)', transformOrigin: 'bottom center', fontSize: '0.7rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 72 }}>{t.slice(0, 10)}</span>
            </div>
          ))}
        </div>
        {students.map((s, ri) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ width: NAME_W, fontSize: '0.8rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8, flexShrink: 0 }}>
              {s.name.slice(0, 12)}
            </span>
            {grid[ri]?.map((cell, ci) => (
              <div
                key={ci}
                title={`${s.name} — ${topics[ci]}: ${cell?.value !== null ? Math.round((cell?.value || 0) * 100) + '%' : 'no data'}`}
                style={{ width: CELL, height: CELL, marginRight: 4, borderRadius: 'var(--radius-sm)', background: COLOR_MAP[cell?.color || 'grey'], flexShrink: 0 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
