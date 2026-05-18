/*
 * App.jsx — Root router and auth context.
 *
 * Defines the full client-side route tree (student, teacher, live-quiz, setup).
 * NetworkGate polls /api/health every 5 s and shows the offline screen after
 * two consecutive failures. Auth state is read from localStorage and passed
 * down via React Router's Outlet context.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import HomeScreen from './screens/HomeScreen'
import SetupScreen from './screens/SetupScreen'
import StudentLayout from './components/StudentLayout'
import StudentHome from './screens/StudentHome'
import StudentSession from './screens/StudentSession'
import CoursesPage from './screens/CoursesPage'
import CoursePage from './screens/CoursePage'
import AssignmentsPage from './screens/AssignmentsPage'
import GradesPage from './screens/GradesPage'
import CalendarPage from './screens/CalendarPage'
import AnnouncementsPage from './screens/AnnouncementsPage'
import TranslateLearn from './screens/TranslateLearn'
import LiveTranslator from './screens/LiveTranslator'
import LiveQuizJoin from './screens/livequiz/LiveQuizJoin'
import LiveQuizPlay from './screens/livequiz/LiveQuizPlay'
import LiveQuizCodeEntry from './screens/livequiz/LiveQuizCodeEntry'
import { getTeacherMe } from './api/client'
import OfflineScreen from './screens/OfflineScreen'

// Teacher-only screens loaded lazily — never downloaded by students
const TeacherDashboard = lazy(() => import('./screens/TeacherDashboard'))
const StudentProgress = lazy(() => import('./screens/StudentProgress'))
const LiveQuizHost = lazy(() => import('./screens/livequiz/LiveQuizHost'))

const _TeacherShell = <div className="page-shell" style={{ minHeight: '100vh' }} />

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
  const activeId = storedStudentId

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

function NetworkGate({ children }) {
  const [state, setState] = useState('checking')
  const failCountRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let intervalId = null

    const check = () => {
      // Force offline screen when testing via URL param
      if (new URLSearchParams(window.location.search).get('offline_test') === '1') {
        if (!cancelled) setState('down')
        return
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      fetch('/api/health', { cache: 'no-store', signal: controller.signal })
        .then((r) => {
          clearTimeout(timer)
          if (cancelled) return
          if (r.ok) {
            failCountRef.current = 0
            setState('up')
            if (intervalId) { clearInterval(intervalId); intervalId = null }
          } else {
            failCountRef.current++
            if (!cancelled && failCountRef.current >= 2) setState('down')
          }
        })
        .catch(() => {
          clearTimeout(timer)
          if (!cancelled) {
            failCountRef.current++
            // Only show offline screen after 2 consecutive failures — prevents
            // a false-positive flash when a device has just joined the WiFi.
            setState((prev) => {
              if (failCountRef.current >= 2) return prev === 'up' ? 'up' : 'down'
              return prev
            })
          }
        })
    }

    check()

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  // When down: start retrying every 3 s
  useEffect(() => {
    if (state !== 'down') return
    const id = setInterval(() => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      fetch('/api/health', { cache: 'no-store', signal: controller.signal })
        .then((r) => { clearTimeout(timer); if (r.ok) { failCountRef.current = 0; setState('up') } })
        .catch(() => clearTimeout(timer))
    }, 3000)
    return () => clearInterval(id)
  }, [state])

  if (state === 'checking') return <div className="page-shell" style={{ minHeight: '100vh' }} />
  if (state === 'down') return <OfflineScreen />
  return children
}

function CanonicalOriginRedirect() {
  useEffect(() => {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') return
    fetch('/api/network/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const canonical = data.connect_url || data.server_url
        if (!canonical) return
        try {
          const canonicalOrigin = new URL(canonical).origin
          if (window.location.origin !== canonicalOrigin) {
            window.location.replace(
              canonicalOrigin + window.location.pathname + window.location.search
            )
          }
        } catch (_) {}
      })
      .catch(() => {})
  }, [])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <CanonicalOriginRedirect />
          <NetworkHeartbeat />
          <NetworkGate>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/setup" element={<SetupScreen />} />
            <Route path="/session/:studentId" element={<LegacySessionRedirect />} />

            {/* Live Quiz — public join & play (no account needed) */}
            <Route path="/join" element={<LiveQuizCodeEntry />} />
            <Route path="/live-quiz/join/:gameId" element={<LiveQuizJoin />} />
            <Route path="/live-quiz/play/:gameId" element={<LiveQuizPlay />} />

            {/* Live Quiz — teacher host (protected, lazy-loaded) */}
            <Route path="/teacher/live-quiz/:gameId" element={<TeacherRoute><Suspense fallback={_TeacherShell}><LiveQuizHost /></Suspense></TeacherRoute>} />
            <Route path="/teacher" element={<TeacherRoute><Suspense fallback={_TeacherShell}><TeacherDashboard /></Suspense></TeacherRoute>} />
            <Route path="/teacher/student/:studentId" element={<TeacherRoute><Suspense fallback={_TeacherShell}><StudentProgress /></Suspense></TeacherRoute>} />
            <Route path="/teacher/materials" element={<TeacherRoute><Suspense fallback={_TeacherShell}><TeacherDashboard initialView="materials" /></Suspense></TeacherRoute>} />
            <Route path="/teacher/quiz-builder" element={<TeacherRoute><Suspense fallback={_TeacherShell}><TeacherDashboard initialView="quiz-builder" /></Suspense></TeacherRoute>} />
            <Route path="/teacher/diagnostics" element={<TeacherRoute><Suspense fallback={_TeacherShell}><TeacherDashboard initialView="diagnostics" /></Suspense></TeacherRoute>} />

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
          </NetworkGate>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
