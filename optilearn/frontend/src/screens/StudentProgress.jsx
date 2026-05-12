import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getStudentProgress, exportStudentWithPin, deleteStudent } from '../api/client'
import { FileZip, DownloadSimple, WarningCircle } from '@phosphor-icons/react'
import MasteryBadge from '../components/MasteryBadge'
import Spinner from '../components/Spinner'

const BASE = window.location.origin

const MASTERY_COLORS = {
  red:   { bar: '#FF9800', bg: '#3a1a1a' },
  amber: { bar: 'var(--color-warning)', bg: 'var(--color-surface-2)' },
  green: { bar: '#639922', bg: '#1a2e0a' },
  grey:  { bar: '#AAAAAA', bg: '#2a2a2a' },
}

function masteryColor(val) {
  if (val === null || val === undefined) return 'grey'
  if (val < 0.40) return 'red'
  if (val < 0.75) return 'amber'
  return 'green'
}

function relativeTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
  return Math.floor(diff / 86400000) + 'd ago'
}

function MasteryBar({ topic, mastery, level }) {
  const key = masteryColor(mastery)
  const col = MASTERY_COLORS[key]
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.85rem' }}>
        <span style={{ color: 'var(--color-text)' }}>{topic}</span>
        <span style={{ color: 'var(--color-text-muted)' }}>{Math.round(mastery * 100)}%</span>
      </div>
      <div style={{ height: 8, background: 'var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${mastery * 100}%`,
          background: col.bar, borderRadius: 4, transition: 'width 0.5s',
        }} />
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-hint)', marginTop: 2 }}>{level}</div>
    </div>
  )
}

function ScoreSparkline({ quizzes, topic }) {
  const relevant = quizzes.filter(q => q.topic === topic).slice(0, 10).reverse()
  if (relevant.length === 0) return <span style={{ color: 'var(--color-text-hint)', fontSize: '0.8rem' }}>No data</span>

  const W = 180, H = 46
  const PAD = 6
  const scoreValue = (raw) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(1, n > 1 ? n / 100 : n))
  }
  const points = relevant.map((q, i) => {
    const x = PAD + (i / Math.max(relevant.length - 1, 1)) * (W - PAD * 2)
    const y = PAD + (1 - scoreValue(q.score)) * (H - PAD * 2)
    return { x, y, score: scoreValue(q.score) }
  })
  const pts = points.map(({ x, y }) => {
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: '100%' }}>
      <rect x="0" y="0" width={W} height={H} rx="10" fill="var(--color-surface-2)" />
      <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="var(--color-border)" strokeWidth="1" />
      {points.length > 1 && <polyline points={pts} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {points.map(({ x, y, score }, i) => (
        <circle key={i} cx={x} cy={y} r={4} fill={score >= 0.75 ? 'var(--color-success)' : score >= 0.4 ? 'var(--color-primary)' : 'var(--color-danger)'} />
      ))}
    </svg>
  )
}

