const express = require('express')
const { query } = require('../config/db')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()

function toNumber(row, key, decimals = null) {
  const value = Number(row?.[key] || 0)
  return decimals === null ? value : Number(value.toFixed(decimals))
}

function boolValue(value) {
  return Boolean(Number(value || 0))
}

router.get('/dashboard', authMiddleware, async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id

    const [activeRooms] = await query(
      `SELECT COUNT(*) AS count FROM rooms WHERE tenant_id = :tenantId AND status = 'active'`,
      { tenantId }
    )

    const [activeSessions] = await query(
      `SELECT COUNT(*) AS count FROM rtc_sessions WHERE tenant_id = :tenantId AND status = 'active'`,
      { tenantId }
    )

    const [totalUsers] = await query(
      `SELECT COUNT(*) AS count FROM users WHERE tenant_id = :tenantId`,
      { tenantId }
    )

    const [roomMetrics] = await query(
      `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status = 'active'), 0) AS active,
        COALESCE(SUM(status = 'inactive'), 0) AS inactive,
        COALESCE(SUM(status = 'ended'), 0) AS ended,
        COALESCE(SUM(privacy_type = 'public'), 0) AS public_rooms,
        COALESCE(SUM(privacy_type = 'private'), 0) AS private_rooms,
        COALESCE(SUM(privacy_type = 'password'), 0) AS password_rooms,
        COALESCE(SUM(room_type IN ('video', 'group_video')), 0) AS video_rooms,
        COALESCE(SUM(room_type IN ('audio', 'group_audio')), 0) AS voice_rooms,
        COALESCE(SUM(room_type IN ('solo_live', 'pk_live')), 0) AS live_rooms,
        COALESCE(SUM(created_at >= CURDATE()), 0) AS created_today
      FROM rooms
      WHERE tenant_id = :tenantId
      `,
      { tenantId }
    )

    const [sessionMetrics] = await query(
      `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status = 'active'), 0) AS active,
        COALESCE(SUM(created_at >= CURDATE()), 0) AS started_today,
        COALESCE(SUM(status = 'ended' AND ended_at >= CURDATE()), 0) AS ended_today,
        COALESCE(AVG(CASE WHEN created_at >= CURDATE() AND total_duration_seconds > 0 THEN total_duration_seconds END), 0) AS avg_duration_seconds_today,
        COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN total_participant_minutes ELSE 0 END), 0) AS participant_minutes_today
      FROM rtc_sessions
      WHERE tenant_id = :tenantId
      `,
      { tenantId }
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
      INNER JOIN rooms r ON r.id = p.room_id
      WHERE r.tenant_id = :tenantId
      AND p.left_at IS NULL
      `,
      { tenantId }
    )

    const [userMetrics] = await query(
      `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status = 'active'), 0) AS active,
        COALESCE(SUM(status = 'banned'), 0) AS banned,
        COALESCE(SUM(created_at >= CURDATE()), 0) AS new_today,
        COALESCE(SUM(created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) AS new_7_days
      FROM users
      WHERE tenant_id = :tenantId
      `,
      { tenantId }
    )

    const [usageToday] = await query(
      `
      SELECT
        COUNT(*) AS logs,
        COALESCE(SUM(duration_seconds), 0) AS seconds,
        COALESCE(SUM(billable_minutes), 0) AS minutes,
        COUNT(DISTINCT user_id) AS users,
        COUNT(DISTINCT room_id) AS rooms,
        COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds
      FROM usage_logs
      WHERE tenant_id = :tenantId
      AND DATE(created_at) = CURDATE()
      `,
      { tenantId }
    )

    const [usageMonth] = await query(
      `
      SELECT
        COUNT(*) AS logs,
        COALESCE(SUM(duration_seconds), 0) AS seconds,
        COALESCE(SUM(billable_minutes), 0) AS minutes,
        COUNT(DISTINCT user_id) AS users,
        COUNT(DISTINCT room_id) AS rooms,
        COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds
      FROM usage_logs
      WHERE tenant_id = :tenantId
      AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      `,
      { tenantId }
    )

    const [chatMetrics] = await query(
      `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(created_at >= CURDATE()), 0) AS messages_today,
        COALESCE(SUM(created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)), 0) AS messages_last_hour,
        COALESCE(SUM(is_unsent = 1 AND updated_at >= CURDATE()), 0) AS unsent_today,
        COALESCE(SUM(is_deleted = 1 AND updated_at >= CURDATE()), 0) AS deleted_today
      FROM chat_messages
      WHERE tenant_id = :tenantId
      `,
      { tenantId }
    )

    const [moderationMetrics] = await query(
      `
      SELECT
        COALESCE(SUM(created_at >= CURDATE()), 0) AS events_today,
        COALESCE(SUM(event_type = 'mute_by_moderator' AND created_at >= CURDATE()), 0) AS mutes_today,
        COALESCE(SUM(event_type = 'kick_by_moderator' AND created_at >= CURDATE()), 0) AS kicks_today,
        COALESCE(SUM(event_type = 'ban_by_moderator' AND created_at >= CURDATE()), 0) AS bans_today
      FROM rtc_events
      WHERE tenant_id = :tenantId
      AND event_type IN ('mute_by_moderator', 'kick_by_moderator', 'ban_by_moderator')
      `,
      { tenantId }
    )

    const [activeBans] = await query(
      `
      SELECT COUNT(*) AS count
      FROM room_bans
      WHERE tenant_id = :tenantId
      AND status = 'active'
      AND (ends_at IS NULL OR ends_at > NOW())
      `,
      { tenantId }
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
      WHERE s.tenant_id = :tenantId
      AND s.status = 'active'
      GROUP BY
        s.id, s.room_id, s.signaling_room, s.session_type, s.started_by, s.started_at,
        r.name, r.privacy_type, r.max_mic_count, owner.name, starter.name
      ORDER BY active_participants DESC, s.started_at DESC
      LIMIT 12
      `,
      { tenantId }
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
      INNER JOIN rooms r ON r.id = p.room_id
      WHERE r.tenant_id = :tenantId
      AND p.left_at IS NOT NULL
      `,
      { tenantId }
    )

    const [missingUsageLogs] = await query(
      `
      SELECT COUNT(*) AS count
      FROM rtc_session_participants p
      INNER JOIN rooms r ON r.id = p.room_id
      WHERE r.tenant_id = :tenantId
      AND p.left_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM usage_logs ul
        WHERE ul.tenant_id = r.tenant_id
        AND ul.room_id = p.room_id
        AND ul.session_id = p.session_id
        AND ul.user_id = p.user_id
        AND ul.started_at = p.joined_at
      )
      `,
      { tenantId }
    )

    const [durationMismatches] = await query(
      `
      SELECT COUNT(*) AS count
      FROM rtc_session_participants p
      INNER JOIN rooms r ON r.id = p.room_id
      INNER JOIN usage_logs ul
        ON ul.tenant_id = r.tenant_id
        AND ul.room_id = p.room_id
        AND ul.session_id = p.session_id
        AND ul.user_id = p.user_id
        AND ul.started_at = p.joined_at
      WHERE r.tenant_id = :tenantId
      AND p.left_at IS NOT NULL
      AND ABS(COALESCE(ul.duration_seconds, 0) - COALESCE(p.duration_seconds, 0)) > 1
      `,
      { tenantId }
    )

    const [duplicateUsageLogs] = await query(
      `
      SELECT COUNT(*) AS count
      FROM (
        SELECT room_id, session_id, user_id, started_at, COUNT(*) AS log_count
        FROM usage_logs
        WHERE tenant_id = :tenantId
        GROUP BY room_id, session_id, user_id, started_at
        HAVING COUNT(*) > 1
      ) duplicates
      `,
      { tenantId }
    )

    const [sessionTotalMismatches] = await query(
      `
      SELECT COUNT(*) AS count
      FROM rtc_sessions s
      INNER JOIN rooms r ON r.id = s.room_id
      LEFT JOIN (
        SELECT session_id, ROUND(SUM(duration_seconds) / 60, 2) AS participant_minutes
        FROM rtc_session_participants
        WHERE left_at IS NOT NULL
        GROUP BY session_id
      ) totals ON totals.session_id = s.id
      WHERE r.tenant_id = :tenantId
      AND ABS(COALESCE(s.total_participant_minutes, 0) - COALESCE(totals.participant_minutes, 0)) > 0.01
      `,
      { tenantId }
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
      WHERE ul.tenant_id = :tenantId
      ORDER BY ul.id DESC
      LIMIT 12
      `,
      { tenantId }
    )

    const verificationIssues = Number(missingUsageLogs.count || 0)
      + Number(durationMismatches.count || 0)
      + Number(duplicateUsageLogs.count || 0)
      + Number(sessionTotalMismatches.count || 0)
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
    const userMetricData = {
      total: toNumber(userMetrics, 'total'),
      active: toNumber(userMetrics, 'active'),
      banned: toNumber(userMetrics, 'banned'),
      new_today: toNumber(userMetrics, 'new_today'),
      new_7_days: toNumber(userMetrics, 'new_7_days'),
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
    const verificationStatus = verificationIssues === 0 ? 'verified' : 'needs_attention'

    return res.json({
      dashboard: {
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
          users: userMetricData,
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
      },
    })
  } catch (error) {
    next(error)
  }
})

module.exports = router
