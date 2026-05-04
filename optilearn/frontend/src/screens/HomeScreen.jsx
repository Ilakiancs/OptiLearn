import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle, Eye, EyeSlash, LockKey, Student, UserCircle, UserPlus, WarningCircle } from '@phosphor-icons/react'
import { checkStudentUsername, feature1, getSetupRequired, loginStudent, loginTeacher, signupStudent } from '../api/client'
import { useAuth } from '../context/AuthContext'

const GRADES = ['Pre-K', 'K', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']

const FALLBACK_LANGUAGES = [{ code: 'en', name: 'English', flag: 'GB' }]

const inputStyle = {
  minHeight: 46,
  border: '1px solid #dadce0',
  borderRadius: 12,
  padding: '10px 12px',
  background: '#fff',
  color: '#202124',
  width: '100%',
}

const secretInputProps = {
  type: 'text',
  autoComplete: 'off',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-form-type': 'other',
}

function Field({ label, hint, children, status }) {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={{ color: '#5f6368', fontSize: '0.84rem', fontWeight: 600 }}>{label}</span>
      {children}
      {(hint || status) && (
        <span style={{ color: status?.tone || '#5f6368', fontSize: '0.78rem', minHeight: 18 }}>
          {status?.text || hint}
        </span>
      )}
    </label>
  )
}

