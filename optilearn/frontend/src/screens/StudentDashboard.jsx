import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getStudent, getSubjects, startSession } from '../api/client'
import { useState } from 'react'
import { BookOpenText, ChatsCircle, FileText, Sparkle } from '@phosphor-icons/react'

function subjectIcon() {
  return <BookOpenText size={30} weight="duotone" />
}

function subjectColor(index) {
  const colors = [
    { bg: '#1e3a5f', border: '#2563eb', text: '#93c5fd' },
    { bg: '#1a3320', border: '#16a34a', text: '#86efac' },
    { bg: '#3b1f2b', border: '#9333ea', text: '#d8b4fe' },
    { bg: '#0f2f41', border: '#0ea5e9', text: '#7dd3fc' },
    { bg: '#1f2d3b', border: '#0891b2', text: '#67e8f9' },
    { bg: '#152c35', border: '#2a8dbf', text: '#9fd6f2' },
    { bg: '#1e2d2a', border: '#2c9b7d', text: '#96dcc8' },
    { bg: '#2d1e2d', border: '#c026d3', text: '#f0abfc' },
  ]
  return colors[index % colors.length]
}

export default function StudentDashboard() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const [startingChat, setStartingChat] = useState(false)

  const { data: student, isLoading: loadingStudent } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => getStudent(studentId),
  })

  const { data: subjects = [], isLoading: loadingSubjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: getSubjects,
  })

  async function handleStartChat() {
    setStartingChat(true)
    try {
      await startSession(studentId)
    } catch (_) {}
    navigate(`/session/${studentId}`)
  }

  const isLoading = loadingStudent || loadingSubjects

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Header */}
      <header style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <Link to="/" style={{
          color: 'var(--color-text-muted)', textDecoration: 'none',
          fontSize: '0.9rem', minHeight: 44, display: 'inline-flex', alignItems: 'center', paddingRight: 12,
        }}>
          ← Back
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
            {loadingStudent ? '...' : student?.name}
          </div>
          {student && (
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              Grade {student.grade_level} · {student.language?.toUpperCase()}
            </div>
          )}
        </div>
        <button
          onClick={handleStartChat}
          disabled={startingChat}
          style={{
            padding: '8px 20px', minHeight: 44,
            background: 'var(--color-primary)', border: 'none',
            borderRadius: 'var(--radius-md)', color: '#fff',
            fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {startingChat ? 'Loading…' : 'AI Tutor'}
        </button>
      </header>

      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 16px' }}>

        {/* Welcome banner */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 20px',
          marginBottom: '32px',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Sparkle size={34} weight="duotone" /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: 4 }}>
              Welcome back{student?.name ? `, ${student.name.split(' ')[0]}` : ''}!
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              Choose a subject below to view materials and quizzes, or use the AI Tutor for personalised help.
            </div>
          </div>
        </div>

        {/* Subjects section */}
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', marginTop: 0 }}>
          My Subjects
        </h2>

        {isLoading ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '16px',
          }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{
                height: 130, borderRadius: 'var(--radius-lg)',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                opacity: 0.5,
              }} />
            ))}
          </div>
        ) : subjects.length === 0 ? (
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
          }}>
            <div style={{ marginBottom: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={30} /></div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>No subjects yet</div>
            <div style={{ fontSize: '0.9rem' }}>
              Your teacher hasn't uploaded any materials yet. Try the AI Tutor while you wait!
            </div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '32px',
          }}>
            {subjects.map((subject, i) => {
              const col = subjectColor(i)
              return (
                <Link
                  key={subject}
                  to={`/dashboard/${studentId}/subject/${encodeURIComponent(subject)}`}
                  style={{ textDecoration: 'none' }}
                >
                  <div style={{
                    background: col.bg,
                    border: `1px solid ${col.border}`,
                    borderRadius: 'var(--radius-lg)',
                    padding: '24px 20px',
                    cursor: 'pointer',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    minHeight: 120,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-3px)'
                      e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.3)`
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = ''
                      e.currentTarget.style.boxShadow = ''
                    }}
                  >
                    <div style={{ marginBottom: 8 }}>{subjectIcon(subject)}</div>
                    <div>
                      <div style={{ fontWeight: 700, color: col.text, fontSize: '1rem' }}>{subject}</div>
                      <div style={{ fontSize: '0.78rem', color: col.text, opacity: 0.7, marginTop: 2 }}>
                        View materials & quizzes →
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* AI Tutor card */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 8 }}><ChatsCircle size={18} weight="duotone" />AI Tutor</div>
            <div style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
              Get personalised explanations, ask any question, and practice with adaptive quizzes.
            </div>
          </div>
          <button
            onClick={handleStartChat}
            disabled={startingChat}
            style={{
              padding: '10px 24px', minHeight: 44,
              background: 'var(--color-primary)', border: 'none',
              borderRadius: 'var(--radius-md)', color: '#fff',
              fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Start Chatting
          </button>
        </div>

      </main>
    </div>
  )
}
