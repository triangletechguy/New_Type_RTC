const express = require('express')
const { query } = require('../config/db')
const { authMiddleware, hasAnyRole, requireAnyRole } = require('../middleware/auth')

const router = express.Router()
const ADMIN_ROLES = ['client_admin', 'super_admin']

function toNumber(row, key, decimals = null) {
  const value = Number(row?.[key] || 0)
  return decimals === null ? value : Number(value.toFixed(decimals))
}

function boolValue(value) {
  return Boolean(Number(value || 0))
}

function makeInFilter(column, values, prefix) {
  if (values === null) return { sql: '1 = 1', params: {} }
  if (!values.length) return { sql: '1 = 0', params: {} }

  const params = {}
  const placeholders = values.map((value, index) => {
    const key = `${prefix}${index}`
    params[key] = value
    return `:${key}`
  })

  return {
    sql: `${column} IN (${placeholders.join(', ')})`,
    params,
  }
}

function roleList(user) {
  return Array.isArray(user?.roles) ? user.roles.map((role) => (typeof role === 'string' ? role : role?.name)).filter(Boolean) : []
}

function normalizeAdmin(row, stats = {}) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name || 'TalkEachOther',
    name: row.name,
    email: row.email,
    status: row.status,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    roles: String(row.roles || '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
    stats,
  }
}

async function getAdminUser(adminId) {
  const rows = await query(
    `
    SELECT
      u.id, u.tenant_id, u.name, u.email, u.status, u.last_login_at, u.created_at,
      t.name AS tenant_name,
      GROUP_CONCAT(DISTINCT roles.name ORDER BY roles.name) AS roles
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles ON roles.id = ur.role_id
    WHERE u.id = :adminId
    GROUP BY u.id, u.tenant_id, u.name, u.email, u.status, u.last_login_at, u.created_at, t.name
    LIMIT 1
    `,
    { adminId }
  )

  return rows[0] || null
}

async function getClientAdmins() {
  return query(
    `
    SELECT
      u.id, u.tenant_id, u.name, u.email, u.status, u.last_login_at, u.created_at,
      t.name AS tenant_name,
      GROUP_CONCAT(DISTINCT roles.name ORDER BY roles.name) AS roles
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    LEFT JOIN user_roles all_roles ON all_roles.user_id = u.id
    LEFT JOIN roles ON roles.id = all_roles.role_id
    WHERE EXISTS (
      SELECT 1
      FROM user_roles admin_roles
      JOIN roles admin_role_names ON admin_role_names.id = admin_roles.role_id
      WHERE admin_roles.user_id = u.id
      AND admin_role_names.name = 'client_admin'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM user_roles super_roles
      JOIN roles super_role_names ON super_role_names.id = super_roles.role_id
      WHERE super_roles.user_id = u.id
      AND super_role_names.name = 'super_admin'
    )
    GROUP BY u.id, u.tenant_id, u.name, u.email, u.status, u.last_login_at, u.created_at, t.name
    ORDER BY u.created_at ASC, u.id ASC
    `
  )
}

async function getScopedRoomIds(adminId, tenantId = null) {
  const params = { adminId }
  const tenantClause = tenantId ? 'AND r.tenant_id = :tenantId' : ''
  if (tenantId) params.tenantId = tenantId

  const rows = await query(
    `
    SELECT DISTINCT r.id
    FROM rooms r
    LEFT JOIN room_roles rr
      ON rr.room_id = r.id
      AND rr.user_id = :adminId
      AND rr.role IN ('owner', 'admin', 'moderator')
    WHERE (r.owner_id = :adminId OR rr.user_id IS NOT NULL)
    ${tenantClause}
    ORDER BY r.updated_at DESC, r.id DESC
    `,
    params
  )

  return rows.map((row) => Number(row.id))
}

