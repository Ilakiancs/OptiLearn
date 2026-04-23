import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listTeacherQuizzes, listMaterials } from '../api/client'

function timeLabel(iso) {
  if (!iso) return ''
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return 'Just now'
  if (d < 3600000) return Math.floor(d / 60000) + ' min ago'
  if (d < 86400000) return Math.floor(d / 3600000) + ' hr ago'
  if (d < 7 * 86400000) return Math.floor(d / 86400000) + ' days ago'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function isNew(iso) {
  return iso && Date.now() - new Date(iso).getTime() < 3 * 86400000
}

function AnnouncementCard({ icon, type, typeColor, title, body, timestamp, badge }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: `1px solid ${isNew(timestamp) ? typeColor + '44' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-lg)', padding: '18px 20px',
      borderLeft: `4px solid ${typeColor}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 'var(--radius-md)', flexShrink: 0,
          background: typeColor + '22',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem',
        }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{
              fontSize: '0.68rem', padding: '2px 8px', borderRadius: 99,
              background: typeColor + '22', color: typeColor, fontWeight: 700,
            }}>{type}</span>
            {isNew(timestamp) && (
              <span style={{
                fontSize: '0.65rem', padding: '2px 8px', borderRadius: 99,
                background: '#22c55e22', color: '#22c55e', fontWeight: 700,
              }}>NEW</span>
            )}
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-hint)', marginLeft: 'auto' }}>{timeLabel(timestamp)}</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: 4 }}>{title}</div>
          {body && <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{body}</div>}
        </div>
      </div>
    </div>
  )
}

export default function AnnouncementsPage() {
  const { studentId } = useOutletContext()
  const { data: quizzes = [], isLoading: qLoading } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes })
  const { data: materials = [], isLoading: mLoading } = useQuery({ queryKey: ['materials'], queryFn: listMaterials })

  const isLoading = qLoading || mLoading

  const announcements = [
    ...quizzes.map(q => ({
      icon: '📝',
      type: 'New Assignment',
      typeColor: '#f59e0b',
      title: `New quiz: ${q.title}`,
      body: `${q.subject ? `Subject: ${q.subject} · ` : ''}${q.question_count} question${q.question_count !== 1 ? 's' : ''} assigned to you.`,
      timestamp: q.created_at,
    })),
    ...materials.map(m => ({
      icon: '📄',
      type: 'New Material',
      typeColor: '#6c63ff',
      title: `New material: ${m.title}`,
      body: m.subject ? `Posted under ${m.subject}.` : 'New learning resource available.',
      timestamp: m.created_at,
    })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

  const newCount = announcements.filter(a => isNew(a.timestamp)).length

  return (
    <div style={{ padding: '28px 24px', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>
          📢 Announcements
          {newCount > 0 && (
            <span style={{
              marginLeft: 10, fontSize: '0.75rem', padding: '3px 10px', borderRadius: 99,
              background: '#22c55e22', color: '#22c55e', fontWeight: 700, verticalAlign: 'middle',
            }}>{newCount} new</span>
          )}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
          Latest updates from your teacher
        </p>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ height: 90, borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: 0.4 }} />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)', padding: '60px 24px', textAlign: 'center',
          color: 'var(--color-text-muted)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>📭</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>No announcements yet</div>
          <div style={{ fontSize: '0.9rem' }}>Your teacher will post updates here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {announcements.map((a, i) => (
            <AnnouncementCard key={i} {...a} />
          ))}
        </div>
      )}
    </div>
  )
}
