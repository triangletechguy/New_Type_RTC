const { query, transaction } = require('../config/db')

function usageTypeFromRoomType(roomType) {
  return ['audio', 'youtube_audio', 'one_to_one_audio', 'group_audio'].includes(roomType) ? 'audio' : 'video'
}

async function closeParticipantSession(connection, room, participant, userId) {
  if (participant.left_at) {
    return {
      durationSeconds: Number(participant.duration_seconds || 0),
      billableMinutes: Number((Number(participant.duration_seconds || 0) / 60).toFixed(2)),
      usageLogId: null,
      alreadyClosed: true,
    }
  }

  const [durationRows] = await connection.execute(
    `
    SELECT TIMESTAMPDIFF(SECOND, joined_at, NOW()) AS duration_seconds
    FROM rtc_session_participants
    WHERE id = ?
    `,
    [participant.id]
  )

  const durationSeconds = Math.max(0, Number(durationRows[0]?.duration_seconds || 0))
  const billableMinutes = Number((durationSeconds / 60).toFixed(2))

  const [updateParticipant] = await connection.execute(
    `
    UPDATE rtc_session_participants
    SET left_at = NOW(),
        duration_seconds = ?,
        connection_status = 'disconnected',
        updated_at = NOW()
    WHERE id = ?
    AND left_at IS NULL
    `,
    [durationSeconds, participant.id]
  )

  if (!updateParticipant.affectedRows) {
    return {
      durationSeconds,
      billableMinutes,
      usageLogId: null,
      alreadyClosed: true,
    }
  }

  const [usageInsert] = await connection.execute(
    `
    INSERT INTO usage_logs (
      tenant_id, room_id, session_id, user_id, usage_type,
      started_at, ended_at, duration_seconds, billable_minutes, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW())
    `,
    [
      room.tenant_id,
      room.id,
      participant.session_id,
      userId,
      usageTypeFromRoomType(room.room_type),
      participant.joined_at,
      durationSeconds,
      billableMinutes,
    ]
  )

  const [activeCountRows] = await connection.execute(
    `
    SELECT COUNT(*) AS active_count
    FROM rtc_session_participants
    WHERE session_id = ?
    AND left_at IS NULL
    `,
    [participant.session_id]
  )

  const [totalRows] = await connection.execute(
    `
    SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM rtc_session_participants
    WHERE session_id = ?
    AND left_at IS NOT NULL
    `,
    [participant.session_id]
  )

  const activeCount = Number(activeCountRows[0]?.active_count || 0)
  const totalParticipantMinutes = Number((Number(totalRows[0]?.total_seconds || 0) / 60).toFixed(2))

  if (activeCount === 0) {
    await connection.execute(
      `
      UPDATE rtc_sessions
      SET status = 'ended',
          ended_at = NOW(),
          total_participant_minutes = ?,
          total_duration_seconds = TIMESTAMPDIFF(SECOND, started_at, NOW()),
          updated_at = NOW()
      WHERE id = ?
      `,
      [totalParticipantMinutes, participant.session_id]
    )
  } else {
    await connection.execute(
      `
      UPDATE rtc_sessions
      SET total_participant_minutes = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [totalParticipantMinutes, participant.session_id]
    )
  }

  return {
    durationSeconds,
    billableMinutes,
    usageLogId: usageInsert.insertId,
    alreadyClosed: false,
  }
}

async function closeActiveParticipantForUser({ roomId, userId, eventType = 'disconnect', reason = 'socket_disconnect' }) {
  const numericRoomId = Number(roomId || 0)
  const numericUserId = Number(userId || 0)
  if (!numericRoomId || !numericUserId) return { closed: false, reason: 'missing_scope' }

  return transaction(async (connection) => {
    const [rooms] = await connection.execute(
      `
      SELECT *
      FROM rooms
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [numericRoomId]
    )

    if (!rooms.length) return { closed: false, reason: 'room_not_found' }
    const room = rooms[0]

    const [participants] = await connection.execute(
      `
      SELECT *
      FROM rtc_session_participants
      WHERE room_id = ?
      AND user_id = ?
      AND left_at IS NULL
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [numericRoomId, numericUserId]
    )

    if (!participants.length) return { closed: false, reason: 'no_active_participant' }

    const participant = participants[0]
    const leaveResult = await closeParticipantSession(connection, room, participant, numericUserId)

    await connection.execute(
      `
      INSERT INTO rtc_events (tenant_id, room_id, session_id, user_id, event_type, event_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        room.tenant_id,
        room.id,
        participant.session_id,
        numericUserId,
        eventType,
        JSON.stringify({
          duration_seconds: leaveResult.durationSeconds,
          billable_minutes: leaveResult.billableMinutes,
          usage_log_id: leaveResult.usageLogId,
          rtc_provider: 'native_webrtc',
          reason,
        }),
      ]
    )

    return {
      closed: !leaveResult.alreadyClosed,
      reason,
      durationSeconds: leaveResult.durationSeconds,
      billableMinutes: leaveResult.billableMinutes,
      usageLogId: leaveResult.usageLogId,
    }
  })
}

async function touchActiveParticipant({ roomId, userId, micEnabled, cameraEnabled, screenShared }) {
  const numericRoomId = Number(roomId || 0)
  const numericUserId = Number(userId || 0)
  if (!numericRoomId || !numericUserId) return { touched: false, reason: 'missing_scope' }

  const updates = ['connection_status = ?', 'updated_at = NOW()']
  const values = ['connected']

  if (micEnabled !== undefined) {
    updates.push('mic_enabled = ?')
    values.push(micEnabled ? 1 : 0)
  }

  if (cameraEnabled !== undefined) {
    updates.push('camera_enabled = ?')
    values.push(cameraEnabled ? 1 : 0)
  }

  if (screenShared !== undefined) {
    updates.push('screen_shared = ?')
    values.push(screenShared ? 1 : 0)
  }

  values.push(numericRoomId, numericUserId)

  const result = await query(
    `
    UPDATE rtc_session_participants
    SET ${updates.join(', ')}
    WHERE room_id = ?
    AND user_id = ?
    AND left_at IS NULL
    ORDER BY id DESC
    LIMIT 1
    `,
    values
  )

  return {
    touched: result.affectedRows > 0,
    reason: result.affectedRows > 0 ? 'active' : 'no_active_participant',
  }
}

module.exports = {
  closeActiveParticipantForUser,
  closeParticipantSession,
  touchActiveParticipant,
}
