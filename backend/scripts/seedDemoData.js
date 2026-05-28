#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const bcrypt = require('bcryptjs')
const mysql = require('mysql2/promise')

const tenantId = 1
const demoPassword = 'Demo@123456'
const passwordRoomPassword = 'Room@1234'

const connectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE || 'rtc_platform',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: false,
}

function dateMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000)
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function durationSeconds(startedAt, endedAt) {
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
}

function billableMinutes(seconds) {
  return Number((seconds / 60).toFixed(2))
}

function usageType(roomType) {
  return ['audio', 'group_audio'].includes(roomType) ? 'audio' : 'video'
}

async function fetchOne(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params)
  return rows[0] || null
}

async function upsertUser(connection, user, passwordHash, roleIds) {
  const existing = await fetchOne(
    connection,
    `
    SELECT id
    FROM users
    WHERE tenant_id = ?
    AND email = ?
    LIMIT 1
    `,
    [tenantId, user.email]
  )

  if (existing) {
    await connection.execute(
      `
      UPDATE users
      SET name = ?,
          password_hash = ?,
          status = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [user.name, passwordHash, user.status || 'active', existing.id]
    )
    return existing.id
  }

  const [result] = await connection.execute(
    `
    INSERT INTO users (
      tenant_id, name, email, password_hash, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    `,
    [tenantId, user.name, user.email, passwordHash, user.status || 'active']
  )

  for (const role of user.roles || ['end_user']) {
    if (!roleIds[role]) continue
    await connection.execute(
      `
      INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
      SELECT ?, ?, ?, NOW()
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_roles
        WHERE user_id = ?
        AND role_id = ?
        AND tenant_id = ?
      )
      `,
      [result.insertId, roleIds[role], tenantId, result.insertId, roleIds[role], tenantId]
    )
  }

  return result.insertId
}

async function ensureRoom(connection, room, ownerId, passwordHash = null) {
  const existing = await fetchOne(
    connection,
    `
    SELECT id
    FROM rooms
    WHERE tenant_id = ?
    AND name = ?
    LIMIT 1
    `,
    [tenantId, room.name]
  )

  if (existing) {
    await connection.execute(
      `
      UPDATE rooms
      SET owner_id = ?,
          description = ?,
          room_type = ?,
          privacy_type = ?,
          password_hash = ?,
          max_mic_count = ?,
          theme = ?,
          chat_enabled = ?,
          gift_enabled = ?,
          screen_share_enabled = ?,
          ai_security_enabled = ?,
          status = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        ownerId,
        room.description,
        room.room_type,
        room.privacy_type,
        room.privacy_type === 'password' ? passwordHash : null,
        room.max_mic_count,
        room.theme,
        room.chat_enabled ? 1 : 0,
        room.gift_enabled ? 1 : 0,
        room.screen_share_enabled ? 1 : 0,
        room.ai_security_enabled ? 1 : 0,
        room.status,
        existing.id,
      ]
    )
    return existing.id
  }

  const [result] = await connection.execute(
    `
    INSERT INTO rooms (
      tenant_id, owner_id, name, description, room_type, privacy_type,
      password_hash, max_mic_count, theme, chat_enabled, gift_enabled,
      screen_share_enabled, ai_security_enabled, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
    [
      tenantId,
      ownerId,
      room.name,
      room.description,
      room.room_type,
      room.privacy_type,
      room.privacy_type === 'password' ? passwordHash : null,
      room.max_mic_count,
      room.theme,
      room.chat_enabled ? 1 : 0,
      room.gift_enabled ? 1 : 0,
      room.screen_share_enabled ? 1 : 0,
      room.ai_security_enabled ? 1 : 0,
      room.status,
    ]
  )

  return result.insertId
}

async function ensureRoomRole(connection, roomId, userId, role) {
  await connection.execute(
    `
    INSERT INTO room_roles (room_id, user_id, role, created_at)
    SELECT ?, ?, ?, NOW()
    WHERE NOT EXISTS (
      SELECT 1
      FROM room_roles
      WHERE room_id = ?
      AND user_id = ?
      AND role = ?
    )
    `,
    [roomId, userId, role, roomId, userId, role]
  )
}

async function ensureSession(connection, roomId, session) {
  const existing = await fetchOne(
    connection,
    `
    SELECT id
    FROM rtc_sessions
    WHERE tenant_id = ?
    AND signaling_room = ?
    LIMIT 1
    `,
    [tenantId, session.signaling_room]
  )

  if (existing) {
    await connection.execute(
      `
      UPDATE rtc_sessions
      SET room_id = ?,
          session_type = ?,
          started_by = ?,
          started_at = ?,
          ended_at = ?,
          status = ?,
          total_duration_seconds = ?,
          total_participant_minutes = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        roomId,
        session.session_type,
        session.started_by,
        session.started_at,
        session.ended_at,
        session.status,
        session.total_duration_seconds || 0,
        session.total_participant_minutes || 0,
        existing.id,
      ]
    )
    return existing.id
  }

  const [result] = await connection.execute(
    `
    INSERT INTO rtc_sessions (
      tenant_id, room_id, rtc_provider, signaling_room, session_type,
      started_by, started_at, ended_at, status, total_duration_seconds,
      total_participant_minutes, created_at, updated_at
    )
    VALUES (?, ?, 'native_webrtc', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
    [
      tenantId,
      roomId,
      session.signaling_room,
      session.session_type,
      session.started_by,
      session.started_at,
      session.ended_at,
      session.status,
      session.total_duration_seconds || 0,
      session.total_participant_minutes || 0,
    ]
  )

  return result.insertId
}

async function upsertParticipant(connection, participant) {
  const existing = await fetchOne(
    connection,
    `
    SELECT id
    FROM rtc_session_participants
    WHERE session_id = ?
    AND user_id = ?
    AND (
      (? IS NULL AND left_at IS NULL)
      OR (? IS NOT NULL AND left_at IS NOT NULL)
    )
    LIMIT 1
    `,
    [participant.session_id, participant.user_id, participant.left_at, participant.left_at]
  )

  if (existing) {
    await connection.execute(
      `
      UPDATE rtc_session_participants
      SET room_id = ?,
          peer_uid = ?,
          role_in_room = ?,
          joined_at = ?,
          left_at = ?,
          duration_seconds = ?,
          mic_enabled = ?,
          camera_enabled = ?,
          screen_shared = ?,
          connection_status = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        participant.room_id,
        participant.peer_uid,
        participant.role_in_room,
        participant.joined_at,
        participant.left_at,
        participant.duration_seconds || 0,
        participant.mic_enabled ? 1 : 0,
        participant.camera_enabled ? 1 : 0,
        participant.screen_shared ? 1 : 0,
        participant.connection_status,
        existing.id,
      ]
    )
    return existing.id
  }

  const [result] = await connection.execute(
    `
    INSERT INTO rtc_session_participants (
      session_id, room_id, user_id, peer_uid, role_in_room, joined_at, left_at,
      duration_seconds, mic_enabled, camera_enabled, screen_shared,
      connection_status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
    [
      participant.session_id,
      participant.room_id,
      participant.user_id,
      participant.peer_uid,
      participant.role_in_room,
      participant.joined_at,
      participant.left_at,
      participant.duration_seconds || 0,
      participant.mic_enabled ? 1 : 0,
      participant.camera_enabled ? 1 : 0,
      participant.screen_shared ? 1 : 0,
      participant.connection_status,
    ]
  )

  return result.insertId
}

async function ensureUsageLog(connection, log) {
  const existing = await fetchOne(
    connection,
    `
    SELECT id
    FROM usage_logs
    WHERE tenant_id = ?
    AND room_id = ?
    AND session_id = ?
    AND user_id = ?
    AND started_at = ?
    LIMIT 1
    `,
    [tenantId, log.room_id, log.session_id, log.user_id, log.started_at]
  )

  if (existing) {
    await connection.execute(
      `
      UPDATE usage_logs
      SET usage_type = ?,
          ended_at = ?,
          duration_seconds = ?,
          billable_minutes = ?
      WHERE id = ?
      `,
      [log.usage_type, log.ended_at, log.duration_seconds, log.billable_minutes, existing.id]
    )
    return existing.id
  }

  const [result] = await connection.execute(
    `
    INSERT INTO usage_logs (
      tenant_id, room_id, session_id, user_id, usage_type,
      started_at, ended_at, duration_seconds, billable_minutes, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    [tenantId, log.room_id, log.session_id, log.user_id, log.usage_type, log.started_at, log.ended_at, log.duration_seconds, log.billable_minutes]
  )

  return result.insertId
}

