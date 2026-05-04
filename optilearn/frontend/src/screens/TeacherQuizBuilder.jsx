import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createTeacherQuiz, listTeacherQuizzes, listStudents } from '../api/client'
import { Link } from 'react-router-dom'
import SubjectComboInput from '../components/SubjectComboInput'

const BLANK_QUESTION = { question: '', options: ['', '', '', ''], correct_answer: '', explanation: '' }

function QuestionForm({ q, idx, onChange, onRemove }) {
  function updateOption(oi, val) {
    const opts = [...q.options]
    opts[oi] = val
    onChange({ ...q, options: opts })
  }

  return (
    <div style={{
      background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Question {idx + 1}</span>
        {idx > 0 && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: '0.85rem' }}>
            Remove
          </button>
        )}
      </div>

      <textarea
        value={q.question}
        onChange={e => onChange({ ...q, question: e.target.value })}
        placeholder="Question text"
        rows={2}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)', background: 'var(--color-surface)',
          color: 'var(--color-text)', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box', marginBottom: 10,
        }}
      />

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>Answer options (mark the correct one)</div>
        {q.options.map((opt, oi) => (
          <div key={oi} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input
              type="radio"
              name={`correct-${idx}`}
              checked={q.correct_answer === opt && opt !== ''}
              onChange={() => onChange({ ...q, correct_answer: opt })}
              style={{ flexShrink: 0, width: 18, height: 18, cursor: 'pointer' }}
              title="Mark as correct answer"
            />
            <input
              value={opt}
              onChange={e => updateOption(oi, e.target.value)}
              placeholder={`Option ${oi + 1}`}
              style={{
                flex: 1, padding: '7px 11px', borderRadius: 'var(--radius-md)',
                border: `1px solid ${q.correct_answer === opt && opt !== '' ? 'var(--color-success)' : 'var(--color-border)'}`,
                background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.9rem',
              }}
            />
          </div>
        ))}
        {q.correct_answer && (
          <div style={{ fontSize: '0.78rem', color: 'var(--color-success)', marginTop: 4 }}>
            Correct: "{q.correct_answer}"
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>Hint / explanation (shown after answering)</div>
        <input
          value={q.explanation}
          onChange={e => onChange({ ...q, explanation: e.target.value })}
          placeholder="e.g. A fraction shows part of a whole. Let's look at this again together."
          style={{
            width: '100%', padding: '7px 11px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)', background: 'var(--color-surface)',
            color: 'var(--color-text)', fontSize: '0.9rem', boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  )
}

function QuizPreview({ title, subject, questions }) {
  const valid = questions.filter(q => q.question && q.correct_answer && q.options.some(o => o))
  return (
    <div style={{
      background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)', padding: '20px 16px',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title || '(Untitled quiz)'}</div>
      {subject && <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: 12 }}>{subject}</div>}
      {valid.length === 0 ? (
        <p style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem' }}>Add at least one complete question to preview.</p>
      ) : valid.map((q, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 6 }}>{i + 1}. {q.question}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {q.options.filter(o => o).map((opt, oi) => (
              <div key={oi} style={{
                padding: '6px 12px', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem',
                background: opt === q.correct_answer ? '#14532d' : 'var(--color-surface)',
                color: opt === q.correct_answer ? '#4ade80' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}>
                {opt} {opt === q.correct_answer ? '✓' : ''}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function TeacherQuizBuilder() {
  const qc = useQueryClient()

  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [assignedTo, setAssignedTo] = useState('all')
  const [questions, setQuestions] = useState([{ ...BLANK_QUESTION }])
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [quizSearch, setQuizSearch] = useState('')

  const { data: students } = useQuery({ queryKey: ['students'], queryFn: listStudents })
  const { data: quizzes, isLoading } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes, refetchInterval: 15000 })

  const filteredQuizzes = useMemo(() => {
    const q = quizSearch.trim().toLowerCase()
    const rows = quizzes || []
    if (!q) return rows
    return rows.filter((quiz) => [
      quiz.title,
      quiz.subject,
      quiz.created_by_username,
      quiz.created_by_display_name,
      quiz.created_by,
    ].some((value) => String(value || '').toLowerCase().includes(q)))
  }, [quizzes, quizSearch])

  const mutation = useMutation({
    mutationFn: createTeacherQuiz,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-quizzes'] })
      setTitle('')
      setSubject('')
      setAssignedTo('all')
      setQuestions([{ ...BLANK_QUESTION }])
      setError('')
    },
    onError: err => setError(err.message),
  })

  function updateQuestion(idx, updated) {
    setQuestions(qs => qs.map((q, i) => i === idx ? updated : q))
  }

  function addQuestion() {
    setQuestions(qs => [...qs, { ...BLANK_QUESTION }])
  }

  function removeQuestion(idx) {
    setQuestions(qs => qs.filter((_, i) => i !== idx))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required.'); return }
    if (!subject.trim()) { setError('Subject is required. Choose an existing subject or press Add to confirm a new one.'); return }

    const valid = questions.filter(q => q.question.trim() && q.correct_answer && q.options.filter(o => o.trim()).length >= 2)
    if (valid.length === 0) {
      setError('At least one complete question is required. Each question needs text, at least 2 options, and a correct answer marked.')
      return
    }

    setError('')
    const cleanQuestions = valid.map(q => ({
      question: q.question.trim(),
      options: q.options.filter(o => o.trim()),
      correct_answer: q.correct_answer,
      explanation: q.explanation.trim(),
    }))

    mutation.mutate({ title: title.trim(), subject: subject.trim() || undefined, questions: cleanQuestions, assigned_to: assignedTo })
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
    color: 'var(--color-text)', fontSize: '1rem', boxSizing: 'border-box',
  }
  const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px 16px', marginBottom: 24 }
  const sectionHead = { fontSize: '1rem', fontWeight: 700, marginBottom: 16, marginTop: 0 }

  return (
    <div className="page-shell">
      <header style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/teacher" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.9rem', minHeight: 44, display: 'inline-flex', alignItems: 'center', paddingRight: 12 }}>
          ← Back to Dashboard
        </Link>
        <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>Quiz Builder</span>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', display: 'grid', gridTemplateColumns: showPreview ? '1fr 1fr' : '1fr', gap: 24 }}>

        <div>
          {/* Builder form */}
          <section style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ ...sectionHead, marginBottom: 0 }}>New Quiz</h2>
              <button
                onClick={() => setShowPreview(p => !p)}
                style={{ padding: '6px 16px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                {showPreview ? 'Hide preview' : 'Preview'}
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>Quiz title *</label>
                <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Fractions Check-in" required />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>Subject *</label>
                <SubjectComboInput value={subject} onChange={setSubject} required error={error.startsWith('Subject') ? error : ''} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>Assign to</label>
                <select
                  value={assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="all">All students</option>
                  {(students || []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 12 }}>Questions</div>
                {questions.map((q, idx) => (
                  <QuestionForm
                    key={idx}
                    q={q}
                    idx={idx}
                    onChange={updated => updateQuestion(idx, updated)}
                    onRemove={() => removeQuestion(idx)}
                  />
                ))}
                <button
                  type="button"
                  onClick={addQuestion}
                  style={{
                    padding: '8px 16px', background: 'transparent',
                    border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)',
                    color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.9rem', width: '100%',
                  }}
                >
                  + Add Question
                </button>
              </div>

              {error && <p style={{ color: 'var(--color-danger)', margin: 0, fontSize: '0.9rem' }}>{error}</p>}
              {mutation.isSuccess && <p style={{ color: '#4ade80', margin: 0, fontSize: '0.9rem' }}>Quiz saved and assigned.</p>}

              <button
                type="submit"
                disabled={mutation.isPending}
                style={{
                  padding: '12px', minHeight: 44,
                  background: mutation.isPending ? 'var(--color-primary-dim)' : 'var(--color-primary)',
                  color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
                  fontSize: '1rem', fontWeight: 600, cursor: mutation.isPending ? 'default' : 'pointer',
                }}
              >
                {mutation.isPending ? 'Saving…' : 'Save Quiz'}
              </button>
            </form>
          </section>

          {/* Existing quizzes list */}
          <section style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <h2 style={{ ...sectionHead, marginBottom: 0 }}>Saved Quizzes</h2>
              <input
                value={quizSearch}
                onChange={(e) => setQuizSearch(e.target.value)}
                placeholder="Search title or teacher..."
                style={{ ...inputStyle, maxWidth: 320, minHeight: 42, fontSize: '0.9rem' }}
              />
            </div>
            {isLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
            ) : !quizzes?.length ? (
              <p style={{ color: 'var(--color-text-hint)' }}>No quizzes yet.</p>
            ) : filteredQuizzes.length === 0 ? (
              <p style={{ color: 'var(--color-text-hint)' }}>No quizzes match your search.</p>
            ) : filteredQuizzes.map((q, i) => (
              <div key={q.id} style={{
                display: 'flex', gap: 12, alignItems: 'center',
                padding: '12px 0', borderBottom: i < filteredQuizzes.length - 1 ? '1px solid var(--color-border)' : 'none',
                flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontWeight: 600 }}>{q.title}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    {q.subject || '—'} · {q.question_count} question{q.question_count !== 1 ? 's' : ''} · Created by {q.created_by_username || q.created_by_display_name || '-'}
                  </div>
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem',
                  background: 'var(--color-surface-2)', color: 'var(--color-text-muted)',
                }}>
                  {q.assigned_to === 'all' ? 'All students' : `Student: ${q.assigned_to.slice(0, 8)}…`}
                </span>
              </div>
            ))}
          </section>
        </div>

        {/* Preview pane */}
        {showPreview && (
          <div>
            <div style={{ ...card, position: 'sticky', top: 20 }}>
              <h2 style={sectionHead}>Preview</h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginBottom: 12 }}>
                This is how the quiz will appear to students. Correct answers are highlighted in green.
              </p>
              <QuizPreview title={title} subject={subject} questions={questions} />
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
