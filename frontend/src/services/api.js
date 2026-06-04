function defaultApiBaseUrl() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8000/api'

  const { hostname, port, protocol, origin } = window.location
  const localDevHost = hostname === 'localhost' || hostname === '127.0.0.1'

  if (localDevHost && ['5173', '5174', '4173'].includes(port)) {
    return `${protocol}//${hostname}:8000/api`
  }

  return `${origin}/api`
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || defaultApiBaseUrl()
export const AUTH_EXPIRED_EVENT = 'rtc:auth-expired'
const LEGACY_SUPERADMIN_EMAILS = new Set(['superadmin@talkeachother.com', 'superadmin@chadnichok.com'])
const SUPERADMIN_EMAIL = 'admin@gmail.com'

function normalizeUserForClient(user) {
  if (!user) return user

  const email = String(user.email || '').toLowerCase()
  if (!LEGACY_SUPERADMIN_EMAILS.has(email)) return user

  return {
    ...user,
    email: SUPERADMIN_EMAIL,
  }
}

function notifyAuthExpired() {
  clearSession()

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
}

function cleanApiErrorMessage(data, status) {
  const message = String(data?.message || `Request failed with status ${status}`)

  if (/api key is invalid/i.test(message) || /"statusCode"\s*:\s*401/i.test(message)) {
    return 'Email delivery is connected, but the email API key is invalid. Update the server email settings and try again.'
  }

  if (/validation_error|email provider rejected/i.test(message)) {
    return 'Email delivery is connected, but the email provider rejected the request. Check the sender domain/settings and try again.'
  }

  return message
}

export function getToken() {
  return localStorage.getItem('rtc_access_token') || ''
}

export function getUser() {
  const saved = localStorage.getItem('rtc_user')
  if (!saved) return null

  try {
    return normalizeUserForClient(JSON.parse(saved))
  } catch {
    return null
  }
}

export function saveSession(token, user) {
  const normalizedUser = normalizeUserForClient(user)
  localStorage.setItem('rtc_access_token', token)
  localStorage.setItem('rtc_user', JSON.stringify(normalizedUser))
}

export function saveUser(user) {
  localStorage.setItem('rtc_user', JSON.stringify(normalizeUserForClient(user)))
}

export function clearSession() {
  localStorage.removeItem('rtc_access_token')
  localStorage.removeItem('rtc_user')
}

export async function apiRequest(path, options = {}) {
  const token = getToken()
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  let response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    })
  } catch (error) {
    throw new Error(`Backend is unreachable. Check that Node backend is running on ${API_BASE_URL}.`)
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const requestError = new Error(cleanApiErrorMessage(data, response.status))
    requestError.status = response.status
    requestError.errors = data.errors || {}
    requestError.data = data
    requestError.email = data.email
    if (response.status === 401) notifyAuthExpired()
    throw requestError
  }

  return data
}

export async function login(email, password) {
  const data = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  saveSession(data.access_token, data.user)
  data.user = normalizeUserForClient(data.user)
  return data
}

export async function refreshCurrentUser() {
  const data = await apiRequest('/auth/me')

  saveUser(data.user)
  data.user = normalizeUserForClient(data.user)
  return data
}

export async function register({ name, gender, age, current_residence, birthday, email, password }) {
  const data = await apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, gender, age, current_residence, birthday, email, password }),
  })

  if (data.access_token && data.user) {
    saveSession(data.access_token, data.user)
  }
  data.user = normalizeUserForClient(data.user)
  return data
}

export async function updateProfile(profile) {
  const data = await apiRequest('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(profile),
  })

  saveUser(data.user)
  data.user = normalizeUserForClient(data.user)
  return data
}

export async function getRtcConfig() {
  return apiRequest('/rtc/config')
}
