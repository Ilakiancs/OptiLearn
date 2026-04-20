import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [studentId, setStudentId] = useState(
    () => sessionStorage.getItem('optilearn_sid') || null
  )

  function login(id) {
    setStudentId(id)
    sessionStorage.setItem('optilearn_sid', id)
  }

  function logout() {
    setStudentId(null)
    sessionStorage.removeItem('optilearn_sid')
  }

  return (
    <AuthContext.Provider value={{ studentId, login, logout, isLoggedIn: !!studentId }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
