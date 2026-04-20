import { useOutletContext, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listTeacherQuizzes, getStudentProgress } from '../api/client'
import { useState } from 'react'

function Badge({ children, color = '#6c63ff' }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
      background: color + '22', color, fontSize: '0.72rem', fontWeight: 700,
    }}>{children}</span>
  )
}

function QuizCard({ quiz, attempt }) {
  const [expanded, setExpanded] = useState(false)
  const done = !!attempt
  const pct = done ? Math.round((attempt.score || 0) * 100) : null
  const scoreColor = pct >= 75 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div style={{
      background: 'var(--color-surface)', border: `1px solid ${done ? '#22c55e33' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-lg)', padding: '18px 20px', transition: 'box-shadow 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '1.6rem', marginTop: 2 }}>{done ? '✅' : '📝'}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>{quiz.title}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {quiz.subject && <Badge color="#6c63ff">{quiz.subject}</Badge>}
            <Badge color="#06b6d4">{quiz.question_count} question{quiz.question_count !== 1 ? 's' : ''}</Badge>
            {quiz.assigned_to !== 'all' && <Badge color="#f59e0b">Assigned</Badge>}
          </div>
          {expanded && quiz.questions?.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {quiz.questions.map((q, i) => (
                <div key={i} style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', paddingLeft: 8, borderLeft: '2px solid var(--color-border)' }}>
                  {i + 1}. {q.question}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          {done ? (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: scoreColor }}>{pct}%</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-hint)' }}>Score</div>
            </div>
          ) : (
            <div style={{
              padding: '7px 16px', background: 'var(--color-primary)', color: '#fff',
              borderRadius: 'var(--radius-md)', fontSize: '0.82rem', fontWeight: 600,
              cursor: 'default', opacity: 0.8,
            }}>
              Not started
            </div>
          )}
          {quiz.questions?.length > 0 && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-hint)', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}
            >
              {expanded ? '▲ Hide' : '▼ Preview'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AssignmentsPage() {
  const { studentId } = useOutletContext()
  const [filter, setFilter] = useState('all')

  const { data: quizzes = [], isLoading } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes })
  const { data: progress } = useQuery({ queryKey: ['student-progress', studentId], queryFn: () => getStudentProgress(studentId) })

  const attempts = progress?.recent_quizzes || []

  const attempted = quizzes.filter(q =>
    attempts.some(a => a.topic?.toLowerCase() === q.subject?.toLowerCase() || a.quiz_id === q.id)
  )
  const pending = quizzes.filter(q => !attempted.includes(q))

  const visible = filter === 'done' ? attempted : filter === 'pending' ? pending : quizzes

  const tabs = [
    { key: 'all', label: `All (${quizzes.length})` },
    { key: 'pending', label: `Pending (${pending.length})` },
    { key: 'done', label: `Completed (${attempted.length})` },
  ]

  return (
    <div style={{ padding: '28px 24px', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>📝 Assignments</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
          {quizzes.length} total · {pending.length} pending · {attempted.length} completed
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)} style={{
            padding: '6px 16px', borderRadius: 99, cursor: 'pointer',
            background: filter === t.key ? 'var(--color-primary)' : 'var(--color-surface)',
            color: filter === t.key ? '#fff' : 'var(--color-text-muted)',
            fontSize: '0.82rem', fontWeight: filter === t.key ? 700 : 400,
            border: `1px solid ${filter === t.key ? 'transparent' : 'var(--color-border)'}`,
          }}>{t.label}</button>
        ))}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ height: 90, borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: 0.4 }} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)', padding: '60px 24px', textAlign: 'center',
          color: 'var(--color-text-muted)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>{filter === 'done' ? '🏆' : '📭'}</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>
            {filter === 'done' ? 'No completed assignments yet' : 'No assignments here'}
          </div>
          <div style={{ fontSize: '0.9rem' }}>
            {filter === 'done' ? 'Complete some quizzes from your courses!' : 'Your teacher will add assignments soon.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map(q => {
            const attempt = attempts.find(a => a.topic?.toLowerCase() === q.subject?.toLowerCase() || a.quiz_id === q.id)
            return <QuizCard key={q.id} quiz={q} attempt={attempt} />
          })}
        </div>
      )}
    </div>
  )
}
