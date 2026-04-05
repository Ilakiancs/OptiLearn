import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listStudents, createStudent, startSession } from '../api/client'
import StudentCard from '../components/StudentCard'

const SKELETON_COUNT = 4

function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 18px',
      minHeight: '120px',
      opacity: 0.5,
    }}>
      <div style={{ height: '18px', background: 'var(--color-surface-2)', borderRadius: 4, width: '60%', marginBottom: 12 }} />
      <div style={{ height: '14px', background: 'var(--color-surface-2)', borderRadius: 4, width: '35%', marginBottom: 8 }} />
      <div style={{ height: '12px', background: 'var(--color-surface-2)', borderRadius: 4, width: '50%' }} />
    </div>
  )
}

export default function HomeScreen() {
  const navigate = useNavigate()
  const [loadingId, setLoadingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', age: '', language: '', grade_level: '' })
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: students, isLoading, error, refetch } = useQuery({
    queryKey: ['students'],
    queryFn: listStudents,
  })

  async function handleSelectStudent(student) {
    setLoadingId(student.id)
    try {
      await startSession(student.id)
      navigate(`/session/${student.id}`)
    } catch (e) {
      setLoadingId(null)
    }
  }

  function handleFormChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleFormSubmit(e) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) { setFormError('Name is required.'); return }
    const age = parseInt(form.age)
    const grade = parseInt(form.grade_level)
    if (isNaN(age) || age < 5 || age > 18) { setFormError('Age must be between 5 and 18.'); return }
    if (isNaN(grade) || grade < 1 || grade > 8) { setFormError('Grade level must be 1–8.'); return }
    if (!form.language.trim()) { setFormError('Language code is required.'); return }

    setSubmitting(true)
    try {
      const student = await createStudent({
        name: form.name.trim(),
        age,
        language: form.language.trim().toLowerCase(),
        grade_level: grade,
      })
      await refetch()
      navigate(`/session/${student.id}`)
    } catch (err) {
      setFormError(err.message)
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: '1rem',
    minHeight: '44px',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <header style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--color-surface)',
      }}>
        <span style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-primary)' }}>
          PolyTutor
        </span>
        <Link to="/teacher" style={{
          color: 'var(--color-text-muted)',
          textDecoration: 'none',
          fontSize: '0.9rem',
          padding: '8px 12px',
          minHeight: '44px',
          display: 'inline-flex',
          alignItems: 'center',
        }}>
          Teacher view →
        </Link>
      </header>

      <main style={{ maxWidth: '800px', margin: '0 auto', padding: '24px 16px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '24px', color: 'var(--color-text)' }}>
          Who's learning today?
        </h1>

        {/* Student grid */}
        {error && (
          <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>
            Could not load students: {error.message}
          </p>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '28px',
        }}>
          {isLoading
            ? Array.from({ length: SKELETON_COUNT }).map((_, i) => <SkeletonCard key={i} />)
            : (students || []).map(s => (
                <StudentCard
                  key={s.id}
                  student={s}
                  onSelect={handleSelectStudent}
                  isLoading={loadingId === s.id}
                />
              ))
          }
        </div>

        {/* Add student toggle */}
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{
              padding: '12px 24px',
              minHeight: '44px',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add new student
          </button>
        )}

        {/* Inline add form */}
        {showForm && (
          <form
            onSubmit={handleFormSubmit}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              maxWidth: '480px',
            }}
          >
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>New student</h2>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                Name *
              </label>
              <input
                name="name"
                type="text"
                value={form.name}
                onChange={handleFormChange}
                placeholder="Full name"
                required
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                Age *
              </label>
              <input
                name="age"
                type="number"
                min="5" max="18"
                value={form.age}
                onChange={handleFormChange}
                placeholder="5–18"
                required
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                Language code *
              </label>
              <input
                name="language"
                type="text"
                value={form.language}
                onChange={handleFormChange}
                placeholder="en, ar, ti, so, fr..."
                required
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                Grade level *
              </label>
              <input
                name="grade_level"
                type="number"
                min="1" max="8"
                value={form.grade_level}
                onChange={handleFormChange}
                placeholder="1–8"
                required
                style={inputStyle}
              />
            </div>

            {formError && (
              <p style={{ color: 'var(--color-danger)', fontSize: '0.9rem', margin: 0 }}>{formError}</p>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: '12px',
                  minHeight: '44px',
                  background: submitting ? 'var(--color-primary-dim)' : 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: submitting ? 'default' : 'pointer',
                }}
              >
                {submitting ? 'Starting...' : 'Start learning'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError('') }}
                style={{
                  padding: '12px 20px',
                  minHeight: '44px',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '1rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
