import { useOutletContext, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getStudentProgress } from '../api/client'

function levelInfo(mastery) {
  if (mastery >= 0.75) return { label: 'Advanced', color: '#22c55e', icon: '🏆', next: null }
  if (mastery >= 0.40) return { label: 'Intermediate', color: '#f59e0b', icon: '📈', next: 'Advanced at 75%' }
  return { label: 'Beginner', color: '#6c63ff', icon: '🌱', next: 'Intermediate at 40%' }
}

export default function StudentProgressPage() {
  const { studentId } = useOutletContext()
  const { data: progress, isLoading } = useQuery({
    queryKey: ['student-progress', studentId],
    queryFn: () => getStudentProgress(studentId),
  })

  const mastery = progress?.mastery_by_topic || []
  const avgMastery = mastery.length
    ? mastery.reduce((a, m) => a + m.mastery, 0) / mastery.length
    : 0
  const info = levelInfo(avgMastery)
  const pct = Math.round(avgMastery * 100)

  return (
    <div style={{ padding: '28px 24px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>🏅 My Progress</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>Your learning journey overview</p>
      </div>

      {/* Level card */}
      <div style={{
        background: `linear-gradient(135deg, ${info.color}22 0%, var(--color-surface) 100%)`,
        border: `1px solid ${info.color}44`, borderRadius: 'var(--radius-lg)',
        padding: '28px 24px', marginBottom: 20, textAlign: 'center',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: 8 }}>{info.icon}</div>
        <div style={{ fontSize: '2rem', fontWeight: 800, color: info.color }}>{isLoading ? '…' : pct}%</div>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', marginTop: 4 }}>Overall Mastery</div>
        <div style={{ fontSize: '0.82rem', color: info.color, fontWeight: 600, marginTop: 6 }}>{info.label}</div>
        {info.next && <div style={{ fontSize: '0.78rem', color: 'var(--color-text-hint)', marginTop: 6 }}>Next: {info.next}</div>}

        {/* Progress bar */}
        <div style={{ height: 10, background: 'rgba(255,255,255,0.1)', borderRadius: 5, overflow: 'hidden', marginTop: 16, maxWidth: 300, margin: '16px auto 0' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: info.color, borderRadius: 5, transition: 'width 0.8s ease' }} />
        </div>
      </div>

      {/* Topic breakdown */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px', marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 14 }}>📚 Topic Breakdown</div>
        {isLoading ? (
          <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem' }}>Loading…</div>
        ) : mastery.length === 0 ? (
          <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>
            📭 Complete quizzes to track your mastery here.
          </div>
        ) : (
          [...mastery].sort((a, b) => b.mastery - a.mastery).map((m, i) => {
            const li = levelInfo(m.mastery)
            const tp = Math.round(m.mastery * 100)
            return (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span>{li.icon}</span>
                  <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>{m.topic}</span>
                  <span style={{ fontSize: '0.8rem', color: li.color, fontWeight: 700 }}>{tp}%</span>
                </div>
                <div style={{ height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${tp}%`, background: li.color, borderRadius: 3, transition: 'width 0.6s' }} />
                </div>
              </div>
            )
          })
        )}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <Link to={`/student/${studentId}/grades`} style={{
          flex: 1, padding: '12px', textAlign: 'center',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)', textDecoration: 'none',
          color: 'var(--color-text)', fontSize: '0.88rem', fontWeight: 600,
        }}>📊 Detailed Grades</Link>
        <Link to={`/student/${studentId}/courses`} style={{
          flex: 1, padding: '12px', textAlign: 'center',
          background: 'var(--color-primary)', border: 'none',
          borderRadius: 'var(--radius-lg)', textDecoration: 'none',
          color: '#fff', fontSize: '0.88rem', fontWeight: 600,
        }}>📚 Browse Courses</Link>
      </div>
    </div>
  )
}
