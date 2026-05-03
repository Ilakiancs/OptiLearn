import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { CalendarDots, Clock, Sparkle, X } from '@phosphor-icons/react'
import { getStudentSchedule } from '../api/client'
import Spinner from '../components/Spinner'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

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
  const ds = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  return events.filter(e => (e.start_datetime||'').startsWith(ds))
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString([], { weekday:'long', year:'numeric', month:'long', day:'numeric' }) } catch { return iso }
}

function fmtTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) } catch { return '' }
}

function EventDetailModal({ event, onClose }) {
  if (!event) return null
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'var(--bg)', borderRadius:16, padding:28, maxWidth:420, width:'100%', boxShadow:'0 8px 32px rgba(0,0,0,0.2)', border:'1px solid var(--border)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:10 }}>
            <span className="icon-only" style={{ width:40, height:40, background:'rgba(42,141,191,0.12)', color:'#2a8dbf' }}>
              <CalendarDots size={20} weight="duotone" />
            </span>
            <span style={{ fontWeight:800, fontSize:'1.1rem' }}>{event.title}</span>
          </div>
          <button onClick={onClose} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text-muted)', padding:4, display:'flex' }}>
            <X size={20} />
          </button>
        </div>

        {event.subject && (
          <div style={{ display:'inline-block', background:'rgba(42,141,191,0.1)', color:'#2a8dbf', fontWeight:700, fontSize:'0.82rem', padding:'3px 10px', borderRadius:99, marginBottom:14 }}>
            {event.subject}
          </div>
        )}

        <div style={{ display:'grid', gap:10, fontSize:'0.9rem', color:'var(--text)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <CalendarDots size={16} color="var(--text-muted)" />
            <span>{fmtDate(event.start_datetime)}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Clock size={16} color="var(--text-muted)" />
            <span>{fmtTime(event.start_datetime)}{event.end_datetime ? ` — ${fmtTime(event.end_datetime)}` : ''}</span>
          </div>
          {event.description && (
            <div style={{ marginTop:6, padding:'12px 14px', background:'var(--surface)', borderRadius:10, border:'1px solid var(--border)', lineHeight:1.6, color:'var(--text-muted)', fontSize:'0.88rem' }}>
              {event.description}
            </div>
          )}
        </div>

        <button onClick={onClose} style={{ marginTop:20, width:'100%', padding:'11px', background:'#2a8dbf', color:'#fff', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer', fontSize:'0.95rem' }}>
          Got it
        </button>
      </div>
    </div>
  )
}

export default function CalendarPage() {
  useOutletContext()
  const [current, setCurrent] = useState(() => { const d=new Date(); return { year:d.getFullYear(), month:d.getMonth() } })
  const [selected, setSelected] = useState(null)

  const { data: events=[], isLoading } = useQuery({ queryKey:['student-schedule'], queryFn:getStudentSchedule, refetchInterval:60000 })

  const calDays = useMemo(() => getCalendarDays(current.year, current.month), [current])
  const today = new Date()

  const upcoming = useMemo(() => {
    const now = new Date()
    const cutoff = new Date(now.getTime() + 7*86400000)
    return events
      .filter(e => { const d=new Date(e.start_datetime); return d>=now && d<=cutoff })
      .sort((a,b) => new Date(a.start_datetime)-new Date(b.start_datetime))
  }, [events])

  function prev() {
    setCurrent(c => c.month===0 ? {year:c.year-1,month:11} : {year:c.year,month:c.month-1})
  }
  function next() {
    setCurrent(c => c.month===11 ? {year:c.year+1,month:0} : {year:c.year,month:c.month+1})
  }

  return (
    <section style={{ display:'grid', gap:12 }}>
      {selected && <EventDetailModal event={selected} onClose={() => setSelected(null)} />}

      <div className="surface-card" style={{ padding:16 }}>
        <h1 style={{ margin:0, display:'inline-flex', alignItems:'center', gap:8, fontSize:'1.2rem' }}>
          <CalendarDots size={22} weight="duotone" />
          <span>Calendar</span>
        </h1>
        <div style={{ marginTop:8, color:'var(--text-muted)', fontSize:'0.84rem' }}>
          Classes scheduled by your teacher — tap any event to see details.
        </div>
        <div className="tid-banner" style={{ marginTop:10 }}>
          If this feels busy, focus on one event at a time.
        </div>
      </div>

      {isLoading ? (
        <div className="surface-card" style={{ padding:24, display:'flex', justifyContent:'center' }}><Spinner /></div>
      ) : (
        <div className="surface-card" style={{ padding:16 }}>
          {/* Month nav */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <button onClick={prev} className="pill-button" style={{ padding:'6px 14px' }}>←</button>
            <span style={{ fontWeight:700 }}>{MONTH_NAMES[current.month]} {current.year}</span>
            <button onClick={next} className="pill-button" style={{ padding:'6px 14px' }}>→</button>
          </div>

          {/* Day headers */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
            {DAY_NAMES.map(d => (
              <div key={d} style={{ textAlign:'center', fontSize:'0.72rem', color:'var(--text-muted)', fontWeight:600, padding:'4px 0' }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
            {calDays.map((day, i) => {
              if (!day) return <div key={`e${i}`} />
              const isToday = day.toDateString()===today.toDateString()
              const dayEvs = eventsForDay(events, day)
              return (
                <div key={i} style={{
                  minHeight:54, padding:'4px 4px 2px',
                  borderRadius:6,
                  background: isToday ? 'rgba(42,141,191,0.06)' : 'transparent',
                  border: `1px solid ${isToday ? '#2a8dbf' : 'var(--border)'}`,
                }}>
                  <div style={{ fontSize:'0.75rem', fontWeight:isToday?700:400, color:isToday?'#2a8dbf':'var(--text-muted)', marginBottom:2 }}>{day.getDate()}</div>
                  {dayEvs.slice(0,2).map((ev,ei) => (
                    <button key={ei} onClick={() => setSelected(ev)} title={ev.title} style={{
                      width:'100%', background:'#2a8dbf', color:'#fff', fontSize:'0.62rem', fontWeight:600,
                      borderRadius:3, padding:'2px 4px', marginBottom:1, border:'none', cursor:'pointer',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'left',
                      display:'block',
                    }}>
                      {ev.title}
                    </button>
                  ))}
                  {dayEvs.length>2 && (
                    <button onClick={() => setSelected(dayEvs[2])} style={{ background:'none', border:'none', fontSize:'0.6rem', color:'var(--text-muted)', cursor:'pointer', padding:0 }}>
                      +{dayEvs.length-2} more
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div className="surface-card" style={{ padding:16 }}>
        <div style={{ fontWeight:700, marginBottom:10, fontSize:'0.95rem' }}>Upcoming (next 7 days)</div>
        {upcoming.length===0 ? (
          <div style={{ color:'var(--text-muted)', textAlign:'center', padding:'16px 0', fontSize:'0.9rem' }}>
            <Sparkle size={24} weight="duotone" style={{ display:'block', margin:'0 auto 8px' }} />
            No classes scheduled in the next 7 days.
          </div>
        ) : upcoming.map(ev => (
          <button key={ev.id} onClick={() => setSelected(ev)} style={{
            width:'100%', display:'flex', gap:10, padding:'12px 8px',
            borderBottom:'1px solid var(--border)', background:'none', border:'none',
            cursor:'pointer', textAlign:'left', borderRadius:8, transition:'background 0.1s',
          }}
          onMouseEnter={e => e.currentTarget.style.background='var(--surface)'}
          onMouseLeave={e => e.currentTarget.style.background='none'}
          >
            <span className="icon-only" style={{ width:34, height:34, flexShrink:0, color:'#2a8dbf', background:'rgba(42,141,191,0.1)' }}>
              <CalendarDots size={18} weight="duotone" />
            </span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text)' }}>{ev.title}</div>
              {ev.subject && <div style={{ fontSize:'0.78rem', color:'#2a8dbf', fontWeight:600 }}>{ev.subject}</div>}
              {ev.description && <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ev.description}</div>}
            </div>
            <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', textAlign:'right', flexShrink:0 }}>
              <div>{new Date(ev.start_datetime).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}</div>
              <div style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end', marginTop:2 }}>
                <Clock size={11} /> {fmtTime(ev.start_datetime)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
