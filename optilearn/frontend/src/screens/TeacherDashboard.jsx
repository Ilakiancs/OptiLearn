import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bell, Warning, TrendDown,
  Sparkle, X, ArrowRight, ArrowClockwise,
  UploadSimple, Plus, CalendarDots, Moon, Student, Sun,
} from '@phosphor-icons/react'
import {
  getTeacherStudents, getTeacherHeatmap, downloadWeeklyReport,
  listMaterials, listTeacherQuizzes, teacherChat, getHealth,
  getTeacherSettings, updateTeacherSettings,
} from '../api/client'
import { feature1 } from '../api/client'
import MasteryBadge from '../components/MasteryBadge'
import TopicHeatmap from '../components/TopicHeatmap'
import NetworkStatusPill from '../components/NetworkStatusPill'
import TeacherCalendarModal from '../components/TeacherCalendarModal'
import Spinner from '../components/Spinner'
import { useTheme } from '../context/ThemeContext'

// ── Helpers ─────────────────────────────────────────────────────

function getISOWeekString() {
  const now = new Date()
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function useSecondsAgo(dataUpdatedAt) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!dataUpdatedAt) return
    const tick = () => setSecs(Math.floor((Date.now() - dataUpdatedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [dataUpdatedAt])
  return secs
}

function relativeTime(isoString) {
  if (!isoString) return '—'
  // All DB timestamps are stored in UTC. Append 'Z' if no timezone suffix
  // so JavaScript Date parses them as UTC, not local time.
  const utc = /Z$|[+-]\d{2}:?\d{2}$/.test(isoString) ? isoString : isoString + 'Z'
  const d = new Date(utc)
  const now = new Date()
  if (now - d < 0) return 'Just now'
  const diffMs = now - d
  if (diffMs < 3600000) return 'Just now'
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.floor((today - dDay) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function renderInline(text) {
  const parts = text.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  )
}

function renderMarkdown(text) {
  if (!text) return null
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return <div key={i} style={{ fontWeight: 700, fontSize: '0.93rem', margin: '10px 0 3px', color: 'var(--color-text)' }}>{line.slice(3)}</div>
    }
    if (line.startsWith('### ')) {
      return <div key={i} style={{ fontWeight: 600, fontSize: '0.88rem', margin: '7px 0 2px' }}>{line.slice(4)}</div>
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <div key={i} style={{ paddingLeft: 12, marginBottom: 2, display: 'flex', gap: 6 }}>
          <span style={{ flexShrink: 0 }}>•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      )
    }
    if (line.trim() === '') return <div key={i} style={{ height: 5 }} />
    return <div key={i}>{renderInline(line)}</div>
  })
}

// ── Alert helpers ────────────────────────────────────────────────

const ALERT_META = {
  inactive_3_days: { label: 'Inactive 3+ days', Icon: Bell,      color: '#dc2626', bg: '#fef2f2' },
  stuck_on_topic:  { label: 'Stuck on a topic', Icon: Warning,   color: '#d97706', bg: '#fffbeb' },
  level_dropped:   { label: 'Level dropped',    Icon: TrendDown, color: '#dc2626', bg: '#fef2f2' },
}

function AlertBadge({ type }) {
  const { label, Icon, color, bg } = ALERT_META[type] || { label: type, Icon: Warning, color: '#666', bg: '#f5f5f5' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6,
      background: bg, color, fontSize: '0.78rem', fontWeight: 600,
    }}>
      <Icon size={12} weight="bold" />
      {label}
    </span>
  )
}

function AlertDot({ alerts }) {
  if (!alerts?.length) return null
  const { Icon, color, bg, label } = ALERT_META[alerts[0]] || ALERT_META.stuck_on_topic
  return (
    <span title={alerts.map(a => ALERT_META[a]?.label || a).join(', ')} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: '50%',
      background: bg, color, flexShrink: 0,
    }}>
      <Icon size={13} weight="bold" />
    </span>
  )
}

// ── Shared button styles (module scope — safe: instantiated before first render) ──

const refreshBtnStyle = {
  padding: '6px 12px', borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)', fontSize: '0.82rem', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 5,
}

const ctaBtnStyle = {
  padding: '6px 12px', borderRadius: 'var(--radius-md)',
  background: 'var(--color-primary)', border: 'none',
  color: '#fff', fontSize: '0.82rem', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 5,
  textDecoration: 'none',
}

