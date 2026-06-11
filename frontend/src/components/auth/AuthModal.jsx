import { useEffect, useState } from 'react'
import { brandAssets } from '../../assets/rtc/catalog'
import {
  login as loginApi,
  register as registerApi,
} from '../../services/api'
import { getPasswordError, normalizeEmail, validateAuthFields } from '../../utils/authValidation'
import { translateApp } from '../rooms/roomsStaticData'

function titleForMode(mode, t) {
  if (mode === 'register') return t('Create your account')
  return t('Welcome back')
}

function messageForAuthError(error) {
  const rawMessage = String(error?.message || error?.data?.message || '')

  return rawMessage || 'Request failed. Please try again.'
}

export function AuthModal({ open, initialMode = 'login', initialEmail = '', reason = '', language = 'English', onClose, onAuthenticated }) {
  const [mode, setMode] = useState(initialMode)
  const [name, setName] = useState('')
  const [gender, setGender] = useState('')
  const [age, setAge] = useState('')
  const [currentResidence, setCurrentResidence] = useState('')
  const [birthday, setBirthday] = useState('')
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const passwordStrong = !getPasswordError(password, { strong: true })
  const t = (key, replacements = {}) => translateApp(language, key, replacements)

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
    setFieldErrors({})
    setStatus(reason || (initialMode === 'register'
      ? 'Create your account to enter immediately.'
      : 'Log in or create an account to continue.'))
  }, [open, initialMode, initialEmail, reason])

  function switchMode(nextMode) {
    setMode(nextMode)
    setFieldErrors({})
    setStatus(nextMode === 'register'
      ? 'Create your account to enter immediately.'
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
      setStatus(messageForAuthError(error))
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
      setStatus('Creating account...')
      const data = await registerApi({
        name: name.trim(),
        gender,
        age: age ? Number(age) : null,
        current_residence: currentResidence.trim() || null,
        birthday: birthday || null,
        email: normalizedEmail,
        password,
      })
      finishAuth(data)
    } catch (error) {
      setStatus(messageForAuthError(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (mode === 'register') return handleRegister()
    return handleLogin()
  }

  if (!open) return null

  return (
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <section className="auth-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <header className="auth-modal-header">
          <div className="auth-modal-brand">
            <span className="image-mark"><img src={brandAssets.appIconSmall} alt="" decoding="async" /></span>
            <div>
              <strong>TalkEachOther</strong>
              <small>{t('Live video and music rooms')}</small>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close auth modal')}>x</button>
        </header>

        <div className="auth-heading">
          <span className="eyebrow">{t('Account access')}</span>
          <h1 id="auth-modal-title">{titleForMode(mode, t)}</h1>
          <p>{t('Log in or sign up to join rooms, chat, create rooms, and manage your profile.')}</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => switchMode('login')} type="button">{t('Login')}</button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => switchMode('register')} type="button">{t('Signup')}</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <label>{t('Name')}</label>
              <input value={name} onChange={(event) => updateField('name', event.target.value)} autoComplete="name" aria-invalid={Boolean(fieldErrors.name)} />
              {fieldErrors.name && <small className="form-error">{t(fieldErrors.name)}</small>}
              <div className="auth-inline-fields">
                <div>
                  <label>{t('Gender')}</label>
                  <select value={gender} onChange={(event) => updateField('gender', event.target.value)} aria-invalid={Boolean(fieldErrors.gender)}>
                    <option value="">{t('Select gender')}</option>
                    <option value="male">{t('Male')}</option>
                    <option value="female">{t('Female')}</option>
                    <option value="non_binary">{t('Non-binary')}</option>
                    <option value="prefer_not_to_say">{t('Prefer not to say')}</option>
                  </select>
                  {fieldErrors.gender && <small className="form-error">{t(fieldErrors.gender)}</small>}
                </div>
                <div>
                  <label>{t('Age')}</label>
                  <input type="text" value={age} onChange={(event) => updateField('age', event.target.value)} inputMode="numeric" aria-invalid={Boolean(fieldErrors.age)} />
                  {fieldErrors.age && <small className="form-error">{t(fieldErrors.age)}</small>}
                </div>
              </div>
              <div className="auth-inline-fields residence-fields">
                <div>
                  <label>{t('Current Residence')}</label>
                  <input
                    value={currentResidence}
                    onChange={(event) => updateField('current_residence', event.target.value)}
                    autoComplete="country-name"
                    placeholder={t('Country')}
                    aria-invalid={Boolean(fieldErrors.current_residence)}
                  />
                  {fieldErrors.current_residence && <small className="form-error">{t(fieldErrors.current_residence)}</small>}
                </div>
                <div>
                  <label>{t('Birthday')}</label>
                  <input
                    type="date"
                    value={birthday}
                    onChange={(event) => updateField('birthday', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.birthday)}
                  />
                  {fieldErrors.birthday && <small className="form-error">{t(fieldErrors.birthday)}</small>}
                </div>
              </div>
            </>
          )}

          <label>{t('Email')}</label>
          <input
            type="email"
            value={email}
            onChange={(event) => updateField('email', event.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="name@gmail.com or name@company.com"
            aria-invalid={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email && <small className="form-error">{t(fieldErrors.email)}</small>}

          <label>{t('Password')}</label>
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => updateField('password', event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? t('10+ chars, upper, lower, number, symbol') : t('Password')}
              aria-invalid={Boolean(fieldErrors.password)}
            />
            <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-pressed={showPassword}>
              {showPassword ? t('Hide') : t('Show')}
            </button>
          </div>
          {fieldErrors.password && <small className="form-error">{t(fieldErrors.password)}</small>}
          {mode === 'register' && (
            <div className={passwordStrong ? 'password-strength strong' : 'password-strength'}>
              <span>{passwordStrong ? t('Strong password') : t('Use 10+ characters with uppercase, lowercase, number, and symbol.')}</span>
            </div>
          )}

          <button className="primary-button full-width" disabled={submitting} type="submit">
            {submitting ? t('Please wait...') : mode === 'register' ? t('Create account') : t('Login')}
          </button>
        </form>

        <div className="status-box">{t(status)}</div>
      </section>
    </div>
  )
}
