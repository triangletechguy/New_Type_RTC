#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const mysql = require('mysql2/promise')
const bcrypt = require('bcryptjs')

const API_BASE_URL = process.env.E2E_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8000}/api`
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@gmail.com'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'admin@gmail.com'
const TEST_VERIFICATION_CODE = process.env.E2E_VERIFICATION_CODE || '123456'

const connectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE || 'rtc_platform',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
}

const state = {
  roomId: null,
  ownerId: null,
  guestId: null,
  connection: null,
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isExpectedStatus(error, status) {
  return error?.status === status
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}

  if (!response.ok) {
    const error = new Error(data.message || `HTTP ${response.status}`)
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

async function getConnection() {
  if (!state.connection) {
    state.connection = await mysql.createConnection(connectionConfig)
  }

  return state.connection
}

async function setKnownVerificationCode(email, code = TEST_VERIFICATION_CODE) {
  const connection = await getConnection()
  const [[user]] = await connection.execute(
    'SELECT id, status FROM users WHERE email = ? ORDER BY id DESC LIMIT 1',
    [email]
  )
  assert(user?.id, `pending user was not created for ${email}`)
  assert(user.status === 'pending_verification', `expected pending_verification for ${email}, found ${user.status}`)

  const codeHash = await bcrypt.hash(code, 10)
  const [result] = await connection.execute(
    `
    UPDATE email_verification_codes
    SET code_hash = ?,
        expires_at = DATE_ADD(NOW(), INTERVAL 15 MINUTE),
        used_at = NULL,
        attempt_count = 0
    WHERE user_id = ?
    AND email = ?
    AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [codeHash, user.id, email]
  )
  assert(result.affectedRows === 1, `verification code row was not available for ${email}`)
  return user
}

