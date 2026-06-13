require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true })

const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const http = require('http')
const { Server } = require('socket.io')
const { query } = require('./config/db')
const authRoutes = require('./routes/authRoutes')
const roomRoutes = require('./routes/roomRoutes')
const chatRoutes = require('./routes/chatRoutes')
const adminRoutes = require('./routes/adminRoutes')
const clientRoutes = require('./routes/clientRoutes')
const feedbackRoutes = require('./routes/feedbackRoutes')
const { registerSignaling } = require('./sockets/signaling')
const { emailDeliveryStatus } = require('./utils/email')

const PORT = Number(process.env.PORT || 8000)

function positiveIntegerEnv(key, fallback) {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const SOCKET_MAX_HTTP_BUFFER_SIZE = positiveIntegerEnv('SOCKET_MAX_HTTP_BUFFER_SIZE', 20 * 1024 * 1024)

const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'

function isLocalDevOrigin(origin) {
  if (isProduction) return false

  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2', '10.0.3.2', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin) || isLocalDevOrigin(origin)) {
    return callback(null, true)
  }
  return callback(new Error(`CORS blocked origin: ${origin}`), false)
}

function splitUrls(value) {
  return String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
}

function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]
    if (value !== undefined && value !== '') return value
  }

  return ''
}

function parseIceServers(value) {
  if (!value) return null

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((server) => server?.urls) : null
  } catch {
    return null
  }
}

function iceServerHasTurn(server) {
  const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls]
  return urls.some((url) => String(url || '').startsWith('turn:') || String(url || '').startsWith('turns:'))
}

function iceServerHasCredentials(server) {
  return Boolean(server?.username && server?.credential)
}

function turnTtlSeconds() {
  const ttl = positiveIntegerEnv('TURN_TTL_SECONDS', 3600)
  return Math.min(Math.max(ttl, 300), 86400)
}

function createTemporaryTurnCredentials() {
  const secret = firstEnv('TURN_SHARED_SECRET', 'TURN_AUTH_SECRET')
  if (!secret) return null

  const ttl = turnTtlSeconds()
  const expiresAt = Math.floor(Date.now() / 1000) + ttl
  const username = `${expiresAt}:rtc`
  const credential = crypto
    .createHmac('sha1', secret)
    .update(username)
    .digest('base64')

  return {
    username,
    credential,
    expiresAt,
    ttl,
  }
}

function decorateTurnServers(iceServers, credentials) {
  if (!credentials) return iceServers

  return iceServers.map((server) => {
    if (!iceServerHasTurn(server)) return server
    return {
      ...server,
      username: server.username || credentials.username,
      credential: server.credential || credentials.credential,
    }
  })
}

function buildRtcConfig() {
  const configuredIceServers = parseIceServers(process.env.RTC_ICE_SERVERS || process.env.ICE_SERVERS)
  const stunUrls = splitUrls(process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
  const turnUrls = splitUrls(process.env.TURN_URLS || process.env.TURN_URL)
  const temporaryTurnCredentials = createTemporaryTurnCredentials()
  const staticTurnUsername = process.env.TURN_USERNAME || ''
  const staticTurnCredential = process.env.TURN_CREDENTIAL || ''

  if (configuredIceServers?.length) {
    const iceServers = decorateTurnServers(configuredIceServers, temporaryTurnCredentials)
    const turnConfigured = iceServers.some((server) => iceServerHasTurn(server) && (
      iceServerHasCredentials(server) || Boolean(temporaryTurnCredentials)
    ))
    const iceTransportPolicy = ['all', 'relay'].includes(process.env.RTC_ICE_TRANSPORT_POLICY)
      ? process.env.RTC_ICE_TRANSPORT_POLICY
      : 'all'

    return {
      iceServers,
      iceTransportPolicy,
      turnConfigured,
      turnCredentialType: temporaryTurnCredentials ? 'ephemeral' : turnConfigured ? 'static' : null,
      ...(temporaryTurnCredentials ? {
        turnExpiresAt: temporaryTurnCredentials.expiresAt,
        turnTtlSeconds: temporaryTurnCredentials.ttl,
      } : {}),
    }
  }

  const turnCredentials = temporaryTurnCredentials || (
    staticTurnUsername && staticTurnCredential
      ? { username: staticTurnUsername, credential: staticTurnCredential }
      : null
  )
  const turnConfigured = turnUrls.length > 0 && Boolean(turnCredentials)
  const iceTransportPolicy = ['all', 'relay'].includes(process.env.RTC_ICE_TRANSPORT_POLICY)
    ? process.env.RTC_ICE_TRANSPORT_POLICY
    : 'all'
  const iceServers = []
  if (stunUrls.length) iceServers.push({ urls: stunUrls })
  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: turnCredentials?.username || '',
      credential: turnCredentials?.credential || '',
    })
  }

  return {
    iceServers,
    iceTransportPolicy,
    turnConfigured,
    turnCredentialType: temporaryTurnCredentials ? 'ephemeral' : turnCredentials ? 'static' : null,
    ...(temporaryTurnCredentials ? {
      turnExpiresAt: temporaryTurnCredentials.expiresAt,
      turnTtlSeconds: temporaryTurnCredentials.ttl,
    } : {}),
  }
}

const app = express()

app.use(cors({
  origin: corsOrigin,
  credentials: false,
}))

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '40mb' }))

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'talk-each-other RTC Node backend is running',
    endpoints: {
      health: '/api/health',
      login: '/api/auth/login',
      rooms: '/api/rooms',
      socket: '/socket.io'
    }
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Node RTC backend is running' })
})

app.get('/api/health', async (req, res, next) => {
  try {
    const rows = await query('SELECT DATABASE() AS db_name')
    const tableRows = await query(
      `
      SELECT COUNT(*) AS total_tables
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      `
    )

    res.json({
      status: 'ok',
      database: rows[0]?.db_name || null,
      total_tables: tableRows[0]?.total_tables || 0,
      email_delivery: emailDeliveryStatus(),
      message: 'Node RTC backend connected successfully',
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/rtc/config', (req, res) => {
  res.json(buildRtcConfig())
})

app.use('/api/auth', authRoutes)
app.use('/api/client', clientRoutes)
app.use('/api/rooms', roomRoutes)
app.use('/api', chatRoutes)
app.use('/api/feedback', feedbackRoutes)
app.use('/api/admin', adminRoutes)

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

app.use((error, req, res, next) => {
  console.error(error)
  res.status(error.status || 500).json({
    message: error.message || 'Server error',
  })
})

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: false,
  },
  maxHttpBufferSize: SOCKET_MAX_HTTP_BUFFER_SIZE,
  perMessageDeflate: false,
  pingInterval: 25000,
  pingTimeout: 60000,
  connectTimeout: 45000,
})

app.set('io', io)
registerSignaling(io)

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Node RTC backend running on http://127.0.0.1:${PORT}`)
  console.log(`Socket.IO signaling running on http://127.0.0.1:${PORT}`)
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`)
})
