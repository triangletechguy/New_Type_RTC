const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const frontendEnv = readEnvFile(path.join(projectRoot, 'frontend/.env'))

const endpoints = [
  {
    name: 'backend',
    candidates: [process.env.HEALTH_BACKEND_URL || process.env.BACKEND_HEALTH_URL || 'http://127.0.0.1:8000/health'],
    validate: validateJsonHealth,
  },
  {
    name: 'database',
    candidates: [process.env.HEALTH_DATABASE_URL || process.env.DATABASE_HEALTH_URL || 'http://127.0.0.1:8000/api/health'],
    validate: validateJsonHealth,
  },
  {
    name: 'frontend',
    candidates: frontendCandidates(),
    validate: validateFrontendHtml,
  },
]

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return env

      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex < 1) return env

      const key = trimmed.slice(0, separatorIndex).trim()
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
      env[key] = value
      return env
    }, {})
}

function normalizeHttpUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''

  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.href
  } catch {
    return ''
  }
}

function frontendOriginFromApiUrl(value) {
  const text = normalizeHttpUrl(value)
  if (!text) return ''

  const url = new URL(text)
  const isLocalBackend = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) && url.port === '8000'
  if (isLocalBackend) return ''

  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.href
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

function frontendCandidates() {
  const webRoot = process.env.WEB_ROOT || '/var/www/rtc-enterprise'
  return [
    ...unique([
      normalizeHttpUrl(process.env.HEALTH_FRONTEND_URL || process.env.FRONTEND_HEALTH_URL),
      normalizeHttpUrl(process.env.PUBLIC_URL || process.env.DOMAIN),
      normalizeHttpUrl(frontendEnv.VITE_FRONTEND_URL),
      frontendOriginFromApiUrl(frontendEnv.VITE_API_BASE_URL),
      'http://127.0.0.1:5173/',
      'http://127.0.0.1:4173/',
    ]).map((url) => ({ type: 'http', value: url, label: url })),
    { type: 'file', value: path.join(webRoot, 'index.html'), label: `${webRoot}/index.html` },
    { type: 'file', value: path.join(projectRoot, 'frontend/dist/index.html'), label: 'frontend/dist/index.html' },
  ]
}

function validateJsonHealth(body) {
  return body && typeof body === 'object' && (body.status === 'ok' || body.message)
}

function validateFrontendHtml(body) {
  if (typeof body !== 'string') return false
  const normalized = body.toLowerCase()
  return normalized.includes('<!doctype html')
    || normalized.includes('<div id="root"')
    || normalized.includes('/assets/')
}

async function checkHttp(candidate, validate) {
  const response = await fetch(candidate.value)
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text()

  if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` }
  if (validate && !validate(body)) return { ok: false, detail: 'unexpected response' }

  const detail = typeof body === 'string'
    ? candidate.label
    : body.message || body.status || candidate.label

  return { ok: true, detail }
}

function checkFile(candidate, validate) {
  if (!fs.existsSync(candidate.value)) return { ok: false, detail: 'missing file' }

  const body = fs.readFileSync(candidate.value, 'utf8')
  if (validate && !validate(body)) return { ok: false, detail: 'unexpected file contents' }
  return { ok: true, detail: candidate.label }
}

async function check(name, candidates, validate) {
  const failures = []

  for (const candidate of candidates) {
    try {
      const result = candidate.type === 'file'
        ? checkFile(candidate, validate)
        : await checkHttp(candidate, validate)

      if (result.ok) {
        console.log(`[ok] ${name}: ${result.detail}`)
        return true
      }

      failures.push(`${candidate.label}: ${result.detail}`)
    } catch (error) {
      failures.push(`${candidate.label}: ${error.message}`)
    }
  }

  console.log(`[fail] ${name}: ${failures.join('; ')}`)
  return false
}

async function main() {
  const results = []

  for (const endpoint of endpoints) {
    results.push(await check(endpoint.name, endpoint.candidates.map((candidate) => (
      typeof candidate === 'string'
        ? { type: 'http', value: candidate, label: candidate }
        : candidate
    )), endpoint.validate))
  }

  if (results.some((result) => !result)) process.exit(1)
}

main()
