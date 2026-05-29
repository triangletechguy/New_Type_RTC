import { useState } from 'react'
import { login as loginApi, register as registerApi } from '../../services/api'
import { getPasswordError, normalizeEmail, validateAuthFields } from '../../utils/authValidation'

export function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('Test User')
  const [email, setEmail] = useState('superadmin@talkeachother.com')
  const [password, setPassword] = useState('123!@#')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [status, setStatus] = useState('Use superadmin@talkeachother.com or admin@accenture.com with password 123!@#.')
  const [submitting, setSubmitting] = useState(false)
  const passwordStrong = !getPasswordError(password, { strong: true })

  function switchMode(nextMode) {
    setMode(nextMode)
    setFieldErrors({})
    setStatus(nextMode === 'login'
      ? 'Use superadmin@talkeachother.com or admin@accenture.com with password 123!@#.'
      : 'Create a host profile for video rooms, music rooms, and live chat.')
  }

  function updateAuthField(field, value) {
    if (field === 'name') setName(value)
    if (field === 'email') setEmail(value)
    if (field === 'password') setPassword(value)

    setFieldErrors((previous) => {
      if (!previous[field]) return previous
      const next = { ...previous }
      delete next[field]
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const nextErrors = validateAuthFields({ mode, name, email, password })
    setFieldErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      setStatus('Please fix the highlighted login details.')
      return
    }

    setSubmitting(true)

    try {
      const normalizedEmail = normalizeEmail(email)

      if (mode === 'register') {
        setStatus('Creating account...')
        await registerApi(name.trim(), normalizedEmail, password)
        setStatus('Account created. Logging in...')
      } else {
        setStatus('Logging in...')
      }

      const data = await loginApi(normalizedEmail, password)
      onLogin(data.access_token, data.user)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-showcase" aria-label="Live room preview">
        <div className="showcase-topbar">
          <div className="app-mark">TE</div>
          <div>
            <strong>TalkEachOther</strong>
            <span>Live video and music rooms</span>
          </div>
          <div className="online-pill"><span></span> Online</div>
        </div>

        <div className="phone-preview">
          <div className="phone-toolbar">
            <button type="button" className="preview-tab active">Hot</button>
            <button type="button" className="preview-tab">Nearby</button>
            <button type="button" className="preview-tab">New</button>
          </div>

          <div className="preview-live-card">
            <div className="live-chip"><span></span> LIVE</div>
            <div className="preview-host">
              <div className="preview-avatar">T</div>
              <div>
                <strong>talk-each-other Studio</strong>
                <span>Video and music hosts on stage</span>
              </div>
            </div>
            <div className="preview-meter">
              <span>2.4K watching</span>
              <span>Native RTC</span>
            </div>
          </div>

          <div className="mini-live-grid">
            <div className="mini-live-card tone-video">
              <div>Video Room</div>
              <strong>Daily Standup</strong>
              <span>8 seats</span>
            </div>
            <div className="mini-live-card tone-music">
              <div>Music Room</div>
              <strong>Open Mic Lounge</strong>
              <span>12 seats</span>
            </div>
          </div>
        </div>

        <div className="showcase-stats">
          <div><span>Latency</span><strong>Low</strong></div>
          <div><span>Rooms</span><strong>Live</strong></div>
          <div><span>Mode</span><strong>{import.meta.env.VITE_MEDIA_MODE || 'Real'}</strong></div>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-heading">
          <span className="eyebrow">Welcome back</span>
          <h1>Enter video and music rooms</h1>
          <p>Sign in or create a host profile for live RTC rooms, chat, and creator flows.</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => switchMode('login')} type="button">Login</button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => switchMode('register')} type="button">Register</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <label>Name</label>
              <input
                value={name}
                onChange={(event) => updateAuthField('name', event.target.value)}
                autoComplete="name"
                required
                aria-invalid={Boolean(fieldErrors.name)}
              />
              {fieldErrors.name && <small className="form-error">{fieldErrors.name}</small>}
            </>
          )}

          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(event) => updateAuthField('email', event.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="name@gmail.com or name@company.com"
            required
            aria-invalid={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email && <small className="form-error">{fieldErrors.email}</small>}

          <label>Password</label>
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => updateAuthField('password', event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? '10+ chars, upper, lower, number, symbol' : 'Password'}
              required
              aria-invalid={Boolean(fieldErrors.password)}
            />
            <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-pressed={showPassword}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {fieldErrors.password && <small className="form-error">{fieldErrors.password}</small>}
          {mode === 'register' && (
            <div className={passwordStrong ? 'password-strength strong' : 'password-strength'}>
              <span>{passwordStrong ? 'Strong password' : 'Use 10+ characters with uppercase, lowercase, number, and symbol.'}</span>
            </div>
          )}

          <button className="primary-button full-width" disabled={submitting} type="submit">
            {submitting ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>

        <div className="status-box">{status}</div>
      </section>
    </main>
  )
}