// ── Main component ───────────────────────────────────────────────

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()

  // ── Queries ──
  const { data: students, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['teacher-students'],
    queryFn: getTeacherStudents,
    refetchInterval: 10000,
    staleTime: 5000,
  })
  const { data: heatmapData } = useQuery({
    queryKey: ['teacher-heatmap'],
    queryFn: getTeacherHeatmap,
    refetchInterval: 10000,
    staleTime: 5000,
  })
  const { data: materials, refetch: refetchMaterials } = useQuery({
    queryKey: ['teacher-materials'],
    queryFn: listMaterials,
    refetchInterval: 30000,
    staleTime: 10000,
  })
  const { data: quizzes, refetch: refetchQuizzes } = useQuery({
    queryKey: ['teacher-quizzes'],
    queryFn: listTeacherQuizzes,
    refetchInterval: 30000,
    staleTime: 10000,
  })

  const secsAgo = useSecondsAgo(dataUpdatedAt)
  const allStudents = students || []
  const alertedStudents = allStudents.filter(s => s.alerts?.length > 0)

  // ── Report state ──
  const [selectedWeek, setSelectedWeek] = useState(getISOWeekString)
  const [reportLoading, setReportLoading] = useState(false)

  // ── Calendar modal ──
  const [calendarOpen, setCalendarOpen] = useState(false)

  // ── Language toggle ──
  const { data: teacherSettings } = useQuery({ queryKey: ['teacher-settings'], queryFn: getTeacherSettings, staleTime: 60000 })
  const [masterLang, setMasterLang] = useState('en')
  const [masterLangName, setMasterLangName] = useState('English')
  const [langSaved, setLangSaved] = useState(false)
  useEffect(() => {
    if (teacherSettings) {
      setMasterLang(teacherSettings.master_language || 'en')
      setMasterLangName(teacherSettings.master_language_name || 'English')
    }
  }, [teacherSettings])

  // Fetch full language list from Feature 1 (same source used by students)
  const { data: allLanguages = [] } = useQuery({
    queryKey: ['feature1-languages'],
    queryFn: feature1.getLanguages,
    staleTime: Infinity,
  })

  async function handleLangChange(code) {
    const lang = allLanguages.find(l => l.code === code)
    if (!lang) return
    setMasterLang(code)
    setMasterLangName(lang.name)
    try {
      await updateTeacherSettings({ master_language: code, master_language_name: lang.name })
      setLangSaved(true)
      setTimeout(() => setLangSaved(false), 2000)
    } catch { /* silent */ }
  }

  // ── AI Chat state ──
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your OptiLearn Assistant. Ask me anything about the platform, your students, or how to use any feature.",
    },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatStreaming, setChatStreaming] = useState(false)
  const [modelPref, setModelPref] = useState('fast')
  const [e4bAvailable, setE4bAvailable] = useState(false)
  const chatEndRef = useRef(null)
  const chatPanelRef = useRef(null)
  const chatBtnRef = useRef(null)

  // Inject animation keyframes once
  useEffect(() => {
    if (!document.getElementById('ol-chat-style')) {
      const s = document.createElement('style')
      s.id = 'ol-chat-style'
      s.textContent = `
        @keyframes olSlideUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
      `
      document.head.appendChild(s)
    }
  }, [])

  // Check e4b availability on mount
  useEffect(() => {
    getHealth().then(h => setE4bAvailable(!!h.e4b_available)).catch(() => {})
  }, [])

  // Auto-scroll chat on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Close chat panel on outside click
  useEffect(() => {
    if (!chatOpen) return
    const handler = (e) => {
      if (!chatPanelRef.current?.contains(e.target) && !chatBtnRef.current?.contains(e.target)) {
        setChatOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [chatOpen])

  // ── Handlers ──

  function handleDownloadReport() {
    setReportLoading(true)
    downloadWeeklyReport(selectedWeek || undefined)
    setTimeout(() => setReportLoading(false), 2000)
  }

  async function sendChatMessage() {
    if (!chatInput.trim() || chatStreaming) return
    const userMsg = chatInput.trim()
    const historySnapshot = [...chatMessages]
    setChatInput('')
    setChatMessages(prev => [
      ...prev,
      { role: 'user', content: userMsg },
      { role: 'assistant', content: '', streaming: true },
    ])
    setChatStreaming(true)

    try {
      await teacherChat(
        { message: userMsg, history: historySnapshot.slice(-10), model_preference: modelPref },
        (event) => {
          if (event.type === 'token') {
            setChatMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              updated[updated.length - 1] = { ...last, content: last.content + event.content }
              return updated
            })
          } else if (event.type === 'model_switch') {
            setChatMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              updated[updated.length - 1] = { ...last, content: '' }
              return updated
            })
          }
        },
        () => {
          setChatMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false }
            return updated
          })
          setChatStreaming(false)
        }
      )
    } catch {
      setChatMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
          streaming: false,
        }
        return updated
      })
      setChatStreaming(false)
    }
  }

  // ── Styles ──

  const metricCardStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '20px 18px',
    textAlign: 'center',
    flex: 1,
    minWidth: 0,
  }

  const sectionHeadStyle = {
    fontSize: '1rem',
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '16px',
    marginTop: 0,
  }

  // ── Render ──

  return (
    <div className="page-shell">

      {/* ──────── Header ──────── */}
      <header style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        position: 'relative',
        minHeight: 68,
      }}>
        <Link to="/" style={{
          color: 'var(--color-text)', textDecoration: 'none',
          minHeight: 54, display: 'inline-flex', alignItems: 'center',
          gap: 10, paddingRight: 12,
        }}>
          <span className="icon-only" style={{ width: 52, height: 52, borderRadius: 16 }}>
            <Student size={24} weight="duotone" />
          </span>
          <span style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontWeight: 800, fontSize: '1.08rem', lineHeight: 1.1 }}>OptiLearn</span>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Teacher dashboard</span>
          </span>
        </Link>
        <NetworkStatusPill variant="inline" />
        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={toggleTheme} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', fontSize: '0.85rem',
            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, cursor: 'pointer',
          }}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <Link to="/teacher/materials" style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.85rem',
            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
          }}>
            <UploadSimple size={14} /> Upload Materials
          </Link>
          <Link to="/teacher/quiz-builder" style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.85rem',
            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
          }}>
            <Plus size={14} /> Quiz Builder
          </Link>
          <button onClick={() => setCalendarOpen(true)} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', fontSize: '0.85rem',
            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, cursor: 'pointer',
          }}>
            <CalendarDots size={14} /> Schedule Class
          </button>

          {/* Language toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Report Language:</span>
            <select
              value={masterLang}
              onChange={e => handleLangChange(e.target.value)}
              style={{
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                padding: '5px 8px', fontSize: '0.8rem',
                background: 'var(--color-surface-2)', color: 'var(--color-text)', height: 36, cursor: 'pointer',
              }}
            >
              {allLanguages.map(l => <option key={l.code} value={l.code}>{l.code.toUpperCase()} {l.name}</option>)}
            </select>
            {langSaved && <span style={{ fontSize: '0.78rem', color: 'var(--color-success)', fontWeight: 600 }}>Saved</span>}
          </div>

          {/* Report download with week picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="week"
              value={selectedWeek}
              onChange={e => setSelectedWeek(e.target.value)}
              style={{
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                padding: '5px 8px', fontSize: '0.8rem',
                background: 'var(--color-surface-2)', color: 'var(--color-text)',
                height: 36, cursor: 'pointer',
              }}
            />
            <button
              onClick={handleDownloadReport}
              disabled={reportLoading}
              style={{
                padding: '6px 14px', borderRadius: 'var(--radius-md)',
                background: reportLoading ? 'var(--color-text-muted)' : 'var(--color-primary)',
                border: 'none', color: '#fff', fontSize: '0.85rem',
                cursor: reportLoading ? 'default' : 'pointer', minHeight: 36,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {reportLoading && <Spinner size={14} color="#fff" />}
              {reportLoading ? 'Generating…' : 'Download Class Report'}
            </button>
          </div>
        </div>

        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-hint)', whiteSpace: 'nowrap' }}>
          {dataUpdatedAt
            ? secsAgo < 5 ? 'Just updated' : `Updated ${secsAgo}s ago`
            : isLoading ? 'Loading...' : '—'}
        </span>
      </header>

      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 16px' }}>
        {error && (
          <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>
            Error loading dashboard: {error.message}
          </p>
        )}

        {/* ──────── Metric cards ──────── */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '28px', flexWrap: 'wrap' }}>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>
              {isLoading ? '—' : allStudents.length}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Total students</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: alertedStudents.length > 0 ? '#EF9F27' : 'var(--color-success)' }}>
              {isLoading ? '—' : alertedStudents.length}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Flagged students</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>
              {isLoading ? '—' : (heatmapData?.topics?.length ?? '—')}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Topics tracked</div>
          </div>
        </div>

        {/* ──────── Alerts panel ──────── */}
        {alertedStudents.length > 0 && (
          <section style={{ marginBottom: '32px' }}>
            <h2 style={sectionHeadStyle}>Alerts</h2>
            <div style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {alertedStudents.map((student, i) => (
                <div key={student.id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '14px 16px', flexWrap: 'wrap',
                  borderBottom: i < alertedStudents.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}>
                  <AlertDot alerts={student.alerts} />
                  <Link
                    to={`/teacher/student/${student.id}`}
                    style={{ fontWeight: 600, flex: 1, minWidth: 80, color: 'var(--color-text)', textDecoration: 'none' }}
                  >
                    {student.name}
                  </Link>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {student.alerts.map(a => <AlertBadge key={a} type={a} />)}
                  </div>
                  <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    {Math.round((student.mastery_avg || 0) * 100)}% avg mastery
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ──────── Topic Heatmap ──────── */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={sectionHeadStyle}>Topic Heatmap</h2>
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 16px',
          }}>
            {isLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
            ) : heatmapData ? (
              <HeatmapFromApi data={heatmapData} />
            ) : (
              <TopicHeatmap students={allStudents} />
            )}
            <HeatmapLegend />
          </div>
        </section>

        {/* ──────── Materials ──────── */}
        <section style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ ...sectionHeadStyle, marginBottom: 0 }}>Uploaded Materials</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => refetchMaterials()} style={refreshBtnStyle}>
                <ArrowClockwise size={14} /> Refresh
              </button>
              <Link to="/teacher/materials" style={ctaBtnStyle}>
                <UploadSimple size={14} /> Upload
              </Link>
            </div>
          </div>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {!materials || materials.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>📄</div>
                <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>No materials uploaded yet</div>
                <div style={{ fontSize: '0.85rem', marginBottom: 16, maxWidth: 340, margin: '0 auto 16px' }}>
                  Upload PDFs or images to expand the AI tutor curriculum for your class.
                </div>
                <Link to="/teacher/materials" style={{ ...ctaBtnStyle, display: 'inline-flex' }}>
                  <UploadSimple size={14} /> Upload first material
                </Link>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Title', 'Subject', 'Pages', 'Uploaded'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {materials.slice(0, 8).map((m, i) => (
                    <tr key={m.id} style={{ borderBottom: i < Math.min(materials.length, 8) - 1 ? '1px solid var(--color-border)' : 'none' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{m.subject || '—'}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{m.page_count || 1}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{relativeTime(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ──────── Teacher Quizzes ──────── */}
        <section style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ ...sectionHeadStyle, marginBottom: 0 }}>Teacher Quizzes</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => refetchQuizzes()} style={refreshBtnStyle}>
                <ArrowClockwise size={14} /> Refresh
              </button>
              <Link to="/teacher/quiz-builder" style={ctaBtnStyle}>
                <Plus size={14} /> Create
              </Link>
            </div>
          </div>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {!quizzes || quizzes.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>📝</div>
                <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>No quizzes yet</div>
                <div style={{ fontSize: '0.85rem', marginBottom: 16, maxWidth: 340, margin: '0 auto 16px' }}>
                  Create quizzes and assign them to your students to consolidate what you have taught.
                </div>
                <Link to="/teacher/quiz-builder" style={{ ...ctaBtnStyle, display: 'inline-flex' }}>
                  <Plus size={14} /> Create first quiz
                </Link>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Title', 'Subject', 'Questions', 'Assigned to'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quizzes.slice(0, 8).map((q, i) => (
                    <tr key={q.id} style={{ borderBottom: i < Math.min(quizzes.length, 8) - 1 ? '1px solid var(--color-border)' : 'none' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{q.subject || '—'}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{Array.isArray(q.questions) ? q.questions.length : '—'}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{q.assigned_to === 'all' ? 'All students' : 'Selected'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ──────── All students ──────── */}
        <section>
          <h2 style={sectionHeadStyle}>All Students</h2>
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            overflowX: 'auto',
          }}>
            {isLoading ? (
              <p style={{ padding: 16, color: 'var(--color-text-muted)' }}>Loading...</p>
            ) : allStudents.length === 0 ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <div style={{ fontSize: '2rem', marginBottom: 10 }}>🏫</div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 8, color: 'var(--color-text)' }}>No students yet</div>
                <div style={{ fontSize: '0.9rem', maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
                  Students join by opening a browser and going to{' '}
                  <strong style={{ color: 'var(--color-primary)' }}>http://192.168.137.1:8000</strong>{' '}
                  on your WiFi hotspot, then entering their name.
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['', 'Name', 'Language', 'Grade', 'Mastery Avg', 'Level', 'Last Active'].map(h => (
                      <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allStudents.map((s, i) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/teacher/student/${s.id}`)}
                      style={{
                        borderBottom: i < allStudents.length - 1 ? '1px solid var(--color-border)' : 'none',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-2)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = '' }}
                    >
                      <td style={{ padding: '12px 8px 12px 14px', width: 30 }}>
                        <AlertDot alerts={s.alerts} />
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {s.name}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)' }}>{s.language}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)' }}>{s.grade_level}</td>
                      <td style={{ padding: '12px 14px' }}>{Math.round((s.mastery_avg || 0) * 100)}%</td>
                      <td style={{ padding: '12px 14px' }}>
                        {s.mastery_summary?.length > 0
                          ? <MasteryBadge level={s.mastery_summary[0]?.level} />
                          : <span style={{ color: 'var(--color-text-hint)' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {relativeTime(s.last_active)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {calendarOpen && <TeacherCalendarModal onClose={() => setCalendarOpen(false)} />}

      {/* ──────── AI Assistant — floating button ──────── */}
      <button
        ref={chatBtnRef}
        onClick={() => setChatOpen(o => !o)}
        title="OptiLearn Assistant"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--color-primary)', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', boxShadow: '0 4px 14px rgba(42,141,191,0.42)',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.07)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(42,141,191,0.5)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 14px rgba(42,141,191,0.42)' }}
      >
        <Sparkle size={24} weight="fill" />
      </button>

      {/* ──────── AI Chat panel ──────── */}
      {chatOpen && (
        <div
          ref={chatPanelRef}
          style={{
            position: 'fixed', bottom: 90, right: 24, zIndex: 999,
            width: 380, height: 520,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
            display: 'flex', flexDirection: 'column',
            animation: 'olSlideUp 0.2s ease-out',
          }}
        >
          {/* Header */}
          <div style={{
            height: 48, display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 14px', borderBottom: '1px solid var(--color-border)', flexShrink: 0,
            background: 'var(--color-surface)', borderRadius: '16px 16px 0 0',
          }}>
            <Sparkle size={18} weight="fill" color="var(--color-primary)" />
            <span style={{ fontWeight: 700, fontSize: '0.9rem', flex: 1, color: 'var(--color-text)' }}>
              OptiLearn Assistant
            </span>
            {e4bAvailable && (
              <div style={{
                display: 'flex', borderRadius: 20, border: '1px solid var(--color-border)',
                overflow: 'hidden', fontSize: '0.73rem',
              }}>
                {['fast', 'deep'].map(mode => (
                  <button key={mode} onClick={() => setModelPref(mode)} style={{
                    padding: '3px 11px', border: 'none', cursor: 'pointer', fontWeight: 600,
                    background: modelPref === mode ? 'var(--color-primary)' : 'transparent',
                    color: modelPref === mode ? '#fff' : 'var(--color-text-muted)',
                    textTransform: 'capitalize',
                  }}>
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setChatOpen(false)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 4px' }}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={{
                background: msg.role === 'user' ? 'var(--accent-soft)' : 'var(--color-surface-2)',
                borderRadius: 8, padding: '10px 12px', marginBottom: 8,
                fontSize: '0.87rem', lineHeight: 1.55, color: 'var(--color-text)',
                wordBreak: 'break-word',
              }}>
                {msg.role === 'assistant' && !msg.content && msg.streaming ? (
                  <span style={{ color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center' }}>
                    <Spinner size={16} />
                  </span>
                ) : msg.role === 'assistant' ? (
                  renderMarkdown(msg.content)
                ) : (
                  msg.content
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{
            height: 56, display: 'flex', alignItems: 'center',
            borderTop: '1px solid var(--color-border)', padding: '0 8px 0 14px',
            flexShrink: 0, gap: 6, background: 'var(--color-surface)',
            borderRadius: '0 0 16px 16px',
          }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage() } }}
              disabled={chatStreaming}
              placeholder="Ask anything..."
              style={{
                flex: 1, border: 'none', outline: 'none',
                fontSize: '0.87rem', background: 'transparent', color: 'var(--color-text)',
              }}
            />
            <button
              onClick={sendChatMessage}
              disabled={chatStreaming || !chatInput.trim()}
              style={{
                width: 36, height: 36, borderRadius: '50%', border: 'none',
                background: chatInput.trim() && !chatStreaming ? 'var(--color-primary)' : 'var(--color-surface-2)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background 0.15s',
                cursor: chatInput.trim() && !chatStreaming ? 'pointer' : 'default',
              }}
            >
              <ArrowRight size={16} weight="bold" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Heatmap legend ───────────────────────────────────────────────

function HeatmapLegend() {
  const items = [
    { color: '#E24B4A', label: 'Needs support (0–39%)' },
    { color: '#EF9F27', label: 'Developing (40–74%)' },
    { color: '#639922', label: 'Advanced (75–100%)' },
    { color: '#AAAAAA', label: 'No data' },
  ]
  return (
    <div style={{
      display: 'flex', gap: 16, flexWrap: 'wrap',
      marginTop: 14, paddingTop: 12,
      borderTop: '1px solid var(--color-border)',
    }}>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          <span style={{ width: 13, height: 13, borderRadius: 3, background: color, flexShrink: 0, display: 'inline-block' }} />
          {label}
        </div>
      ))}
    </div>
  )
}

// ── HeatmapFromApi ───────────────────────────────────────────────

function HeatmapFromApi({ data }) {
  const { topics, students, grid } = data

  if (!topics?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-hint)', fontSize: '0.9rem' }}>
        No topic data yet — students will appear here after their first quiz.
      </div>
    )
  }

  const COLOR_MAP = { red: '#E24B4A', amber: '#EF9F27', green: '#639922', grey: '#AAAAAA' }
  const COL_W = 72

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content' }}>
        <thead>
          <tr>
            <th style={{
              width: 130, minWidth: 130, padding: '6px 10px 6px 0',
              textAlign: 'left', fontSize: '0.72rem', color: 'var(--color-text-muted)',
              fontWeight: 600, borderBottom: '2px solid var(--color-border)',
            }}>
              Student
            </th>
            {topics.map(t => (
              <th key={t} style={{
                width: COL_W, minWidth: COL_W, maxWidth: COL_W,
                padding: '6px 4px', textAlign: 'center',
                fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600,
                borderBottom: '2px solid var(--color-border)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={t}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((s, ri) => (
            <tr key={s.id}>
              <td style={{
                padding: '4px 10px 4px 0', fontSize: '0.8rem',
                color: 'var(--color-text-muted)', fontWeight: 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: 130, borderBottom: '1px solid var(--color-border)',
              }} title={s.name}>
                {s.name}
              </td>
              {grid[ri]?.map((cell, ci) => {
                const pct = cell?.value != null ? Math.round((cell.value || 0) * 100) : null
                return (
                  <td key={ci}
                    title={`${s.name} — ${topics[ci]}: ${pct !== null ? pct + '%' : 'no data'}`}
                    style={{
                      height: 34, textAlign: 'center', verticalAlign: 'middle',
                      background: COLOR_MAP[cell?.color || 'grey'],
                      border: '2px solid var(--color-surface)',
                      fontSize: '0.68rem', fontWeight: 700,
                      color: 'rgba(255,255,255,0.92)',
                      cursor: 'default',
                      borderRadius: 4,
                    }}
                  >
                    {pct !== null ? `${pct}%` : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
