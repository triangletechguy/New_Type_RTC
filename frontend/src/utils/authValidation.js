export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function getEmailError(value) {
  const email = normalizeEmail(value)
  const emailPattern = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

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

function getBirthdayError(value) {
  const birthday = String(value || '').trim()
  if (!birthday) return 'Birthday is required.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return 'Choose a valid birthday.'

  const date = new Date(`${birthday}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) {
    return 'Choose a valid birthday.'
  }

  const today = new Date()
  let age = today.getUTCFullYear() - date.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - date.getUTCMonth()
  const dayDiff = today.getUTCDate() - date.getUTCDate()
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1

  if (age < 13) return 'You must be at least 13 years old.'
  if (age > 120) return 'Choose a realistic birthday.'
  return ''
}

export function validateAuthFields({ mode, name, gender, age, current_residence, birthday, email, password }) {
  const errors = {}

  if (mode === 'register' && String(name || '').trim().length < 2) {
    errors.name = 'Name must be at least 2 characters.'
  }

  if (mode === 'register') {
    if (!String(gender || '').trim()) errors.gender = 'Gender is required.'

    const numericAge = Number(age)
    if (!Number.isInteger(numericAge) || numericAge < 13 || numericAge > 120) {
      errors.age = 'Age must be between 13 and 120.'
    }

    if (String(current_residence || '').trim().length < 2) {
      errors.current_residence = 'Current residence country is required.'
    }

    const birthdayError = getBirthdayError(birthday)
    if (birthdayError) errors.birthday = birthdayError
  }

  const emailError = getEmailError(email)
  if (emailError) errors.email = emailError

  const passwordError = getPasswordError(password, { strong: mode === 'register' })
  if (passwordError) errors.password = passwordError

  return errors
}
