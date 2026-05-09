import { useState } from 'react'
import { useParams, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowSquareOut,
  BookOpenText,
  CheckCircle,
  ClipboardText,
  FileText,
  Lightbulb,
  PencilSimpleLine,
  Play,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { getMaterialsBySubject, getQuizzesBySubject, getMaterialFileUrl, submitQuiz, getStudentProgress } from '../api/client'

function fileExt(path) {
  return (path || '').split('.').pop().toLowerCase()
}

function fileLabel(path) {
  const ext = fileExt(path)
  if (ext === 'pdf') return { label: 'PDF', bg: '#21103a', color: '#a78bfa', border: '#7c3aed' }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return { label: 'Image', bg: '#061e2e', color: '#67e8f9', border: '#0891b2' }
  return { label: 'Text', bg: '#0a2a18', color: '#86efac', border: '#16a34a' }
}

function TypeBadge({ path }) {
  const { label, bg, color, border } = fileLabel(path)
  return (
    <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.7rem', fontWeight: 700, background: bg, color, border: `1px solid ${border}` }}>
      {label}
    </span>
  )
}

function MaterialViewer({ material, onClose }) {
  const [txt, setTxt] = useState(null)
  const url = getMaterialFileUrl(material.id)
  const ext = fileExt(material.file_path)
  const isPdf = ext === 'pdf'
  const isImg = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)
  const isTxt = ext === 'txt'

  if (isTxt && txt === null) {
    fetch(url)
      .then((r) => r.text())
      .then(setTxt)
      .catch(() => setTxt('Could not load file.'))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <X size={14} />
          <span>Close</span>
        </button>
        <span style={{ fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{material.title}</span>
        <TypeBadge path={material.file_path} />
        <a href={url} target="_blank" rel="noreferrer" style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowSquareOut size={14} />
          <span>Open</span>
        </a>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {isPdf && <iframe src={url} style={{ width: '100%', height: '100%', border: 'none' }} title={material.title} />}
        {isImg && (
          <div style={{ height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24 }}>
            <img src={url} alt={material.title} style={{ maxWidth: '100%', borderRadius: 'var(--radius-lg)' }} />
          </div>
        )}
        {isTxt && (
          <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.95rem', lineHeight: 1.7, maxWidth: 760, margin: '0 auto', color: 'var(--color-text)' }}>{txt ?? 'Loading...'}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

export function QuizFlow({ quiz, studentId, onDone }) {
  const [idx, setIdx] = useState(0)
  const [sel, setSel] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [answers, setAnswers] = useState([])
  const [result, setResult] = useState(null)
  const questions = quiz.questions || []
  const question = questions[idx]

  function confirm() {
    if (!sel || confirmed) return
    setConfirmed(true)
  }

  function next() {
    const updatedAnswers = [...answers, { question_id: question.question, answer: sel, correct_answer: question.correct_answer }]
    setAnswers(updatedAnswers)
    if (idx + 1 < questions.length) {
      setIdx((i) => i + 1)
      setSel(null)
      setConfirmed(false)
      return
    }

    submitQuiz({ student_id: studentId, topic: quiz.subject || quiz.title, answers: updatedAnswers })
      .then((r) => setResult(r))
      .catch(() =>
        setResult({
          score: updatedAnswers.filter((x) => x.answer === x.correct_answer).length / questions.length,
          new_level: 'intermediate',
          mastery: 0.5,
        })
      )
  }

  if (result) {
    const pct = Math.round(result.score * 100)
    const color = pct >= 75 ? 'var(--color-success)' : pct >= 40 ? 'var(--color-primary)' : 'var(--color-text-muted)'
    const message = pct === 100
      ? 'Excellent accuracy.'
      : pct >= 75
        ? 'Strong progress.'
        : pct >= 40
          ? 'You are improving. Review and retry when ready.'
          : 'Take a break and try another round later.'

    return (
      <div style={{ padding: '28px 16px', textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
        <div style={{ fontSize: '3rem', fontWeight: 800, color, marginBottom: 6 }}>{pct}%</div>
        <div style={{ color: 'var(--color-text-muted)', marginBottom: 20 }}>{Math.round(result.score * questions.length)} of {questions.length} correct</div>
        <div style={{ fontSize: '1rem', color: 'var(--color-text)', marginBottom: 24 }}>{message}</div>
        <button onClick={onDone} style={{ padding: '12px 28px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}>
          Done
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px 16px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{idx + 1} / {questions.length}</span>
        <div style={{ flex: 1, height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--color-primary)', width: `${((idx + 1) / questions.length) * 100}%`, transition: 'width 0.3s' }} />
        </div>
      </div>

      <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px', marginBottom: 14, fontWeight: 600, lineHeight: 1.5 }}>
        {question.question}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {(question.options || []).map((opt, i) => {
          let bg = 'var(--color-surface)'
          let border = 'var(--color-border)'
          let color = 'var(--color-text)'
          let endIcon = null
          let endLabel = null

          if (confirmed) {
            if (opt === question.correct_answer) {
              bg = '#0f2c23'
              border = '#2c9b7d'
              color = '#7ddfbf'
              endIcon = <CheckCircle size={20} weight="bold" />
              endLabel = 'Correct'
            } else if (opt === sel) {
              bg = 'rgba(115, 201, 247, 0.12)'
              border = 'var(--color-primary)'
              color = 'var(--color-text)'
              endIcon = <XCircle size={20} weight="bold" />
              endLabel = 'Review'
            }
          } else if (opt === sel) {
            border = 'var(--color-primary)'
            bg = 'var(--color-surface-2)'
          }

          return (
            <button
              key={i}
              onClick={() => !confirmed && setSel(opt)}
              style={{ padding: '12px 14px', textAlign: 'left', background: bg, border: `2px solid ${border}`, color, borderRadius: 'var(--radius-md)', fontSize: '0.92rem', cursor: confirmed ? 'default' : 'pointer', transition: 'all 0.12s', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
            >
              <span>{opt}</span>
              {endIcon ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700 }}>
                  {endIcon}
                  <span>{endLabel}</span>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {confirmed && question.explanation && (
        <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 14, lineHeight: 1.6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lightbulb size={15} />
          <span>{question.explanation}</span>
        </div>
      )}

      {!confirmed ? (
        <button onClick={confirm} disabled={!sel} style={{ width: '100%', padding: '12px', background: sel ? 'var(--color-primary)' : 'var(--color-primary-dim)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: sel ? 'pointer' : 'default', fontSize: '0.95rem' }}>
          Confirm answer
        </button>
      ) : (
        <button onClick={next} style={{ width: '100%', padding: '12px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span>{idx + 1 < questions.length ? 'Next' : 'Finish quiz'}</span>
          {idx + 1 < questions.length && <ArrowRight size={14} />}
        </button>
      )}
    </div>
  )
}

export default function CoursePage() {
  const { subject } = useParams()
  const { studentId } = useOutletContext()
  const decoded = decodeURIComponent(subject)
  const [tab, setTab] = useState('materials')
  const [viewing, setViewing] = useState(null)
  const [takingQuiz, setTakingQuiz] = useState(null)

  const { data: materials = [], isLoading: matLoad } = useQuery({ queryKey: ['materials', decoded], queryFn: () => getMaterialsBySubject(decoded) })
  const { data: quizzes = [], isLoading: quizLoad } = useQuery({ queryKey: ['subject-quizzes', decoded, studentId], queryFn: () => getQuizzesBySubject(decoded, studentId) })
  const { data: progress } = useQuery({ queryKey: ['student-progress', studentId], queryFn: () => getStudentProgress(studentId) })

  const subjectMastery = (progress?.mastery_by_topic || []).filter(
    m => m.topic?.toLowerCase().includes(decoded.toLowerCase()) || decoded.toLowerCase().includes(m.topic?.toLowerCase())
  )

  function relTime(iso) {
    if (!iso) return ''
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 86400000) return 'Today'
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago'
    return Math.floor(diff / 604800000) + 'w ago'
  }

  return (
    <div style={{ padding: '24px 20px', maxWidth: 900, margin: '0 auto' }}>
      {viewing && <MaterialViewer material={viewing} onClose={() => setViewing(null)} />}

      <div className="surface-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <BookOpenText size={22} weight="duotone" />
          <h1 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0 }}>{decoded}</h1>
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', margin: '0 0 12px' }}>
          {materials.length} material{materials.length !== 1 ? 's' : ''} and {quizzes.length} quiz{quizzes.length !== 1 ? 'zes' : ''}
        </p>
        {subjectMastery.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {subjectMastery.map(m => {
              const pct = Math.round(m.mastery * 100)
              const bar = m.mastery < 0.40 ? '#FF9800' : m.mastery < 0.75 ? '#EF9F27' : '#639922'
              return (
                <div key={m.topic}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 3 }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>{m.topic}</span>
                    <span style={{ fontWeight: 600, color: bar }}>{pct}%</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: bar, borderRadius: 3, transition: 'width 0.4s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-hint)' }}>No activity yet for this subject.</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => { setTab('materials'); setTakingQuiz(null) }} style={{ padding: '9px 14px', borderRadius: 'var(--radius-md)', fontWeight: tab === 'materials' ? 700 : 500, background: tab === 'materials' ? 'var(--color-primary)' : 'transparent', color: tab === 'materials' ? '#fff' : 'var(--color-text-muted)', border: tab === 'materials' ? 'none' : '1px solid var(--color-border)', cursor: 'pointer', fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} />
          <span>Materials {!matLoad && `(${materials.length})`}</span>
        </button>
        <button onClick={() => { setTab('quizzes'); setTakingQuiz(null) }} style={{ padding: '9px 14px', borderRadius: 'var(--radius-md)', fontWeight: tab === 'quizzes' ? 700 : 500, background: tab === 'quizzes' ? 'var(--color-primary)' : 'transparent', color: tab === 'quizzes' ? '#fff' : 'var(--color-text-muted)', border: tab === 'quizzes' ? 'none' : '1px solid var(--color-border)', cursor: 'pointer', fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <PencilSimpleLine size={16} />
          <span>Quizzes {!quizLoad && `(${quizzes.length})`}</span>
        </button>
      </div>

      {tab === 'materials' && (
        matLoad ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : materials.length === 0 ? (
          <div className="surface-card" style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <FileText size={34} />
            <div style={{ marginTop: 8 }}>No materials uploaded yet for this subject.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {materials.map((m) => (
              <div key={m.id} className="surface-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.92rem', flex: 1, lineHeight: 1.4 }}>{m.title}</span>
                  <TypeBadge path={m.file_path} />
                </div>
                {m.faiss_indexed ? <span style={{ fontSize: '0.72rem', color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><CheckCircle size={13} />Indexed for AI</span> : null}
                <span style={{ fontSize: '0.74rem', color: 'var(--color-text-hint)' }}>{relTime(m.created_at)}</span>
                <button onClick={() => setViewing(m)} style={{ padding: '9px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem', marginTop: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <ArrowSquareOut size={14} />
                  <span>Open</span>
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'quizzes' && (
        takingQuiz ? (
          <div className="surface-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => setTakingQuiz(null)} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <X size={14} />
                <span>Back</span>
              </button>
              <span style={{ fontWeight: 700 }}>{takingQuiz.title}</span>
            </div>
            <QuizFlow quiz={takingQuiz} studentId={studentId} onDone={() => setTakingQuiz(null)} />
          </div>
        ) : quizLoad ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : quizzes.length === 0 ? (
          <div className="surface-card" style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <ClipboardText size={34} />
            <div style={{ marginTop: 8 }}>No quizzes assigned for this subject yet.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {quizzes.map((q) => (
              <div key={q.id} className="surface-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <PencilSimpleLine size={20} />
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{q.title}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    {q.question_count} question{q.question_count !== 1 ? 's' : ''} · {q.assigned_to === 'all' ? 'Whole class' : 'Assigned to you'}
                  </div>
                </div>
                <button onClick={() => setTakingQuiz(q)} style={{ padding: '9px 18px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Play size={14} />
                  <span>Take quiz</span>
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
