import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle, ClipboardText, FunnelSimple, ListChecks, Timer } from '@phosphor-icons/react'
import { getStudentProgress, listTeacherQuizzes } from '../api/client'

function QuizTile({ quiz, completed, score }) {
  return (
    <article className="surface-card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="icon-only" style={{ width: 34, height: 34 }}>
            {completed ? <CheckCircle size={18} weight="duotone" /> : <ClipboardText size={18} weight="duotone" />}
          </span>
          <div>
            <div style={{ fontWeight: 700 }}>{quiz.title}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{quiz.subject || 'General'} • {quiz.question_count} questions</div>
          </div>
        </div>
        <div style={{ fontSize: '0.78rem', color: completed ? 'var(--success)' : 'var(--warning)', fontWeight: 700 }}>
          {completed ? `${score}%` : 'Pending'}
        </div>
      </div>
    </article>
  )
}

export default function AssignmentsPage() {
  const { studentId } = useOutletContext()
  const [filter, setFilter] = useState('all')

  const { data: quizzes = [], isLoading } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes })
  const { data: progress } = useQuery({ queryKey: ['student-progress', studentId], queryFn: () => getStudentProgress(studentId) })

  const attempts = progress?.recent_quizzes || []

  const rows = useMemo(
    () =>
      quizzes.map((quiz) => {
        const attempt = attempts.find((a) => a.quiz_id === quiz.id || a.topic?.toLowerCase() === quiz.subject?.toLowerCase())
        const score = attempt ? Math.round((attempt.score || 0) * 100) : null
        return { quiz, completed: Boolean(attempt), score }
      }),
    [quizzes, attempts]
  )

  const visible = rows.filter((item) => {
    if (filter === 'done') return item.completed
    if (filter === 'pending') return !item.completed
    return true
  })

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div className="surface-card" style={{ padding: 16, display: 'grid', gap: 8 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '1.2rem' }}>
          <ListChecks size={22} weight="duotone" />
          <span>Assignments</span>
        </h1>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>Pick a tile and complete one item at a time.</div>
        <div className="tid-banner">You can return later. Your progress is saved automatically.</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          ['all', `All ${rows.length}`],
          ['pending', `Pending ${rows.filter((x) => !x.completed).length}`],
          ['done', `Done ${rows.filter((x) => x.completed).length}`],
        ].map(([key, label]) => (
          <button
            key={key}
            className="pill-button"
            onClick={() => setFilter(key)}
            style={{
              background: filter === key ? 'var(--accent-soft)' : 'var(--surface)',
              borderColor: filter === key ? 'var(--accent)' : 'var(--border)',
              fontWeight: filter === key ? 700 : 500,
            }}
          >
            <FunnelSimple size={16} weight="duotone" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="surface-card" style={{ padding: 16, color: 'var(--text-muted)' }}>Loading assignments…</div>
      ) : visible.length === 0 ? (
        <div className="surface-card" style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
          <Timer size={30} weight="duotone" />
          <div style={{ marginTop: 8 }}>No assignments in this filter.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {visible.map(({ quiz, completed, score }) => (
            <QuizTile key={quiz.id} quiz={quiz} completed={completed} score={score} />
          ))}
        </div>
      )}
    </section>
  )
}
