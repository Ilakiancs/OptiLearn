import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bell, Warning, TrendDown,
  Sparkle, X, ArrowRight, ArrowClockwise,
  UploadSimple, Plus, CalendarDots, Moon, Student, Sun,
  SignOut, Key, Eye, EyeSlash, Copy, ShieldCheck, UserPlus, MagnifyingGlass,
  WifiHigh, QrCode, CheckCircle, WarningCircle, ClipboardText, ChalkboardTeacher, FileText,
} from '@phosphor-icons/react'
import {
  getTeacherStudents, getTeacherHeatmap, downloadWeeklyReport,
  listMaterials, listTeacherQuizzes, teacherChat, getHealth,
  getTeacherSettings, updateTeacherSettings,
  changeTeacherPassword, logoutTeacher,
  listAdminTeachers, createAdminTeacher, updateAdminTeacher,
  resetAdminTeacherPassword, deactivateAdminTeacher,
  listAdminStudents, resetAdminStudentPin, createAdminStudent,
  getNetworkStatus, refreshNetworkStatus, getNetworkQrData, getNetworkQrUrl,
} from '../api/client'
import { feature1 } from '../api/client'
import MasteryBadge from '../components/MasteryBadge'
import TopicHeatmap from '../components/TopicHeatmap'
import NetworkStatusPill from '../components/NetworkStatusPill'
import TeacherCalendarModal from '../components/TeacherCalendarModal'
import Spinner from '../components/Spinner'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import MaterialUpload from './MaterialUpload'
import TeacherQuizBuilder from './TeacherQuizBuilder'

const GRADE_LEVELS = ['Pre-K', 'K', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']

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

function SearchBox({ value, onChange, placeholder, style }) {
  return (
    <label style={{ position: 'relative', minWidth: 220, flex: '1 1 260px', maxWidth: 360, ...style }}>
      <MagnifyingGlass size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--color-text-muted)' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          minHeight: 42,
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '9px 11px 9px 36px',
          background: 'var(--color-surface-2)',
          color: 'var(--color-text)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </label>
  )
}

const ignoredSecretProps = {
  type: 'text',
  autoComplete: 'off',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-form-type': 'other',
}

function randomPassword() {
  return `teach-${Math.random().toString(36).slice(2, 8)}`
}

function randomPin() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function CopyButton({ value, label = 'Copy' }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value || '')}
      title={label}
      style={{ ...refreshBtnStyle, padding: '4px 8px', minHeight: 30 }}
    >
      <Copy size={13} />
      {label}
    </button>
  )
}

function SecretCell({ value }) {
  const [visible, setVisible] = useState(false)
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <code style={{ fontFamily: 'inherit', color: 'var(--color-text)' }}>{visible ? value || '—' : '••••'}</code>
      <button type="button" onClick={() => setVisible((v) => !v)} title={visible ? 'Hide' : 'Show'} style={{ ...refreshBtnStyle, padding: 4, minHeight: 28 }}>
        {visible ? <EyeSlash size={13} /> : <Eye size={13} />}
      </button>
      {value && <CopyButton value={value} label="Copy" />}
    </span>
  )
}

