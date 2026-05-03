import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import HomeScreen from './screens/HomeScreen'
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/session/:studentId" element={<LegacySessionRedirect />} />
            <Route path="/teacher" element={<TeacherDashboard />} />
            <Route path="/teacher/student/:studentId" element={<StudentProgress />} />
            <Route path="/teacher/materials" element={<MaterialUpload />} />
            <Route path="/teacher/quiz-builder" element={<TeacherQuizBuilder />} />

            {/* Student LMS — nested under sidebar layout */}
            <Route path="/student/:studentId" element={<StudentLayout />}>
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
