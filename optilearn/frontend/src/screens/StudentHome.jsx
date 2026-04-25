import { Link, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  CalendarDots,
  ChartBar,
  ChatsCircle,
  Gauge,
  ListChecks,
  Sparkle,
  Target,
  Trophy,
} from '@phosphor-icons/react'
import { getStudentProgress, getSubjects, listTeacherQuizzes } from '../api/client'

function StatTile({ Icon, label, value, tone }) {
  return (
    <div className="surface-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="icon-only" style={{ background: tone, borderColor: 'transparent' }}>
          <Icon size={20} weight="duotone" />
        </span>
        <div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{label}</div>
          <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{value}</div>
        </div>
      </div>
    </div>
  )
}

function ActionCard({ to, Icon, label, hint }) {
  return (
    <Link className="surface-card" to={to} style={{ textDecoration: 'none', padding: 16, display: 'grid', gap: 12 }}>
      <span className="icon-only">
        <Icon size={20} weight="duotone" />
      </span>
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{hint}</div>
      <div style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 700 }}>
        <span>Open</span>
        <ArrowRight size={14} weight="bold" />
      </div>
    </Link>
  )
}

export default function StudentHome() {
  const { student, studentId } = useOutletContext()
  const { data: subjects = [] } = useQuery({ queryKey: ['subjects'], queryFn: getSubjects })
  const { data: progress } = useQuery({ queryKey: ['student-progress', studentId], queryFn: () => getStudentProgress(studentId) })
  const { data: quizzes = [] } = useQuery({ queryKey: ['teacher-quizzes'], queryFn: listTeacherQuizzes })

  const masteryAvg = progress?.mastery_by_topic?.length
    ? Math.round((progress.mastery_by_topic.reduce((acc, item) => acc + item.mastery, 0) / progress.mastery_by_topic.length) * 100)
    : null

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div className="surface-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkle size={14} weight="fill" />
              Safe learning space
            </div>
            <h1 style={{ margin: '6px 0 4px', fontSize: '1.35rem' }}>{student?.name || 'Student'}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>Follow icons to move through learning areas.</div>
          </div>
          <Link to={`/session/${studentId}`} className="pill-button primary" style={{ fontWeight: 700 }}>
            <ChatsCircle size={18} weight="duotone" />
            <span>AI Tutor</span>
          </Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <StatTile Icon={BookOpen} label="Courses" value={subjects.length} tone="var(--accent-soft)" />
        <StatTile Icon={ListChecks} label="Assignments" value={quizzes.length} tone="rgba(76, 168, 217, 0.14)" />
        <StatTile Icon={Gauge} label="Mastery" value={masteryAvg === null ? '—' : `${masteryAvg}%`} tone="rgba(79, 188, 153, 0.16)" />
        <StatTile Icon={Trophy} label="Level" value={progress?.level || '—'} tone="rgba(111, 168, 243, 0.16)" />
      </div>

      <div className="tid-banner">
        You can go at your own pace. Nothing is permanent here and your work updates step by step.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <ActionCard to={`/student/${studentId}/courses`} Icon={BookOpen} label="Courses" hint="Study by topic" />
        <ActionCard to={`/student/${studentId}/assignments`} Icon={ListChecks} label="Assignments" hint="Practice tasks" />
        <ActionCard to={`/student/${studentId}/grades`} Icon={ChartBar} label="Results" hint="Track outcomes" />
        <ActionCard to={`/student/${studentId}/calendar`} Icon={CalendarDots} label="Calendar" hint="See timeline" />
      </div>

      <div className="surface-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 700 }}>
          <Target size={18} weight="duotone" />
          Current topics
        </div>
        {subjects.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>No topics yet. Your teacher will add resources soon.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {subjects.slice(0, 5).map((subject) => (
              <Link
                key={subject}
                to={`/student/${studentId}/course/${encodeURIComponent(subject)}`}
                className="pill-button"
                style={{ justifyContent: 'space-between' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <BookOpen size={16} weight="duotone" />
                  <span>{subject}</span>
                </span>
                <ArrowRight size={14} weight="bold" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
