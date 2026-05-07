import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarDots,
  ChatsCircle,
  ChartBar,
  DoorOpen,
  House,
  Key,
  ListChecks,
  List,
  Megaphone,
  Moon,
  Radio,
  SignOut,
  Sparkle,
  Student,
  Sun,
  Trophy,
  X,
} from '@phosphor-icons/react'
import { getStudent, changeStudentPin, getHealth } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import NetworkStatusPill from './NetworkStatusPill'

function ChangePinModal({ studentId, onClose }) {
  const [form, setForm] = useState({ current_pin: '', new_pin: '', confirm_pin: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  function onlyDigits(val) {
    return val.replace(/\D/g, '').slice(0, 4)
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.current_pin || !form.new_pin || !form.confirm_pin) {
      setError('Please complete every field.')
      return
    }
    if (!/^\d{4}$/.test(form.new_pin)) {
      setError('New PIN must be exactly 4 digits.')
      return
    }
    if (form.new_pin !== form.confirm_pin) {
      setError('New PINs do not match.')
      return
    }
    setSaving(true)
    try {
      await changeStudentPin({ student_id: studentId, current_pin: form.current_pin, new_pin: form.new_pin, confirm_pin: form.confirm_pin })
      setDone(true)
      setTimeout(onClose, 1200)
    } catch (err) {
      setError(err.message || 'PIN could not be updated.')
      setSaving(false)
    }
  }

  const inputStyle = {
    minHeight: 44,
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '9px 14px',
    background: 'var(--surface-soft)',
    color: 'var(--text)',
    fontSize: '1.1rem',
    letterSpacing: '0.25em',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', padding: 18 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 22, display: 'grid', gap: 14, boxShadow: 'var(--shadow)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
            <Key size={18} weight="duotone" />
          </span>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Change PIN</h2>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--success)', fontWeight: 700 }}>PIN updated!</div>
        ) : (
          <>
            {[
              ['current_pin', 'Current PIN'],
              ['new_pin', 'New PIN'],
              ['confirm_pin', 'Confirm new PIN'],
            ].map(([key, label]) => (
              <label key={key} style={{ display: 'grid', gap: 6, fontSize: '0.83rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                {label}
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={form[key]}
                  onChange={(e) => setForm(f => ({ ...f, [key]: onlyDigits(e.target.value) }))}
                  style={inputStyle}
                  placeholder="••••"
                />
              </label>
            ))}
            {error && <div style={{ color: 'var(--danger)', fontSize: '0.84rem' }}>{error}</div>}
            <button type="submit" disabled={saving} style={{ minHeight: 44, borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.72 : 1, fontSize: '0.95rem' }}>
              {saving ? 'Updating…' : 'Update PIN'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}

const NAV_ITEMS = [
  { to: '', label: 'Home', Icon: House, end: true, key: 'home' },
  { to: 'courses', label: 'Courses', Icon: BookOpen, key: 'courses' },
  { to: 'assignments', label: 'Assignments', Icon: ListChecks, key: 'assignments' },
  { to: 'grades', label: 'Grades', Icon: ChartBar, key: 'grades' },
  { to: 'calendar', label: 'Calendar', Icon: CalendarDots, key: 'calendar' },
  { to: 'announcements', label: 'Updates', Icon: Megaphone, key: 'announcements' },
]

const EXTRA_ITEMS = [
  { suffix: '/session', label: 'AI Tutor', Icon: ChatsCircle },
  { suffix: '/translate-learn', label: 'Translate & Learn', Icon: BookOpen },
  { suffix: '/live-translator', label: 'Live Class', Icon: Radio },
]

export function avatarColor(name) {
  const palette = ['#4ca8d9', '#4fbc99', '#6fa8f3', '#4f9fce', '#7fb89f', '#82a3d4']
  let h = 0
  for (const c of name || '') h = c.charCodeAt(0) + ((h << 5) - h)
  return palette[Math.abs(h) % palette.length]
}

export function getInitials(name) {
  return (name || '?')
    .split(' ')
    .map((chunk) => chunk[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function NavButton({ to, end, Icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      title={label}
      style={({ isActive }) => ({
        display: 'grid',
        gridTemplateColumns: '66px 1fr',
        alignItems: 'center',
        gap: 12,
        textDecoration: 'none',
        borderRadius: 18,
        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
        background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
        color: 'var(--text)',
        padding: '10px 12px',
      })}
    >
      <span className="icon-only" style={{ borderColor: 'transparent', width: 52, height: 52, borderRadius: 14 }}>
        <Icon size={22} weight="duotone" />
      </span>
      <span style={{ fontWeight: 600, fontSize: '1rem', lineHeight: 1.2 }}>{label}</span>
    </NavLink>
  )
}

function Sidebar({ studentId, student, onNavigate }) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [pinOpen, setPinOpen] = useState(false)

  const primaryLinks = useMemo(
    () => NAV_ITEMS.map((item) => ({ ...item, route: item.end ? `/student/${studentId}` : `/student/${studentId}/${item.to}` })),
    [studentId]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 14, padding: 14 }}>
      <div className="surface-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="icon-only" aria-hidden>
          <Student size={22} weight="duotone" />
        </span>
        <div>
          <div style={{ fontWeight: 800, letterSpacing: '0.02em' }}>OptiLearn</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Accessible Education</div>
        </div>
      </div>

      <div className="surface-card" style={{ padding: 13, display: 'flex', gap: 12, alignItems: 'center' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: avatarColor(student?.name || ''),
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            fontSize: '1.2rem',
          }}
        >
          {getInitials(student?.name)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{student?.name || 'Student'}</div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Grade {student?.grade_level || '-'} - {student?.language?.toUpperCase() || '--'}</div>
        </div>
      </div>

      <div role="status" aria-live="polite">
        <NetworkStatusPill variant="inline" fullWidth dropdownAlign="left" />
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Student navigation">
        {primaryLinks.map(({ route, end, label, Icon, key }) => (
          <NavButton key={key} to={route} end={end} label={label} Icon={Icon} onClick={onNavigate} />
        ))}

        {EXTRA_ITEMS.map(({ suffix, label, Icon }) => (
          <NavButton key={suffix} to={`/student/${studentId}${suffix}`} label={label} Icon={Icon} onClick={onNavigate} />
        ))}
      </nav>

      <div style={{ marginTop: 'auto', display: 'grid', gap: 10 }}>
        <button type="button" onClick={toggleTheme} className="pill-button" aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={18} weight="duotone" /> : <Moon size={18} weight="duotone" />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <button type="button" className="pill-button" onClick={() => setPinOpen(true)}>
          <Key size={18} weight="duotone" />
          <span>Change PIN</span>
        </button>
        <button
          type="button"
          className="pill-button"
          onClick={() => {
            logout()
            navigate('/')
          }}
        >
          <SignOut size={18} weight="duotone" />
          <span>Sign Out</span>
        </button>
      </div>

      {pinOpen && <ChangePinModal studentId={studentId} onClose={() => setPinOpen(false)} />}
    </div>
  )
}

export default function StudentLayout() {
  const { studentId } = useParams()
  const [isMobile, setIsMobile] = useState(window.innerWidth < 980)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine)

  const { data: student } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => getStudent(studentId),
  })

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 980)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isMobile) setMenuOpen(false)
  }, [isMobile])

  useEffect(() => {
    let active = true
    const markOffline = () => active && setIsOffline(true)
    const checkConnection = async () => {
      if (!navigator.onLine) {
        markOffline()
        return
      }
      try {
        await getHealth()
        if (active) setIsOffline(false)
      } catch (_) {
        markOffline()
      }
    }
    window.addEventListener('offline', markOffline)
    window.addEventListener('online', checkConnection)
    checkConnection()
    const id = setInterval(checkConnection, 15000)
    return () => {
      active = false
      clearInterval(id)
      window.removeEventListener('offline', markOffline)
      window.removeEventListener('online', checkConnection)
    }
  }, [])

  return (
    <div className="app-shell" style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '296px 1fr',
      height: isMobile ? 'auto' : '100vh',
      overflow: isMobile ? 'visible' : 'hidden',
      paddingTop: isOffline ? 32 : 0,
      boxSizing: 'border-box',
    }}>
      {isOffline && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 32,
            background: '#fff8e1',
            color: '#f57f17',
            display: 'grid',
            placeItems: 'center',
            fontSize: '0.84rem',
            fontWeight: 700,
            zIndex: 2500,
            borderBottom: '1px solid #ffe0a3',
          }}
        >
          Connection lost - your work is saved
        </div>
      )}
      <a className="quick-exit" href="https://www.google.com" target="_blank" rel="noreferrer" title="Quick exit to a neutral page">
        <DoorOpen size={16} weight="bold" />
        <span>Quick Exit</span>
      </a>

      {!isMobile && (
        <aside className="student-sidebar-scroll" style={{
          borderRight: '1px solid var(--border)',
          height: isOffline ? 'calc(100vh - 32px)' : '100vh',
          minHeight: 0,
          overflowY: 'auto',
        }}>
          <Sidebar student={student} studentId={studentId} onNavigate={() => {}} />
        </aside>
      )}

      {isMobile && (
        <>
          <header
            className="surface-card"
            style={{
              margin: '16px 16px 0',
              padding: '14px',
              borderRadius: 16,
              position: 'sticky',
              top: 8,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <button className="icon-only" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <List size={20} weight="bold" />
            </button>
            <div style={{ fontWeight: 700, flex: 1 }}>Student Space</div>
            <span className="icon-only" aria-hidden>
              <Sparkle size={18} weight="duotone" />
            </span>
          </header>

          {menuOpen && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.55)', zIndex: 30 }}
              onClick={() => setMenuOpen(false)}
              aria-hidden
            />
          )}

          {menuOpen && (
            <aside
              className="student-sidebar-scroll"
              style={{
                position: 'fixed',
                zIndex: 40,
                inset: '0 auto 0 0',
                width: 274,
                height: isOffline ? 'calc(100vh - 32px)' : '100vh',
                background: 'var(--bg)',
                borderRight: '1px solid var(--border)',
                overflowY: 'auto',
              }}
            >
              <button className="icon-only" style={{ margin: 14 }} onClick={() => setMenuOpen(false)} aria-label="Close menu">
                <X size={20} weight="bold" />
              </button>
              <Sidebar student={student} studentId={studentId} onNavigate={() => setMenuOpen(false)} />
            </aside>
          )}
        </>
      )}

      <main style={{
        height: isMobile ? 'auto' : isOffline ? 'calc(100vh - 32px)' : '100vh',
        minHeight: isMobile ? '100vh' : 0,
        padding: isMobile ? '16px 14px 28px' : '24px 24px 34px',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: isMobile ? 'visible' : 'auto',
      }}>
        <Outlet context={{ student, studentId }} />
      </main>
    </div>
  )
}


