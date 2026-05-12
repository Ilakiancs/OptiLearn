import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowSquareOut, BellSimple, ClipboardText, FileText, Megaphone, Play, X } from '@phosphor-icons/react'
import { listMaterials, listStudentQuizzes } from '../api/client'
import MaterialViewer from '../components/MaterialViewer'
import { QuizFlow } from './CoursePage'

function isNew(iso) {
  return iso && Date.now() - new Date(iso).getTime() < 1000 * 60 * 60 * 24 * 2
}

export default function AnnouncementsPage() {
  const { studentId } = useOutletContext()
  const [activeQuiz, setActiveQuiz] = useState(null)
  const [viewingMaterial, setViewingMaterial] = useState(null)
  const { data: quizzes = [], isLoading: qLoading } = useQuery({
    queryKey: ['student-quizzes', studentId],
    queryFn: () => listStudentQuizzes(studentId),
    enabled: !!studentId,
  })
  const { data: materials = [], isLoading: mLoading } = useQuery({ queryKey: ['materials'], queryFn: listMaterials })

  const notes = useMemo(
    () =>
      [
        ...quizzes.map((item) => ({ id: `q-${item.id}`, icon: ClipboardText, kind: 'Assignment', title: item.title, meta: item.subject || 'General', timestamp: item.created_at, resource: item })),
        ...materials.map((item) => ({ id: `m-${item.id}`, icon: FileText, kind: 'Material', title: item.title, meta: item.subject || 'General', timestamp: item.created_at, resource: item })),
      ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    [quizzes, materials]
  )

  if (activeQuiz) {
    return (
      <section style={{ display: 'grid', gap: 12 }}>
        {viewingMaterial && <MaterialViewer material={viewingMaterial} onClose={() => setViewingMaterial(null)} />}
        <div className="surface-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveQuiz(null)}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <X size={14} /> Back
            </button>
            <span style={{ fontWeight: 700, minWidth: 0 }}>{activeQuiz.title}</span>
          </div>
          <QuizFlow quiz={activeQuiz} studentId={studentId} onDone={() => setActiveQuiz(null)} />
        </div>
      </section>
    )
  }

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      {viewingMaterial && <MaterialViewer material={viewingMaterial} onClose={() => setViewingMaterial(null)} />}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="icon-only" style={{ width: 34, height: 34 }}>
                    <Icon size={18} weight="duotone" />
                  </span>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
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
                  {note.kind === 'Assignment' ? (
                    <button
                      type="button"
                      onClick={() => setActiveQuiz(note.resource)}
                      className="pill-button primary"
                      style={{ minHeight: 38, fontWeight: 700, flexShrink: 0 }}
                    >
                      <Play size={15} weight="bold" />
                      <span>Start assignment</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setViewingMaterial(note.resource)}
                      className="pill-button"
                      style={{ minHeight: 38, fontWeight: 700, flexShrink: 0 }}
                    >
                      <ArrowSquareOut size={15} weight="bold" />
                      <span>Open material</span>
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
