import { useOutletContext, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSubjects, getMaterialsBySubject, getStudentProgress } from '../api/client'
import { useState } from 'react'

const SUBJECT_ICONS = { mathematics:'📐', math:'📐', science:'🔬', english:'📖', literacy:'📖', reading:'📖', writing:'✏️', history:'🏛️', geography:'🌍', art:'🎨', music:'🎵', 'life skills':'🌱', health:'💊', ict:'💻', computer:'💻', default:'📚' }
function subjectIcon(s) {
  const k = (s || '').toLowerCase()
  for (const [w, icon] of Object.entries(SUBJECT_ICONS)) if (k.includes(w)) return icon
  return SUBJECT_ICONS.default
}

const COURSE_COLORS = [
  { bg: '#0d1f3c', border: '#3b82f6', text: '#93c5fd', accent: '#3b82f6' },
  { bg: '#0a2a18', border: '#22c55e', text: '#86efac', accent: '#22c55e' },
  { bg: '#21103a', border: '#a855f7', text: '#d8b4fe', accent: '#a855f7' },
  { bg: '#2a1600', border: '#f59e0b', text: '#fcd34d', accent: '#f59e0b' },
  { bg: '#061e2e', border: '#06b6d4', text: '#67e8f9', accent: '#06b6d4' },
  { bg: '#2a0a0a', border: '#ef4444', text: '#fca5a5', accent: '#ef4444' },
  { bg: '#111f0a', border: '#84cc16', text: '#bef264', accent: '#84cc16' },
  { bg: '#1a0a2a', border: '#ec4899', text: '#f9a8d4', accent: '#ec4899' },
]

function CourseCard({ subject, index, studentId, masteryData }) {
  const col = COURSE_COLORS[index % COURSE_COLORS.length]
  const [hovered, setHovered] = useState(false)
  const mastery = masteryData?.find(m => m.topic?.toLowerCase().includes(subject.toLowerCase()))
  const pct = mastery ? Math.round(mastery.mastery * 100) : null

  return (
    <Link to={`/student/${studentId}/course/${encodeURIComponent(subject)}`} style={{ textDecoration: 'none' }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: col.bg, border: `1px solid ${hovered ? col.accent : col.border + '66'}`,
          borderRadius: 'var(--radius-lg)', padding: '22px 18px',
          transition: 'all 0.15s', cursor: 'pointer',
          transform: hovered ? 'translateY(-3px)' : 'none',
          boxShadow: hovered ? `0 8px 24px ${col.accent}22` : 'none',
          minHeight: 160, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: '2rem', marginBottom: 10 }}>{subjectIcon(subject)}</div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: col.text, marginBottom: 4 }}>{subject}</div>
          <div style={{ fontSize: '0.75rem', color: col.text, opacity: 0.65 }}>
            View materials & quizzes
          </div>
        </div>
        <div>
          {pct !== null && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.72rem', color: col.text, opacity: 0.7 }}>Mastery</span>
                <span style={{ fontSize: '0.72rem', color: col.accent, fontWeight: 700 }}>{pct}%</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: col.accent, borderRadius: 2, transition: 'width 0.5s' }} />
              </div>
            </div>
          )}
          <div style={{
            marginTop: 12, padding: '7px 0', borderRadius: 'var(--radius-sm)',
            background: `${col.accent}22`, color: col.text,
            fontSize: '0.78rem', fontWeight: 600, textAlign: 'center',
          }}>
            Open Course →
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function CoursesPage() {
  const { student, studentId } = useOutletContext()

  const { data: subjects = [], isLoading } = useQuery({ queryKey: ['subjects'], queryFn: getSubjects })
  const { data: progress } = useQuery({ queryKey: ['student-progress', studentId], queryFn: () => getStudentProgress(studentId) })

  return (
    <div style={{ padding: '28px 24px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>📚 My Courses</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
          {subjects.length} subject{subjects.length !== 1 ? 's' : ''} available · Click a course to view materials and quizzes
        </p>
      </div>

      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ height: 160, borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: 0.4 }} />
          ))}
        </div>
      ) : subjects.length === 0 ? (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)', padding: '60px 24px', textAlign: 'center',
          color: 'var(--color-text-muted)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>📭</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>No courses yet</div>
          <div style={{ fontSize: '0.9rem' }}>Your teacher will upload materials soon.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
          {subjects.map((s, i) => (
            <CourseCard key={s} subject={s} index={i} studentId={studentId} masteryData={progress?.mastery_by_topic} />
          ))}
        </div>
      )}
    </div>
  )
}
