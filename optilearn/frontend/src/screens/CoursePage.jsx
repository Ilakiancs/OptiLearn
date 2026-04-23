import { useState } from 'react'
import { useParams, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getMaterialsBySubject, getQuizzesBySubject, getMaterialFileUrl, submitQuiz } from '../api/client'

function fileExt(p) { return (p || '').split('.').pop().toLowerCase() }
function fileLabel(p) {
  const e = fileExt(p)
  if (e === 'pdf') return { label: 'PDF', bg: '#21103a', color: '#a78bfa', border: '#7c3aed' }
  if (['png','jpg','jpeg','webp'].includes(e)) return { label: 'Image', bg: '#061e2e', color: '#67e8f9', border: '#0891b2' }
  return { label: 'Text', bg: '#0a2a18', color: '#86efac', border: '#16a34a' }
}

function TypeBadge({ path }) {
  const { label, bg, color, border } = fileLabel(path)
  return <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.7rem', fontWeight: 700, background: bg, color, border: `1px solid ${border}` }}>{label}</span>
}

function MaterialViewer({ material, onClose }) {
  const [txt, setTxt] = useState(null)
  const url = getMaterialFileUrl(material.id)
  const ext = fileExt(material.file_path)
  const isPdf = ext === 'pdf'
  const isImg = ['png','jpg','jpeg','webp'].includes(ext)
  const isTxt = ext === 'txt'

  if (isTxt && txt === null) {
    fetch(url).then(r => r.text()).then(setTxt).catch(() => setTxt('Could not load file.'))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-md)', padding: '5px 14px', cursor: 'pointer', fontSize: '0.88rem' }}>← Close</button>
        <span style={{ fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{material.title}</span>
        <TypeBadge path={material.file_path} />
        <a href={url} target="_blank" rel="noreferrer" style={{ padding: '5px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.82rem' }}>Open ↗</a>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {isPdf && <iframe src={url} style={{ width: '100%', height: '100%', border: 'none' }} title={material.title} />}
        {isImg && <div style={{ height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24 }}><img src={url} alt={material.title} style={{ maxWidth: '100%', borderRadius: 'var(--radius-lg)' }} /></div>}
        {isTxt && <div style={{ height: '100%', overflow: 'auto', padding: 24 }}><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.95rem', lineHeight: 1.7, maxWidth: 760, margin: '0 auto', color: 'var(--color-text)' }}>{txt ?? 'Loading…'}</pre></div>}
      </div>
    </div>
  )
}

function QuizFlow({ quiz, studentId, onDone }) {
  const [idx, setIdx] = useState(0)
  const [sel, setSel] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [answers, setAnswers] = useState([])
  const [result, setResult] = useState(null)
  const qs = quiz.questions || []
  const q = qs[idx]

  function confirm() {
    if (!sel || confirmed) return
    setConfirmed(true)
  }

  function next() {
    const a = [...answers, { question_id: q.question, answer: sel, correct_answer: q.correct_answer }]
    setAnswers(a)
    if (idx + 1 < qs.length) { setIdx(i => i + 1); setSel(null); setConfirmed(false) }
    else {
      submitQuiz({ student_id: studentId, topic: quiz.subject || quiz.title, answers: a })
        .then(r => setResult(r))
        .catch(() => setResult({ score: a.filter(x => x.answer === x.correct_answer).length / qs.length, new_level: 'intermediate', mastery: 0.5 }))
    }
  }

  if (result) {
    const pct = Math.round(result.score * 100)
    const col = pct >= 75 ? 'var(--color-success)' : pct >= 40 ? '#f59e0b' : 'var(--color-danger)'
    return (
      <div style={{ padding: '28px 16px', textAlign: 'center', maxWidth: 440, margin: '0 auto' }}>
        <div style={{ fontSize: '3rem', fontWeight: 800, color: col, marginBottom: 6 }}>{pct}%</div>
        <div style={{ color: 'var(--color-text-muted)', marginBottom: 20 }}>{Math.round(result.score * qs.length)} of {qs.length} correct</div>
        <div style={{ fontSize: '1rem', fontStyle: 'italic', color: 'var(--color-text)', marginBottom: 24 }}>
          {pct === 100 ? '🏆 Perfect score!' : pct >= 75 ? '🎉 Great work!' : pct >= 40 ? '👍 Good effort. Review and try again.' : '💪 Keep practising — you got this!'}
        </div>
        <button onClick={onDone} style={{ padding: '12px 32px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}>Done</button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px 16px', maxWidth: 520, margin: '0 auto' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{idx + 1} / {qs.length}</span>
        <div style={{ flex: 1, height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--color-primary)', width: `${((idx + 1) / qs.length) * 100}%`, transition: 'width 0.3s' }} />
        </div>
      </div>
      <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px', marginBottom: 14, fontWeight: 600, lineHeight: 1.5 }}>{q.question}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {(q.options || []).map((opt, i) => {
          let bg = 'var(--color-surface)', border = 'var(--color-border)', color = 'var(--color-text)'
          if (confirmed) {
            if (opt === q.correct_answer) { bg = '#14532d'; border = '#16a34a'; color = '#4ade80' }
            else if (opt === sel) { bg = '#3a1a1a'; border = '#dc2626'; color = '#fca5a5' }
          } else if (opt === sel) { border = 'var(--color-primary)'; bg = 'var(--color-surface-2)' }
          return (
            <button key={i} onClick={() => !confirmed && setSel(opt)} style={{ padding: '12px 14px', textAlign: 'left', background: bg, border: `2px solid ${border}`, color, borderRadius: 'var(--radius-md)', fontSize: '0.92rem', cursor: confirmed ? 'default' : 'pointer', transition: 'all 0.12s' }}>
              {opt}{confirmed && opt === q.correct_answer ? ' ✓' : ''}{confirmed && opt === sel && opt !== q.correct_answer ? ' ✗' : ''}
            </button>
          )
        })}
      </div>
      {confirmed && q.explanation && (
        <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          💡 {q.explanation}
        </div>
      )}
      {!confirmed
        ? <button onClick={confirm} disabled={!sel} style={{ width: '100%', padding: '12px', background: sel ? 'var(--color-primary)' : 'var(--color-primary-dim)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: sel ? 'pointer' : 'default', fontSize: '0.95rem' }}>Confirm Answer</button>
        : <button onClick={next} style={{ width: '100%', padding: '12px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}>{idx + 1 < qs.length ? 'Next →' : 'Finish Quiz'}</button>
      }
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

  function relTime(iso) {
    if (!iso) return ''
    const d = Date.now() - new Date(iso).getTime()
    if (d < 86400000) return 'Today'
    if (d < 604800000) return Math.floor(d / 86400000) + 'd ago'
    return Math.floor(d / 604800000) + 'w ago'
  }

  const TABS = [
    { key: 'materials', label: '📄 Materials', count: materials.length },
    { key: 'quizzes', label: '✏️ Quizzes', count: quizzes.length },
  ]

  return (
    <div style={{ padding: '28px 24px', maxWidth: 860, margin: '0 auto' }}>
      {viewing && <MaterialViewer material={viewing} onClose={() => setViewing(null)} />}

      {/* Course header */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '22px', marginBottom: 24 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>📚</div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 4 }}>{decoded}</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
          {materials.length} material{materials.length !== 1 ? 's' : ''} · {quizzes.length} quiz{quizzes.length !== 1 ? 'zes' : ''}
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setTakingQuiz(null) }} style={{
            padding: '9px 18px', borderRadius: 'var(--radius-md)', fontWeight: t.key === tab ? 700 : 400,
            background: t.key === tab ? 'var(--color-primary)' : 'transparent',
            color: t.key === tab ? '#fff' : 'var(--color-text-muted)',
            border: t.key === tab ? 'none' : '1px solid var(--color-border)',
            cursor: 'pointer', fontSize: '0.88rem',
          }}>
            {t.label} {!matLoad && !quizLoad ? `(${t.count})` : ''}
          </button>
        ))}
      </div>

      {/* Materials tab */}
      {tab === 'materials' && (
        matLoad ? <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p> :
        materials.length === 0 ? (
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 10 }}>📭</div>
            No materials uploaded yet for this subject.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {materials.map(m => (
              <div key={m.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.92rem', flex: 1, lineHeight: 1.4 }}>{m.title}</span>
                  <TypeBadge path={m.file_path} />
                </div>
                {m.faiss_indexed ? <span style={{ fontSize: '0.72rem', color: 'var(--color-success)' }}>✓ AI-indexed</span> : null}
                <span style={{ fontSize: '0.74rem', color: 'var(--color-text-hint)' }}>{relTime(m.created_at)}</span>
                <button onClick={() => setViewing(m)} style={{ padding: '9px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem', marginTop: 'auto' }}>
                  📖 Open
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* Quizzes tab */}
      {tab === 'quizzes' && (
        takingQuiz ? (
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => setTakingQuiz(null)} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-md)', padding: '5px 12px', cursor: 'pointer', fontSize: '0.85rem' }}>← Back</button>
              <span style={{ fontWeight: 700 }}>{takingQuiz.title}</span>
            </div>
            <QuizFlow quiz={takingQuiz} studentId={studentId} onDone={() => setTakingQuiz(null)} />
          </div>
        ) : quizLoad ? <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p> :
        quizzes.length === 0 ? (
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 10 }}>📝</div>
            No quizzes assigned for this subject yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {quizzes.map(q => (
              <div key={q.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.3rem' }}>✏️</span>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{q.title}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    {q.question_count} question{q.question_count !== 1 ? 's' : ''} · {q.assigned_to === 'all' ? 'Whole class' : 'Assigned to you'}
                  </div>
                </div>
                <button onClick={() => setTakingQuiz(q)} style={{ padding: '9px 20px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem', flexShrink: 0 }}>
                  ▶ Take Quiz
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
