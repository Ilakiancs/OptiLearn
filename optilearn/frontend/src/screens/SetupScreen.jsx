import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ChalkboardTeacher, Eye, EyeSlash, ShieldCheck, Student, Users, WifiHigh } from '@phosphor-icons/react'
import { getSetupRequired, setupAdmin } from '../api/client'
import { useAuth } from '../context/AuthContext'

const inputStyle = {
  minHeight: 46,
  borderRadius: 12,
  border: '1px solid #dadce0',
  padding: '10px 12px',
  background: '#fff',
  color: '#202124',
}

const secretInputProps = {
  type: 'text',
  autoComplete: 'off',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-form-type': 'other',
}

export default function SetupScreen() {
  const navigate = useNavigate()
  const { loginTeacher } = useAuth()
  const [checking, setChecking] = useState(true)
  const [required, setRequired] = useState(false)
  const [showHotspotStep, setShowHotspotStep] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ display_name: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSetupRequired()
      .then((data) => setRequired(!!data.setup_required))
      .catch(() => setRequired(true))
      .finally(() => setChecking(false))
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.display_name.trim() || !form.username.trim() || !form.password) {
      setError('Please complete every field.')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    try {
      const payload = await setupAdmin({
        display_name: form.display_name.trim(),
        username: form.username.trim(),
        password: form.password,
      })
      loginTeacher(payload)
      if (localStorage.getItem('optilearn_hotspot_onboarding_done') === '1') {
        navigate('/teacher', { replace: true })
      } else {
        setShowHotspotStep(true)
      }
    } catch (err) {
      setError(err.message || 'Setup could not be completed.')
      setSaving(false)
    }
  }

  function finishHotspotStep() {
    localStorage.setItem('optilearn_hotspot_onboarding_done', '1')
    navigate('/teacher', { replace: true })
  }

  if (checking) return <div className="app-shell" style={{ minHeight: '100vh' }} />
  if (!required) return <Navigate to="/" replace />

  if (showHotspotStep) {
    const steps = [
      {
        Icon: WifiHigh,
        title: 'Turn on your WiFi Hotspot',
        description: "Go to Windows Settings > Network > Mobile Hotspot > Turn On. Name it 'OptiLearn' so students know which network to join.",
        action: (
          <a href="ms-settings:network-mobilehotspot" style={{ ...inputStyle, minHeight: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', fontWeight: 700, color: '#2a8dbf', background: 'rgba(42,141,191,0.12)' }}>
            Open Hotspot Settings
          </a>
        ),
      },
      {
        Icon: ShieldCheck,
        title: 'Run as Administrator for best experience',
        description: "Right-click the OptiLearn shortcut and select 'Run as administrator'. This enables automatic student connection when they join your WiFi.",
      },
      {
        Icon: Users,
        title: 'Students connect automatically',
        description: 'Once your hotspot is on, students who join your WiFi can open OptiLearn from the sign-in prompt, QR code, or classroom address.',
      },
    ]

    return (
      <main style={{ minHeight: '100vh', background: '#fff', color: '#202124', display: 'grid', placeItems: 'center', padding: 20 }}>
        <section style={{ width: '100%', maxWidth: 760, display: 'grid', gap: 18 }}>
          <header style={{ textAlign: 'center', display: 'grid', gap: 8 }}>
            <span style={{ margin: '0 auto', width: 62, height: 62, borderRadius: 16, background: 'rgba(42,141,191,0.12)', color: '#2a8dbf', display: 'grid', placeItems: 'center' }}>
              <WifiHigh size={32} weight="duotone" />
            </span>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.55rem' }}>One more thing before your first class</h1>
              <p style={{ margin: '6px 0 0', color: '#5f6368' }}>Set up the classroom connection so students can join smoothly.</p>
            </div>
          </header>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
            {steps.map(({ Icon, title, description, action }) => (
              <section key={title} style={{ border: '1px solid #dadce0', borderRadius: 12, padding: 16, display: 'grid', gap: 10, alignContent: 'start' }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(42,141,191,0.12)', color: '#2a8dbf', display: 'grid', placeItems: 'center' }}>
                  <Icon size={24} weight="duotone" />
                </span>
                <h2 style={{ margin: 0, fontSize: '1rem' }}>{title}</h2>
                <p style={{ margin: 0, color: '#5f6368', lineHeight: 1.55, fontSize: '0.9rem' }}>{description}</p>
                {action}
              </section>
            ))}
          </div>

          <button type="button" onClick={finishHotspotStep} style={{ minHeight: 48, border: 'none', borderRadius: 12, background: '#2a8dbf', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
            Got it, open dashboard
          </button>
        </section>
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: '#fff', color: '#202124', display: 'grid', placeItems: 'center', padding: 20 }}>
      <section style={{ width: '100%', maxWidth: 430, display: 'grid', gap: 18 }}>
        <header style={{ textAlign: 'center', display: 'grid', gap: 10 }}>
          <span style={{ margin: '0 auto', width: 62, height: 62, borderRadius: 16, background: 'rgba(42,141,191,0.12)', color: '#2a8dbf', display: 'grid', placeItems: 'center' }}>
            <Student size={32} weight="duotone" />
          </span>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.55rem' }}>Welcome to OptiLearn</h1>
            <p style={{ margin: '6px 0 0', color: '#5f6368' }}>Create your admin teacher account to get started.</p>
          </div>
        </header>

        <form onSubmit={submit} style={{ border: '1px solid #dadce0', borderRadius: 12, padding: 18, display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ color: '#5f6368', fontSize: '0.84rem' }}>Display Name</span>
            <input style={inputStyle} value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Ms. Fatima" />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ color: '#5f6368', fontSize: '0.84rem' }}>Username</span>
            <input style={inputStyle} value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="admin" autoComplete="username" />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ color: '#5f6368', fontSize: '0.84rem' }}>Password</span>
            <div style={{ display: 'flex', border: '1px solid #dadce0', borderRadius: 12, overflow: 'hidden' }}>
              <input
                {...secretInputProps}
                name="optilearn_setup_password"
                style={{ ...inputStyle, border: 'none', borderRadius: 0, flex: 1, WebkitTextSecurity: showPassword ? 'none' : 'disc' }}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label="Toggle password visibility" style={{ width: 48, border: 'none', background: '#f8fafd', color: '#5f6368', cursor: 'pointer' }}>
                {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ color: '#5f6368', fontSize: '0.84rem' }}>Confirm Password</span>
            <input {...secretInputProps} name="optilearn_setup_password_confirm" style={{ ...inputStyle, WebkitTextSecurity: 'disc' }} value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
          </label>
          {error && <div style={{ color: '#d93025', fontSize: '0.84rem' }}>{error}</div>}
          <button type="submit" disabled={saving} style={{ minHeight: 46, border: 'none', borderRadius: 12, background: '#2a8dbf', color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <ChalkboardTeacher size={18} weight="duotone" />
            {saving ? 'Creating...' : 'Create Admin Account'}
          </button>
        </form>
      </section>
    </main>
  )
}
