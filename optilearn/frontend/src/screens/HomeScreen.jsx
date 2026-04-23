import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listStudents, createStudent } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { avatarColor, getInitials } from '../components/StudentLayout'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic — عربي' },
  { code: 'fr', label: 'French — Français' },
  { code: 'sw', label: 'Swahili — Kiswahili' },
  { code: 'so', label: 'Somali — Soomaali' },
  { code: 'am', label: 'Amharic — አማርኛ' },
  { code: 'ti', label: 'Tigrinya — ትግርኛ' },
  { code: 'om', label: 'Oromo — Afaan Oromoo' },
  { code: 'ha', label: 'Hausa' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ig', label: 'Igbo' },
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'ln', label: 'Lingala' },
  { code: 'ps', label: 'Pashto — پښتو' },
  { code: 'fa', label: 'Farsi / Persian — فارسی' },
  { code: 'ur', label: 'Urdu — اردو' },
  { code: 'hi', label: 'Hindi — हिन्दी' },
  { code: 'bn', label: 'Bengali — বাংলা' },
  { code: 'my', label: 'Burmese — မြန်မာ' },
  { code: 'km', label: 'Khmer — ខ្មែរ' },
  { code: 'ne', label: 'Nepali — नेपाली' },
  { code: 'ta', label: 'Tamil — தமிழ்' },
  { code: 'tr', label: 'Turkish — Türkçe' },
  { code: 'ku', label: 'Kurdish — Kurdî' },
  { code: 'uk', label: 'Ukrainian — Українська' },
  { code: 'ru', label: 'Russian — Русский' },
  { code: 'es', label: 'Spanish — Español' },
  { code: 'pt', label: 'Portuguese — Português' },
  { code: 'de', label: 'German — Deutsch' },
  { code: 'zh', label: 'Chinese — 中文' },
  { code: 'vi', label: 'Vietnamese — Tiếng Việt' },
  { code: 'tl', label: 'Filipino / Tagalog' },
]

const GRADES = Array.from({ length: 13 }, (_, i) => i + 1)

function StudentCard({ student, onSelect }) {
  const [hovered, setHovered] = useState(false)
  const bg = avatarColor(student.name)
  return (
    <div
      onClick={() => onSelect(student)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${hovered ? bg : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '24px 16px',
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'all 0.15s',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered ? `0 8px 24px ${bg}22` : 'none',
      }}
    >
      <div style={{
        width: 60, height: 60, borderRadius: '50%', background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.4rem', fontWeight: 800, color: '#fff',
        margin: '0 auto 12px', border: `3px solid ${bg}66`,
      }}>
        {getInitials(student.name)}
      </div>
      <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>{student.name}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: 14 }}>
        Grade {student.grade_level} · {student.language?.toUpperCase()}
      </div>
      <div style={{
        padding: '7px 0', borderRadius: 'var(--radius-md)',
        background: hovered ? bg : 'var(--color-surface-2)',
        color: hovered ? '#fff' : 'var(--color-text-muted)',
        fontSize: '0.82rem', fontWeight: 600, transition: 'all 0.15s',
      }}>
        {hovered ? '▶  Go to Dashboard' : '● Select'}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 24, opacity: 0.4 }}>
      <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--color-surface-2)', margin: '0 auto 12px' }} />
      <div style={{ height: 14, background: 'var(--color-surface-2)', borderRadius: 4, width: '60%', margin: '0 auto 8px' }} />
      <div style={{ height: 11, background: 'var(--color-surface-2)', borderRadius: 4, width: '40%', margin: '0 auto' }} />
    </div>
  )
}

