import { useOutletContext, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSubjects, getStudentProgress, listTeacherQuizzes } from '../api/client'
import { avatarColor } from '../components/StudentLayout'

function StatCard({ icon, label, value, color }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)', padding: '18px 16px', flex: 1, minWidth: 110,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <span style={{ fontSize: '1.5rem' }}>{icon}</span>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: color || 'var(--color-primary)' }}>{value}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
}

function relativeTime(iso) {
  if (!iso) return 'Never'
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return 'Just now'
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago'
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago'
  return Math.floor(d / 86400000) + 'd ago'
}

const SUBJECT_ICONS = { mathematics:'📐', math:'📐', science:'🔬', english:'📖', literacy:'📖', reading:'📖', writing:'✏️', history:'🏛️', geography:'🌍', art:'🎨', music:'🎵', 'life skills':'🌱', health:'💊', ict:'💻', computer:'💻', default:'📚' }
function subjectIcon(s) {
  const k = (s || '').toLowerCase()
  for (const [w, icon] of Object.entries(SUBJECT_ICONS)) if (k.includes(w)) return icon
  return SUBJECT_ICONS.default
}

const COURSE_COLORS = [
  { bg: '#1e3a5f', accent: '#3b82f6' }, { bg: '#1a3320', accent: '#22c55e' },
  { bg: '#3b1f2b', accent: '#a855f7' }, { bg: '#3a2000', accent: '#f59e0b' },
  { bg: '#1f2d3b', accent: '#06b6d4' }, { bg: '#2d1a1a', accent: '#ef4444' },
]

export default function StudentHome() {
  const { student, studentId } = useOutletContext()

  const { data: subjects = [], isLoading: subLoading } = useQuery({ queryKey: ['subjects'], queryFn: getSubjects })
  const { data: progress } = useQuery({ queryKey: ['student-progress', studentId], queryFn: () => getStudentProgress(studentId) })
  const { data: quizzes = [] } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes })

  const masteryAvg = progress?.mastery_by_topic?.length
    ? Math.round(progress.mastery_by_topic.reduce((a, m) => a + m.mastery, 0) / progress.mastery_by_topic.length * 100)
    : null

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div style={{ padding: '28px 24px', maxWidth: 900, margin: '0 auto' }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>

      {/* Welcome */}
      <div style={{
        background: `linear-gradient(135deg, var(--color-surface) 0%, #1e1a3a 100%)`,
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
        padding: '24px 24px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
        animation: 'fadeIn 0.3s ease',
      }}>
        {student && (
          <div style={{
            width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
            background: avatarColor(student.name),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.3rem', fontWeight: 800, color: '#fff',
          }}>
            {student.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 2 }}>{greeting} 👋</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{student?.name || '…'}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            Grade {student?.grade_level} · Last active {relativeTime(student?.last_active)}
          </div>
        </div>
        <Link to={`/session/${studentId}`} style={{
          padding: '10px 20px', background: 'var(--color-primary)', color: '#fff',
          borderRadius: 'var(--radius-md)', textDecoration: 'none',
          fontWeight: 600, fontSize: '0.9rem', flexShrink: 0,
        }}>
          🤖 Open AI Tutor
        </Link>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        <StatCard icon="📚" label="Courses" value={subLoading ? '…' : subjects.length} color="var(--color-primary)" />
        <StatCard icon="📝" label="Assignments" value={quizzes.length} color="#f59e0b" />
        <StatCard icon="📊" label="Avg Mastery" value={masteryAvg !== null ? `${masteryAvg}%` : '—'} color="var(--color-success)" />
        <StatCard icon="🏅" label="Level" value={progress?.level ? progress.level.charAt(0).toUpperCase() + progress.level.slice(1) : '—'} color="#a855f7" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>

        {/* My Courses preview */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px', gridColumn: subjects.length === 0 ? '1/-1' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>📚 My Courses</span>
            <Link to={`/student/${studentId}/courses`} style={{ fontSize: '0.78rem', color: 'var(--color-primary)', textDecoration: 'none' }}>See all →</Link>
          </div>
          {subLoading ? (
            <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem' }}>Loading…</div>
          ) : subjects.length === 0 ? (
            <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem', padding: '8px 0' }}>
              📭 No courses yet. Your teacher will add materials soon.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {subjects.slice(0, 4).map((s, i) => {
                const col = COURSE_COLORS[i % COURSE_COLORS.length]
                const mastery = progress?.mastery_by_topic?.find(m => m.topic?.toLowerCase().includes(s.toLowerCase()))
                return (
                  <Link key={s} to={`/student/${studentId}/course/${encodeURIComponent(s)}`} style={{ textDecoration: 'none' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      background: col.bg, borderRadius: 'var(--radius-md)',
                      border: `1px solid ${col.accent}44`,
                    }}>
                      <span style={{ fontSize: '1.1rem' }}>{subjectIcon(s)}</span>
                      <span style={{ flex: 1, fontWeight: 600, fontSize: '0.88rem', color: 'var(--color-text)' }}>{s}</span>
                      {mastery && (
                        <span style={{ fontSize: '0.75rem', color: col.accent, fontWeight: 700 }}>
                          {Math.round(mastery.mastery * 100)}%
                        </span>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-hint)' }}>→</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Upcoming assignments */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>📝 Assignments</span>
            <Link to={`/student/${studentId}/assignments`} style={{ fontSize: '0.78rem', color: 'var(--color-primary)', textDecoration: 'none' }}>See all →</Link>
          </div>
          {quizzes.length === 0 ? (
            <div style={{ color: 'var(--color-text-hint)', fontSize: '0.85rem', padding: '8px 0' }}>
              ✅ No assignments yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {quizzes.slice(0, 4).map(q => (
                <div key={q.id} style={{
                  padding: '10px 12px', background: 'var(--color-surface-2)',
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 2 }}>{q.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {q.subject || 'General'} · {q.question_count} question{q.question_count !== 1 ? 's' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent quiz activity */}
      {progress?.recent_quizzes?.length > 0 && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 14 }}>⚡ Recent Activity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {progress.recent_quizzes.slice(0, 5).map((q, i) => {
              const pct = Math.round((q.score || 0) * 100)
              const color = pct >= 75 ? 'var(--color-success)' : pct >= 40 ? '#f59e0b' : 'var(--color-danger)'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < 4 ? '1px solid var(--color-border)' : 'none' }}>
                  <span style={{ fontSize: '1rem' }}>📊</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.topic}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--color-text-hint)' }}>{relativeTime(q.timestamp)}</div>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color }}>{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginTop: 24 }}>
        {[
          { icon: '🤖', label: 'AI Tutor', desc: 'Ask anything', to: `/session/${studentId}`, color: '#6c63ff' },
          { icon: '📚', label: 'Browse Courses', desc: 'All subjects', to: `/student/${studentId}/courses`, color: '#22c55e' },
          { icon: '📊', label: 'View Grades', desc: 'Your progress', to: `/student/${studentId}/grades`, color: '#f59e0b' },
          { icon: '📅', label: 'Calendar', desc: 'Upcoming', to: `/student/${studentId}/calendar`, color: '#06b6d4' },
        ].map(a => (
          <Link key={a.label} to={a.to} style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', padding: '16px',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'border-color 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = a.color}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
            >
              <span style={{ fontSize: '1.5rem' }}>{a.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{a.label}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>{a.desc}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
