import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import HomeScreen from './screens/HomeScreen'
import SetupScreen from './screens/SetupScreen'
import StudentSession from './screens/StudentSession'
import TeacherDashboard from './screens/TeacherDashboard'
import StudentProgress from './screens/StudentProgress'
import MaterialUpload from './screens/MaterialUpload'
import TeacherQuizBuilder from './screens/TeacherQuizBuilder'
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/setup" element={<SetupScreen />} />
            <Route path="/session/:studentId" element={<LegacySessionRedirect />} />
            <Route path="/teacher" element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
            <Route path="/teacher/student/:studentId" element={<TeacherRoute><StudentProgress /></TeacherRoute>} />
            <Route path="/teacher/materials" element={<TeacherRoute><MaterialUpload /></TeacherRoute>} />
            <Route path="/teacher/quiz-builder" element={<TeacherRoute><TeacherQuizBuilder /></TeacherRoute>} />

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