async function getDashboard(roomIds) {
  const roomFilter = makeInFilter('r.id', roomIds, 'room')
  const sessionRoomFilter = makeInFilter('s.room_id', roomIds, 'sessionRoom')
  const participantRoomFilter = makeInFilter('p.room_id', roomIds, 'participantRoom')
  const usageRoomFilter = makeInFilter('ul.room_id', roomIds, 'usageRoom')
  const chatRoomFilter = makeInFilter('cm.room_id', roomIds, 'chatRoom')
  const eventRoomFilter = makeInFilter('ev.room_id', roomIds, 'eventRoom')
  const banRoomFilter = makeInFilter('rb.room_id', roomIds, 'banRoom')

  const [activeRooms] = await query(
    `SELECT COUNT(*) AS count FROM rooms r WHERE ${roomFilter.sql} AND r.status = 'active'`,
    roomFilter.params
  )

  const [activeSessions] = await query(
    `SELECT COUNT(*) AS count FROM rtc_sessions s WHERE ${sessionRoomFilter.sql} AND s.status = 'active'`,
    sessionRoomFilter.params
  )

  const [totalUsers] = await query(
    `
    SELECT COUNT(DISTINCT p.user_id) AS count
    FROM rtc_session_participants p
    WHERE ${participantRoomFilter.sql}
    `,
    participantRoomFilter.params
  )

  const [roomMetrics] = await query(
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(r.status = 'active'), 0) AS active,
      COALESCE(SUM(r.status = 'inactive'), 0) AS inactive,
      COALESCE(SUM(r.status = 'ended'), 0) AS ended,
      COALESCE(SUM(r.privacy_type = 'public'), 0) AS public_rooms,
      COALESCE(SUM(r.privacy_type = 'private'), 0) AS private_rooms,
      COALESCE(SUM(r.privacy_type = 'password'), 0) AS password_rooms,
      COALESCE(SUM(r.room_type IN ('video', 'group_video')), 0) AS video_rooms,
      COALESCE(SUM(r.room_type IN ('audio', 'group_audio')), 0) AS voice_rooms,
      COALESCE(SUM(r.room_type IN ('solo_live', 'pk_live')), 0) AS live_rooms,
      COALESCE(SUM(r.created_at >= CURDATE()), 0) AS created_today
    FROM rooms r
    WHERE ${roomFilter.sql}
    `,
    roomFilter.params
  )

  const [sessionMetrics] = await query(
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(s.status = 'active'), 0) AS active,
      COALESCE(SUM(s.created_at >= CURDATE()), 0) AS started_today,
      COALESCE(SUM(s.status = 'ended' AND s.ended_at >= CURDATE()), 0) AS ended_today,
      COALESCE(AVG(CASE WHEN s.created_at >= CURDATE() AND s.total_duration_seconds > 0 THEN s.total_duration_seconds END), 0) AS avg_duration_seconds_today,
      COALESCE(SUM(CASE WHEN s.created_at >= CURDATE() THEN s.total_participant_minutes ELSE 0 END), 0) AS participant_minutes_today
    FROM rtc_sessions s
    WHERE ${sessionRoomFilter.sql}
    `,
    sessionRoomFilter.params
  )

  const [participantMetrics] = await query(
    `
    SELECT
      COUNT(*) AS active,
      COUNT(DISTINCT p.user_id) AS active_users,
      COALESCE(SUM(p.mic_enabled = 1), 0) AS mics_on,
      COALESCE(SUM(p.camera_enabled = 1), 0) AS cameras_on,
      COALESCE(SUM(p.connection_status = 'reconnecting'), 0) AS reconnecting
    FROM rtc_session_participants p
    WHERE ${participantRoomFilter.sql}
    AND p.left_at IS NULL
    `,
    participantRoomFilter.params
  )

  const [usageToday] = await query(
    `
    SELECT
      COUNT(*) AS logs,
      COALESCE(SUM(ul.duration_seconds), 0) AS seconds,
      COALESCE(SUM(ul.billable_minutes), 0) AS minutes,
      COUNT(DISTINCT ul.user_id) AS users,
      COUNT(DISTINCT ul.room_id) AS rooms,
      COALESCE(AVG(ul.duration_seconds), 0) AS avg_duration_seconds
    FROM usage_logs ul
    WHERE ${usageRoomFilter.sql}
    AND DATE(ul.created_at) = CURDATE()
    `,
    usageRoomFilter.params
  )

  const [usageMonth] = await query(
    `
    SELECT
      COUNT(*) AS logs,
      COALESCE(SUM(ul.duration_seconds), 0) AS seconds,
      COALESCE(SUM(ul.billable_minutes), 0) AS minutes,
      COUNT(DISTINCT ul.user_id) AS users,
      COUNT(DISTINCT ul.room_id) AS rooms,
      COALESCE(AVG(ul.duration_seconds), 0) AS avg_duration_seconds
    FROM usage_logs ul
    WHERE ${usageRoomFilter.sql}
    AND ul.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
    `,
    usageRoomFilter.params
  )

  const [chatMetrics] = await query(
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(cm.created_at >= CURDATE()), 0) AS messages_today,
      COALESCE(SUM(cm.created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)), 0) AS messages_last_hour,
      COALESCE(SUM(cm.is_unsent = 1 AND cm.updated_at >= CURDATE()), 0) AS unsent_today,
      COALESCE(SUM(cm.is_deleted = 1 AND cm.updated_at >= CURDATE()), 0) AS deleted_today
    FROM chat_messages cm
    WHERE ${chatRoomFilter.sql}
    `,
    chatRoomFilter.params
  )

  const [moderationMetrics] = await query(
    `
    SELECT
      COALESCE(SUM(ev.created_at >= CURDATE()), 0) AS events_today,
      COALESCE(SUM(ev.event_type = 'mute_by_moderator' AND ev.created_at >= CURDATE()), 0) AS mutes_today,
      COALESCE(SUM(ev.event_type = 'kick_by_moderator' AND ev.created_at >= CURDATE()), 0) AS kicks_today,
      COALESCE(SUM(ev.event_type = 'ban_by_moderator' AND ev.created_at >= CURDATE()), 0) AS bans_today
    FROM rtc_events ev
    WHERE ${eventRoomFilter.sql}
    AND ev.event_type IN ('mute_by_moderator', 'kick_by_moderator', 'ban_by_moderator')
    `,
    eventRoomFilter.params
  )

  const [activeBans] = await query(
    `
    SELECT COUNT(*) AS count
    FROM room_bans rb
    WHERE ${banRoomFilter.sql}
    AND rb.status = 'active'
    AND (rb.ends_at IS NULL OR rb.ends_at > NOW())
    `,
    banRoomFilter.params
  )

  const activeSessionMonitorRows = await query(
    `
    SELECT
      s.id,
      s.room_id,
      s.signaling_room,
      s.session_type,
      s.started_by,
      s.started_at,
      TIMESTAMPDIFF(SECOND, s.started_at, NOW()) AS elapsed_seconds,
      r.name AS room_name,
      r.privacy_type,
      r.max_mic_count,
      owner.name AS owner_name,
      starter.name AS started_by_name,
      COUNT(p.id) AS active_participants,
      COUNT(DISTINCT p.user_id) AS active_users,
      COALESCE(SUM(p.mic_enabled = 1), 0) AS mics_on,
      COALESCE(SUM(p.camera_enabled = 1), 0) AS cameras_on,
      COALESCE(SUM(p.screen_shared = 1), 0) AS screen_shares,
      COALESCE(SUM(p.connection_status = 'reconnecting'), 0) AS reconnecting,
      MAX(p.updated_at) AS last_participant_update
    FROM rtc_sessions s
    INNER JOIN rooms r ON r.id = s.room_id
    LEFT JOIN users owner ON owner.id = r.owner_id
    LEFT JOIN users starter ON starter.id = s.started_by
    LEFT JOIN rtc_session_participants p
      ON p.session_id = s.id
      AND p.left_at IS NULL
    WHERE ${sessionRoomFilter.sql}
    AND s.status = 'active'
    GROUP BY
      s.id, s.room_id, s.signaling_room, s.session_type, s.started_by, s.started_at,
      r.name, r.privacy_type, r.max_mic_count, owner.name, starter.name
    ORDER BY active_participants DESC, s.started_at DESC
    LIMIT 12
    `,
    sessionRoomFilter.params
  )

  const activeSessionIds = activeSessionMonitorRows.map((session) => Number(session.id))
  const activeSessionParticipants = activeSessionIds.length
    ? await query(
      `
      SELECT
        p.id,
        p.session_id,
        p.user_id,
        p.peer_uid,
        p.role_in_room,
        p.joined_at,
        TIMESTAMPDIFF(SECOND, p.joined_at, NOW()) AS connected_seconds,
        p.mic_enabled,
        p.camera_enabled,
        p.screen_shared,
        p.connection_status,
        p.updated_at,
        u.name AS user_name,
        u.email AS user_email
      FROM rtc_session_participants p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.left_at IS NULL
      AND p.session_id IN (${activeSessionIds.map((_, index) => `:session${index}`).join(', ')})
      ORDER BY
        p.session_id ASC,
        FIELD(p.role_in_room, 'owner', 'admin', 'moderator', 'speaker', 'audience', 'end_user'),
        p.joined_at ASC
      `,
      activeSessionIds.reduce((params, sessionId, index) => {
        params[`session${index}`] = sessionId
        return params
      }, {})
    )
    : []

  const [endedParticipants] = await query(
    `
    SELECT COUNT(*) AS count
    FROM rtc_session_participants p
    WHERE ${participantRoomFilter.sql}
    AND p.left_at IS NOT NULL
    `,
    participantRoomFilter.params
  )

  const [missingUsageLogs] = await query(
    `
    SELECT COUNT(*) AS count
    FROM rtc_session_participants p
    WHERE ${participantRoomFilter.sql}
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
    participantRoomFilter.params
  )

  const [durationMismatches] = await query(
    `
    SELECT COUNT(*) AS count
    FROM rtc_session_participants p
    INNER JOIN usage_logs ul
      ON ul.room_id = p.room_id
      AND ul.session_id = p.session_id
      AND ul.user_id = p.user_id
      AND ul.started_at = p.joined_at
    WHERE ${participantRoomFilter.sql}
    AND p.left_at IS NOT NULL
    AND ABS(COALESCE(ul.duration_seconds, 0) - COALESCE(p.duration_seconds, 0)) > 1
    `,
    participantRoomFilter.params
  )

  const [duplicateUsageLogs] = await query(
    `
    SELECT COUNT(*) AS count
    FROM (
      SELECT ul.room_id, ul.session_id, ul.user_id, ul.started_at, COUNT(*) AS log_count
      FROM usage_logs ul
      WHERE ${usageRoomFilter.sql}
      GROUP BY ul.room_id, ul.session_id, ul.user_id, ul.started_at
      HAVING COUNT(*) > 1
    ) duplicates
    `,
    usageRoomFilter.params
  )

  const [sessionTotalMismatches] = await query(
    `
    SELECT COUNT(*) AS count
    FROM rtc_sessions s
    LEFT JOIN (
      SELECT session_id, ROUND(SUM(duration_seconds) / 60, 2) AS participant_minutes
      FROM rtc_session_participants
      WHERE left_at IS NOT NULL
      GROUP BY session_id
    ) totals ON totals.session_id = s.id
    WHERE ${sessionRoomFilter.sql}
    AND ABS(COALESCE(s.total_participant_minutes, 0) - COALESCE(totals.participant_minutes, 0)) > 0.01
    `,
    sessionRoomFilter.params
  )

  const recentUsageLogs = await query(
    `
    SELECT
      ul.id, ul.room_id, ul.session_id, ul.user_id, ul.usage_type,
      ul.started_at, ul.ended_at, ul.duration_seconds, ul.billable_minutes, ul.created_at,
      r.name AS room_name,
      u.name AS user_name,
      s.status AS session_status
    FROM usage_logs ul
    INNER JOIN rooms r ON r.id = ul.room_id
    LEFT JOIN users u ON u.id = ul.user_id
    LEFT JOIN rtc_sessions s ON s.id = ul.session_id
    WHERE ${usageRoomFilter.sql}
    ORDER BY ul.id DESC
    LIMIT 12
    `,
    usageRoomFilter.params
  )

  const usageTodayData = {
    logs: toNumber(usageToday, 'logs'),
    seconds: toNumber(usageToday, 'seconds'),
    minutes: toNumber(usageToday, 'minutes', 2),
    users: toNumber(usageToday, 'users'),
    rooms: toNumber(usageToday, 'rooms'),
    avg_duration_seconds: toNumber(usageToday, 'avg_duration_seconds'),
  }
  const usageMonthData = {
    logs: toNumber(usageMonth, 'logs'),
    seconds: toNumber(usageMonth, 'seconds'),
    minutes: toNumber(usageMonth, 'minutes', 2),
    users: toNumber(usageMonth, 'users'),
    rooms: toNumber(usageMonth, 'rooms'),
    avg_duration_seconds: toNumber(usageMonth, 'avg_duration_seconds'),
  }
  const roomMetricData = {
    total: toNumber(roomMetrics, 'total'),
    active: toNumber(roomMetrics, 'active'),
    inactive: toNumber(roomMetrics, 'inactive'),
    ended: toNumber(roomMetrics, 'ended'),
    public: toNumber(roomMetrics, 'public_rooms'),
    private: toNumber(roomMetrics, 'private_rooms'),
    password: toNumber(roomMetrics, 'password_rooms'),
    video: toNumber(roomMetrics, 'video_rooms'),
    voice: toNumber(roomMetrics, 'voice_rooms'),
    live: toNumber(roomMetrics, 'live_rooms'),
    created_today: toNumber(roomMetrics, 'created_today'),
  }
  const sessionMetricData = {
    total: toNumber(sessionMetrics, 'total'),
    active: toNumber(sessionMetrics, 'active'),
    started_today: toNumber(sessionMetrics, 'started_today'),
    ended_today: toNumber(sessionMetrics, 'ended_today'),
    avg_duration_seconds_today: toNumber(sessionMetrics, 'avg_duration_seconds_today'),
    participant_minutes_today: toNumber(sessionMetrics, 'participant_minutes_today', 2),
  }
  const participantMetricData = {
    active: toNumber(participantMetrics, 'active'),
    active_users: toNumber(participantMetrics, 'active_users'),
    mics_on: toNumber(participantMetrics, 'mics_on'),
    cameras_on: toNumber(participantMetrics, 'cameras_on'),
    reconnecting: toNumber(participantMetrics, 'reconnecting'),
  }
  const chatMetricData = {
    total: toNumber(chatMetrics, 'total'),
    messages_today: toNumber(chatMetrics, 'messages_today'),
    messages_last_hour: toNumber(chatMetrics, 'messages_last_hour'),
    unsent_today: toNumber(chatMetrics, 'unsent_today'),
    deleted_today: toNumber(chatMetrics, 'deleted_today'),
  }
  const moderationMetricData = {
    events_today: toNumber(moderationMetrics, 'events_today'),
    mutes_today: toNumber(moderationMetrics, 'mutes_today'),
    kicks_today: toNumber(moderationMetrics, 'kicks_today'),
    bans_today: toNumber(moderationMetrics, 'bans_today'),
    active_bans: toNumber(activeBans, 'count'),
  }

  const participantsBySession = activeSessionParticipants.reduce((groups, participant) => {
    const sessionId = Number(participant.session_id)
    if (!groups.has(sessionId)) groups.set(sessionId, [])
    groups.get(sessionId).push({
      id: participant.id,
      user_id: participant.user_id,
      user_name: participant.user_name || `User #${participant.user_id}`,
      user_email: participant.user_email,
      peer_uid: participant.peer_uid,
      role: participant.role_in_room,
      joined_at: participant.joined_at,
      connected_seconds: toNumber(participant, 'connected_seconds'),
      mic_enabled: boolValue(participant.mic_enabled),
      camera_enabled: boolValue(participant.camera_enabled),
      screen_shared: boolValue(participant.screen_shared),
      connection_status: participant.connection_status,
      updated_at: participant.updated_at,
    })
    return groups
  }, new Map())

  const activeSessionMonitor = {
    generated_at: new Date().toISOString(),
    summary: {
      sessions: activeSessionMonitorRows.length,
      participants: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'active_participants'), 0),
      active_users: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'active_users'), 0),
      mics_on: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'mics_on'), 0),
      cameras_on: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'cameras_on'), 0),
      reconnecting: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'reconnecting'), 0),
    },
    sessions: activeSessionMonitorRows.map((session) => {
      const maxMicCount = Math.max(1, toNumber(session, 'max_mic_count') || 1)
      const activeParticipants = toNumber(session, 'active_participants')

      return {
        id: session.id,
        room_id: session.room_id,
        room_name: session.room_name,
        room_privacy: session.privacy_type,
        max_mic_count: maxMicCount,
        signaling_room: session.signaling_room,
        session_type: session.session_type,
        started_by: session.started_by,
        started_by_name: session.started_by_name || `User #${session.started_by}`,
        owner_name: session.owner_name || 'Room owner',
        started_at: session.started_at,
        elapsed_seconds: toNumber(session, 'elapsed_seconds'),
        active_participants: activeParticipants,
        active_users: toNumber(session, 'active_users'),
        mics_on: toNumber(session, 'mics_on'),
        cameras_on: toNumber(session, 'cameras_on'),
        screen_shares: toNumber(session, 'screen_shares'),
        reconnecting: toNumber(session, 'reconnecting'),
        capacity_percent: Math.min(100, Math.round((activeParticipants / maxMicCount) * 100)),
        health: toNumber(session, 'reconnecting') > 0 ? 'attention' : activeParticipants > 0 ? 'live' : 'idle',
        last_participant_update: session.last_participant_update,
        participants: participantsBySession.get(Number(session.id)) || [],
      }
    }),
  }

  const verificationIssues = Number(missingUsageLogs.count || 0)
    + Number(durationMismatches.count || 0)
    + Number(duplicateUsageLogs.count || 0)
    + Number(sessionTotalMismatches.count || 0)
  const verificationStatus = verificationIssues === 0 ? 'verified' : 'needs_attention'

  return {
    active_rooms: Number(activeRooms.count || 0),
    active_sessions: Number(activeSessions.count || 0),
    total_users: Number(totalUsers.count || 0),
    minutes_used_today: usageTodayData.minutes,
    minutes_used_this_month: usageMonthData.minutes,
    rtc_status: 'online',
    billing_mode: 'participant_minutes',
    usage_today: usageTodayData,
    usage_month: usageMonthData,
    usage_verification: {
      status: verificationStatus,
      ended_participants: Number(endedParticipants.count || 0),
      missing_usage_logs: Number(missingUsageLogs.count || 0),
      duration_mismatches: Number(durationMismatches.count || 0),
      duplicate_usage_logs: Number(duplicateUsageLogs.count || 0),
      session_total_mismatches: Number(sessionTotalMismatches.count || 0),
    },
    metrics: {
      rooms: roomMetricData,
      sessions: sessionMetricData,
      participants: participantMetricData,
      users: {
        total: Number(totalUsers.count || 0),
        active: Number(totalUsers.count || 0),
        banned: 0,
        new_today: 0,
        new_7_days: 0,
      },
      usage: {
        today: usageTodayData,
        month: usageMonthData,
      },
      chat: chatMetricData,
      moderation: moderationMetricData,
      verification: {
        status: verificationStatus,
        issue_count: verificationIssues,
      },
    },
    active_sessions_monitor: activeSessionMonitor,
    recent_usage_logs: recentUsageLogs.map((log) => ({
      id: log.id,
      room_id: log.room_id,
      session_id: log.session_id,
      user_id: log.user_id,
      room_name: log.room_name,
      user_name: log.user_name || `User #${log.user_id}`,
      usage_type: log.usage_type,
      started_at: log.started_at,
      ended_at: log.ended_at,
      duration_seconds: Number(log.duration_seconds || 0),
      billable_minutes: Number(log.billable_minutes || 0),
      session_status: log.session_status,
      created_at: log.created_at,
    })),
  }
}

