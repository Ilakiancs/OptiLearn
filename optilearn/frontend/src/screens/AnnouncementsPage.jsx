import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BellSimple, ClipboardText, FileText, Megaphone } from '@phosphor-icons/react'
import { listMaterials, listTeacherQuizzes } from '../api/client'

function isNew(iso) {
  return iso && Date.now() - new Date(iso).getTime() < 1000 * 60 * 60 * 24 * 2
}

export default function AnnouncementsPage() {
  const { data: quizzes = [], isLoading: qLoading } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes })
  const { data: materials = [], isLoading: mLoading } = useQuery({ queryKey: ['materials'], queryFn: listMaterials })

  const notes = useMemo(
    () =>
      [
        ...quizzes.map((item) => ({ id: `q-${item.id}`, icon: ClipboardText, kind: 'Assignment', title: item.title, meta: item.subject || 'General', timestamp: item.created_at })),
        ...materials.map((item) => ({ id: `m-${item.id}`, icon: FileText, kind: 'Material', title: item.title, meta: item.subject || 'General', timestamp: item.created_at })),
      ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    [quizzes, materials]
  )

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div className="surface-card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '1.2rem' }}>
          <Megaphone size={22} weight="duotone" />
          <span>Announcements</span>
        </h1>
        <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.84rem' }}>Important updates are listed in a calm, readable feed.</div>
      </div>

      {qLoading || mLoading ? (
        <div className="surface-card" style={{ padding: 16, color: 'var(--text-muted)' }}>Loading announcements…</div>
      ) : notes.length === 0 ? (
        <div className="surface-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          <BellSimple size={30} weight="duotone" />
          <div style={{ marginTop: 8 }}>No updates yet.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {notes.map((note) => {
            const Icon = note.icon
            return (
              <article key={note.id} className="surface-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="icon-only" style={{ width: 34, height: 34 }}>
                    <Icon size={18} weight="duotone" />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>{note.title}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{note.kind}</span>
                      {isNew(note.timestamp) && (
                        <span style={{ background: 'rgba(79, 188, 153, 0.16)', color: 'var(--success)', fontSize: '0.72rem', padding: '2px 8px', borderRadius: 999 }}>
                          New
                        </span>
                      )}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{note.meta}</div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
