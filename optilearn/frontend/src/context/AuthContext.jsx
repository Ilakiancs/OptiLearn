import { createContext, useContext, useMemo, useState } from 'react'

const AuthContext = createContext(null)

const STUDENT_KEY = 'student_id'
const TEACHER_TOKEN_KEY = 'teacher_token'
const TEACHER_PROFILE_KEY = 'teacher_profile'

function readTeacherProfile() {
  try {
    return JSON.parse(localStorage.getItem(TEACHER_PROFILE_KEY) || 'null')
  } catch (_) {
    return null
  }
}

export function AuthProvider({ children }) {
  const [studentId, setStudentId] = useState(() => localStorage.getItem(STUDENT_KEY) || null)
  const [teacherToken, setTeacherToken] = useState(() => localStorage.getItem(TEACHER_TOKEN_KEY) || null)
  const [teacher, setTeacher] = useState(() => readTeacherProfile())

  function loginStudent(id) {
    localStorage.setItem(STUDENT_KEY, id)
    localStorage.removeItem(TEACHER_TOKEN_KEY)
    localStorage.removeItem(TEACHER_PROFILE_KEY)
    setStudentId(id)
    setTeacherToken(null)
    setTeacher(null)
  }

  function loginTeacher(payload) {
    const profile = {
      teacher_id: payload.teacher_id,
      username: payload.username,
      display_name: payload.display_name,
      is_admin: !!payload.is_admin,
    }
    localStorage.setItem(TEACHER_TOKEN_KEY, payload.token)
    localStorage.setItem(TEACHER_PROFILE_KEY, JSON.stringify(profile))
    localStorage.removeItem(STUDENT_KEY)
    setTeacherToken(payload.token)
    setTeacher(profile)
    setStudentId(null)
  }

  function updateTeacher(profile) {
    const next = { ...(teacher || {}), ...profile, is_admin: !!profile.is_admin }
    localStorage.setItem(TEACHER_PROFILE_KEY, JSON.stringify(next))
    setTeacher(next)
  }

  function clearStudent() {
    localStorage.removeItem(STUDENT_KEY)
    setStudentId(null)
  }

  function clearTeacher() {
    localStorage.removeItem(TEACHER_TOKEN_KEY)
    localStorage.removeItem(TEACHER_PROFILE_KEY)
    setTeacherToken(null)
    setTeacher(null)
  }

  function clearAll() {
    clearStudent()
    clearTeacher()
  }

  const value = useMemo(
    () => ({
      studentId,
      teacher,
      teacherToken,
      isStudentLoggedIn: !!studentId,
      isTeacherLoggedIn: !!teacherToken,
      login: loginStudent,
      loginStudent,
      loginTeacher,
      updateTeacher,
      logout: clearStudent,
      clearStudent,
      clearTeacher,
      clearAll,
    }),
    [studentId, teacher, teacherToken]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