export default function StudentProgress() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const [reportLang, setReportLang] = useState('en')
  const [reportText, setReportText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef(null)

  // Export and delete states
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPin, setExportPin] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const [deletePromptOpen, setDeletePromptOpen] = useState(false)
  const [deletePromptBusy, setDeletePromptBusy] = useState(false)
  const [deletePromptError, setDeletePromptError] = useState('')

  const { data: progress, isLoading, error } = useQuery({
    queryKey: ['student-progress', studentId],
    queryFn: () => getStudentProgress(studentId),
  })

  // Export handler
  async function submitExport() {
    if (!exportPin) return
    setExportBusy(true)
    setExportError('')
    try {
      await exportStudentWithPin(studentId, exportPin)
      // Export successful, show delete confirmation
      setExportOpen(false)
      setExportPin('')
      setDeletePromptOpen(true)
    } catch (err) {
      setExportError(err.message || 'Export could not be completed.')
    } finally {
      setExportBusy(false)
    }
  }

  // Delete confirmation handler
  async function confirmDeleteAfterExport() {
    setDeletePromptBusy(true)
    setDeletePromptError('')
    try {
      await deleteStudent(studentId)
      // Deletion successful, navigate back to dashboard
      navigate('/teacher?view=manage', { replace: true })
    } catch (err) {
      setDeletePromptError(err.message || 'Record could not be removed.')
    } finally {
      setDeletePromptBusy(false)
    }
  }

  async function handleGenerateReport() {
    if (streaming) {
      abortRef.current?.abort()
      return
    }
    setReportText('')
    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(
        `${BASE}/api/students/${studentId}/report?language=${encodeURIComponent(reportLang)}`,
        { signal: controller.signal }
      )
      if (!res.ok) { setStreaming(false); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'token') setReportText(t => t + ev.content)
            if (ev.type === 'done') setStreaming(false)
          } catch (_) {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setStreaming(false)
    } finally {
      setStreaming(false)
    }
  }

  const sectionHead = { fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: 16, marginTop: 0 }
  const card = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '20px 16px',
    marginBottom: 24,
  }

  if (isLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner size={32} />
    </div>
  )

  if (error || !progress) return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: 24, color: 'var(--color-danger)' }}>
      Could not load student data. <Link to="/teacher">← Back</Link>
    </div>
  )

  const { student, mastery_by_topic, recent_quizzes, sessions, level } = progress

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <header style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/teacher" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.9rem', minHeight: 44, display: 'inline-flex', alignItems: 'center', paddingRight: 12 }}>
          ← Back to Dashboard
        </Link>
        <span style={{ fontWeight: 700, fontSize: '1.05rem', flex: 1 }}>
          {student.name} — Progress
        </span>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            minHeight: 40,
            background: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <DownloadSimple size={16} weight="bold" />
          Export Profile
        </button>
        <MasteryBadge level={level} />
      </header>

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>

        {/* Summary strip */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            ['Language', student.language],
            ['Grade', student.grade_level],
            ['Age', student.age || '—'],
            ['Last active', relativeTime(student.last_active)],
            ['Topics studied', mastery_by_topic.length],
          ].map(([label, val]) => (
            <div key={label} style={{ ...card, padding: '14px 18px', marginBottom: 0, flex: 1, minWidth: 100, textAlign: 'center' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-primary)' }}>{val}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Mastery bars */}
        <section style={card}>
          <h2 style={sectionHead}>Mastery by Topic</h2>
          {mastery_by_topic.length === 0
            ? <p style={{ color: 'var(--color-text-hint)' }}>No topics assessed yet.</p>
            : mastery_by_topic.map(m => (
                <MasteryBar key={m.topic} topic={m.topic} mastery={m.mastery} level={m.level} />
              ))
          }
        </section>

        {/* Quiz score sparklines */}
        {mastery_by_topic.length > 0 && recent_quizzes.length > 0 && (
          <section style={card}>
            <h2 style={sectionHead}>Quiz Score History (last 10 per topic)</h2>
            {mastery_by_topic.map(m => (
              <div key={m.topic} style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                <span style={{ width: 160, fontSize: '0.85rem', color: 'var(--color-text-muted)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.topic}</span>
                <ScoreSparkline quizzes={recent_quizzes} topic={m.topic} />
              </div>
            ))}
          </section>
        )}

        {/* Session history */}
        <section style={card}>
          <h2 style={sectionHead}>Recent Sessions</h2>
          {sessions.length === 0
            ? <p style={{ color: 'var(--color-text-hint)' }}>No sessions yet.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {['Started', 'Messages', 'Topics'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s, i) => (
                      <tr key={s.id} style={{ borderBottom: i < sessions.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}>{relativeTime(s.started_at)}</td>
                        <td style={{ padding: '8px 12px' }}>{s.message_count}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(() => { try { return JSON.parse(s.topics_covered || '[]').join(', ') || '—' } catch { return '—' } })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </section>

        {/* AI Report */}
        <section style={card}>
          <h2 style={sectionHead}>AI Progress Report</h2>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={reportLang}
              onChange={e => setReportLang(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: '0.9rem' }}
            >
              {[['en','English'],['ar','Arabic'],['fr','French'],['sw','Swahili'],['so','Somali'],['am','Amharic']].map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
            <button
              onClick={handleGenerateReport}
              style={{
                padding: '8px 20px', minHeight: 40,
                background: streaming ? 'var(--color-danger)' : 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
                fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {streaming ? 'Stop' : 'Generate AI Report'}
            </button>
          </div>
          {(reportText || streaming) && (
            <div style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              fontSize: '0.9rem',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              color: 'var(--color-text)',
              minHeight: 80,
            }}>
              {reportText}
              {streaming && <span style={{ display: 'inline-flex', marginLeft: 8, verticalAlign: 'middle' }}><Spinner size={14} /></span>}
            </div>
          )}
        </section>

      </main>

      {/* Export Modal */}
      {exportOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.52)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 16 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 18, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 18px 48px rgba(0,0,0,0.28)', display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: 'rgba(42,141,191,0.12)', color: 'var(--color-primary)', padding: 10, borderRadius: 12, display: 'inline-flex' }}>
                <DownloadSimple size={20} weight="duotone" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Export Student Profile</h3>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{student.name}</div>
              </div>
            </div>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Enter the student PIN to download the encrypted ZIP archive.</p>
            <input
              value={exportPin}
              onChange={(e) => setExportPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              maxLength={4}
              inputMode="numeric"
              placeholder="0000"
              style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '1rem', fontWeight: 700, letterSpacing: 4, textAlign: 'center', background: 'var(--color-surface-2)', color: 'var(--color-text)' }}
            />
            {exportError && <div style={{ background: '#FFF3E0', color: '#FF9800', borderRadius: 10, padding: 10, fontSize: '0.85rem' }}>{exportError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => { setExportOpen(false); setExportPin(''); setExportError('') }} style={{ flex: 1, minHeight: 44, padding: '10px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={submitExport} disabled={exportBusy || !exportPin} style={{ flex: 1, minHeight: 44, padding: '10px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: exportBusy || !exportPin ? 0.7 : 1 }}>
                {exportBusy ? 'Exporting...' : 'Export ZIP'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletePromptOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.52)', display: 'grid', placeItems: 'center', zIndex: 10000, padding: 16 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 18, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 18px 48px rgba(0,0,0,0.28)', display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: '#fef2f2', color: '#dc2626', padding: 10, borderRadius: 12, display: 'inline-flex' }}>
                <WarningCircle size={20} weight="duotone" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Delete student record?</h3>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{student.name}</div>
              </div>
            </div>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>The ZIP has been downloaded. Do you want to delete this student record from the system now?</p>
            {deletePromptError && <div style={{ background: '#FFF3E0', color: '#FF9800', borderRadius: 10, padding: 10, fontSize: '0.85rem' }}>{deletePromptError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => { setDeletePromptOpen(false); setDeletePromptError(''); navigate('/teacher?view=manage', { replace: true }); }} style={{ flex: 1, minHeight: 44, padding: '10px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }} disabled={deletePromptBusy}>Keep Record</button>
              <button type="button" onClick={confirmDeleteAfterExport} disabled={deletePromptBusy} style={{ flex: 1, minHeight: 44, padding: '10px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: deletePromptBusy ? 0.7 : 1 }}>
                {deletePromptBusy ? 'Deleting...' : 'Delete Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