async function getAdminStats(roomIds) {
  const roomFilter = makeInFilter('r.id', roomIds, 'statRoom')
  const sessionFilter = makeInFilter('s.room_id', roomIds, 'statSession')
  const usageFilter = makeInFilter('ul.room_id', roomIds, 'statUsage')

  const [rooms] = await query(
    `
    SELECT
      COUNT(*) AS total_rooms,
      COALESCE(SUM(r.status = 'active'), 0) AS active_rooms
    FROM rooms r
    WHERE ${roomFilter.sql}
    `,
    roomFilter.params
  )
  const [sessions] = await query(
    `
    SELECT COUNT(*) AS active_sessions
    FROM rtc_sessions s
    WHERE ${sessionFilter.sql}
    AND s.status = 'active'
    `,
    sessionFilter.params
  )
  const [usage] = await query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN DATE(ul.created_at) = CURDATE() THEN ul.billable_minutes ELSE 0 END), 0) AS minutes_today,
      COALESCE(SUM(CASE WHEN ul.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN ul.billable_minutes ELSE 0 END), 0) AS minutes_month,
      COUNT(*) AS usage_logs
    FROM usage_logs ul
    WHERE ${usageFilter.sql}
    `,
    usageFilter.params
  )

  return {
    total_rooms: toNumber(rooms, 'total_rooms'),
    active_rooms: toNumber(rooms, 'active_rooms'),
    active_sessions: toNumber(sessions, 'active_sessions'),
    minutes_today: toNumber(usage, 'minutes_today', 2),
    minutes_month: toNumber(usage, 'minutes_month', 2),
    usage_logs: toNumber(usage, 'usage_logs'),
  }
}

async function getRoomRows(roomIds) {
  const roomFilter = makeInFilter('r.id', roomIds, 'detailRoom')

  const rows = await query(
    `
    SELECT
      r.id, r.tenant_id, r.owner_id, r.name, r.description, r.room_type, r.privacy_type,
      r.max_mic_count, r.chat_enabled, r.gift_enabled, r.screen_share_enabled,
      r.ai_security_enabled, r.status, r.created_at, r.updated_at,
      owner.name AS owner_name,
      owner.email AS owner_email,
      COALESCE(active_participants.active_count, 0) AS active_participants,
      COALESCE(active_participants.mics_on, 0) AS mics_on,
      COALESCE(active_participants.cameras_on, 0) AS cameras_on,
      COALESCE(active_sessions.active_count, 0) AS active_sessions,
      COALESCE(usage_totals.usage_logs, 0) AS usage_logs,
      COALESCE(usage_totals.billable_minutes, 0) AS billable_minutes
    FROM rooms r
    LEFT JOIN users owner ON owner.id = r.owner_id
    LEFT JOIN (
      SELECT
        room_id,
        COUNT(*) AS active_count,
        COALESCE(SUM(mic_enabled = 1), 0) AS mics_on,
        COALESCE(SUM(camera_enabled = 1), 0) AS cameras_on
      FROM rtc_session_participants
      WHERE left_at IS NULL
      GROUP BY room_id
    ) active_participants ON active_participants.room_id = r.id
    LEFT JOIN (
      SELECT room_id, COUNT(*) AS active_count
      FROM rtc_sessions
      WHERE status = 'active'
      GROUP BY room_id
    ) active_sessions ON active_sessions.room_id = r.id
    LEFT JOIN (
      SELECT
        room_id,
        COUNT(*) AS usage_logs,
        COALESCE(SUM(billable_minutes), 0) AS billable_minutes
      FROM usage_logs
      GROUP BY room_id
    ) usage_totals ON usage_totals.room_id = r.id
    WHERE ${roomFilter.sql}
    ORDER BY active_sessions DESC, active_participants DESC, r.updated_at DESC, r.id DESC
    LIMIT 120
    `,
    roomFilter.params
  )

  return rows.map((room) => ({
    id: room.id,
    tenant_id: room.tenant_id,
    owner_id: room.owner_id,
    owner_name: room.owner_name || 'Admin',
    owner_email: room.owner_email,
    name: room.name,
    description: room.description,
    room_type: room.room_type,
    privacy_type: room.privacy_type,
    max_mic_count: Number(room.max_mic_count || 0),
    status: room.status,
    chat_enabled: boolValue(room.chat_enabled),
    gift_enabled: boolValue(room.gift_enabled),
    screen_share_enabled: boolValue(room.screen_share_enabled),
    ai_security_enabled: boolValue(room.ai_security_enabled),
    active_participants: Number(room.active_participants || 0),
    active_sessions: Number(room.active_sessions || 0),
    mics_on: Number(room.mics_on || 0),
    cameras_on: Number(room.cameras_on || 0),
    usage_logs: Number(room.usage_logs || 0),
    billable_minutes: Number(room.billable_minutes || 0),
    created_at: room.created_at,
    updated_at: room.updated_at,
  }))
}

async function getDailyUsage(roomIds) {
  const usageFilter = makeInFilter('ul.room_id', roomIds, 'dailyRoom')

  const rows = await query(
    `
    SELECT
      DATE(ul.created_at) AS usage_date,
      COUNT(*) AS logs,
      COUNT(DISTINCT ul.room_id) AS rooms,
      COUNT(DISTINCT ul.user_id) AS users,
      COALESCE(SUM(ul.duration_seconds), 0) AS seconds,
      COALESCE(SUM(ul.billable_minutes), 0) AS minutes
    FROM usage_logs ul
    WHERE ${usageFilter.sql}
    AND ul.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(ul.created_at)
    ORDER BY usage_date DESC
    LIMIT 30
    `,
    usageFilter.params
  )

  return rows.map((row) => ({
    usage_date: row.usage_date,
    logs: Number(row.logs || 0),
    rooms: Number(row.rooms || 0),
    users: Number(row.users || 0),
    seconds: Number(row.seconds || 0),
    minutes: Number(row.minutes || 0),
  }))
}

async function getParticipantRecords(roomIds) {
  const participantFilter = makeInFilter('p.room_id', roomIds, 'recordRoom')

  const rows = await query(
    `
    SELECT
      p.id, p.room_id, p.session_id, p.user_id, p.role_in_room,
      p.joined_at, p.left_at, p.duration_seconds, p.connection_status,
      p.mic_enabled, p.camera_enabled,
      r.name AS room_name,
      r.status AS room_status,
      u.name AS user_name,
      u.email AS user_email,
      s.status AS session_status
    FROM rtc_session_participants p
    INNER JOIN rooms r ON r.id = p.room_id
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN rtc_sessions s ON s.id = p.session_id
    WHERE ${participantFilter.sql}
    ORDER BY p.joined_at DESC, p.id DESC
    LIMIT 80
    `,
    participantFilter.params
  )

  return rows.map((row) => ({
    id: row.id,
    room_id: row.room_id,
    room_name: row.room_name,
    room_status: row.room_status,
    session_id: row.session_id,
    session_status: row.session_status,
    user_id: row.user_id,
    user_name: row.user_name || `User #${row.user_id}`,
    user_email: row.user_email,
    role: row.role_in_room,
    joined_at: row.joined_at,
    left_at: row.left_at,
    duration_seconds: Number(row.duration_seconds || 0),
    connection_status: row.connection_status,
    mic_enabled: boolValue(row.mic_enabled),
    camera_enabled: boolValue(row.camera_enabled),
  }))
}

