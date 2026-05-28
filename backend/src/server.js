require('dotenv').config()

const express = require('express')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const { query } = require('./config/db')
const authRoutes = require('./routes/authRoutes')
const roomRoutes = require('./routes/roomRoutes')
const chatRoutes = require('./routes/chatRoutes')
const adminRoutes = require('./routes/adminRoutes')
const { registerSignaling } = require('./sockets/signaling')

const PORT = Number(process.env.PORT || 8000)

const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) {
    return callback(null, true)
  }
  return callback(new Error(`CORS blocked origin: ${origin}`), false)
}

const app = express()

app.use(cors({
  origin: corsOrigin,
  credentials: false,
}))

app.use(express.json({ limit: '10mb' }))

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
      message: 'Node RTC backend connected successfully',
    })
  } catch (error) {
    next(error)
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/rooms', roomRoutes)
app.use('/api', chatRoutes)
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
})

registerSignaling(io)

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Node RTC backend running on http://127.0.0.1:${PORT}`)
  console.log(`Socket.IO signaling running on http://127.0.0.1:${PORT}`)
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`)
})
