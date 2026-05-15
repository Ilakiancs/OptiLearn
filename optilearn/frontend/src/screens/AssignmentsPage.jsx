import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, ClipboardText, FunnelSimple, ListChecks, Play, Timer, X } from '@phosphor-icons/react'
import { getStudentProgress, listStudentQuizzes } from '../api/client'
import { QuizFlow } from './CoursePage'
import Spinner from '../components/Spinner'

function QuizTile({ quiz, completed, score, onStart }) {
  return (
    <article className="surface-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <span className="icon-only" style={{ width: 34, height: 34, flexShrink: 0 }}>
        {completed ? <CheckCircle size={18} weight="duotone" /> : <ClipboardText size={18} weight="duotone" />}
      </span>
      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ fontWeight: 700 }}>{quiz.title}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          {quiz.subject || 'General'} · {quiz.question_count ?? (quiz.questions?.length ?? 0)} questions
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {completed && (
          <span style={{ fontSize: '0.82rem', color: 'var(--success)', fontWeight: 700 }}>{score}%</span>
        )}
        <button
          onClick={onStart}
          style={{
            padding: '9px 18px', background: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600,
            cursor: 'pointer', fontSize: '0.88rem',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}
        >
          <Play size={14} />
          <span>{completed ? 'Retake' : 'Start'}</span>
        </button>
      </div>
    </article>
  )
}

export default function AssignmentsPage() {
  const { studentId } = useOutletContext()
  const [filter, setFilter] = useState('all')
  const [activeQuiz, setActiveQuiz] = useState(null)
  const queryClient = useQueryClient()

  const { data: quizzes = [], isLoading } = useQuery({
    queryKey: ['student-quizzes', studentId],
    queryFn: () => listStudentQuizzes(studentId),
    enabled: !!studentId,
  })
  const { data: progress } = useQuery({
    queryKey: ['student-progress', studentId],
    queryFn: () => getStudentProgress(studentId),
    refetchOnMount: 'always',
  })

  useEffect(() => {
    if (!activeQuiz) {
      queryClient.invalidateQueries({ queryKey: ['student-progress', studentId] })
    }
  }, [activeQuiz, queryClient, studentId])

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

  if (activeQuiz) {
    return (
      <section style={{ display: 'grid', gap: 12 }}>
        <div className="surface-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
                onClick={() => setActiveQuiz(null)}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <X size={14} /> Back
            </button>
              <span style={{ fontWeight: 700 }}>{activeQuiz.title}</span>
          </div>
            <QuizFlow
              quiz={activeQuiz}
              studentId={studentId}
              onDone={() => {
                setActiveQuiz(null)
                queryClient.invalidateQueries({ queryKey: ['student-progress', studentId] })
              }}
            />
        </div>
      </section>
    )
  }

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
        <div className="surface-card" style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <div className="surface-card" style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
          <Timer size={30} weight="duotone" />
          <div style={{ marginTop: 8 }}>No assignments in this filter.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {visible.map(({ quiz, completed, score }) => (
            <QuizTile key={quiz.id} quiz={quiz} completed={completed} score={score} onStart={() => setActiveQuiz(quiz)} />
          ))}
        </div>
      )}
    </section>
  )
}