async function buildScopePayload({ adminRow = null, roomIds }) {
  const [dashboard, rooms, dailyUsage, records] = await Promise.all([
    getDashboard(roomIds),
    getRoomRows(roomIds),
    getDailyUsage(roomIds),
    getParticipantRecords(roomIds),
  ])

  return {
    admin: adminRow ? normalizeAdmin(adminRow, await getAdminStats(roomIds)) : null,
    dashboard,
    rooms,
    daily_usage: dailyUsage,
    participant_records: records,
  }
}

router.use(authMiddleware, requireAnyRole(ADMIN_ROLES))

router.get('/dashboard', async (req, res, next) => {
  try {
    const roomIds = hasAnyRole(req.user, ['super_admin'])
      ? null
      : await getScopedRoomIds(req.user.id, req.user.tenant_id)

    return res.json({ dashboard: await getDashboard(roomIds) })
  } catch (error) {
    return next(error)
  }
})

router.get('/overview', async (req, res, next) => {
  try {
    const isSuperAdmin = hasAnyRole(req.user, ['super_admin'])

    if (isSuperAdmin) {
      const adminRows = await getClientAdmins()
      const admins = await Promise.all(adminRows.map(async (admin) => {
        const roomIds = await getScopedRoomIds(admin.id, admin.tenant_id)
        return normalizeAdmin(admin, await getAdminStats(roomIds))
      }))
      const platform = await buildScopePayload({ roomIds: null })

      return res.json({
        scope: 'super_admin',
        roles: roleList(req.user),
        admins,
        ...platform,
      })
    }

    const adminRow = await getAdminUser(req.user.id)
    const roomIds = await getScopedRoomIds(req.user.id, req.user.tenant_id)
    const payload = await buildScopePayload({ adminRow, roomIds })

    return res.json({
      scope: 'client_admin',
      roles: roleList(req.user),
      ...payload,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/admins/:adminId', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the super admin can inspect another admin.' })
    }

    const adminId = Number(req.params.adminId)
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ message: 'Invalid admin id.' })
    }

    const adminRow = await getAdminUser(adminId)
    const adminRoles = String(adminRow?.roles || '').split(',')
    if (!adminRow || !adminRoles.includes('client_admin') || adminRoles.includes('super_admin')) {
      return res.status(404).json({ message: 'Admin was not found.' })
    }

    const roomIds = await getScopedRoomIds(adminId, adminRow.tenant_id)
    const payload = await buildScopePayload({ adminRow, roomIds })

    return res.json({
      scope: 'admin_detail',
      ...payload,
    })
  } catch (error) {
    return next(error)
  }
})

module.exports = router