export default function HomeScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const { loginTeacher: storeTeacher, loginStudent: storeStudent, teacherToken, studentId } = useAuth()
  const [tab, setTab] = useState('signin')
  const [showSecret, setShowSecret] = useState(false)
  const [checkingSetup, setCheckingSetup] = useState(true)
  const [signin, setSignin] = useState({ username: '', password: '' })
  const [signup, setSignup] = useState({ name: '', username: '', grade_level: '7th', language: 'en', pin: '', confirmPin: '' })
  const [languages, setLanguages] = useState([])
  const [usernameState, setUsernameState] = useState({ status: 'idle', message: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sessionMessage = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('reason') === 'session_expired'
      ? 'Session expired. Please sign in again.'
      : ''
  }, [location.search])

  useEffect(() => {
    getSetupRequired()
      .then((data) => {
        if (data.setup_required) navigate('/setup', { replace: true })
        else if (teacherToken) navigate('/teacher', { replace: true })
        else if (studentId) navigate(`/student/${studentId}`, { replace: true })
      })
      .finally(() => setCheckingSetup(false))
  }, [navigate, teacherToken, studentId])

  useEffect(() => {
    feature1.getLanguages()
      .then((items) => setLanguages(Array.isArray(items) ? items : []))
      .catch(() => setLanguages(FALLBACK_LANGUAGES))
  }, [])

  useEffect(() => {
    const username = signup.username.trim()
    if (tab !== 'signup' || username.length < 3) {
      setUsernameState({ status: 'idle', message: '' })
      return
    }
    setUsernameState({ status: 'checking', message: 'Checking username...' })
    const id = setTimeout(() => {
      checkStudentUsername(username)
        .then((res) => {
          setUsernameState(res.available
            ? { status: 'ok', message: 'Username is available.' }
            : { status: 'taken', message: 'That username is already in use.' })
        })
        .catch((err) => setUsernameState({ status: 'taken', message: err.message || 'Choose a simpler username.' }))
    }, 500)
    return () => clearTimeout(id)
  }, [signup.username, tab])

  async function submitSignin(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const username = signin.username.trim()
    const password = signin.password
    try {
      const teacher = await loginTeacher({ username, password })
      storeTeacher(teacher)
      navigate('/teacher', { replace: true })
      return
    } catch (teacherErr) {
      if (teacherErr.status && teacherErr.status !== 401) {
        setError(teacherErr.message)
        setBusy(false)
        return
      }
    }

    try {
      const student = await loginStudent({ username, pin: password })
      storeStudent(student.student_id)
      navigate(`/student/${student.student_id}`, { replace: true })
    } catch (_) {
      setError('Incorrect username or password. Please try again.')
      setBusy(false)
    }
  }

  async function submitSignup(e) {
    e.preventDefault()
    setError('')
    if (!signup.name.trim()) {
      setError('Please add your name.')
      return
    }
    if (usernameState.status !== 'ok') {
      setError('Please choose an available username.')
      return
    }
    if (!/^\d{4}$/.test(signup.pin)) {
      setError('Choose exactly 4 numbers for your PIN.')
      return
    }
    if (signup.pin !== signup.confirmPin) {
      setError('PINs do not match yet.')
      return
    }
    setBusy(true)
    try {
      const student = await signupStudent({
        name: signup.name.trim(),
        username: signup.username.trim(),
        pin: signup.pin,
        grade_level: signup.grade_level,
        language: signup.language,
      })
      storeStudent(student.student_id)
      navigate(`/student/${student.student_id}`, { replace: true })
    } catch (err) {
      setError(err.message || 'Account could not be created.')
      setBusy(false)
    }
  }

  if (checkingSetup) return <div style={{ minHeight: '100vh', background: '#fff' }} />

  const usernameStatus = usernameState.status === 'ok'
    ? { text: usernameState.message, tone: '#188038' }
    : usernameState.status === 'taken'
      ? { text: usernameState.message, tone: '#d93025' }
      : usernameState.message
        ? { text: usernameState.message, tone: '#5f6368' }
        : null
  const languageOptions = languages.length ? languages : FALLBACK_LANGUAGES

  return (
    <main style={{ minHeight: '100vh', background: '#fff', color: '#202124', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 18, boxSizing: 'border-box' }}>
      <section style={{ width: '100%', maxWidth: 460, display: 'grid', gap: 18 }}>
        <header style={{ textAlign: 'center', display: 'grid', gap: 10 }}>
          <span style={{ margin: '0 auto', width: 64, height: 64, borderRadius: 16, background: '#e8f0fe', color: '#2a8dbf', display: 'grid', placeItems: 'center' }}>
            <Student size={34} weight="duotone" />
          </span>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.7rem', lineHeight: 1.15 }}>OptiLearn</h1>
            <p style={{ margin: '7px 0 0', color: '#5f6368' }}>Offline learning for every classroom.</p>
          </div>
        </header>

        <div style={{ border: '1px solid #dadce0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #dadce0' }}>
            {[
              ['signin', 'Sign In', UserCircle],
              ['signup', 'Sign Up', UserPlus],
            ].map(([key, label, Icon]) => (
              <button
                type="button"
                key={key}
                onClick={() => { setTab(key); setError('') }}
                style={{
                  minHeight: 46,
                  border: 'none',
                  background: tab === key ? '#e8f0fe' : '#fff',
                  color: tab === key ? '#2a8dbf' : '#5f6368',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Icon size={18} weight="duotone" />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={tab === 'signin' ? submitSignin : submitSignup} style={{ padding: 18, display: 'grid', gap: 13 }}>
            {sessionMessage && (
              <div style={{ border: '1px solid #fbbc04', background: '#fff8e1', color: '#7a4d00', borderRadius: 10, padding: '9px 11px', fontSize: '0.84rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <WarningCircle size={17} /> {sessionMessage}
              </div>
            )}

            {tab === 'signin' ? (
              <>
                <Field label="Username">
                  <input style={inputStyle} placeholder="Username" value={signin.username} onChange={(e) => setSignin((f) => ({ ...f, username: e.target.value }))} autoComplete="username" />
                </Field>
                <Field label="Password or PIN">
                  <div style={{ display: 'flex', border: '1px solid #dadce0', borderRadius: 12, overflow: 'hidden' }}>
                    <input
                      {...secretInputProps}
                      name="optilearn_signin_secret"
                      style={{ ...inputStyle, border: 'none', borderRadius: 0, WebkitTextSecurity: showSecret ? 'none' : 'disc' }}
                      placeholder="Password or PIN"
                      value={signin.password}
                      onChange={(e) => setSignin((f) => ({ ...f, password: e.target.value }))}
                    />
                    <button type="button" onClick={() => setShowSecret((v) => !v)} aria-label="Toggle password visibility" style={{ width: 48, border: 'none', background: '#f8fafd', color: '#5f6368', cursor: 'pointer' }}>
                      {showSecret ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
              </>
            ) : (
              <>
                <Field label="Full Name">
                  <input style={inputStyle} value={signup.name} onChange={(e) => setSignup((f) => ({ ...f, name: e.target.value }))} placeholder="Your name" autoComplete="name" />
                </Field>
                <Field label="Username" hint="Use your name or a nickname - keep it simple" status={usernameStatus}>
                  <div style={{ position: 'relative' }}>
                    <input style={{ ...inputStyle, paddingRight: 42 }} value={signup.username} onChange={(e) => setSignup((f) => ({ ...f, username: e.target.value }))} placeholder="Choose a username" autoComplete="username" />
                    {usernameState.status === 'ok' && <CheckCircle size={20} weight="fill" color="#188038" style={{ position: 'absolute', right: 12, top: 13 }} />}
                  </div>
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Grade Level">
                    <select style={inputStyle} value={signup.grade_level} onChange={(e) => setSignup((f) => ({ ...f, grade_level: e.target.value }))}>
                      {GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                    </select>
                  </Field>
                  <Field label="Language">
                    <select style={inputStyle} value={signup.language} onChange={(e) => setSignup((f) => ({ ...f, language: e.target.value }))}>
                      {languageOptions.map((language) => (
                        <option key={language.code} value={language.code}>
                          {language.flag ? `${language.flag} ` : ''}{language.name || language.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="PIN" hint="Choose 4 numbers you will remember">
                  <input {...secretInputProps} name="optilearn_signup_pin" style={{ ...inputStyle, WebkitTextSecurity: 'disc' }} value={signup.pin} onChange={(e) => setSignup((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))} inputMode="numeric" maxLength={4} />
                </Field>
                <Field label="Confirm PIN">
                  <input {...secretInputProps} name="optilearn_signup_pin_confirm" style={{ ...inputStyle, WebkitTextSecurity: 'disc' }} value={signup.confirmPin} onChange={(e) => setSignup((f) => ({ ...f, confirmPin: e.target.value.replace(/\D/g, '').slice(0, 4) }))} inputMode="numeric" maxLength={4} />
                </Field>
              </>
            )}

            {error && <div style={{ color: '#d93025', fontSize: '0.84rem' }}>{error}</div>}

            <button
              type="submit"
              disabled={busy}
              style={{ minHeight: 48, border: 'none', borderRadius: 12, background: '#2a8dbf', color: '#fff', fontWeight: 800, cursor: busy ? 'default' : 'pointer', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
            >
              {tab === 'signin' ? <LockKey size={18} weight="duotone" /> : <UserPlus size={18} weight="duotone" />}
              {busy ? 'Please wait...' : tab === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
