import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listTeacherQuizzes, listMaterials } from '../api/client'
import { useState } from 'react'

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysAgo(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function EventItem({ icon, title, subtitle, tag, tagColor, date }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0',
      borderBottom: '1px solid var(--color-border)',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 'var(--radius-md)', flexShrink: 0,
        background: (tagColor || '#6c63ff') + '22',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {subtitle && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        {tag && (
          <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: 99, background: (tagColor || '#6c63ff') + '22', color: tagColor || '#6c63ff', fontWeight: 700 }}>
            {tag}
          </span>
        )}
        {date && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-hint)' }}>{date}</span>}
      </div>
    </div>
  )
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function MiniCalendar() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) => i < firstDay ? null : i - firstDay + 1)

  function prev() { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
  function next() { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <button onClick={prev} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '4px 8px' }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{MONTHS[month]} {year}</span>
        <button onClick={next} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '4px 8px' }}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
        {DAYS.map(d => (
          <div key={d} style={{ fontSize: '0.65rem', color: 'var(--color-text-hint)', fontWeight: 700, padding: '4px 0', textTransform: 'uppercase' }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          return (
            <div key={i} style={{
              padding: '6px 0', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
              background: isToday ? 'var(--color-primary)' : 'transparent',
              color: isToday ? '#fff' : day ? 'var(--color-text)' : 'transparent',
              fontWeight: isToday ? 700 : 400,
            }}>
              {day || ''}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function CalendarPage() {
  const { studentId } = useOutletContext()
  const { data: quizzes = [], isLoading: qLoading } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes })
  const { data: materials = [], isLoading: mLoading } = useQuery({ queryKey: ['materials'], queryFn: listMaterials })

  const isLoading = qLoading || mLoading

  const events = [
    ...quizzes.map(q => ({
      type: 'quiz', icon: '📝', title: q.title,
      subtitle: q.subject || 'General', tag: 'Assignment', tagColor: '#f59e0b',
      date: q.created_at, ago: daysAgo(q.created_at),
    })),
    ...materials.map(m => ({
      type: 'material', icon: '📄', title: m.title,
      subtitle: m.subject || 'General', tag: 'Material', tagColor: '#6c63ff',
      date: m.created_at, ago: daysAgo(m.created_at),
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  const recent = events.filter(e => e.ago <= 7)
  const older = events.filter(e => e.ago > 7)

  return (
    <div style={{ padding: '28px 24px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>📅 Calendar</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
          Upcoming events, assignments and newly added materials
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 20, alignItems: 'start' }}>

        {/* Event feed */}
        <div>
          {isLoading ? (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px', color: 'var(--color-text-hint)', fontSize: '0.85rem' }}>
              Loading events…
            </div>
          ) : events.length === 0 ? (
            <div style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', padding: '60px 24px', textAlign: 'center',
              color: 'var(--color-text-muted)',
            }}>
              <div style={{ fontSize: '3rem', marginBottom: 16 }}>📭</div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>No events yet</div>
              <div style={{ fontSize: '0.9rem' }}>Your teacher will add assignments and materials soon.</div>
            </div>
          ) : (
            <>
              {recent.length > 0 && (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 12, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                    This Week
                  </div>
                  {recent.map((e, i) => (
                    <EventItem key={i} {...e} date={formatDate(e.date)} />
                  ))}
                </div>
              )}
              {older.length > 0 && (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-border)', display: 'inline-block' }} />
                    Earlier
                  </div>
                  {older.map((e, i) => (
                    <EventItem key={i} {...e} date={formatDate(e.date)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Mini calendar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <MiniCalendar />
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 10 }}>Legend</div>
            {[
              { color: '#f59e0b', label: 'Assignment' },
              { color: '#6c63ff', label: 'New Material' },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