async function ensureEvent(connection, event) {
  const existing = await fetchOne(
    connection,
    `
    SELECT id
    FROM rtc_events
    WHERE tenant_id = ?
    AND room_id = ?
    AND session_id = ?
    AND user_id = ?
    AND event_type = ?
    AND created_at = ?
    LIMIT 1
    `,
    [tenantId, event.room_id, event.session_id, event.user_id, event.event_type, event.created_at]
  )

  if (existing) {
    await connection.execute(
      `
      UPDATE rtc_events
      SET event_data = ?
      WHERE id = ?
      `,
      [JSON.stringify(event.event_data || {}), existing.id]
    )
    return existing.id
  }

  const [result] = await connection.execute(
    `
    INSERT INTO rtc_events (
      tenant_id, room_id, session_id, user_id, event_type, event_data, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [tenantId, event.room_id, event.session_id, event.user_id, event.event_type, JSON.stringify(event.event_data || {}), event.created_at]
  )

  return result.insertId
}

async function ensureMessage(connection, message) {
  const existing = await fetchOne(
    connection,
    `
    SELECT id
    FROM chat_messages
    WHERE tenant_id = ?
    AND room_id = ?
    AND sender_id = ?
    AND message_body = ?
    LIMIT 1
    `,
    [tenantId, message.room_id, message.sender_id, message.message_body]
  )

  if (existing) {
    await connection.execute(
      `
      UPDATE chat_messages
      SET session_id = ?,
          is_deleted = ?,
          is_unsent = ?,
          deleted_by = ?,
          deleted_at = ?,
          created_at = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        message.session_id,
        message.is_deleted ? 1 : 0,
        message.is_unsent ? 1 : 0,
        message.deleted_by || null,
        message.deleted_at || null,
        message.created_at,
        existing.id,
      ]
    )
    return existing.id
  }

  const [result] = await connection.execute(
    `
    INSERT INTO chat_messages (
      tenant_id, room_id, session_id, sender_id, message_type, message_body,
      is_deleted, is_unsent, deleted_by, deleted_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'text', ?, ?, ?, ?, ?, ?, NOW())
    `,
    [
      tenantId,
      message.room_id,
      message.session_id,
      message.sender_id,
      message.message_body,
      message.is_deleted ? 1 : 0,
      message.is_unsent ? 1 : 0,
      message.deleted_by || null,
      message.deleted_at || null,
      message.created_at,
    ]
  )

  return result.insertId
}

