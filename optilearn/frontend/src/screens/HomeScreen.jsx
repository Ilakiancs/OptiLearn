import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  DoorOpen,
  Moon,
  Plus,
  Student,
  Sun,
  User,
  Users,
} from '@phosphor-icons/react'
import { createStudent, listStudents } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { avatarColor, getInitials } from '../components/StudentLayout'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'fr', label: 'French' },
  { code: 'sw', label: 'Swahili' },
  { code: 'so', label: 'Somali' },
  { code: 'am', label: 'Amharic' },
  { code: 'ti', label: 'Tigrinya' },
  { code: 'om', label: 'Oromo' },
  { code: 'ha', label: 'Hausa' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ig', label: 'Igbo' },
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'ln', label: 'Lingala' },
  { code: 'ps', label: 'Pashto' },
  { code: 'fa', label: 'Farsi' },
  { code: 'ur', label: 'Urdu' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'my', label: 'Burmese' },
  { code: 'km', label: 'Khmer' },
  { code: 'ne', label: 'Nepali' },
  { code: 'ta', label: 'Tamil' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ku', label: 'Kurdish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ru', label: 'Russian' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'de', label: 'German' },
  { code: 'zh', label: 'Chinese' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'tl', label: 'Filipino' },
]

const GRADES = Array.from({ length: 13 }, (_, i) => i + 1)

function ProfileCard({ student, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(student)}
      className="surface-card"
      style={{ padding: 14, textAlign: 'left', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: avatarColor(student.name),
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
          }}
        >
          {getInitials(student.name)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{student.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Grade {student.grade_level} • {student.language?.toUpperCase()}</div>
        </div>
      </div>
    </button>
  )
}

export default function HomeScreen() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', age: '', language: 'en', grade_level: '1' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: students = [], isLoading, refetch } = useQuery({ queryKey: ['students'], queryFn: listStudents })

  const selectStudent = (student) => {
    login(student.id)
    navigate(`/student/${student.id}`)
  }

  async function submit(e) {
    e.preventDefault()
    setError('')

    if (!form.name.trim()) {
      setError('Please add a name.')
      return
    }

    const ageValue = form.age ? Number(form.age) : null
    if (ageValue !== null && (Number.isNaN(ageValue) || ageValue < 3 || ageValue > 25)) {
      setError('Age must be between 3 and 25.')
      return
    }

    setSaving(true)
    try {
      const created = await createStudent({
        name: form.name.trim(),
        age: ageValue,
        language: form.language,
        grade_level: Number(form.grade_level),
      })
      await refetch()
      login(created.id)
      navigate(`/student/${created.id}`)
    } catch (err) {
      setError(err.message || 'Could not create profile.')
      setSaving(false)
    }
  }

  return (
    <div className="app-shell" style={{ padding: '14px 12px 24px' }}>
      <a className="quick-exit" href="https://www.google.com" target="_blank" rel="noreferrer" title="Quick exit to a neutral page">
        <DoorOpen size={16} weight="bold" />
        <span>Quick Exit</span>
      </a>

      <header className="surface-card" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="icon-only">
            <Student size={20} weight="duotone" />
          </span>
          <div>
            <div style={{ fontWeight: 800 }}>OptiLearn</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>Icon-guided learning</div>
          </div>
        </div>

        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="pill-button" onClick={toggleTheme}>
                {theme === 'dark' ? <Sun size={16} weight="duotone" /> : <Moon size={16} weight="duotone" />}
                <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>

            <button
                type="button"
                className="pill-button"
                disabled
                aria-disabled="true"
                title="Coming Soon"
                style={{ opacity: 0.58, cursor: 'not-allowed' }}
            >
                <User size={16} weight="duotone" />
                <span>Student Sign In (Coming Soon)</span>
            </button>

            <Link to="/teacher" className="pill-button">
                <ArrowSquareOut size={16} weight="duotone" />
                <span>Teacher</span>
            </Link>
        </div>
      </header>

      <main style={{ marginTop: 12, display: 'grid', gap: 12, maxWidth: 1000, marginInline: 'auto' }}>
        <section className="surface-card" style={{ padding: 16 }}>
          <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Choose profile by icon</h1>
          <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
            This interface is designed to stay predictable and calm. You can stop and return at any time.
          </p>
          <div className="tid-banner" style={{ marginTop: 10 }}>
            Why we ask details: language and grade help personalize materials; nothing else is required.
          </div>
        </section>

        <section className="surface-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <Users size={18} weight="duotone" />
              <span>Profiles</span>
            </div>
            <button type="button" className="pill-button" onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} weight="bold" />
              <span>{showForm ? 'Close form' : 'New profile'}</span>
            </button>
          </div>

          {isLoading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading profiles…</div>
          ) : students.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '8px 0' }}>No profiles yet. Add one to start.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {students.map((student) => (
                <ProfileCard key={student.id} student={student} onSelect={selectStudent} />
              ))}
            </div>
          )}
        </section>

        {showForm && (
          <section className="surface-card" style={{ padding: 16 }}>
            <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Name</span>
                <input
                  name="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '10px 12px', background: 'var(--surface)', color: 'var(--text)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Age (optional)</span>
                <input
                  name="age"
                  type="number"
                  min="3"
                  max="25"
                  value={form.age}
                  onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
                  style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '10px 12px', background: 'var(--surface)', color: 'var(--text)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Language</span>
                <select
                  name="language"
                  value={form.language}
                  onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                  style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '10px 12px', background: 'var(--surface)', color: 'var(--text)' }}
                >
                  {LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Grade level</span>
                <select
                  name="grade_level"
                  value={form.grade_level}
                  onChange={(e) => setForm((f) => ({ ...f, grade_level: e.target.value }))}
                  style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '10px 12px', background: 'var(--surface)', color: 'var(--text)' }}
                >
                  {GRADES.map((grade) => (
                    <option key={grade} value={grade}>{`Grade ${grade}`}</option>
                  ))}
                </select>
              </label>

              {error && <div style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{error}</div>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="pill-button primary" disabled={saving}>
                  <User size={16} weight="duotone" />
                  <span>{saving ? 'Creating…' : 'Create profile'}</span>
                </button>
                <button type="button" className="pill-button" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
    </div>
  )
}
