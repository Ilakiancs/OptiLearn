import { Link, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChartBar, RocketLaunch, Trophy } from '@phosphor-icons/react'
import { getStudentProgress } from '../api/client'

export default function StudentProgressPage() {
  const { studentId } = useOutletContext()
  const { data: progress, isLoading } = useQuery({
    queryKey: ['student-progress', studentId],
    queryFn: () => getStudentProgress(studentId),
  })

  const mastery = progress?.mastery_by_topic || []
  const overall = mastery.length ? Math.round((mastery.reduce((acc, row) => acc + row.mastery, 0) / mastery.length) * 100) : 0

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div className="surface-card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '1.2rem' }}>
          <Trophy size={22} weight="duotone" />
          <span>Progress</span>
        </h1>
        <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.84rem' }}>
          This view helps you notice growth, not mistakes.
        </div>
      </div>

      <div className="surface-card" style={{ padding: 16, textAlign: 'center' }}>
        <span className="icon-only" style={{ margin: '0 auto', width: 46, height: 46 }}>
          <RocketLaunch size={24} weight="duotone" />
        </span>
        <div style={{ marginTop: 8, fontSize: '2rem', fontWeight: 800 }}>{isLoading ? '…' : `${overall}%`}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>Overall mastery</div>
      </div>

      <div className="surface-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Topics</div>
        {isLoading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : mastery.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>No topic progress yet.</div>
        ) : (
          mastery
            .slice()
            .sort((a, b) => b.mastery - a.mastery)
            .map((item, idx) => {
              const pct = Math.round(item.mastery * 100)
              return (
                <div key={`${item.topic}-${idx}`} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{item.topic}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 99, background: 'var(--accent-soft)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                </div>
              )
            })
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link to={`/student/${studentId}/grades`} className="pill-button">
          <ChartBar size={16} weight="duotone" />
          <span>Detailed results</span>
        </Link>
        <Link to={`/student/${studentId}`} className="pill-button">
          <ArrowLeft size={16} weight="duotone" />
          <span>Back home</span>
        </Link>
      </div>
    </section>
  )
}
