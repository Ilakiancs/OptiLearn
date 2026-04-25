import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { CalendarDots, ClipboardText, FileText, Sparkle } from '@phosphor-icons/react'
import { listMaterials, listTeacherQuizzes } from '../api/client'

function toDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

export default function CalendarPage() {
  const { studentId } = useOutletContext()
  const { data: quizzes = [], isLoading: quizzesLoading } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes })
  const { data: materials = [], isLoading: materialsLoading } = useQuery({ queryKey: ['materials'], queryFn: listMaterials })

  const timeline = useMemo(
    () =>
      [
        ...quizzes.map((item) => ({ id: `q-${item.id}`, type: 'assignment', title: item.title, subtitle: item.subject || 'General', date: item.created_at })),
        ...materials.map((item) => ({ id: `m-${item.id}`, type: 'material', title: item.title, subtitle: item.subject || 'General', date: item.created_at })),
      ].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [quizzes, materials]
  )

  const loading = quizzesLoading || materialsLoading

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div className="surface-card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '1.2rem' }}>
          <CalendarDots size={22} weight="duotone" />
          <span>Calendar</span>
        </h1>
        <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.84rem' }}>
          Predictable timeline of what was added and when.
        </div>
        <div className="tid-banner" style={{ marginTop: 10 }}>
          If this feels busy, focus on one card at a time and return later.
        </div>
      </div>

      {loading ? (
        <div className="surface-card" style={{ padding: 16, color: 'var(--text-muted)' }}>Loading timeline…</div>
      ) : timeline.length === 0 ? (
        <div className="surface-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Sparkle size={30} weight="duotone" />
          <div style={{ marginTop: 8 }}>No timeline entries yet.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {timeline.map((entry) => {
            const isAssignment = entry.type === 'assignment'
            return (
              <article key={entry.id} className="surface-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="icon-only" style={{ width: 34, height: 34 }}>
                    {isAssignment ? <ClipboardText size={18} weight="duotone" /> : <FileText size={18} weight="duotone" />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.title}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{entry.subtitle}</div>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{toDate(entry.date)}</div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