async function ensureBan(connection, ban) {
  const existing = await fetchOne(
    connection,
    `
    SELECT id
    FROM room_bans
    WHERE tenant_id = ?
    AND room_id = ?
    AND banned_user_id = ?
    AND status = 'active'
    LIMIT 1
    `,
    [tenantId, ban.room_id, ban.banned_user_id]
  )

  if (existing) {
    await connection.execute(
      `
      UPDATE room_bans
      SET banned_by = ?,
          ban_type = ?,
          reason = ?,
          starts_at = ?,
          ends_at = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [ban.banned_by, ban.ban_type, ban.reason, ban.starts_at, ban.ends_at, existing.id]
    )
    return existing.id
  }

  const [result] = await connection.execute(
    `
    INSERT INTO room_bans (
      tenant_id, room_id, banned_user_id, banned_by, ban_type,
      reason, starts_at, ends_at, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
    `,
    [tenantId, ban.room_id, ban.banned_user_id, ban.banned_by, ban.ban_type, ban.reason, ban.starts_at, ban.ends_at]
  )

  return result.insertId
}

async function main() {
  const connection = await mysql.createConnection(connectionConfig)
  const passwordHash = await bcrypt.hash(demoPassword, 10)
  const roomPasswordHash = await bcrypt.hash(passwordRoomPassword, 10)

  try {
    await connection.beginTransaction()

    await connection.execute(
      `
      INSERT INTO tenants (id, name, status, billing_rate_per_minute, created_at, updated_at)
      VALUES (?, 'Default Client', 'active', 0.0000, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        status = VALUES(status),
        updated_at = NOW()
      `,
      [tenantId]
    )

    const [roles] = await connection.execute(`SELECT id, name FROM roles`)
    const roleIds = roles.reduce((map, role) => {
      map[role.name] = role.id
      return map
    }, {})

    const users = {
      host: await upsertUser(connection, { name: 'Demo Host Maya', email: 'demo-host@rtc.com', roles: ['end_user', 'room_owner'] }, passwordHash, roleIds),
      moderator: await upsertUser(connection, { name: 'Demo Moderator Leo', email: 'demo-moderator@rtc.com', roles: ['end_user', 'moderator'] }, passwordHash, roleIds),
      speaker: await upsertUser(connection, { name: 'Demo Speaker Asha', email: 'demo-speaker@rtc.com', roles: ['end_user'] }, passwordHash, roleIds),
      viewer: await upsertUser(connection, { name: 'Demo Viewer Noor', email: 'demo-viewer@rtc.com', roles: ['end_user'] }, passwordHash, roleIds),
      banned: await upsertUser(connection, { name: 'Demo Banned Viewer', email: 'demo-banned@rtc.com', roles: ['end_user'] }, passwordHash, roleIds),
    }

    const roomConfigs = [
      {
        key: 'stage',
        name: 'Demo BuzzCast Stage',
        description: 'A public group video room with active demo speakers, chat, moderation, and RTC state.',
        room_type: 'group_video',
        privacy_type: 'public',
        max_mic_count: 8,
        theme: 'neon',
        chat_enabled: true,
        gift_enabled: true,
        screen_share_enabled: true,
        ai_security_enabled: true,
        status: 'active',
      },
      {
        key: 'voice',
        name: 'Demo Voice Lounge',
        description: 'A group audio room seeded with live audio participants for mic-seat testing.',
        room_type: 'group_audio',
        privacy_type: 'public',
        max_mic_count: 6,
        theme: 'mint',
        chat_enabled: true,
        gift_enabled: false,
        screen_share_enabled: false,
        ai_security_enabled: false,
        status: 'active',
      },
      {
        key: 'password',
        name: 'Demo Password Greenroom',
        description: 'A password-protected video room for testing locked-room access flows. Password: Room@1234',
        room_type: 'video',
        privacy_type: 'password',
        max_mic_count: 4,
        theme: 'studio',
        chat_enabled: true,
        gift_enabled: true,
        screen_share_enabled: false,
        ai_security_enabled: true,
        status: 'active',
      },
      {
        key: 'private',
        name: 'Demo Private Studio',
        description: 'A private solo-live room for owner-role and access-control checks.',
        room_type: 'solo_live',
        privacy_type: 'private',
        max_mic_count: 2,
        theme: 'midnight',
        chat_enabled: true,
        gift_enabled: true,
        screen_share_enabled: true,
        ai_security_enabled: true,
        status: 'active',
      },
      {
        key: 'replay',
        name: 'Demo Replay Room',
        description: 'An ended session with matching participants and usage logs for billing verification.',
        room_type: 'video',
        privacy_type: 'public',
        max_mic_count: 8,
        theme: 'studio',
        chat_enabled: true,
        gift_enabled: false,
        screen_share_enabled: true,
        ai_security_enabled: false,
        status: 'ended',
      },
    ]

    const rooms = {}
    for (const room of roomConfigs) {
      rooms[room.key] = await ensureRoom(connection, room, users.host, roomPasswordHash)
      await ensureRoomRole(connection, rooms[room.key], users.host, 'owner')
      await ensureRoomRole(connection, rooms[room.key], users.moderator, 'moderator')
    }

    const stageSessionId = await ensureSession(connection, rooms.stage, {
      signaling_room: `demo_stage_${tenantId}`,
      session_type: 'group_video',
      started_by: users.host,
      started_at: dateMinutesAgo(44),
      ended_at: null,
      status: 'active',
    })

    const voiceSessionId = await ensureSession(connection, rooms.voice, {
      signaling_room: `demo_voice_${tenantId}`,
      session_type: 'group_audio',
      started_by: users.host,
      started_at: dateMinutesAgo(26),
      ended_at: null,
      status: 'active',
    })

    const replayStartedAt = dateMinutesAgo(155)
    const replayEndedAt = dateMinutesAgo(95)
    const replaySessionId = await ensureSession(connection, rooms.replay, {
      signaling_room: `demo_replay_${tenantId}`,
      session_type: 'video',
      started_by: users.host,
      started_at: replayStartedAt,
      ended_at: replayEndedAt,
      status: 'ended',
      total_duration_seconds: durationSeconds(replayStartedAt, replayEndedAt),
    })

    const demoSessionIds = [stageSessionId, voiceSessionId, replaySessionId]
    const demoSessionPlaceholders = demoSessionIds.map(() => '?').join(', ')

    await connection.execute(
      `DELETE FROM usage_logs WHERE session_id IN (${demoSessionPlaceholders})`,
      demoSessionIds
    )

    await connection.execute(
      `DELETE FROM rtc_events WHERE session_id IN (${demoSessionPlaceholders})`,
      demoSessionIds
    )

    const activeParticipants = [
      { session_id: stageSessionId, room_id: rooms.stage, user_id: users.host, peer_uid: users.host, role_in_room: 'owner', joined_at: dateMinutesAgo(44), left_at: null, mic_enabled: true, camera_enabled: true, screen_shared: false, connection_status: 'connected' },
      { session_id: stageSessionId, room_id: rooms.stage, user_id: users.moderator, peer_uid: users.moderator, role_in_room: 'moderator', joined_at: dateMinutesAgo(36), left_at: null, mic_enabled: true, camera_enabled: true, screen_shared: false, connection_status: 'connected' },
      { session_id: stageSessionId, room_id: rooms.stage, user_id: users.speaker, peer_uid: users.speaker, role_in_room: 'speaker', joined_at: dateMinutesAgo(31), left_at: null, mic_enabled: false, camera_enabled: true, screen_shared: false, connection_status: 'connected' },
      { session_id: stageSessionId, room_id: rooms.stage, user_id: users.viewer, peer_uid: users.viewer, role_in_room: 'audience', joined_at: dateMinutesAgo(18), left_at: null, mic_enabled: false, camera_enabled: false, screen_shared: false, connection_status: 'reconnecting' },
      { session_id: voiceSessionId, room_id: rooms.voice, user_id: users.host, peer_uid: users.host, role_in_room: 'owner', joined_at: dateMinutesAgo(26), left_at: null, mic_enabled: true, camera_enabled: false, screen_shared: false, connection_status: 'connected' },
      { session_id: voiceSessionId, room_id: rooms.voice, user_id: users.speaker, peer_uid: users.speaker, role_in_room: 'speaker', joined_at: dateMinutesAgo(20), left_at: null, mic_enabled: true, camera_enabled: false, screen_shared: false, connection_status: 'connected' },
    ]

    for (const participant of activeParticipants) {
      await upsertParticipant(connection, { ...participant, duration_seconds: 0 })
    }

    const endedParticipantConfigs = [
      { user_id: users.host, role_in_room: 'owner', joined_at: replayStartedAt, left_at: addMinutes(replayStartedAt, 50), mic_enabled: true, camera_enabled: true },
      { user_id: users.speaker, role_in_room: 'speaker', joined_at: addMinutes(replayStartedAt, 7), left_at: addMinutes(replayStartedAt, 48), mic_enabled: true, camera_enabled: true },
      { user_id: users.viewer, role_in_room: 'audience', joined_at: addMinutes(replayStartedAt, 15), left_at: addMinutes(replayStartedAt, 42), mic_enabled: false, camera_enabled: false },
    ]

    let participantMinutesTotal = 0
    for (const participant of endedParticipantConfigs) {
      const seconds = durationSeconds(participant.joined_at, participant.left_at)
      participantMinutesTotal += seconds / 60

      await upsertParticipant(connection, {
        session_id: replaySessionId,
        room_id: rooms.replay,
        user_id: participant.user_id,
        peer_uid: participant.user_id,
        role_in_room: participant.role_in_room,
        joined_at: participant.joined_at,
        left_at: participant.left_at,
        duration_seconds: seconds,
        mic_enabled: participant.mic_enabled,
        camera_enabled: participant.camera_enabled,
        screen_shared: false,
        connection_status: 'disconnected',
      })

      const usageLogId = await ensureUsageLog(connection, {
        room_id: rooms.replay,
        session_id: replaySessionId,
        user_id: participant.user_id,
        usage_type: usageType('video'),
        started_at: participant.joined_at,
        ended_at: participant.left_at,
        duration_seconds: seconds,
        billable_minutes: billableMinutes(seconds),
      })

      await ensureEvent(connection, {
        room_id: rooms.replay,
        session_id: replaySessionId,
        user_id: participant.user_id,
        event_type: 'leave',
        event_data: {
          rtc_provider: 'native_webrtc',
          usage_log_id: usageLogId,
          duration_seconds: seconds,
          billable_minutes: billableMinutes(seconds),
          demo_seed: true,
        },
        created_at: participant.left_at,
      })
    }

    await connection.execute(
      `
      UPDATE rtc_sessions
      SET total_participant_minutes = ?,
          total_duration_seconds = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [Number(participantMinutesTotal.toFixed(2)), durationSeconds(replayStartedAt, replayEndedAt), replaySessionId]
    )

    const stageMessages = [
      { sender_id: users.host, message_body: 'Welcome to the demo stage. Camera, mic, chat, and owner controls are all seeded.', created_at: dateMinutesAgo(32) },
      { sender_id: users.speaker, message_body: 'I am joining from the seeded speaker account with video enabled.', created_at: dateMinutesAgo(27) },
      { sender_id: users.moderator, message_body: 'Moderator controls are ready for mute, kick, ban, and privacy checks.', created_at: dateMinutesAgo(22) },
      { sender_id: users.viewer, message_body: 'This demo message was unsent by moderation.', created_at: dateMinutesAgo(16), is_unsent: true, is_deleted: true, deleted_by: users.moderator, deleted_at: dateMinutesAgo(15) },
    ]

    for (const message of stageMessages) {
      await ensureMessage(connection, {
        tenant_id: tenantId,
        room_id: rooms.stage,
        session_id: stageSessionId,
        sender_id: message.sender_id,
        message_body: message.message_body,
        is_unsent: Boolean(message.is_unsent),
        is_deleted: Boolean(message.is_deleted),
        deleted_by: message.deleted_by,
        deleted_at: message.deleted_at,
        created_at: message.created_at,
      })
    }

    await ensureBan(connection, {
      room_id: rooms.stage,
      banned_user_id: users.banned,
      banned_by: users.moderator,
      ban_type: 'temporary',
      reason: 'Seeded demo ban for owner controls and moderation metrics.',
      starts_at: dateMinutesAgo(12),
      ends_at: addMinutes(new Date(), 24 * 60),
    })

    const banEventTime = dateMinutesAgo(12)
    await ensureEvent(connection, {
      room_id: rooms.stage,
      session_id: stageSessionId,
      user_id: users.banned,
      event_type: 'ban_by_moderator',
      event_data: {
        rtc_provider: 'native_webrtc',
        moderation_action: 'ban',
        moderator_user_id: users.moderator,
        target_user_id: users.banned,
        reason: 'Seeded demo moderation event.',
        demo_seed: true,
      },
      created_at: banEventTime,
    })

    await ensureEvent(connection, {
      room_id: rooms.stage,
      session_id: stageSessionId,
      user_id: users.speaker,
      event_type: 'mute_by_moderator',
      event_data: {
        rtc_provider: 'native_webrtc',
        moderation_action: 'mute_mic',
        moderator_user_id: users.moderator,
        target_user_id: users.speaker,
        mic_enabled: false,
        demo_seed: true,
      },
      created_at: dateMinutesAgo(20),
    })

    await connection.commit()

    console.log('Demo data seeded successfully.')
    console.log(`Demo users: ${Object.keys(users).length} users, password ${demoPassword}`)
    console.log(`Demo rooms: ${Object.keys(rooms).length} rooms, password room password ${passwordRoomPassword}`)
    console.log(`Active sessions: stage #${stageSessionId}, voice #${voiceSessionId}`)
    console.log(`Ended replay session: #${replaySessionId}, participant minutes ${Number(participantMinutesTotal.toFixed(2))}`)
  } catch (error) {
    await connection.rollback()
    console.error('Demo seed failed:', error.message)
    process.exitCode = 1
  } finally {
    await connection.end()
  }
}

main()
