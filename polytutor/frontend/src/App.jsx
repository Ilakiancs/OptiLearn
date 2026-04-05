import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HomeScreen from './screens/HomeScreen'
import StudentSession from './screens/StudentSession'
import TeacherDashboard from './screens/TeacherDashboard'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/session/:studentId" element={<StudentSession />} />
          <Route path="/teacher" element={<TeacherDashboard />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
