import { useEffect, useState } from 'react'
import { brandAssets } from '../../assets/rtc/catalog'
import {
  login as loginApi,
  register as registerApi,
  resendVerification,
  verifyEmail,
} from '../../services/api'
import { getPasswordError, normalizeEmail, validateAuthFields } from '../../utils/authValidation'

function titleForMode(mode) {
  if (mode === 'verify') return 'Verify your email'
  if (mode === 'register') return 'Create your account'
  return 'Welcome back'
}

export function AuthModal({ open, initialMode = 'login', initialEmail = '', reason = '', onClose, onAuthenticated }) {
  const [mode, setMode] = useState(initialMode)
  const [name, setName] = useState('')
  const [gender, setGender] = useState('')
  const [age, setAge] = useState('')
  const [currentResidence, setCurrentResidence] = useState('')
  const [birthday, setBirthday] = useState('')
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const passwordStrong = !getPasswordError(password, { strong: true })

  useEffect(() => {
    if (!open) return
    setMode(initialMode)
    setName('')
    setGender('')
    setAge('')
    setCurrentResidence('')
    setBirthday('')
    setEmail(initialEmail || '')
    setPassword('')
    setCode('')
    setFieldErrors({})
    setStatus(reason || (initialMode === 'register'
      ? 'Create your account, then verify your email code.'
      : 'Log in or create an account to continue.'))
  }, [open, initialMode, initialEmail, reason])

  function switchMode(nextMode) {
    setMode(nextMode)
    setFieldErrors({})
    setCode('')
    setStatus(nextMode === 'register'
      ? 'Create your account, then verify your email code.'
      : nextMode === 'verify'
        ? 'Enter the 6-digit code sent to your email.'
        : 'Log in to unlock rooms, chat, and profile tools.')
  }

  function updateField(field, value) {
    if (field === 'name') setName(value)
    if (field === 'gender') setGender(value)
    if (field === 'age') setAge(value.replace(/\D/g, '').slice(0, 3))
    if (field === 'current_residence') setCurrentResidence(value)
    if (field === 'birthday') setBirthday(value)
    if (field === 'email') setEmail(value)
    if (field === 'password') setPassword(value)
    if (field === 'code') setCode(value.replace(/\D/g, '').slice(0, 6))

    setFieldErrors((previous) => {
      if (!previous[field]) return previous
      const next = { ...previous }
      delete next[field]
      return next
    })
  }

  function finishAuth(data) {
    onAuthenticated(data.user)
    onClose()
  }

  async function handleLogin() {
    const nextErrors = validateAuthFields({ mode: 'login', email, password })
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setStatus('Please fix the highlighted login details.')
      return
    }

    setSubmitting(true)
    try {
      setStatus('Logging in...')
      const data = await loginApi(normalizeEmail(email), password)
      finishAuth(data)
    } catch (error) {
      if (error.requires_verification) {
        setEmail(error.email || normalizeEmail(email))
        switchMode('verify')
      }
      setStatus(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRegister() {
    const nextErrors = validateAuthFields({
      mode: 'register',
      name,
      gender,
      age,
      current_residence: currentResidence,
      birthday,
      email,
      password,
    })
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setStatus('Please fix the highlighted signup details.')
      return
    }

    setSubmitting(true)
    try {
      const normalizedEmail = normalizeEmail(email)
      setStatus('Creating account and sending code...')
      const data = await registerApi({
        name: name.trim(),
        gender,
        age: Number(age),
        current_residence: currentResidence.trim(),
        birthday,
        email: normalizedEmail,
        password,
      })
      setEmail(data.email || normalizedEmail)
      switchMode('verify')
      setCode('')
      setStatus(data.message || 'Verification code sent. Check your email inbox.')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerify() {
    const normalizedEmail = normalizeEmail(email)
    const nextErrors = {}
    if (!normalizedEmail) nextErrors.email = 'Email is required.'
    if (code.length !== 6) nextErrors.code = 'Enter the 6-digit code.'
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setStatus('Please enter the verification code from your email.')
      return
    }

    setSubmitting(true)
    try {
      setStatus('Verifying email...')
      const data = await verifyEmail(normalizedEmail, code)
      finishAuth(data)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) {
      setFieldErrors({ email: 'Email is required.' })
      return
    }

    setSubmitting(true)
    try {
      setStatus('Sending a new code...')
      const data = await resendVerification(normalizedEmail)
      setCode('')
      setStatus(data.message || 'A new verification code was sent. Check your email inbox.')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (mode === 'register') return handleRegister()
    if (mode === 'verify') return handleVerify()
    return handleLogin()
  }

  if (!open) return null

  return (
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <section className="auth-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <header className="auth-modal-header">
          <div className="auth-modal-brand">
            <span className="image-mark"><img src={brandAssets.appIcon} alt="" /></span>
            <div>
              <strong>TalkEachOther</strong>
              <small>Live video and music rooms</small>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close auth modal">x</button>
        </header>

        <div className="auth-heading">
          <span className="eyebrow">{mode === 'verify' ? 'Email code' : 'Account access'}</span>
          <h1 id="auth-modal-title">{titleForMode(mode)}</h1>
          <p>{mode === 'verify' ? `We sent a 6-digit code to ${email || 'your email address'}.` : 'Log in or sign up to join rooms, chat, create rooms, and manage your profile.'}</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => switchMode('login')} type="button">Login</button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => switchMode('register')} type="button">Signup</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <label>Name</label>
              <input value={name} onChange={(event) => updateField('name', event.target.value)} autoComplete="name" aria-invalid={Boolean(fieldErrors.name)} />
              {fieldErrors.name && <small className="form-error">{fieldErrors.name}</small>}
              <div className="auth-inline-fields">
                <div>
                  <label>Gender</label>
                  <select value={gender} onChange={(event) => updateField('gender', event.target.value)} aria-invalid={Boolean(fieldErrors.gender)}>
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="non_binary">Non-binary</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </select>
                  {fieldErrors.gender && <small className="form-error">{fieldErrors.gender}</small>}
                </div>
                <div>
                  <label>Age</label>
                  <input type="text" value={age} onChange={(event) => updateField('age', event.target.value)} inputMode="numeric" aria-invalid={Boolean(fieldErrors.age)} />
                  {fieldErrors.age && <small className="form-error">{fieldErrors.age}</small>}
                </div>
              </div>
              <div className="auth-inline-fields residence-fields">
                <div>
                  <label>Current Residence</label>
                  <input
                    value={currentResidence}
                    onChange={(event) => updateField('current_residence', event.target.value)}
                    autoComplete="country-name"
                    placeholder="Country"
                    aria-invalid={Boolean(fieldErrors.current_residence)}
                  />
                  {fieldErrors.current_residence && <small className="form-error">{fieldErrors.current_residence}</small>}
                </div>
                <div>
                  <label>Birthday</label>
                  <input
                    type="date"
                    value={birthday}
                    onChange={(event) => updateField('birthday', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.birthday)}
                  />
                  {fieldErrors.birthday && <small className="form-error">{fieldErrors.birthday}</small>}
                </div>
              </div>
            </>
          )}

          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(event) => updateField('email', event.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="name@gmail.com or name@company.com"
            aria-invalid={Boolean(fieldErrors.email)}
            disabled={mode === 'verify' && submitting}
          />
          {fieldErrors.email && <small className="form-error">{fieldErrors.email}</small>}

          {mode === 'verify' ? (
            <>
              <label>Verification code</label>
              <input className="auth-code-input" value={code} onChange={(event) => updateField('code', event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-invalid={Boolean(fieldErrors.code)} />
              {fieldErrors.code && <small className="form-error">{fieldErrors.code}</small>}
            </>
          ) : (
            <>
              <label>Password</label>
              <div className="password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => updateField('password', event.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'register' ? '10+ chars, upper, lower, number, symbol' : 'Password'}
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
            </>
          )}

          <button className="primary-button full-width" disabled={submitting} type="submit">
            {submitting ? 'Please wait...' : mode === 'verify' ? 'Verify and enter' : mode === 'register' ? 'Create account' : 'Login'}
          </button>
        </form>

        {mode === 'verify' ? (
          <button className="auth-resend-button" type="button" onClick={handleResend} disabled={submitting}>Resend code</button>
        ) : null}

        <div className="status-box">{status}</div>
      </section>
    </div>
  )
}
