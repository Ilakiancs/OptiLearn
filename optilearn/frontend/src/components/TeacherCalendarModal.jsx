import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDots, Clock, Pencil, Trash, X, Plus } from '@phosphor-icons/react'
import { getTeacherSchedule, createScheduledClass, updateScheduledClass, deleteScheduledClass, getSubjects } from '../api/client'
import Spinner from './Spinner'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1)
  const lastDate = new Date(year, month + 1, 0).getDate()
  const days = []
  for (let i = 0; i < firstDay.getDay(); i++) days.push(null)
  for (let d = 1; d <= lastDate; d++) days.push(new Date(year, month, d))
  return days
}

function eventsForDay(events, date) {
  if (!date) return []
  const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return events.filter(e => (e.start_datetime || '').startsWith(ds))
}

function toLocalDatetimeInput(iso) {
  if (!iso) return ''
  try { return iso.slice(0, 16) } catch { return '' }
}

const BLANK_FORM = { title: '', subject: '', description: '', start_datetime: '', end_datetime: '' }

export default function TeacherCalendarModal({ onClose }) {
  const qc = useQueryClient()
  const [current, setCurrent] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() } })
  const [view, setView] = useState('month')
  const [form, setForm] = useState(BLANK_FORM)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [viewingEvent, setViewingEvent] = useState(null)
  const [formError, setFormError] = useState('')

  const { data: events = [], isLoading } = useQuery({ queryKey: ['teacher-schedule'], queryFn: getTeacherSchedule, refetchInterval: 30000 })
  const { data: subjects = [] } = useQuery({ queryKey: ['subjects'], queryFn: getSubjects })

  const createMut = useMutation({
    mutationFn: createScheduledClass,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teacher-schedule'] }); resetForm() },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, body }) => updateScheduledClass(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teacher-schedule'] }); resetForm() },
  })
  const deleteMut = useMutation({
    mutationFn: deleteScheduledClass,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teacher-schedule'] }); setViewingEvent(null) },
  })

  function resetForm() { setForm(BLANK_FORM); setShowForm(false); setEditingId(null); setFormError('') }

  function openCreate(date) {
    const ds = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T09:00` : ''
    setForm({ ...BLANK_FORM, start_datetime: ds, end_datetime: ds ? ds.replace('T09:00', 'T10:00') : '' })
    setEditingId(null)
    setViewingEvent(null)
    setShowForm(true)
  }

  function openEdit(ev) {
    setForm({ title: ev.title, subject: ev.subject || '', description: ev.description || '', start_datetime: toLocalDatetimeInput(ev.start_datetime), end_datetime: toLocalDatetimeInput(ev.end_datetime) })
    setEditingId(ev.id)
    setViewingEvent(null)
    setShowForm(true)
  }

  function submitForm(e) {
    e.preventDefault()
    if (!form.title.trim()) { setFormError('Title is required.'); return }
    if (!form.start_datetime) { setFormError('Start date/time is required.'); return }
    if (!form.end_datetime) { setFormError('End date/time is required.'); return }
    setFormError('')
    const body = { ...form, subject: form.subject || null, description: form.description || null }
    if (editingId) updateMut.mutate({ id: editingId, body })
    else createMut.mutate(body)
  }

  const calDays = getCalendarDays(current.year, current.month)
  const today = new Date()

  // Week view: get Mon–Sun of current week relative to current date
  const weekDays = (() => {
    const d = new Date(current.year, current.month, today.getDate())
    const dow = d.getDay()
    const mon = new Date(d); mon.setDate(d.getDate() - dow)
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x })
  })()

  const isPending = createMut.isPending || updateMut.isPending

  const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
  const modalStyle = { background: 'var(--color-surface)', borderRadius: 16, width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--color-border)', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }

  return (
    <div style={overlayStyle} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle} onMouseDown={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'var(--color-surface)' }}>
          <CalendarDots size={20} weight="duotone" color="#2a8dbf" />
          <span style={{ fontWeight: 700, flex: 1, fontSize: '1rem' }}>Class Schedule</span>

          <div style={{ display: 'flex', gap: 6 }}>
            {/* Month/Week toggle */}
            <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
              {['month', 'week'].map(v => (
                <button key={v} onClick={() => setView(v)} style={{ padding: '5px 12px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', background: view === v ? '#2a8dbf' : 'transparent', color: view === v ? '#fff' : 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                  {v}
                </button>
              ))}
            </div>
            <button onClick={() => openCreate(null)} style={{ padding: '6px 12px', background: '#2a8dbf', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Schedule
            </button>
            <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 6 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Calendar area */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {/* Nav */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <button onClick={() => setCurrent(c => { const m = c.month===0?11:c.month-1; return { year: c.month===0?c.year-1:c.year, month: m } })} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>←</button>
              <span style={{ fontWeight: 700, flex: 1, textAlign: 'center' }}>{MONTH_NAMES[current.month]} {current.year}</span>
              <button onClick={() => setCurrent(c => { const m = c.month===11?0:c.month+1; return { year: c.month===11?c.year+1:c.year, month: m } })} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>→</button>
            </div>

            {isLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div> : view === 'month' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, marginBottom: 4 }}>
                  {DAY_NAMES.map(d => <div key={d} style={{ textAlign: 'center', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted)', padding: '3px 0' }}>{d}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1 }}>
                  {calDays.map((day, i) => {
                    if (!day) return <div key={`e${i}`} style={{ minHeight: 72 }} />
                    const isToday = day.toDateString() === today.toDateString()
                    const dayEvs = eventsForDay(events, day)
                    return (
                      <div key={i} onClick={() => openCreate(day)} style={{ minHeight: 72, padding: '4px 4px 2px', borderRadius: 6, border: `1px solid ${isToday ? '#2a8dbf' : 'var(--color-border)'}`, background: isToday ? 'rgba(42,141,191,0.06)' : 'var(--color-surface)', cursor: 'pointer', transition: 'background 0.1s' }}
                        onMouseEnter={e => { if (!isToday) e.currentTarget.style.background = 'var(--color-surface-2)' }}
                        onMouseLeave={e => { if (!isToday) e.currentTarget.style.background = 'var(--color-surface)' }}
                      >
                        <div style={{ fontSize: '0.75rem', fontWeight: isToday ? 700 : 400, color: isToday ? '#2a8dbf' : 'var(--color-text-muted)', marginBottom: 2 }}>{day.getDate()}</div>
                        {dayEvs.slice(0, 2).map((ev, ei) => (
                          <div key={ei} onClick={e => { e.stopPropagation(); setViewingEvent(ev) }} title={ev.title} style={{ background: '#2a8dbf', color: '#fff', fontSize: '0.65rem', fontWeight: 600, borderRadius: 3, padding: '1px 4px', marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                            {ev.title}
                          </div>
                        ))}
                        {dayEvs.length > 2 && <div style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>+{dayEvs.length - 2} more</div>}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              /* Week view */
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
                {weekDays.map((day, i) => {
                  const isToday = day.toDateString() === today.toDateString()
                  const dayEvs = eventsForDay(events, day)
                  return (
                    <div key={i} style={{ border: `1px solid ${isToday ? '#2a8dbf' : 'var(--color-border)'}`, borderRadius: 8, overflow: 'hidden', minHeight: 160 }}>
                      <div onClick={() => openCreate(day)} style={{ padding: '6px 8px', background: isToday ? '#2a8dbf' : 'var(--color-surface-2)', cursor: 'pointer', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: isToday ? 'rgba(255,255,255,0.8)' : 'var(--color-text-muted)' }}>{DAY_NAMES[day.getDay()]}</div>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: isToday ? '#fff' : 'var(--color-text)' }}>{day.getDate()}</div>
                      </div>
                      <div style={{ padding: 4 }}>
                        {dayEvs.map((ev, ei) => (
                          <div key={ei} onClick={() => setViewingEvent(ev)} style={{ background: '#2a8dbf', color: '#fff', fontSize: '0.7rem', fontWeight: 600, borderRadius: 4, padding: '4px 6px', marginBottom: 3, cursor: 'pointer' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
                            <div style={{ opacity: 0.8, fontSize: '0.62rem' }}>{ev.start_datetime?.slice(11, 16)}</div>
                          </div>
                        ))}
                        {dayEvs.length === 0 && (
                          <div onClick={() => openCreate(day)} style={{ fontSize: '0.7rem', color: 'var(--color-text-hint)', padding: '6px 4px', cursor: 'pointer', textAlign: 'center' }}>+ Add</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Side panel: form or event detail */}
          {(showForm || viewingEvent) && (
            <div style={{ width: 280, borderLeft: '1px solid var(--color-border)', padding: 16, overflowY: 'auto', flexShrink: 0, background: 'var(--color-surface)' }}>
              {showForm ? (
                <form onSubmit={submitForm}>
                  <div style={{ fontWeight: 700, marginBottom: 14, fontSize: '0.95rem' }}>{editingId ? 'Edit class' : 'Schedule class'}</div>

                  <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Title *</label>
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Math – Fractions" style={fieldStyle} required />

                  <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: 3, marginTop: 10 }}>Subject</label>
                  <select value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} style={fieldStyle}>
                    <option value="">— select —</option>
                    {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>

                  <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: 3, marginTop: 10 }}>Description</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Optional notes for students" style={{ ...fieldStyle, resize: 'vertical' }} />

                  <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: 3, marginTop: 10 }}>Start *</label>
                  <input type="datetime-local" value={form.start_datetime} onChange={e => setForm(f => ({ ...f, start_datetime: e.target.value }))} style={fieldStyle} required />

                  <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: 3, marginTop: 10 }}>End *</label>
                  <input type="datetime-local" value={form.end_datetime} onChange={e => setForm(f => ({ ...f, end_datetime: e.target.value }))} style={fieldStyle} required />

                  {formError && <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 8 }}>{formError}</div>}

                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button type="submit" disabled={isPending} style={{ flex: 1, padding: '9px', background: '#2a8dbf', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: isPending ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      {isPending ? <Spinner size={16} color="#fff" /> : editingId ? 'Save changes' : 'Create'}
                    </button>
                    <button type="button" onClick={resetForm} style={{ padding: '9px 14px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                      <X size={14} />
                    </button>
                  </div>
                </form>
              ) : viewingEvent ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3 }}>{viewingEvent.title}</span>
                    <button onClick={() => setViewingEvent(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                      <X size={16} />
                    </button>
                  </div>
                  {viewingEvent.subject && <div style={{ fontSize: '0.82rem', color: '#2a8dbf', marginBottom: 6, fontWeight: 600 }}>{viewingEvent.subject}</div>}
                  {viewingEvent.description && <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>{viewingEvent.description}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                    <Clock size={13} /> {viewingEvent.start_datetime?.slice(0, 16).replace('T', ' ')} → {viewingEvent.end_datetime?.slice(11, 16)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button onClick={() => openEdit(viewingEvent)} style={{ flex: 1, padding: '8px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--color-text)' }}>
                      <Pencil size={14} /> Edit
                    </button>
                    <button onClick={() => { if (window.confirm('Delete this class?')) deleteMut.mutate(viewingEvent.id) }} style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', fontWeight: 600 }}>
                      <Trash size={14} /> Delete
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const fieldStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 8,
  border: '1px solid var(--color-border)', background: 'var(--color-surface)',
  color: 'var(--color-text)', fontSize: '0.88rem',
  boxSizing: 'border-box', outline: 'none',
}
