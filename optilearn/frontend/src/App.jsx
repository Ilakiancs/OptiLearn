import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import HomeScreen from './screens/HomeScreen'
import SetupScreen from './screens/SetupScreen'
import StudentSession from './screens/StudentSession'
import TeacherDashboard from './screens/TeacherDashboard'
import StudentProgress from './screens/StudentProgress'
import StudentLayout from './components/StudentLayout'
import StudentHome from './screens/StudentHome'
import CoursesPage from './screens/CoursesPage'
import CoursePage from './screens/CoursePage'
import AssignmentsPage from './screens/AssignmentsPage'
import GradesPage from './screens/GradesPage'
import CalendarPage from './screens/CalendarPage'
import AnnouncementsPage from './screens/AnnouncementsPage'
import StudentProgressPage from './screens/StudentProgressPage'
import TranslateLearn from './screens/TranslateLearn'
import LiveTranslator from './screens/LiveTranslator'
import LiveQuizJoin from './screens/livequiz/LiveQuizJoin'
import LiveQuizPlay from './screens/livequiz/LiveQuizPlay'
import LiveQuizHost from './screens/livequiz/LiveQuizHost'
import LiveQuizCodeEntry from './screens/livequiz/LiveQuizCodeEntry'
import { getTeacherMe } from './api/client'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function LegacySessionRedirect() {
  const { studentId } = useParams()
  return <Navigate to={`/student/${studentId}/session`} replace />
}

function TeacherRoute({ children }) {
  const location = useLocation()
  const { teacherToken, updateTeacher, clearTeacher } = useAuth()
  const [state, setState] = useState('checking')

  useEffect(() => {
    if (!teacherToken) {
      setState('missing')
      return
    }
    let active = true
    getTeacherMe()
      .then((profile) => {
        if (!active) return
        updateTeacher(profile)
        setState('ready')
      })
      .catch(() => {
        if (!active) return
        clearTeacher()
        setState('expired')
      })
    return () => { active = false }
  }, [teacherToken])

  if (state === 'checking') return <div className="page-shell" style={{ minHeight: '100vh' }} />
  if (state === 'ready') return children
  return <Navigate to={`/${state === 'expired' ? '?reason=session_expired' : ''}`} replace state={{ from: location.pathname }} />
}

function StudentRoute({ children }) {
  const { studentId } = useParams()
  const { studentId: storedStudentId } = useAuth()
  const activeId = storedStudentId || localStorage.getItem('student_id')

  if (!activeId) return <Navigate to="/" replace />
  if (studentId && studentId !== activeId) return <Navigate to={`/student/${activeId}`} replace />
  return children
}

function NetworkHeartbeat() {
  const { teacherToken } = useAuth()

  useEffect(() => {
    if (teacherToken) return undefined

    let stopped = false
    const sendHeartbeat = () => {
      if (stopped || document.visibilityState === 'hidden') return
      fetch('/api/network/heartbeat', {
        method: 'POST',
        cache: 'no-store',
        keepalive: true,
      }).catch(() => {})
    }

    sendHeartbeat()
    const id = window.setInterval(sendHeartbeat, 10000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sendHeartbeat()
    }
    window.addEventListener('online', sendHeartbeat)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stopped = true
      window.clearInterval(id)
      window.removeEventListener('online', sendHeartbeat)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [teacherToken])

  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <NetworkHeartbeat />
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/setup" element={<SetupScreen />} />
            <Route path="/session/:studentId" element={<LegacySessionRedirect />} />

            {/* Live Quiz — public join & play (no account needed) */}
            <Route path="/join" element={<LiveQuizCodeEntry />} />
            <Route path="/live-quiz/join/:gameId" element={<LiveQuizJoin />} />
            <Route path="/live-quiz/play/:gameId" element={<LiveQuizPlay />} />

            {/* Live Quiz — teacher host (protected) */}
            <Route path="/teacher/live-quiz/:gameId" element={<TeacherRoute><LiveQuizHost /></TeacherRoute>} />
            <Route path="/teacher" element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
            <Route path="/teacher/student/:studentId" element={<TeacherRoute><StudentProgress /></TeacherRoute>} />
            <Route path="/teacher/materials" element={<TeacherRoute><TeacherDashboard initialView="materials" /></TeacherRoute>} />
            <Route path="/teacher/quiz-builder" element={<TeacherRoute><TeacherDashboard initialView="quiz-builder" /></TeacherRoute>} />
            <Route path="/teacher/diagnostics" element={<TeacherRoute><TeacherDashboard initialView="diagnostics" /></TeacherRoute>} />

            {/* Student LMS — nested under sidebar layout */}
            <Route path="/student/:studentId" element={<StudentRoute><StudentLayout /></StudentRoute>}>
              <Route index element={<StudentHome />} />
              <Route path="courses" element={<CoursesPage />} />
              <Route path="course/:subject" element={<CoursePage />} />
              <Route path="assignments" element={<AssignmentsPage />} />
              <Route path="grades" element={<GradesPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="announcements" element={<AnnouncementsPage />} />
              <Route path="session" element={<StudentSession />} />
              <Route path="translate-learn" element={<TranslateLearn />} />
              <Route path="live-translator" element={<LiveTranslator />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
