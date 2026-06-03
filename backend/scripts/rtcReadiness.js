#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const mysql = require('mysql2/promise')

const PORT = Number(process.env.PORT || 8000)
const BASE_URL = String(process.env.RTC_READINESS_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '')
const REQUIRED_TABLES = [
  'rooms',
  'rtc_sessions',
  'rtc_session_participants',
  'rtc_quality_samples',
  'chat_messages',
  'usage_logs',
]
const REQUIRED_QUALITY_COLUMNS = [
  'quality',
  'peer_count',
  'measured_peer_count',
  'incoming_kbps',
  'outgoing_kbps',
  'rtt_ms',
  'packet_loss_pct',
  'local_candidate_types',
  'remote_candidate_types',
]

let failures = 0
let warnings = 0

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function ok(label, detail = '') {
  console.log(`[ok] ${label}${detail ? `: ${detail}` : ''}`)
}

function warn(label, detail = '') {
  warnings += 1
  console.log(`[warn] ${label}${detail ? `: ${detail}` : ''}`)
}

function fail(label, detail = '') {
  failures += 1
  console.log(`[fail] ${label}${detail ? `: ${detail}` : ''}`)
}

function hasTurnServer(iceServers = []) {
  return iceServers.some((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls]
    return urls.some((url) => /^turns?:/i.test(String(url || '')))
  })
}

async function fetchJson(path, label) {
  const response = await fetch(`${BASE_URL}${path}`)
  const text = await response.text()
  let data = null

  try {
    data = text ? JSON.parse(text) : null
  } catch (_error) {
    fail(label, `non-JSON response from ${path}`)
    return null
  }

  if (!response.ok) {
    fail(label, `HTTP ${response.status}`)
    return null
  }

  return data
}

async function checkBackend() {
  try {
    const health = await fetchJson('/health', 'backend health')
    if (health?.status === 'ok') ok('backend health', health.message || 'running')
    else fail('backend health', 'unexpected response')

    const apiHealth = await fetchJson('/api/health', 'database health')
    if (apiHealth?.status === 'ok') {
      ok('database health', `${apiHealth.database || 'database'} with ${apiHealth.total_tables || 0} tables`)
    } else {
      fail('database health', 'unexpected response')
    }

    return apiHealth
  } catch (error) {
    fail('backend reachability', error.message)
    return null
  }
}

async function checkRtcConfig() {
  const requireTurn = boolEnv(process.env.RTC_READINESS_REQUIRE_TURN, process.env.NODE_ENV === 'production')

  try {
    const config = await fetchJson('/api/rtc/config', 'RTC config')
    if (!config) return

    const iceServers = Array.isArray(config.iceServers) ? config.iceServers : []
    if (iceServers.length) ok('ICE servers', `${iceServers.length} configured`)
    else fail('ICE servers', 'no STUN/TURN servers returned')

    if (config.turnConfigured && hasTurnServer(iceServers)) {
      ok('TURN relay', `${config.turnCredentialType || 'configured'} credentials`)
    } else if (requireTurn) {
      fail('TURN relay', 'required for production but not configured')
    } else {
      warn('TURN relay', 'not configured; strict networks may need refresh or fail media')
    }

    if (config.turnConfigured && config.turnCredentialType !== 'ephemeral') {
      warn('TURN credentials', 'static credentials work, but ephemeral credentials are safer')
    }

    if (config.iceTransportPolicy === 'relay') {
      warn('ICE transport policy', 'relay-only can add latency; use only when intentionally forcing TURN')
    } else {
      ok('ICE transport policy', config.iceTransportPolicy || 'all')
    }
  } catch (error) {
    fail('RTC config', error.message)
  }
}