export default function HomeScreen() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', age: '', language: 'en', grade_level: '1' })
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: students = [], isLoading, error, refetch } = useQuery({
    queryKey: ['students'],
    queryFn: listStudents,
  })

  function handleSelect(student) {
    login(student.id)
    navigate(`/student/${student.id}`)
  }

  function handleFormChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleFormSubmit(e) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) { setFormError('Name is required.'); return }
    const age = form.age ? parseInt(form.age) : null
    if (age !== null && (isNaN(age) || age < 3 || age > 25)) { setFormError('Age must be 3–25.'); return }
    setSubmitting(true)
    try {
      const s = await createStudent({
        name: form.name.trim(), age,
        language: form.language,
        grade_level: parseInt(form.grade_level),
      })
      await refetch()
      login(s.id)
      navigate(`/student/${s.id}`)
    } catch (err) {
      setFormError(err.message)
      setSubmitting(false)
    }
  }

  const input = {
    width: '100%', padding: '11px 14px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
    color: 'var(--color-text)', fontSize: '0.95rem', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <header style={{
        padding: '14px 24px', borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.5rem' }}>🎓</span>
          <span style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--color-primary)', letterSpacing: '-0.3px' }}>OptiLearn</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Auth placeholder */}
          <div style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)', color: 'var(--color-text-hint)',
            fontSize: '0.82rem', cursor: 'not-allowed',
          }} title="Authentication coming soon">
            🔐 Sign In <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>(soon)</span>
          </div>
          <Link to="/teacher" style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.85rem',
          }}>
            🏫 Teacher Portal
          </Link>
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 900, margin: '0 auto', padding: '40px 20px', width: '100%' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: '2.8rem', marginBottom: 10 }}>👋</div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: 8, color: 'var(--color-text)' }}>
            Welcome to OptiLearn
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '1rem', maxWidth: 400, margin: '0 auto' }}>
            Adaptive learning for every child. Select your profile to continue.
          </p>
        </div>

        {/* Student profiles */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Student Profiles
            </h2>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                style={{
                  padding: '7px 16px', borderRadius: 'var(--radius-md)',
                  background: 'var(--color-primary)', color: '#fff',
                  border: 'none', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                + New Student
              </button>
            )}
          </div>

          {error && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>Could not load profiles: {error.message}</p>}

          {!showForm && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                : students.map(s => <StudentCard key={s.id} student={s} onSelect={handleSelect} />)
              }
              {!isLoading && students.length === 0 && (
                <div style={{ gridColumn: '1/-1', padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 10 }}>🧑‍🎓</div>
                  No students yet. Add the first one!
                </div>
              )}
            </div>
          )}

          {/* Add student form */}
          {showForm && (
            <div style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', padding: '28px 24px', maxWidth: 460,
            }}>
              <h3 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 20 }}>🧑‍🎓 Register New Student</h3>
              <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 5 }}>Full Name *</label>
                  <input name="name" value={form.name} onChange={handleFormChange} placeholder="Student's full name" required style={input} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 5 }}>Age</label>
                  <input name="age" type="number" min="3" max="25" value={form.age} onChange={handleFormChange} placeholder="Optional" style={input} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 5 }}>Language *</label>
                  <select name="language" value={form.language} onChange={handleFormChange} style={{ ...input, cursor: 'pointer' }}>
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 5 }}>Grade Level *</label>
                  <select name="grade_level" value={form.grade_level} onChange={handleFormChange} style={{ ...input, cursor: 'pointer' }}>
                    {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                </div>
                {formError && <p style={{ color: 'var(--color-danger)', fontSize: '0.88rem', margin: 0 }}>{formError}</p>}
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button type="submit" disabled={submitting} style={{
                    flex: 1, padding: '11px', background: submitting ? 'var(--color-primary-dim)' : 'var(--color-primary)',
                    color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
                    fontSize: '0.95rem', fontWeight: 600, cursor: submitting ? 'default' : 'pointer',
                  }}>
                    {submitting ? 'Creating…' : '✓ Create Profile'}
                  </button>
                  <button type="button" onClick={() => { setShowForm(false); setFormError('') }} style={{
                    padding: '11px 18px', background: 'transparent', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-muted)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', textAlign: 'center', color: 'var(--color-text-hint)', fontSize: '0.78rem' }}>
        OptiLearn · Adaptive Learning for Refugee Classrooms · Gemma 4 Good 2026
      </footer>
    </div>
  )
}
