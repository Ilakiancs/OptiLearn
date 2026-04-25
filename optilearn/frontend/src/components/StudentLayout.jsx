import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarDots,
  ChatsCircle,
  ChartBar,
  DoorOpen,
  House,
  ListChecks,
  List,
  Megaphone,
  Moon,
  SignOut,
  Sparkle,
  Student,
  Sun,
  Trophy,
  X,
} from '@phosphor-icons/react'
import { getStudent } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

const NAV_ITEMS = [
  { to: '', label: 'Home', Icon: House, end: true, key: 'home' },
  { to: 'courses', label: 'Courses', Icon: BookOpen, key: 'courses' },
  { to: 'assignments', label: 'Assignments', Icon: ListChecks, key: 'assignments' },
  { to: 'grades', label: 'Grades', Icon: ChartBar, key: 'grades' },
  { to: 'calendar', label: 'Calendar', Icon: CalendarDots, key: 'calendar' },
  { to: 'announcements', label: 'Updates', Icon: Megaphone, key: 'announcements' },
]

const EXTRA_ITEMS = [
  { suffix: '/progress', label: 'Progress', Icon: Trophy },
  { suffix: '/session', label: 'AI Tutor', Icon: ChatsCircle },
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

  const primaryLinks = useMemo(
    () => NAV_ITEMS.map((item) => ({ ...item, route: item.end ? `/student/${studentId}` : `/student/${studentId}/${item.to}` })),
    [studentId]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 14, padding: 14 }}>
      <Link to="/" style={{ textDecoration: 'none' }}>
        <div className="surface-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="icon-only" aria-hidden>
            <Student size={22} weight="duotone" />
          </span>
          <div>
            <div style={{ fontWeight: 800, letterSpacing: '0.02em' }}>OptiLearn</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Visual learning mode</div>
          </div>
        </div>
      </Link>

        <div style={{ padding: '10px 16px 4px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-hint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 6 }}>
          Tools
        </div>
        <Link
          to={`/session/${studentId}`}
          onClick={onNav}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', margin: '1px 8px',
            borderRadius: 'var(--radius-md)', textDecoration: 'none',
            color: 'var(--color-text-muted)', fontSize: '0.88rem',
          }}
        >
          <span style={{ fontSize: '1rem', width: 22, textAlign: 'center', flexShrink: 0 }}>🤖</span>
          AI Tutor
        </Link>
        <NavLink
          to={`/student/${studentId}/translate-learn`}
          onClick={onNav}
          style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', margin: '1px 8px',
            borderRadius: 'var(--radius-md)', textDecoration: 'none',
            background: isActive ? 'var(--color-primary)' : 'transparent',
            color: isActive ? '#fff' : 'var(--color-text-muted)',
            fontWeight: isActive ? 600 : 400,
            fontSize: '0.88rem', transition: 'all 0.12s',
          })}
        >
          <span style={{ fontSize: '1rem', width: 22, textAlign: 'center', flexShrink: 0 }}>📖</span>
          Translate &amp; Learn
        </NavLink>
        <Link
          to={`/student/${studentId}/progress`}
          onClick={onNav}
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
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Grade {student?.grade_level || '-'} • {student?.language?.toUpperCase() || '--'}</div>
        </div>
      </div>

      <div className="tid-banner" role="status" aria-live="polite">
        Calm mode on. You can leave safely any time.
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Student navigation">
        {primaryLinks.map(({ route, end, label, Icon, key }) => (
          <NavButton key={key} to={route} end={end} label={label} Icon={Icon} onClick={onNavigate} />
        ))}

        {EXTRA_ITEMS.map(({ suffix, label, Icon }) => {
          const to = suffix === '/session' ? `/session/${studentId}` : `/student/${studentId}${suffix}`
          return <NavButton key={suffix} to={to} label={label} Icon={Icon} onClick={onNavigate} />
        })}
      </nav>

      <div style={{ marginTop: 'auto', display: 'grid', gap: 10 }}>
        <button type="button" onClick={toggleTheme} className="pill-button" aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={18} weight="duotone" /> : <Moon size={18} weight="duotone" />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
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
          <span>Switch profile</span>
        </button>
      </div>
    </div>
  )
}

export default function StudentLayout() {
  const { studentId } = useParams()
  const [isMobile, setIsMobile] = useState(window.innerWidth < 980)
  const [menuOpen, setMenuOpen] = useState(false)

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

  return (
    <div className="app-shell" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '296px 1fr' }}>
      <a className="quick-exit" href="https://www.google.com" target="_blank" rel="noreferrer" title="Quick exit to a neutral page">
        <DoorOpen size={16} weight="bold" />
        <span>Quick Exit</span>
      </a>

      {!isMobile && (
        <aside style={{ borderRight: '1px solid var(--border)', minHeight: '100vh', position: 'sticky', top: 0 }}>
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
              style={{
                position: 'fixed',
                zIndex: 40,
                inset: '0 auto 0 0',
                width: 274,
                background: 'var(--bg)',
                borderRight: '1px solid var(--border)',
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

      <main style={{ minHeight: '100vh', padding: isMobile ? '16px 14px 28px' : '24px 24px 34px', overflowX: 'hidden' }}>
        <Outlet context={{ student, studentId }} />
      </main>
    </div>
  )
}
