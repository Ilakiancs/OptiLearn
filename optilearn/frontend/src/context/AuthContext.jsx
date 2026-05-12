import { createContext, useContext, useMemo, useState } from 'react'

const AuthContext = createContext(null)

const STUDENT_KEY = 'student_id'
const STUDENT_EXPIRY_KEY = 'student_token_expiry'
const STUDENT_REMEMBERED_KEY = 'student_remembered'
const TEACHER_TOKEN_KEY = 'teacher_token'
const TEACHER_PROFILE_KEY = 'teacher_profile'
const TEACHER_EXPIRY_KEY = 'teacher_token_expiry'

const STUDENT_TTL = 30 * 24 * 60 * 60 * 1000  // 30 days
const TEACHER_TTL = 8 * 60 * 60 * 1000         // 8 hours

function readTeacherProfile() {
  try {
    return JSON.parse(localStorage.getItem(TEACHER_PROFILE_KEY) || 'null')
  } catch (_) {
    return null
  }
}

function readStudentId() {
  const id = localStorage.getItem(STUDENT_KEY)
  if (!id) return null
  const expiry = parseInt(localStorage.getItem(STUDENT_EXPIRY_KEY) || '0')
  if (!expiry || Number.isNaN(expiry) || expiry < Date.now()) {
    localStorage.removeItem(STUDENT_KEY)
    localStorage.removeItem(STUDENT_EXPIRY_KEY)
    localStorage.removeItem(STUDENT_REMEMBERED_KEY)
    return null
  }
  return id
}

function readTeacherToken() {
  const token = localStorage.getItem(TEACHER_TOKEN_KEY)
  if (!token) return null
  const expiry = parseInt(localStorage.getItem(TEACHER_EXPIRY_KEY) || '0')
  if (!expiry || Number.isNaN(expiry) || expiry < Date.now()) {
    localStorage.removeItem(TEACHER_TOKEN_KEY)
    localStorage.removeItem(TEACHER_PROFILE_KEY)
    localStorage.removeItem(TEACHER_EXPIRY_KEY)
    return null
  }
  return token
}

export function AuthProvider({ children }) {
  const [studentId, setStudentId] = useState(() => readStudentId())
  const [teacherToken, setTeacherToken] = useState(() => readTeacherToken())
  const [teacher, setTeacher] = useState(() => readTeacherToken() ? readTeacherProfile() : null)

  function loginStudent(id) {
    const expiry = Date.now() + STUDENT_TTL
    localStorage.setItem(STUDENT_KEY, id)
    localStorage.setItem(STUDENT_EXPIRY_KEY, String(expiry))
    localStorage.setItem(STUDENT_REMEMBERED_KEY, 'true')
    localStorage.removeItem(TEACHER_TOKEN_KEY)
    localStorage.removeItem(TEACHER_PROFILE_KEY)
    localStorage.removeItem(TEACHER_EXPIRY_KEY)
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
    const expiry = Date.now() + TEACHER_TTL
    localStorage.setItem(TEACHER_TOKEN_KEY, payload.token)
    localStorage.setItem(TEACHER_PROFILE_KEY, JSON.stringify(profile))
    localStorage.setItem(TEACHER_EXPIRY_KEY, String(expiry))
    localStorage.removeItem(STUDENT_KEY)
    localStorage.removeItem(STUDENT_EXPIRY_KEY)
    localStorage.removeItem(STUDENT_REMEMBERED_KEY)
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
    localStorage.removeItem(STUDENT_EXPIRY_KEY)
    localStorage.removeItem(STUDENT_REMEMBERED_KEY)
    setStudentId(null)
  }

  function clearTeacher() {
    localStorage.removeItem(TEACHER_TOKEN_KEY)
    localStorage.removeItem(TEACHER_PROFILE_KEY)
    localStorage.removeItem(TEACHER_EXPIRY_KEY)
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
