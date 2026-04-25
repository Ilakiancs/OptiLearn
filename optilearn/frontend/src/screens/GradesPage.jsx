import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChartBar, CheckCircle, Gauge, GraduationCap, TrendUp } from '@phosphor-icons/react'
import { getStudentProgress } from '../api/client'

function MasteryRow({ topic, value }) {
  const pct = Math.round(value * 100)
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>{topic}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{pct}%</div>
      </div>
      <div style={{ height: 8, borderRadius: 8, background: 'var(--accent-soft)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)' }} />
      </div>
    </div>
  )
}

export default function GradesPage() {
  const { studentId } = useOutletContext()
  const { data: progress, isLoading } = useQuery({
    queryKey: ['student-progress', studentId],
    queryFn: () => getStudentProgress(studentId),
  })

  const mastery = progress?.mastery_by_topic || []
  const quizzes = progress?.recent_quizzes || []
  const avg = mastery.length ? Math.round((mastery.reduce((acc, m) => acc + m.mastery, 0) / mastery.length) * 100) : null

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div className="surface-card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '1.2rem' }}>
          <ChartBar size={22} weight="duotone" />
          <span>Results</span>
        </h1>
        <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.84rem' }}>Review learning outcomes without pressure. Use this as guidance, not judgment.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[
          [Gauge, 'Average', avg === null ? '—' : `${avg}%`],
          [GraduationCap, 'Topics', mastery.length],
          [CheckCircle, 'Quizzes', quizzes.length],
          [TrendUp, 'Level', progress?.level || '—'],
        ].map(([Icon, label, value]) => (
          <div className="surface-card" key={label} style={{ padding: 14 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="icon-only" style={{ width: 34, height: 34 }}>
                <Icon size={18} weight="duotone" />
              </span>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{label}</div>
                <div style={{ fontWeight: 800 }}>{isLoading ? '…' : value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="surface-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Topic mastery</div>
        {isLoading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : mastery.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>No mastery data yet.</div>
        ) : (
          mastery.map((item, idx) => <MasteryRow key={`${item.topic}-${idx}`} topic={item.topic} value={item.mastery} />)
        )}
      </div>
    </section>
  )
}
