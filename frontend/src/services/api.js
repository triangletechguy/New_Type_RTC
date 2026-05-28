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

export function getToken() {
  return localStorage.getItem('rtc_access_token') || ''
}

export function getUser() {
  const saved = localStorage.getItem('rtc_user')
  if (!saved) return null

  try {
    return JSON.parse(saved)
  } catch {
    return null
  }
}

export function saveSession(token, user) {
  localStorage.setItem('rtc_access_token', token)
  localStorage.setItem('rtc_user', JSON.stringify(user))
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
    const requestError = new Error(data.message || `Request failed with status ${response.status}`)
    requestError.status = response.status
    requestError.errors = data.errors || {}
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
  return data
}

export async function register(name, email, password) {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })
}