async function checkSocketIo() {
  try {
    const response = await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`)
    const body = await response.text()

    if (!response.ok) {
      fail('Socket.IO signaling', `HTTP ${response.status}`)
      return
    }

    if (/^0\{/.test(body)) {
      ok('Socket.IO signaling', 'polling handshake accepted')
      return
    }

    fail('Socket.IO signaling', 'handshake response was not a Socket.IO open packet')
  } catch (error) {
    fail('Socket.IO signaling', error.message)
  }
}

async function withDb(callback) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_DATABASE || 'rtc_platform',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  })

  try {
    return await callback(connection)
  } finally {
    await connection.end()
  }
}

async function checkDatabaseSchema() {
  try {
    await withDb(async (connection) => {
      const [tables] = await connection.execute(
        `
        SELECT TABLE_NAME AS table_name
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${REQUIRED_TABLES.map(() => '?').join(', ')})
        `,
        REQUIRED_TABLES
      )
      const existingTables = new Set(tables.map((row) => row.table_name))
      const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.has(table))

      if (missingTables.length) fail('RTC schema tables', `missing ${missingTables.join(', ')}`)
      else ok('RTC schema tables', `${REQUIRED_TABLES.length} required tables present`)

      if (existingTables.has('rtc_quality_samples')) {
        const [columns] = await connection.execute(
          `
          SELECT COLUMN_NAME AS column_name
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'rtc_quality_samples'
          AND COLUMN_NAME IN (${REQUIRED_QUALITY_COLUMNS.map(() => '?').join(', ')})
          `,
          REQUIRED_QUALITY_COLUMNS
        )
        const existingColumns = new Set(columns.map((row) => row.column_name))
        const missingColumns = REQUIRED_QUALITY_COLUMNS.filter((column) => !existingColumns.has(column))

        if (missingColumns.length) fail('RTC quality table', `missing columns ${missingColumns.join(', ')}`)
        else ok('RTC quality table', 'telemetry columns ready')
      }

      const [participants] = await connection.execute(
        `
        SELECT
          COUNT(*) AS active,
          COALESCE(SUM(connection_status = 'reconnecting'), 0) AS reconnecting,
          COALESCE(SUM(updated_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)), 0) AS stale
        FROM rtc_session_participants
        WHERE left_at IS NULL
        `
      )
      const active = Number(participants[0]?.active || 0)
      const reconnecting = Number(participants[0]?.reconnecting || 0)
      const stale = Number(participants[0]?.stale || 0)
      ok('RTC active participants', `${active} active, ${reconnecting} reconnecting`)
      if (stale > 0) warn('RTC stale participants', `${stale} active rows have not updated in 2 minutes`)

      if (existingTables.has('rtc_quality_samples')) {
        const [quality] = await connection.execute(
          `
          SELECT
            COUNT(*) AS samples,
            COALESCE(SUM(quality IN ('poor', 'degraded', 'failed', 'connecting')), 0) AS issues,
            COALESCE(AVG(NULLIF(rtt_ms, 0)), 0) AS avg_rtt_ms,
            COALESCE(MAX(packet_loss_pct), 0) AS max_loss
          FROM rtc_quality_samples
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
          `
        )
        const row = quality[0] || {}
        ok('RTC quality telemetry', `${Number(row.samples || 0)} samples / 30m, ${Number(row.issues || 0)} issues`)
        if (Number(row.max_loss || 0) >= 8) warn('RTC packet loss', `peak ${Number(row.max_loss).toFixed(1)}% in last 30 minutes`)
        if (Number(row.avg_rtt_ms || 0) >= 450) warn('RTC latency', `average ${Number(row.avg_rtt_ms).toFixed(0)} ms in last 30 minutes`)
      }
    })
  } catch (error) {
    fail('database readiness', error.message)
  }
}

async function main() {
  console.log(`RTC readiness audit for ${BASE_URL}`)
  await checkBackend()
  await checkRtcConfig()
  await checkSocketIo()
  await checkDatabaseSchema()

  console.log('')
  if (failures) {
    console.log(`RTC readiness failed: ${failures} failure(s), ${warnings} warning(s)`)
    process.exit(1)
  }

  console.log(`RTC readiness passed: ${warnings} warning(s)`)
}

main()
