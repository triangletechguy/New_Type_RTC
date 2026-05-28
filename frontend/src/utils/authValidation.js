export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function getEmailError(value) {
  const email = normalizeEmail(value)
  const emailPattern = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

  if (!email) return 'Email is required.'
  if (!emailPattern.test(email)) return 'Use a valid email like name@gmail.com or name@company.com.'

  return ''
}

export function getPasswordError(value, { strong = false } = {}) {
  const password = String(value || '')

  if (!password) return 'Password is required.'
  if (!strong) return ''

  if (password.length < 10) return 'Use at least 10 characters.'
  if (!/[a-z]/.test(password)) return 'Add a lowercase letter.'
  if (!/[A-Z]/.test(password)) return 'Add an uppercase letter.'
  if (!/\d/.test(password)) return 'Add a number.'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Add a symbol.'

  return ''
}

export function validateAuthFields({ mode, name, email, password }) {
  const errors = {}

  if (mode === 'register' && String(name || '').trim().length < 2) {
    errors.name = 'Name must be at least 2 characters.'
  }

  const emailError = getEmailError(email)
  if (emailError) errors.email = emailError

  const passwordError = getPasswordError(password, { strong: mode === 'register' })
  if (passwordError) errors.password = passwordError

  return errors
}
