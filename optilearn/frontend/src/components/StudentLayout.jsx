import { NavLink, Outlet, useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getStudent } from '../api/client'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '', label: 'Home', icon: '🏠', end: true },
  { to: 'courses', label: 'My Courses', icon: '📚' },
  { to: 'assignments', label: 'Assignments', icon: '📝' },
  { to: 'grades', label: 'Grades', icon: '📊' },
  { to: 'calendar', label: 'Calendar', icon: '📅' },
  { to: 'announcements', label: 'Announcements', icon: '📢' },
]

export function avatarColor(name) {
  const palette = ['#6c63ff','#e85d75','#f59e0b','#22c55e','#06b6d4','#8b5cf6','#ec4899','#14b8a6']
  let h = 0
  for (const c of (name || '')) h = c.charCodeAt(0) + ((h << 5) - h)
  return palette[Math.abs(h) % palette.length]
}

export function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function SidebarContent({ student, studentId, onNav }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const base = `/student/${studentId}`

  function handleLogout() {
    logout()
    navigate('/')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Brand */}
      <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--color-border)' }}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.4rem' }}>🎓</span>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--color-primary)', letterSpacing: '-0.3px' }}>
            OptiLearn
          </span>
        </Link>
      </div>

      {/* Student profile chip */}
      {student && (
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: avatarColor(student.name),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.88rem', color: '#fff', flexShrink: 0,
          }}>
            {getInitials(student.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {student.name}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
              Grade {student.grade_level} · {student.language?.toUpperCase()}
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        <div style={{ padding: '6px 16px 4px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-hint)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Learning
        </div>
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.end ? base : `${base}/${item.to}`}
            end={item.end}
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
            <span style={{ fontSize: '1rem', width: 22, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}

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
        <Link
          to={`/student/${studentId}/progress`}
          onClick={onNav}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', margin: '1px 8px',
            borderRadius: 'var(--radius-md)', textDecoration: 'none',
            color: 'var(--color-text-muted)', fontSize: '0.88rem',
          }}
        >
          <span style={{ fontSize: '1rem', width: 22, textAlign: 'center', flexShrink: 0 }}>🏅</span>
          My Progress
        </Link>
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 8px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '8px 12px', background: 'none', border: 'none',
            color: 'var(--color-text-hint)', cursor: 'pointer',
            fontSize: '0.82rem', borderRadius: 'var(--radius-md)', textAlign: 'left',
          }}
        >
          <span>🚪</span> Switch profile
        </button>
      </div>
    </div>
  )
}

export default function StudentLayout() {
  const { studentId } = useParams()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  const { data: student } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => getStudent(studentId),
  })

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  const SIDEBAR_W = 220

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>

      {/* Desktop sidebar */}
      {!isMobile && (
        <aside style={{
          width: SIDEBAR_W, flexShrink: 0, background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 20, overflowY: 'auto',
        }}>
          <SidebarContent student={student} studentId={studentId} onNav={() => {}} />
        </aside>
      )}

      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 30 }} />
          <aside style={{
            width: 240, position: 'fixed', left: 0, top: 0, bottom: 0,
            background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)',
            zIndex: 40, overflowY: 'auto',
          }}>
            <SidebarContent student={student} studentId={studentId} onNav={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      {/* Main */}
      <div style={{ flex: 1, marginLeft: isMobile ? 0 : SIDEBAR_W, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {isMobile && (
          <header style={{
            padding: '12px 16px', background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center', gap: 12,
            position: 'sticky', top: 0, zIndex: 10,
          }}>
            <button onClick={() => setMobileOpen(true)} style={{ background: 'none', border: 'none', color: 'var(--color-text)', fontSize: '1.3rem', cursor: 'pointer', padding: '4px 8px' }}>
              ☰
            </button>
            <span style={{ fontWeight: 800, color: 'var(--color-primary)', fontSize: '1rem' }}>🎓 OptiLearn</span>
            {student && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(student.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
                  {getInitials(student.name)}
                </div>
              </div>
            )}
          </header>
        )}
        <Outlet context={{ student, studentId }} />
      </div>
    </div>
  )
}