function ConnectStudentsView({ isMobile = false }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [qrVersion, setQrVersion] = useState(() => Date.now())
  const [qrSrc, setQrSrc] = useState('')

  async function load({ refresh = false, quiet = false } = {}) {
    if (!quiet) {
      setError('')
      refresh ? setRefreshing(true) : setLoading(true)
    }
    try {
      const data = refresh ? await refreshNetworkStatus() : await getNetworkStatus()
      setStatus(data)
      const nextQrVersion = Date.now()
      setQrVersion(nextQrVersion)
      try {
        const qr = await getNetworkQrData(nextQrVersion)
        setQrSrc(qr.data_url)
      } catch (_) {
        setQrSrc(getNetworkQrUrl(nextQrVersion))
      }
    } catch (err) {
      if (!quiet) setError(err.message || 'Network status could not be loaded.')
    } finally {
      if (!quiet) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  useEffect(() => {
    let active = true
    const safeLoad = async (options) => {
      if (!active) return
      await load(options)
    }
    safeLoad()
    const id = setInterval(() => safeLoad({ quiet: true }), 10000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  const fallbackUrl = status?.connect_url || status?.server_url || 'http://192.168.137.1:8000'
  const url = fallbackUrl.endsWith('/') ? fallbackUrl : `${fallbackUrl}/`
  const mdnsUrl = status?.mdns_url || 'http://optilearn.local:8000/'
  const connectionUrls = Array.from(new Set([url, mdnsUrl].filter(Boolean)))
  const portalActive = !!status?.captive_portal_active
  const connectedCount = Number(status?.network_client_count ?? status?.student_count ?? 0)
  const studentLabel = connectedCount === 1 ? 'student' : 'students'
  const qrSize = isMobile ? 'min(244px, 72vw)' : 'min(292px, 38vh)'

  async function copyUrl(value) {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(value)
      setTimeout(() => setCopied(''), 1800)
    } catch (_) {}
  }

  return (
    <main style={{ padding: isMobile ? '16px' : '24px 22px', background: 'var(--bg)', color: 'var(--color-text)', minHeight: '100vh', overflowY: 'auto', display: 'grid', placeItems: isMobile ? 'start stretch' : 'center', boxSizing: 'border-box' }}>
      <section style={{ width: '100%', maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 24, justifyItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', flexWrap: 'wrap' }}>
          <span style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--color-primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <WifiHigh size={23} weight="duotone" />
          </span>
          <h1 style={{ margin: 0, fontSize: '1.35rem', color: 'var(--color-text)' }}>Connect Students to OptiLearn</h1>
        </div>

        {error && (
          <div style={{ width: '100%', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', borderRadius: 10, padding: 12, background: 'var(--color-surface)' }}>
            {error}
          </div>
        )}

        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(300px, 360px) minmax(360px, 1fr)', gap: isMobile ? 16 : 28, alignItems: 'center', justifyContent: 'center' }}>

          <div style={{ display: 'grid', gap: 14, justifyItems: 'center', alignContent: 'center', minWidth: 0 }}>
            <div style={{ border: '6px solid #2a8dbf', borderRadius: 12, padding: 0, background: '#fff', width: qrSize, height: qrSize, display: 'grid', placeItems: 'center', boxSizing: 'border-box', overflow: 'hidden' }}>
              {loading ? <Spinner /> : <img src={qrSrc || getNetworkQrUrl(qrVersion)} alt="OptiLearn connection QR code" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />}
            </div>
            <div style={{ fontSize: '0.86rem', color: 'var(--color-text-muted)' }}>Scan this code with any phone or tablet</div>

            <div style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface)', padding: 14, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, color: portalActive ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 700, lineHeight: 1.35 }}>
                {portalActive ? <CheckCircle size={20} weight="fill" style={{ flexShrink: 0, marginTop: 1 }} /> : <WarningCircle size={20} weight="fill" style={{ flexShrink: 0, marginTop: 1 }} />}
                <span>
                  {portalActive
                    ? 'Auto-connect active - students see OptiLearn automatically when they join WiFi'
                    : 'Auto-connect needs admin privileges - run OptiLearn as administrator to enable it'}
                </span>
              </div>
              <div style={{ paddingLeft: 30, color: 'var(--color-text-muted)', fontSize: '0.9rem', lineHeight: 1.4 }}>
                {connectedCount} {studentLabel} connected to the OptiLearn network
              </div>
            </div>

            <button type="button" onClick={() => load({ refresh: true })} disabled={refreshing} style={{ ...ctaBtnStyle, minHeight: 44, justifyContent: 'center', minWidth: 180, opacity: refreshing ? 0.72 : 1 }}>
              {refreshing ? <Spinner size={14} color="#fff" /> : <ArrowClockwise size={15} />}
              {refreshing ? 'Refreshing...' : 'Refresh connection'}
            </button>
          </div>

          <div style={{ width: '100%', display: 'grid', gap: 14, alignContent: 'center', minWidth: 0 }}>
            <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, color: 'var(--color-text-muted)', fontSize: '0.82rem', fontWeight: 700 }}>
              <span style={{ height: 1, background: 'var(--color-border)' }} />
              <span>or connect manually</span>
              <span style={{ height: 1, background: 'var(--color-border)' }} />
            </div>

            <div style={{ width: '100%', display: 'grid', gap: 10 }}>
              {connectionUrls.map((value) => (
                <div key={value} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) auto', alignItems: 'center', gap: 8, width: '100%' }}>
                  <code style={{ fontSize: isMobile ? '1rem' : '1.22rem', fontWeight: 800, color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 12px', wordBreak: 'break-all' }}>
                    {value}
                  </code>
                  <button type="button" onClick={() => copyUrl(value)} style={{ ...refreshBtnStyle, minHeight: 42, justifyContent: 'center' }}>
                    <Copy size={15} />
                    {copied === value ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>

            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.84rem', lineHeight: 1.5 }}>
              Use the numeric address first so students stay signed in. optilearn.local is optional and may not open on some iPhone, iPad, or hotspot networks.
            </div>

            <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 1.65, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              <li>Connect to the "OptiLearn" WiFi on your device</li>
              <li>Scan the QR code above or type the address in your browser</li>
              <li>Sign in or create your account</li>
              <li>Tap "Add to Home Screen" to install the OptiLearn app</li>
            </ol>
          </div>
        </div>
      </section>
    </main>
  )
}

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.current_password || !form.new_password || !form.confirm_password) {
      setError('Please complete every field.')
      return
    }
    if (form.new_password !== form.confirm_password) {
      setError('New passwords do not match.')
      return
    }
    if (form.new_password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setSaving(true)
    try {
      await changeTeacherPassword(form)
      onClose()
    } catch (err) {
      setError(err.message || 'Password could not be updated.')
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', padding: 18 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 390, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Key size={20} weight="duotone" />
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Change Password</h2>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        {[
          ['current_password', 'Current password'],
          ['new_password', 'New password'],
          ['confirm_password', 'Confirm new password'],
        ].map(([key, label]) => (
          <label key={key} style={{ display: 'grid', gap: 5, fontSize: '0.84rem', color: 'var(--color-text-muted)' }}>
            {label}
            <input
              {...ignoredSecretProps}
              name={`optilearn_${key}`}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              style={{ minHeight: 42, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '9px 11px', background: 'var(--color-surface-2)', color: 'var(--color-text)', WebkitTextSecurity: 'disc' }}
            />
          </label>
        ))}
        {error && <div style={{ color: 'var(--color-danger)', fontSize: '0.84rem' }}>{error}</div>}
        <button type="submit" disabled={saving} style={{ ...ctaBtnStyle, justifyContent: 'center', minHeight: 42 }}>
          {saving ? 'Updating...' : 'Update Password'}
        </button>
      </form>
    </div>
  )
}

function AdminManagement({ currentTeacher, allLanguages = [] }) {
  const [teachers, setTeachers] = useState([])
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ display_name: '', username: '', password: randomPassword(), is_admin: false })
  const [teacherSearch, setTeacherSearch] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [studentForm, setStudentForm] = useState({ name: '', username: '', pin: randomPin(), grade_level: '7th', language: 'en' })
  const [studentError, setStudentError] = useState('')
  const [studentNotice, setStudentNotice] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [teacherRows, studentRows] = await Promise.all([listAdminTeachers(), listAdminStudents()])
      setTeachers(teacherRows)
      setStudents(studentRows)
    } catch (err) {
      setError(err.message || 'Admin data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function addTeacher(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    try {
      const created = await createAdminTeacher(form)
      setNotice(`Created ${created.display_name || created.username}. Password: ${form.password}`)
      setForm({ display_name: '', username: '', password: randomPassword(), is_admin: false })
      await load()
    } catch (err) {
      setError(err.message || 'Teacher could not be created.')
    }
  }

  async function resetTeacher(teacher) {
    const newPassword = randomPassword()
    try {
      await resetAdminTeacherPassword(teacher.id, newPassword)
      setNotice(`Password reset for ${teacher.display_name || teacher.username}: ${newPassword}`)
      await load()
    } catch (err) {
      setError(err.message || 'Password reset could not be completed.')
    }
  }

  async function toggleAdmin(teacher) {
    try {
      await updateAdminTeacher(teacher.id, { is_admin: !teacher.is_admin })
      await load()
    } catch (err) {
      setError(err.message || 'Role could not be updated.')
    }
  }

  async function deactivateTeacherAccount(teacher) {
    try {
      await deactivateAdminTeacher(teacher.id)
      await load()
    } catch (err) {
      setError(err.message || 'Teacher could not be deactivated.')
    }
  }

  async function resetPin(student) {
    const pin = randomPin()
    try {
      await resetAdminStudentPin(student.id, pin)
      setNotice(`PIN reset for ${student.name}: ${pin}`)
      await load()
    } catch (err) {
      setError(err.message || 'PIN could not be reset.')
    }
  }

  async function addStudent(e) {
    e.preventDefault()
    setStudentError('')
    setStudentNotice('')
    try {
      const created = await createAdminStudent(studentForm)
      setStudentNotice(`Created ${created.name} (${created.username}). PIN: ${studentForm.pin}`)
      setStudentForm({ name: '', username: '', pin: randomPin(), grade_level: '7th', language: 'en' })
      await load()
    } catch (err) {
      setStudentError(err.message || 'Student could not be created.')
    }
  }

  const teacherRows = useMemo(() => {
    const q = teacherSearch.trim().toLowerCase()
    if (!q) return teachers
    return teachers.filter((teacher) => [
      teacher.display_name,
      teacher.username,
      teacher.is_admin ? 'admin' : 'teacher',
      teacher.is_active ? 'active' : 'inactive',
    ].some((value) => String(value || '').toLowerCase().includes(q)))
  }, [teachers, teacherSearch])

  const studentRows = useMemo(() => {
    const q = studentSearch.trim().toLowerCase()
    if (!q) return students
    return students.filter((student) => [
      student.name,
      student.username,
      student.pin_visible,
      student.grade_level,
      student.language,
    ].some((value) => String(value || '').toLowerCase().includes(q)))
  }, [students, studentSearch])

  const inputBase = {
    minHeight: 42,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '9px 11px',
    background: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
  }
  const fieldStyle = { display: 'grid', gap: 6, color: 'var(--color-text-muted)', fontSize: '0.82rem', fontWeight: 600 }
  const tableWrap = { overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)' }
  const th = { padding: '12px 14px', textAlign: 'left', color: 'var(--color-text-muted)', fontSize: '0.78rem', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap', fontWeight: 700 }
  const td = { padding: '12px 14px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap', fontSize: '0.86rem', verticalAlign: 'middle' }
  const actionCell = { ...td, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minWidth: 380 }
  const compactBtn = { ...refreshBtnStyle, minHeight: 38, padding: '7px 12px', borderRadius: 'var(--radius-md)' }
  const sectionHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 16px', display: 'grid', gap: 22 }}>
      <section style={{ display: 'grid', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={24} weight="duotone" />
          Manage Users
        </h1>
        {notice && (
          <div style={{ border: '1px solid var(--color-success)', borderRadius: 10, padding: 10, color: 'var(--color-success)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{notice}</span>
            <CopyButton value={notice.split(': ').pop()} label="Copy details" />
          </div>
        )}
        {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
      </section>

      <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <UserPlus size={20} weight="duotone" />
        Add Teacher
      </h2>

      <form
        onSubmit={addTeacher}
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-surface)',
          padding: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <label style={{ ...fieldStyle, flex: '1 1 220px', minWidth: 0 }}>
          Display Name
          <input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} style={inputBase} />
        </label>
        <label style={{ ...fieldStyle, flex: '1 1 220px', minWidth: 0 }}>
          Username
          <input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} style={inputBase} />
        </label>
        <label style={{ ...fieldStyle, flex: '1.2 1 320px', minWidth: 0 }}>
          Password
          <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, minWidth: 0 }}>
            <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} style={inputBase} />
            <button type="button" onClick={() => setForm((f) => ({ ...f, password: randomPassword() }))} style={compactBtn}>Generate</button>
          </span>
        </label>
        <div style={{ ...fieldStyle, flex: '0 1 260px', minWidth: 220 }}>
          Role
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', minHeight: 42 }}>
            {[
              [false, 'Teacher'],
              [true, 'Admin'],
            ].map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setForm((f) => ({ ...f, is_admin: value }))}
                style={{
                  border: 'none',
                  borderRight: value ? 'none' : '1px solid var(--color-border)',
                  background: form.is_admin === value ? 'var(--color-primary)' : 'var(--color-surface-2)',
                  color: form.is_admin === value ? '#fff' : 'var(--color-text-muted)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" style={{ ...ctaBtnStyle, minHeight: 42, justifyContent: 'center', fontWeight: 700, flex: '0 0 190px' }}>
          <UserPlus size={15} />
          Add Teacher
        </button>
      </form>

      {/* ── Add Student ─────────────────────────────────────────── */}
      <section style={{ display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <UserPlus size={20} weight="duotone" />
          Add Student
        </h2>
        {studentNotice && (
          <div style={{ border: '1px solid var(--color-success)', borderRadius: 10, padding: 10, color: 'var(--color-success)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{studentNotice}</span>
            <CopyButton value={studentNotice.split(': ').pop()} label="Copy details" />
          </div>
        )}
        {studentError && <div style={{ color: 'var(--color-danger)', fontSize: '0.86rem' }}>{studentError}</div>}
      </section>

      <form
        onSubmit={addStudent}
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-surface)',
          padding: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <label style={{ ...fieldStyle, flex: '1 1 220px', minWidth: 0 }}>
          Full Name
          <input
            value={studentForm.name}
            onChange={(e) => setStudentForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Student full name"
            style={inputBase}
          />
        </label>
        <label style={{ ...fieldStyle, flex: '1 1 200px', minWidth: 0 }}>
          Username
          <input
            value={studentForm.username}
            onChange={(e) => setStudentForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="student123"
            style={inputBase}
          />
        </label>
        <label style={{ ...fieldStyle, flex: '1 1 220px', minWidth: 0 }}>
          PIN (4 digits)
          <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={studentForm.pin}
              onChange={(e) => setStudentForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
              style={inputBase}
            />
            <button type="button" onClick={() => setStudentForm((f) => ({ ...f, pin: randomPin() }))} style={compactBtn}>Generate</button>
          </span>
        </label>
        <label style={{ ...fieldStyle, flex: '0 1 160px', minWidth: 0 }}>
          Grade Level
          <select
            value={studentForm.grade_level}
            onChange={(e) => setStudentForm((f) => ({ ...f, grade_level: e.target.value }))}
            style={inputBase}
          >
            {GRADE_LEVELS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label style={{ ...fieldStyle, flex: '0 1 200px', minWidth: 0 }}>
          Language
          <select
            value={studentForm.language}
            onChange={(e) => setStudentForm((f) => ({ ...f, language: e.target.value }))}
            style={inputBase}
          >
            {allLanguages.length > 0
              ? allLanguages.map((l) => <option key={l.code} value={l.code}>{l.code.toUpperCase()} {l.name}</option>)
              : <option value="en">EN English</option>}
          </select>
        </label>
        <button type="submit" style={{ ...ctaBtnStyle, minHeight: 42, justifyContent: 'center', fontWeight: 700, flex: '0 0 190px' }}>
          <UserPlus size={15} />
          Add Student
        </button>
      </form>

      {loading ? <Spinner /> : (
        <>
          <section style={{ display: 'grid', gap: 10 }}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.08rem' }}>Teachers</h2>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', marginTop: 3 }}>
                  {teacherRows.length} of {teachers.length} shown
                </div>
              </div>
              <SearchBox value={teacherSearch} onChange={setTeacherSearch} placeholder="Search teachers..." />
            </div>
            <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr>{['Display Name', 'Username', 'Initial Password', 'Role', 'Last Login', 'Actions'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {teacherRows.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...td, color: 'var(--color-text-muted)', textAlign: 'center' }}>No teachers match your search.</td></tr>
                ) : teacherRows.map((teacher) => (
                  <tr key={teacher.id} style={{ opacity: teacher.is_active ? 1 : 0.55 }}>
                    <td style={td}>{teacher.display_name || '—'}</td>
                    <td style={td}>{teacher.username}</td>
                    <td style={td}><SecretCell value={teacher.initial_password} /></td>
                    <td style={td}>{teacher.is_admin ? 'Admin' : 'Teacher'}</td>
                    <td style={td}>{relativeTime(teacher.last_login)}</td>
                    <td style={actionCell}>
                      <button type="button" onClick={() => resetTeacher(teacher)} style={compactBtn}>Reset Password</button>
                      <button type="button" onClick={() => toggleAdmin(teacher)} style={{ ...compactBtn, minWidth: 128, justifyContent: 'center' }}>{teacher.is_admin ? 'Remove Admin' : 'Make Admin'}</button>
                      <button
                        type="button"
                        disabled={teacher.id === currentTeacher?.teacher_id || !teacher.is_active}
                        onClick={() => deactivateTeacherAccount(teacher)}
                        style={{ ...compactBtn, opacity: teacher.id === currentTeacher?.teacher_id || !teacher.is_active ? 0.45 : 1 }}
                      >
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>

          <section style={{ display: 'grid', gap: 10 }}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.08rem' }}>Admin Student Management</h2>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', marginTop: 3 }}>
                  {studentRows.length} of {students.length} shown
                </div>
              </div>
              <SearchBox value={studentSearch} onChange={setStudentSearch} placeholder="Search students..." />
            </div>
            <div style={tableWrap}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead>
                  <tr>{['Name', 'Username', 'PIN', 'Grade', 'Language', 'Last Active', 'Actions'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {studentRows.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...td, color: 'var(--color-text-muted)', textAlign: 'center' }}>No students match your search.</td></tr>
                  ) : studentRows.map((student) => (
                    <tr key={student.id}>
                      <td style={td}>{student.name}</td>
                      <td style={td}>{student.username || '—'}</td>
                      <td style={td}><SecretCell value={student.pin_visible} /></td>
                      <td style={td}>{student.grade_level}</td>
                      <td style={td}>{student.language}</td>
                      <td style={td}>{relativeTime(student.last_active)}</td>
                      <td style={td}><button type="button" onClick={() => resetPin(student)} style={compactBtn}>Reset PIN</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

// ── Main component ───────────────────────────────────────────────

export default function TeacherDashboard({ initialView = 'overview' }) {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { teacher, clearTeacher } = useAuth()
  const [view, setView] = useState(initialView)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [materialSearch, setMaterialSearch] = useState('')
  const [quizSearch, setQuizSearch] = useState('')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 980)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 980)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    setView(initialView)
  }, [initialView])

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
  const filteredMaterials = useMemo(() => {
    const q = materialSearch.trim().toLowerCase()
    const rows = materials || []
    if (!q) return rows
    return rows.filter((material) => [
      material.title,
      material.subject,
      material.uploaded_by_username,
      material.uploaded_by_display_name,
      material.uploaded_by,
    ].some((value) => String(value || '').toLowerCase().includes(q)))
  }, [materials, materialSearch])
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
  const canUpdateSettings = !!teacher?.is_admin && teacherSettings?.can_update !== false
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
    if (!canUpdateSettings) return
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

  async function handleDownloadReport() {
    setReportLoading(true)
    try {
      await downloadWeeklyReport(selectedWeek || undefined)
    } finally {
      setReportLoading(false)
    }
  }

  async function handleSignOut() {
    try { await logoutTeacher() } catch (_) {}
    clearTeacher()
    navigate('/', { replace: true })
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
          content: 'Something needs attention. Please try again.',
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

  const sidebarNavStyle = (active = false) => ({
    width: '100%',
    minHeight: 48,
    borderRadius: 18,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-soft)' : 'var(--surface)',
    color: 'var(--text)',
    padding: '10px 12px',
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '66px 1fr',
    alignItems: 'center',
    gap: 12,
    textDecoration: 'none',
    textAlign: 'left',
    fontSize: '1rem',
    fontWeight: 600,
    boxSizing: 'border-box',
  })

  const sidebarIconStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 52,
    borderRadius: 14,
    border: 'none',
    background: 'transparent',
    color: 'var(--text)',
    flexShrink: 0,
  }

  const sidebarSectionStyle = {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--surface)',
    padding: 12,
    display: 'grid',
    gap: 10,
  }

  // ── Render ──

  return (
    <div
      className="page-shell"
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '296px minmax(0, 1fr)',
        minHeight: '100vh',
        alignItems: 'start',
      }}
    >

      {/* ──────── Sidebar ──────── */}
      <aside className="student-sidebar-scroll" style={{
        padding: 14,
        borderRight: isMobile ? 'none' : '1px solid var(--border)',
        borderBottom: isMobile ? '1px solid var(--border)' : 'none',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        position: isMobile ? 'relative' : 'sticky',
        top: 0,
        height: isMobile ? 'auto' : '100vh',
        minHeight: 0,
        overflowY: isMobile ? 'visible' : 'auto',
        boxSizing: 'border-box',
      }}>
        <div className="surface-card" style={{
          color: 'var(--text)', textDecoration: 'none',
          minHeight: 70, display: 'inline-flex', alignItems: 'center',
          gap: 12, padding: 12,
        }}>
          <span className="icon-only" style={{ width: 52, height: 52, borderRadius: 14 }}>
            <Student size={24} weight="duotone" />
          </span>
          <span style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontWeight: 800, fontSize: '1.08rem', lineHeight: 1.1 }}>OptiLearn</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Teacher dashboard</span>
          </span>
        </div>
        <div className="surface-card" style={{ padding: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '1.2rem', flexShrink: 0 }}>
            {(teacher?.display_name || teacher?.username || 'T').slice(0, 1).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {teacher?.display_name || teacher?.username || 'Teacher'}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              {teacher?.is_admin ? 'Admin teacher' : 'Teacher'}
            </div>
          </div>
        </div>
        <NetworkStatusPill variant="inline" fullWidth dropdownAlign="left" />

        <div style={{ display: 'grid', gap: 10 }}>
          <button type="button" onClick={() => setView('overview')} style={sidebarNavStyle(view === 'overview')}>
            <span style={sidebarIconStyle}><Student size={22} weight="duotone" /></span>
            <span>Overview</span>
          </button>
          {teacher?.is_admin && (
            <button type="button" onClick={() => setView('manage')} style={sidebarNavStyle(view === 'manage')}>
              <span style={sidebarIconStyle}><ShieldCheck size={22} weight="duotone" /></span>
              <span>Manage Users</span>
            </button>
          )}
          <button type="button" onClick={() => setView('connect')} style={sidebarNavStyle(view === 'connect')}>
            <span style={sidebarIconStyle}><WifiHigh size={22} weight="duotone" /></span>
            <span>Connect Students</span>
          </button>
          <button type="button" onClick={() => setView('materials')} style={sidebarNavStyle(view === 'materials')}>
            <span style={sidebarIconStyle}><UploadSimple size={22} weight="duotone" /></span>
            <span>Upload Materials</span>
          </button>
          <button type="button" onClick={() => setView('quiz-builder')} style={sidebarNavStyle(view === 'quiz-builder')}>
            <span style={sidebarIconStyle}><Plus size={22} weight="duotone" /></span>
            <span>Quiz Builder</span>
          </button>
          <button type="button" onClick={() => setCalendarOpen(true)} style={sidebarNavStyle(false)}>
            <span style={sidebarIconStyle}><CalendarDots size={22} weight="duotone" /></span>
            <span>Schedule Class</span>
          </button>

          {/* Language toggle */}
          <div style={sidebarSectionStyle}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>Report Language</span>
            <select
              value={masterLang}
              onChange={e => handleLangChange(e.target.value)}
              disabled={!canUpdateSettings}
              title={canUpdateSettings ? 'Change report language' : 'Only admin teachers can change this setting'}
              style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                padding: '8px 10px', fontSize: '0.82rem',
                background: 'var(--surface-soft)', color: 'var(--text)', minHeight: 38,
                cursor: canUpdateSettings ? 'pointer' : 'not-allowed',
                opacity: canUpdateSettings ? 1 : 0.62,
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {allLanguages.map(l => <option key={l.code} value={l.code}>{l.code.toUpperCase()} {l.name}</option>)}
            </select>
            {langSaved && <span style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: 600 }}>Saved</span>}
          </div>

          {/* Report download with week picker */}
          <div style={sidebarSectionStyle}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>Weekly Report</span>
            <input
              type="week"
              value={selectedWeek}
              onChange={e => setSelectedWeek(e.target.value)}
              style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                padding: '8px 10px', fontSize: '0.82rem',
                background: 'var(--surface-soft)', color: 'var(--text)',
                minHeight: 38, cursor: 'pointer',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={handleDownloadReport}
              disabled={reportLoading}
              style={{ ...ctaBtnStyle, justifyContent: 'center', minHeight: 42, fontWeight: 700, opacity: reportLoading ? 0.72 : 1 }}
            >
              {reportLoading && <Spinner size={14} color="#fff" />}
              {reportLoading ? 'Generating…' : 'Download Class Report'}
            </button>
          </div>
        </div>

        {/* Bottom actions — pushed to bottom, matching student sidebar */}
        <div style={{ marginTop: 'auto', display: 'grid', gap: 10 }}>
          <button type="button" onClick={toggleTheme} className="pill-button">
            {theme === 'dark' ? <Sun size={18} weight="duotone" /> : <Moon size={18} weight="duotone" />}
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button type="button" onClick={() => setPasswordOpen(true)} className="pill-button">
            <Key size={18} weight="duotone" />
            <span>Change Password</span>
          </button>
          <button type="button" onClick={handleSignOut} className="pill-button">
            <SignOut size={18} weight="duotone" />
            <span>Sign Out</span>
          </button>
        </div>

        {passwordOpen && <ChangePasswordModal onClose={() => setPasswordOpen(false)} />}

        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textAlign: 'center', opacity: 0.7 }}>
          {dataUpdatedAt
            ? secsAgo < 5 ? 'Just updated' : `Updated ${secsAgo}s ago`
            : isLoading ? 'Loading...' : '—'}
        </span>
      </aside>

      {view === 'manage' && teacher?.is_admin ? (
        <AdminManagement currentTeacher={teacher} allLanguages={allLanguages} />
      ) : view === 'connect' ? (
        <ConnectStudentsView isMobile={isMobile} />
      ) : view === 'materials' ? (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px', boxSizing: 'border-box' }}>
          <MaterialUpload embedded />
        </div>
      ) : view === 'quiz-builder' ? (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px', boxSizing: 'border-box' }}>
          <TeacherQuizBuilder embedded />
        </div>
      ) : (
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 16px' }}>
        <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.35rem', color: 'var(--color-text)' }}>Classroom Dashboard</h1>
            <p style={{ margin: '5px 0 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Share the live classroom link, QR code, and hotspot status from one place.</p>
          </div>
          <button type="button" onClick={() => setView('connect')} style={{ ...ctaBtnStyle, minHeight: 42, fontWeight: 700 }}>
            <QrCode size={16} weight="duotone" />
            Connect Students
          </button>
        </section>

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ ...sectionHeadStyle, marginBottom: 0 }}>Uploaded Materials</h2>
            <SearchBox value={materialSearch} onChange={setMaterialSearch} placeholder="Search by title or teacher..." />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => refetchMaterials()} style={refreshBtnStyle}>
                <ArrowClockwise size={14} /> Refresh
              </button>
              <button type="button" onClick={() => setView('materials')} style={ctaBtnStyle}>
                <UploadSimple size={14} /> Upload
              </button>
            </div>
          </div>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {!materials || materials.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <FileText size={32} weight="duotone" color="var(--color-primary)" style={{ marginBottom: 8 }} />
                <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>No materials uploaded yet</div>
                <div style={{ fontSize: '0.85rem', marginBottom: 16, maxWidth: 340, margin: '0 auto 16px' }}>
                  Upload PDFs or images to expand the AI tutor curriculum for your class.
                </div>
                <button type="button" onClick={() => setView('materials')} style={{ ...ctaBtnStyle, display: 'inline-flex' }}>
                  <UploadSimple size={14} /> Upload first material
                </button>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Title', 'Subject', 'Pages', 'Uploaded by', 'Uploaded'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '18px 14px', textAlign: 'center', color: 'var(--color-text-muted)' }}>No materials match your search.</td></tr>
                  ) : filteredMaterials.slice(0, 8).map((m, i) => (
                    <tr key={m.id} style={{ borderBottom: i < Math.min(filteredMaterials.length, 8) - 1 ? '1px solid var(--color-border)' : 'none' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{m.subject || '—'}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{m.page_count || 1}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{m.uploaded_by_username || m.uploaded_by_display_name || '-'}</td>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ ...sectionHeadStyle, marginBottom: 0 }}>Teacher Quizzes</h2>
            <SearchBox value={quizSearch} onChange={setQuizSearch} placeholder="Search by title or teacher..." />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => refetchQuizzes()} style={refreshBtnStyle}>
                <ArrowClockwise size={14} /> Refresh
              </button>
              <button type="button" onClick={() => setView('quiz-builder')} style={ctaBtnStyle}>
                <Plus size={14} /> Create
              </button>
            </div>
          </div>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {!quizzes || quizzes.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <ClipboardText size={32} weight="duotone" color="var(--color-primary)" style={{ marginBottom: 8 }} />
                <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>No quizzes yet</div>
                <div style={{ fontSize: '0.85rem', marginBottom: 16, maxWidth: 340, margin: '0 auto 16px' }}>
                  Create quizzes and assign them to your students to consolidate what you have taught.
                </div>
                <button type="button" onClick={() => setView('quiz-builder')} style={{ ...ctaBtnStyle, display: 'inline-flex' }}>
                  <Plus size={14} /> Create first quiz
                </button>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Title', 'Subject', 'Questions', 'Created by', 'Assigned to'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredQuizzes.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '18px 14px', textAlign: 'center', color: 'var(--color-text-muted)' }}>No quizzes match your search.</td></tr>
                  ) : filteredQuizzes.slice(0, 8).map((q, i) => (
                    <tr key={q.id} style={{ borderBottom: i < Math.min(filteredQuizzes.length, 8) - 1 ? '1px solid var(--color-border)' : 'none' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{q.subject || '—'}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{Array.isArray(q.questions) ? q.questions.length : '—'}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{q.created_by_username || q.created_by_display_name || '-'}</td>
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
                <ChalkboardTeacher size={36} weight="duotone" color="var(--color-primary)" style={{ marginBottom: 10 }} />
                <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 8, color: 'var(--color-text)' }}>No students yet</div>
                <div style={{ fontSize: '0.9rem', maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
                  Use Connect Students to show the current QR code and classroom address for your WiFi hotspot.
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
      )}

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
