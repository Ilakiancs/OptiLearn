import { Link, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Gauge } from '@phosphor-icons/react'
import { getStudentProgress, getSubjects } from '../api/client'

function SubjectCard({ studentId, subject, mastery }) {
  const percent = mastery !== undefined ? Math.round(mastery * 100) : null

  return (
    <Link to={`/student/${studentId}/course/${encodeURIComponent(subject)}`} className="surface-card" style={{ textDecoration: 'none', padding: 14, display: 'grid', gap: 10 }}>
      <span className="icon-only">
        <BookOpen size={20} weight="duotone" />
      </span>
      <div style={{ fontWeight: 700 }}>{subject}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Open learning resources and practice.</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          <Gauge size={14} weight="duotone" />
          <span>{percent === null ? 'Not started' : `${percent}% mastery`}</span>
        </div>
        <ArrowRight size={14} weight="bold" color="var(--accent)" />
      </div>
    </Link>
  )
}

export default function CoursesPage() {
  const { studentId } = useOutletContext()

  const { data: subjects = [], isLoading } = useQuery({ queryKey: ['subjects'], queryFn: getSubjects })
  const { data: progress } = useQuery({ queryKey: ['student-progress', studentId], queryFn: () => getStudentProgress(studentId) })

  const masteryList = progress?.mastery_by_topic || []

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div className="surface-card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '1.2rem' }}>
          <BookOpen size={22} weight="duotone" />
          <span>Courses</span>
        </h1>
        <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: '0.84rem' }}>Choose a tile by icon and start where you feel ready.</p>
      </div>

      {isLoading ? (
        <div className="surface-card" style={{ padding: 18, color: 'var(--text-muted)' }}>Loading courses…</div>
      ) : subjects.length === 0 ? (
        <div className="surface-card" style={{ padding: 22, textAlign: 'center', color: 'var(--text-muted)' }}>
          <BookOpen size={34} weight="duotone" />
          <div style={{ marginTop: 8 }}>No courses available yet.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          {subjects.map((subject) => {
            const mastery = masteryList.find((item) => item.topic?.toLowerCase().includes(subject.toLowerCase()))?.mastery
            return <SubjectCard key={subject} studentId={studentId} subject={subject} mastery={mastery} />
          })}
        </div>
      )}
    </section>
  )
}