async function registerAndLogin({ name, email, password }) {
  await request('/auth/register', {
    method: 'POST',
    body: {
      name,
      gender: 'prefer_not_to_say',
      age: 30,
      current_residence: 'United States',
      birthday: '1996-01-01',
      email,
      password,
    },
  })

  try {
    await request('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    throw new Error(`pending user ${email} was allowed to log in before verification`)
  } catch (error) {
    if (!isExpectedStatus(error, 403) || error.data?.requires_verification !== true) throw error
  }

  await setKnownVerificationCode(email)

  return request('/auth/verify-email', {
    method: 'POST',
    body: { email, code: TEST_VERIFICATION_CODE },
  })
}

async function cleanup() {
  if (!state.connection) {
    state.connection = await mysql.createConnection(connectionConfig).catch(() => null)
  }

  if (!state.connection) return

  if (state.roomId) {
    await state.connection.execute('DELETE FROM rooms WHERE id = ?', [state.roomId]).catch(() => {})
  }

  if (state.guestId) {
    await state.connection.execute('DELETE FROM users WHERE id = ?', [state.guestId]).catch(() => {})
  }

  if (state.ownerId) {
    await state.connection.execute('DELETE FROM users WHERE id = ?', [state.ownerId]).catch(() => {})
  }

  await state.connection.end()
  state.connection = null
}

async function main() {
  const runId = Date.now()
  const ownerEmail = `e2e-owner-${runId}@example.com`
  const guestEmail = `e2e-guest-${runId}@example.com`
  const password = 'E2e@123456'
  const roomPassword = 'E2ERoom@1234'
  const roomName = `E2E Polish Room ${runId}`

  await request('/health')
  const admin = await request('/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  const owner = await registerAndLogin({ name: 'E2E Owner', email: ownerEmail, password })
  const guest = await registerAndLogin({ name: 'E2E Guest', email: guestEmail, password })
  state.ownerId = owner.user.id
  state.guestId = guest.user.id

  const created = await request('/rooms', {
    token: owner.access_token,
    method: 'POST',
    body: {
      name: roomName,
      description: 'End-to-end polish smoke room for RTC, chat, owner controls, and usage logging.',
      room_type: 'video',
      privacy_type: 'password',
      password: roomPassword,
      max_mic_count: 8,
      theme: 'neon',
      chat_enabled: true,
      screen_share_enabled: true,
      ai_security_enabled: true,
    },
  })
  state.roomId = created.room.id
  assert(created.room.is_password_protected === true, 'created room is not password protected')

  const rooms = await request(`/rooms?q=${encodeURIComponent(roomName)}`, { token: owner.access_token })
  assert(rooms.rooms.data.some((room) => Number(room.id) === Number(state.roomId)), 'created room was not listed')

  try {
    await request(`/rooms/${state.roomId}/join`, {
      token: guest.access_token,
      method: 'POST',
      body: { password: 'wrong-password', rtc_mode: 'video' },
    })
    throw new Error('wrong room password was accepted')
  } catch (error) {
    if (!isExpectedStatus(error, 403)) throw error
  }

  const ownerJoin = await request(`/rooms/${state.roomId}/join`, {
    token: owner.access_token,
    method: 'POST',
    body: { password: roomPassword, rtc_mode: 'video', mic_enabled: true, camera_enabled: true },
  })
  assert(ownerJoin.rtc.signaling_room, 'owner join did not return signaling room')

  const guestJoin = await request(`/rooms/${state.roomId}/join`, {
    token: guest.access_token,
    method: 'POST',
    body: { password: roomPassword, rtc_mode: 'video', mic_enabled: true, camera_enabled: true },
  })
  assert(guestJoin.rtc.camera_enabled === true, 'guest camera was not enabled after join')

  const mediaOff = await request(`/rooms/${state.roomId}/media-state`, {
    token: guest.access_token,
    method: 'POST',
    body: { mic_enabled: false, camera_enabled: false },
  })
  assert(mediaOff.rtc.mic_enabled === false && mediaOff.rtc.camera_enabled === false, 'media-state did not save mic/camera off')

  const sentMessage = await request(`/rooms/${state.roomId}/messages`, {
    token: guest.access_token,
    method: 'POST',
    body: { message_body: `E2E chat message ${runId}` },
  })
  assert(sentMessage.chat_message?.id, 'chat message was not created')

  const messageList = await request(`/rooms/${state.roomId}/messages`, { token: owner.access_token })
  assert(messageList.messages.some((message) => message.id === sentMessage.chat_message.id), 'created message was not returned in chat list')

  const unsent = await request(`/messages/${sentMessage.chat_message.id}`, {
    token: guest.access_token,
    method: 'DELETE',
  })
  assert(Number(unsent.message_id) === Number(sentMessage.chat_message.id), 'message delete did not return the deleted message id')
  const messageListAfterDelete = await request(`/rooms/${state.roomId}/messages`, { token: owner.access_token })
  assert(!messageListAfterDelete.messages.some((message) => message.id === sentMessage.chat_message.id), 'deleted message was still visible in chat list')

  const controls = await request(`/rooms/${state.roomId}/controls`, { token: owner.access_token })
  assert(controls.controls.can_manage === true, 'owner controls did not report can_manage')
  assert(controls.controls.participants.length >= 2, 'owner controls did not include active participants')

  const updatedControls = await request(`/rooms/${state.roomId}/controls`, {
    token: owner.access_token,
    method: 'PATCH',
    body: { theme: 'studio', max_mic_count: 10 },
  })
  assert(updatedControls.controls.room.theme === 'studio', 'room theme control did not update')
  assert(Number(updatedControls.controls.room.max_mic_count) === 10, 'max mic count did not update')

  const mediaOn = await request(`/rooms/${state.roomId}/media-state`, {
    token: guest.access_token,
    method: 'POST',
    body: { mic_enabled: true, camera_enabled: true },
  })
  assert(mediaOn.rtc.mic_enabled === true, 'guest mic was not restored before moderation')

  const muted = await request(`/rooms/${state.roomId}/participants/${state.guestId}/mute`, {
    token: owner.access_token,
    method: 'POST',
    body: {},
  })
  assert(Boolean(Number(muted.participant?.mic_enabled)) === false, 'moderator mute did not turn guest mic off')

  const dashboardDuringSession = await request('/admin/dashboard', { token: admin.access_token })
  assert(dashboardDuringSession.dashboard.metrics, 'admin dashboard metrics missing')
  assert(dashboardDuringSession.dashboard.active_sessions_monitor?.sessions?.some((session) => Number(session.room_id) === Number(state.roomId)), 'active session monitor missing E2E room')

  await sleep(1200)

  const kicked = await request(`/rooms/${state.roomId}/participants/${state.guestId}/kick`, {
    token: owner.access_token,
    method: 'POST',
    body: {},
  })
  assert(kicked.participant?.left_at, 'kick did not close guest participant session')

  const ownerLeave = await request(`/rooms/${state.roomId}/leave`, {
    token: owner.access_token,
    method: 'POST',
    body: {},
  })
  assert(ownerLeave.usage_logged === true, 'owner leave did not log usage')

  state.connection = await getConnection()

  const [[usage]] = await state.connection.execute(
    `
    SELECT COUNT(*) AS logs,
           COALESCE(SUM(duration_seconds), 0) AS seconds,
           COALESCE(SUM(billable_minutes), 0) AS minutes
    FROM usage_logs
    WHERE room_id = ?
    `,
    [state.roomId]
  )
  assert(Number(usage.logs) === 2, `expected 2 usage logs for E2E room, found ${usage.logs}`)
  assert(Number(usage.seconds) > 0, 'usage logs did not record a nonzero duration')

  const [[missingUsage]] = await state.connection.execute(
    `
    SELECT COUNT(*) AS count
    FROM rtc_session_participants p
    WHERE p.room_id = ?
    AND p.left_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM usage_logs ul
      WHERE ul.room_id = p.room_id
      AND ul.session_id = p.session_id
      AND ul.user_id = p.user_id
      AND ul.started_at = p.joined_at
    )
    `,
    [state.roomId]
  )
  assert(Number(missingUsage.count) === 0, 'E2E room has ended participants missing usage logs')

  const [[activeParticipants]] = await state.connection.execute(
    `
    SELECT COUNT(*) AS count
    FROM rtc_session_participants
    WHERE room_id = ?
    AND left_at IS NULL
    `,
    [state.roomId]
  )
  assert(Number(activeParticipants.count) === 0, 'E2E room still has active participants after leave/kick')

  const dashboardAfterSession = await request('/admin/dashboard', { token: admin.access_token })
  assert(dashboardAfterSession.dashboard.usage_verification?.status, 'usage verification status missing after E2E flow')

  console.log(JSON.stringify({
    ok: true,
    roomId: state.roomId,
    ownerId: state.ownerId,
    guestId: state.guestId,
    usageLogs: Number(usage.logs),
    usageSeconds: Number(usage.seconds),
    usageMinutes: Number(usage.minutes),
    dashboardVerification: dashboardAfterSession.dashboard.usage_verification.status,
  }))
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
  })
