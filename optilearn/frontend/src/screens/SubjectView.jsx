import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getMaterialsBySubject, getQuizzesBySubject, getMaterialFileUrl, submitQuiz } from '../api/client'

// ── File type helpers ──────────────────────────────────────────
function fileExt(filePath) {
  return (filePath || '').split('.').pop().toLowerCase()
}

function fileTypeLabel(filePath) {
  const ext = fileExt(filePath)
  if (ext === 'pdf') return 'PDF'
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'Image'
  if (ext === 'txt') return 'Text'
  return 'File'
}

function fileTypeBadge(filePath) {
  const label = fileTypeLabel(filePath)
  const colors = {
    PDF: { bg: '#1a0a2e', color: '#a78bfa', border: '#6d28d9' },
    Image: { bg: '#0a1f2e', color: '#67e8f9', border: '#0891b2' },
    Text: { bg: '#0a2e1a', color: '#86efac', border: '#16a34a' },
    File: { bg: '#1a1a1a', color: '#aaa', border: '#444' },
  }
  const c = colors[label] || colors.File
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 'var(--radius-sm)',
      fontSize: '0.72rem', fontWeight: 700,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {label}
    </span>
  )
}

// ── Material viewer ────────────────────────────────────────────
function MaterialViewer({ material, onClose }) {
  const [txtContent, setTxtContent] = useState(null)
  const [txtLoading, setTxtLoading] = useState(false)
  const ext = fileExt(material.file_path)
  const url = getMaterialFileUrl(material.id)
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)
  const isTxt = ext === 'txt'
  const isPdf = ext === 'pdf'

  useState(() => {
    if (isTxt && txtContent === null && !txtLoading) {
      setTxtLoading(true)
      fetch(url)
        .then(r => r.text())
        .then(t => { setTxtContent(t); setTxtLoading(false) })
        .catch(() => { setTxtContent('Could not load file.'); setTxtLoading(false) })
    }
  }, [material.id])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Viewer header */}
      <div style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', borderRadius: 'var(--radius-md)',
            padding: '6px 14px', cursor: 'pointer', fontSize: '0.9rem', minHeight: 36,
          }}
        >
          ← Close
        </button>
        <span style={{ fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {material.title}
        </span>
        {fileTypeBadge(material.file_path)}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem',
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', textDecoration: 'none', minHeight: 36,
            display: 'inline-flex', alignItems: 'center',
          }}
        >
          Open in tab ↗
        </a>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {isPdf && (
          <iframe
            src={url}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            title={material.title}
          />
        )}
        {isImage && (
          <div style={{ height: '100%', overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24 }}>
            <img
              src={url}
              alt={material.title}
              style={{ maxWidth: '100%', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
            />
          </div>
        )}
        {isTxt && (
          <div style={{ height: '100%', overflow: 'auto', padding: '24px', color: 'var(--color-text)' }}>
            {txtLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
            ) : (
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'inherit', fontSize: '0.95rem', lineHeight: 1.7,
                maxWidth: 760, margin: '0 auto',
              }}>
                {txtContent}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Quiz flow (inline) ─────────────────────────────────────────
function QuizFlow({ quiz, studentId, onClose, onComplete }) {
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [answers, setAnswers] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  const questions = quiz.questions || []
  const total = questions.length
  const q = questions[idx]

  function handleSelect(opt) {
    if (confirmed) return
    setSelected(opt)
  }

  function handleConfirm() {
    if (!selected || confirmed) return
    setConfirmed(true)
  }

  function handleNext() {
    const newAnswers = [...answers, {
      question_id: q.question,
      answer: selected,
      correct_answer: q.correct_answer,
    }]
    setAnswers(newAnswers)

    if (idx + 1 < total) {
      setIdx(i => i + 1)
      setSelected(null)
      setConfirmed(false)
    } else {
      // Submit
      setSubmitting(true)
      submitQuiz({
        student_id: studentId,
        session_id: null,
        topic: quiz.subject || quiz.title,
        answers: newAnswers,
      })
        .then(res => { setResult(res); setSubmitting(false) })
        .catch(() => {
          const score = newAnswers.filter(a => a.answer === a.correct_answer).length / total
          setResult({ score, mastery: score, new_level: score >= 0.75 ? 'advanced' : score >= 0.4 ? 'intermediate' : 'beginner' })
          setSubmitting(false)
        })
    }
  }

  const isCorrect = confirmed && selected === q?.correct_answer

  // Result screen
  if (result) {
    const pct = Math.round(result.score * 100)
    const correct = Math.round(result.score * total)
    return (
      <div style={{ padding: '32px 16px', maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <div style={{
          fontSize: '3rem', fontWeight: 800, marginBottom: 8,
          color: result.score >= 0.75 ? 'var(--color-success)' : result.score >= 0.4 ? '#EF9F27' : 'var(--color-danger)',
        }}>
          {pct}%
        </div>
        <div style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
          {correct} of {total} correct
        </div>
        <div style={{
          background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: 24, textAlign: 'left',
        }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Mastery update — {quiz.subject || quiz.title}
          </div>
          <div style={{ height: 8, background: 'var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.round((result.mastery || result.score) * 100)}%`,
              background: result.score >= 0.75 ? 'var(--color-success)' : result.score >= 0.4 ? '#EF9F27' : 'var(--color-danger)',
              transition: 'width 0.6s',
            }} />
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-hint)', marginTop: 4 }}>
            Level: {result.new_level}
          </div>
        </div>
        <div style={{ fontSize: '1rem', fontStyle: 'italic', color: 'var(--color-text)', marginBottom: 24 }}>
          {result.score === 1 ? 'Perfect score! Outstanding work.' :
           result.score >= 0.75 ? 'Great job! Keep it up.' :
           result.score >= 0.4 ? 'Good effort. Review the material and try again.' :
           "Let's go over this topic together."}
        </div>
        <button
          onClick={onComplete}
          style={{
            width: '100%', padding: '13px', minHeight: 44, fontWeight: 600,
            background: 'var(--color-primary)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius-md)', fontSize: '1rem', cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    )
  }

  if (submitting) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64 }}>
        <div style={{
          width: 32, height: 32, border: '3px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)', borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }} />
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: 560, margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          {idx + 1} / {total}
        </span>
        <div style={{ flex: 1, height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%', background: 'var(--color-primary)',
            width: `${((idx + 1) / total) * 100}%`, transition: 'width 0.3s',
          }} />
        </div>
      </div>

      {/* Question */}
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 16px',
        marginBottom: 16,
        fontSize: '1rem', fontWeight: 600, lineHeight: 1.5,
      }}>
        {q.question}
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {(q.options || []).map((opt, oi) => {
          let bg = 'var(--color-surface)'
          let border = 'var(--color-border)'
          let color = 'var(--color-text)'

          if (confirmed) {
            if (opt === q.correct_answer) { bg = '#14532d'; border = '#16a34a'; color = '#4ade80' }
            else if (opt === selected) { bg = '#3a1a1a'; border = '#dc2626'; color = '#fca5a5' }
          } else if (opt === selected) {
            bg = 'var(--color-surface-2)'; border = 'var(--color-primary)'; color = 'var(--color-text)'
          }

          return (
            <button
              key={oi}
              onClick={() => handleSelect(opt)}
              style={{
                padding: '13px 16px', textAlign: 'left', borderRadius: 'var(--radius-md)',
                background: bg, border: `2px solid ${border}`, color,
                fontSize: '0.95rem', cursor: confirmed ? 'default' : 'pointer',
                transition: 'all 0.15s', fontWeight: opt === q.correct_answer && confirmed ? 600 : 400,
              }}
            >
              {opt}
              {confirmed && opt === q.correct_answer && ' ✓'}
              {confirmed && opt === selected && opt !== q.correct_answer && ' ✗'}
            </button>
          )
        })}
      </div>

      {/* Explanation */}
      {confirmed && q.explanation && (
        <div style={{
          background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: '12px 16px',
          fontSize: '0.88rem', color: 'var(--color-text-muted)', marginBottom: 16, lineHeight: 1.6,
        }}>
          💡 {q.explanation}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        {!confirmed ? (
          <button
            onClick={handleConfirm}
            disabled={!selected}
            style={{
              flex: 1, padding: '13px', minHeight: 44, fontWeight: 600,
              background: selected ? 'var(--color-primary)' : 'var(--color-primary-dim)',
              color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
              fontSize: '1rem', cursor: selected ? 'pointer' : 'default',
            }}
          >
            Confirm Answer
          </button>
        ) : (
          <button
            onClick={handleNext}
            style={{
              flex: 1, padding: '13px', minHeight: 44, fontWeight: 600,
              background: 'var(--color-primary)', color: '#fff', border: 'none',
              borderRadius: 'var(--radius-md)', fontSize: '1rem', cursor: 'pointer',
            }}
          >
            {idx + 1 < total ? 'Next Question →' : 'Finish Quiz'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main SubjectView ───────────────────────────────────────────
export default function SubjectView() {
  const { studentId, subject } = useParams()
  const decodedSubject = decodeURIComponent(subject)

  const [activeTab, setActiveTab] = useState('materials')
  const [viewingMaterial, setViewingMaterial] = useState(null)
  const [takingQuiz, setTakingQuiz] = useState(null)

  const { data: materials = [], isLoading: matLoading } = useQuery({
    queryKey: ['materials', decodedSubject],
    queryFn: () => getMaterialsBySubject(decodedSubject),
  })

  const { data: quizzes = [], isLoading: quizLoading } = useQuery({
    queryKey: ['subject-quizzes', decodedSubject, studentId],
    queryFn: () => getQuizzesBySubject(decodedSubject, studentId),
  })

  function relativeTime(iso) {
    if (!iso) return ''
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
    return Math.floor(diff / 86400000) + 'd ago'
  }

  const tabStyle = (active) => ({
    padding: '10px 20px', minHeight: 40, fontWeight: active ? 700 : 500,
    background: active ? 'var(--color-primary)' : 'transparent',
    color: active ? '#fff' : 'var(--color-text-muted)',
    border: active ? 'none' : '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)', fontSize: '0.9rem',
    cursor: 'pointer',
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>

      {/* Full-screen material viewer overlay */}
      {viewingMaterial && (
        <MaterialViewer material={viewingMaterial} onClose={() => setViewingMaterial(null)} />
      )}

      {/* Header */}
      <header style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <Link
          to={`/dashboard/${studentId}`}
          style={{
            color: 'var(--color-text-muted)', textDecoration: 'none',
            fontSize: '0.9rem', minHeight: 44, display: 'inline-flex', alignItems: 'center', paddingRight: 12,
          }}
        >
          ← Dashboard
        </Link>
        <span style={{ fontWeight: 700, fontSize: '1.1rem', flex: 1 }}>{decodedSubject}</span>
        <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
          {materials.length} material{materials.length !== 1 ? 's' : ''} · {quizzes.length} quiz{quizzes.length !== 1 ? 'zes' : ''}
        </span>
      </header>

      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button style={tabStyle(activeTab === 'materials')} onClick={() => { setActiveTab('materials'); setTakingQuiz(null) }}>
            📄 Materials {matLoading ? '' : `(${materials.length})`}
          </button>
          <button style={tabStyle(activeTab === 'quizzes')} onClick={() => { setActiveTab('quizzes'); setTakingQuiz(null) }}>
            ✏️ Quizzes {quizLoading ? '' : `(${quizzes.length})`}
          </button>
        </div>

        {/* ── MATERIALS TAB ─────────────────────────────────── */}
        {activeTab === 'materials' && (
          <>
            {matLoading ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} style={{
                    height: 140, borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: 0.5,
                  }} />
                ))}
              </div>
            ) : materials.length === 0 ? (
              <div style={{
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', padding: '40px 20px', textAlign: 'center',
                color: 'var(--color-text-muted)',
              }}>
                <div style={{ fontSize: '2rem', marginBottom: 12 }}>📭</div>
                No materials uploaded for this subject yet.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                {materials.map(m => (
                  <div key={m.id} style={{
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)', padding: '18px 16px',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', flex: 1, lineHeight: 1.4 }}>
                        {m.title}
                      </span>
                      {fileTypeBadge(m.file_path)}
                    </div>
                    {m.faiss_indexed ? (
                      <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>✓ Indexed for AI search</span>
                    ) : null}
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-hint)' }}>
                      Added {relativeTime(m.created_at)}
                    </div>
                    <button
                      onClick={() => setViewingMaterial(m)}
                      style={{
                        padding: '9px 14px', minHeight: 38, marginTop: 'auto',
                        background: 'var(--color-primary)', color: '#fff',
                        border: 'none', borderRadius: 'var(--radius-md)',
                        fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      View
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── QUIZZES TAB ───────────────────────────────────── */}
        {activeTab === 'quizzes' && (
          <>
            {/* Active quiz */}
            {takingQuiz ? (
              <div>
                <div style={{
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)', overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '14px 16px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <button
                      onClick={() => setTakingQuiz(null)}
                      style={{
                        background: 'none', border: '1px solid var(--color-border)',
                        color: 'var(--color-text-muted)', borderRadius: 'var(--radius-md)',
                        padding: '5px 12px', cursor: 'pointer', fontSize: '0.85rem',
                      }}
                    >
                      ← Back
                    </button>
                    <span style={{ fontWeight: 700 }}>{takingQuiz.title}</span>
                  </div>
                  <QuizFlow
                    quiz={takingQuiz}
                    studentId={studentId}
                    onClose={() => setTakingQuiz(null)}
                    onComplete={() => setTakingQuiz(null)}
                  />
                </div>
              </div>
            ) : quizLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} style={{
                    height: 90, borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: 0.5,
                  }} />
                ))}
              </div>
            ) : quizzes.length === 0 ? (
              <div style={{
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', padding: '40px 20px', textAlign: 'center',
                color: 'var(--color-text-muted)',
              }}>
                <div style={{ fontSize: '2rem', marginBottom: 12 }}>📝</div>
                No quizzes assigned for this subject yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {quizzes.map(q => (
                  <div key={q.id} style={{
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)', padding: '18px 16px',
                    display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                  }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{q.title}</div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                        {q.question_count} question{q.question_count !== 1 ? 's' : ''}
                        {q.assigned_to === 'all' ? ' · Assigned to all' : ' · Assigned to you'}
                      </div>
                    </div>
                    <button
                      onClick={() => setTakingQuiz(q)}
                      style={{
                        padding: '9px 20px', minHeight: 38, fontWeight: 600,
                        background: 'var(--color-primary)', color: '#fff',
                        border: 'none', borderRadius: 'var(--radius-md)',
                        fontSize: '0.9rem', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      Take Quiz
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </main>
    </div>
  )
}
