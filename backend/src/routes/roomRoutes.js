const express = require('express')
const bcrypt = require('bcryptjs')
const { query, transaction } = require('../config/db')
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth')
const { closeParticipantSession } = require('../services/rtcSessionLifecycle')
const {
  ASSIGNABLE_ROOM_ROLES,
  canApproveStageRequests,
  canAssignRoomRoles,
  canManageRoom,
  canModerateTarget,
  canPublishRoomMedia,
  canUpdateRoomSettings,
  normalizeRoomRole,
  roleCanBeMovedByStagePermission,
  roomRoleCapabilities,
} = require('../utils/roomRoles')

const router = express.Router()

const roomTypes = ['audio', 'youtube_audio', 'one_to_one_audio', 'video', 'one_to_one_video', 'group_audio', 'group_video', 'solo_live', 'pk_live']
const validRoomTypes = new Set(roomTypes)
const validPrivacyTypes = new Set(['public', 'private', 'password'])
const validRoomStatuses = new Set(['active', 'inactive', 'ended'])
const validRoomFeeds = new Set(['live', 'following', 'nearby', 'party', 'pk', 'new', 'for_you', 'explore', 'latest', 'global'])
const validRtcModes = new Set(['audio', 'video'])
const validRtcQualities = new Set(['good', 'fair', 'poor', 'degraded', 'failed', 'connecting', 'idle', 'unknown'])
const validControlThemes = new Set(['neon', 'midnight', 'studio', 'mint'])
const validModerationActions = new Set(['mute', 'mute_mic', 'disable_camera', 'kick', 'ban'])
const validBanTypes = new Set(['temporary', 'permanent'])
const stagePermissionActions = new Set(['approve', 'reject', 'remove'])
const stageRequestStatuses = new Set(['pending', 'approved', 'rejected', 'cancelled', 'expired'])
const MAX_ROOM_SEATS = 20
let roomFollowSchemaPromise = null
let roomFeatureSchemaPromise = null
let roomStageRequestSchemaPromise = null
let roomCreationSchemaPromise = null
const roomTypeGroups = {
  all: null,
  live: ['solo_live', 'pk_live'],
  video: ['video', 'one_to_one_video', 'group_video'],
  music: ['audio', 'youtube_audio', 'one_to_one_audio', 'group_audio'],
  voice: ['audio', 'youtube_audio', 'one_to_one_audio', 'group_audio'],
  pk: ['pk_live'],
}
const newestRoomWindowDays = 3
const sortOptions = {
  newest: 'r.created_at DESC, r.id DESC',
  oldest: 'r.created_at ASC, r.id ASC',
  name: 'r.name ASC, r.id DESC',
  active: 'active_participants DESC, r.created_at DESC, r.id DESC',
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function cleanString(value, maxLength) {
  if (value === undefined || value === null) return ''
  return String(value).trim().slice(0, maxLength)
}

function parseInteger(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue
  const number = Number(value)
  if (!Number.isInteger(number)) return null
  return number
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1

  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

function roomTypeEnumSql() {
  return roomTypes.map((roomType) => `'${roomType}'`).join(', ')
}

async function ensureRoomFeatureSchema() {
  if (!roomFeatureSchemaPromise) {
    roomFeatureSchemaPromise = (async () => {
      const enumSql = roomTypeEnumSql()
      await query(`ALTER TABLE rooms MODIFY COLUMN room_type ENUM(${enumSql}) NOT NULL DEFAULT 'video'`)
      await query(`ALTER TABLE rtc_sessions MODIFY COLUMN session_type ENUM(${enumSql}) NOT NULL`)
      await ensureRoomCreationSchema()
    })().catch((error) => {
      roomFeatureSchemaPromise = null
      throw error
    })
  }

  return roomFeatureSchemaPromise
}

async function ensureRoomColumn(columnName, alterSql) {
  const rows = await query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rooms'
    AND COLUMN_NAME = :columnName
    LIMIT 1
    `,
    { columnName }
  )

  if (!rows.length) await query(alterSql)
}

async function ensureRoomCreationSchema() {
  if (!roomCreationSchemaPromise) {
    roomCreationSchemaPromise = (async () => {
      await ensureRoomColumn(
        'stage_requests_enabled',
        'ALTER TABLE rooms ADD COLUMN stage_requests_enabled BOOLEAN DEFAULT TRUE AFTER max_mic_count'
      )
      await ensureRoomColumn(
        'tags_json',
        'ALTER TABLE rooms ADD COLUMN tags_json JSON NULL AFTER theme'
      )
    })().catch((error) => {
      roomCreationSchemaPromise = null
      throw error
    })
  }

  return roomCreationSchemaPromise
}

async function ensureRoomStageRequestSchema() {
  if (!roomStageRequestSchemaPromise) {
    roomStageRequestSchemaPromise = query(`
      CREATE TABLE IF NOT EXISTS room_stage_requests (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        room_id BIGINT UNSIGNED NOT NULL,
        session_id BIGINT UNSIGNED NULL,
        participant_id BIGINT UNSIGNED NULL,
        requester_user_id BIGINT UNSIGNED NOT NULL,
        requested_mic TINYINT(1) DEFAULT 1,
        requested_camera TINYINT(1) DEFAULT 0,
        requested_rtc_mode ENUM('audio', 'video') NOT NULL DEFAULT 'video',
        status ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
        response_by BIGINT UNSIGNED NULL,
        responded_at TIMESTAMP NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_stage_requests_room_status (room_id, status, created_at),
        INDEX idx_stage_requests_requester (room_id, requester_user_id, status),
        INDEX idx_stage_requests_tenant (tenant_id, status),
        CONSTRAINT fk_stage_requests_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_stage_requests_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_stage_requests_session FOREIGN KEY (session_id) REFERENCES rtc_sessions(id) ON DELETE SET NULL,
        CONSTRAINT fk_stage_requests_participant FOREIGN KEY (participant_id) REFERENCES rtc_session_participants(id) ON DELETE SET NULL,
        CONSTRAINT fk_stage_requests_requester FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_stage_requests_response_by FOREIGN KEY (response_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `).catch((error) => {
      roomStageRequestSchemaPromise = null
      throw error
    })
  }

  return roomStageRequestSchemaPromise
}

function boundedNumber(value, min, max, fallback = 0, precision = 2) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback

  const bounded = Math.min(max, Math.max(min, number))
  const factor = 10 ** precision
  return Math.round(bounded * factor) / factor
}

function boundedInteger(value, min, max, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.trunc(Math.min(max, Math.max(min, number)))
}

function cleanStringArray(value, maxItems = 8, maxLength = 32) {
  if (!Array.isArray(value)) return []

  const seen = new Set()
  for (const item of value) {
    const clean = cleanString(item, maxLength)
    if (clean) seen.add(clean)
    if (seen.size >= maxItems) break
  }

  return Array.from(seen)
}

function cleanRoomTags(value) {
  if (typeof value === 'string') {
    return cleanStringArray(value.split(/[,\n#]+/), 6, 32)
  }

  if (Buffer.isBuffer(value)) {
    return cleanRoomTags(value.toString('utf8'))
  }

  if (Array.isArray(value)) {
    return cleanStringArray(value, 6, 32)
  }

  return []
}

function parseRoomTags(value) {
  if (!value) return []
  if (Array.isArray(value)) return cleanRoomTags(value)
  if (Buffer.isBuffer(value)) return parseRoomTags(value.toString('utf8'))

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
      return cleanRoomTags(JSON.parse(trimmed))
    } catch {
      return cleanRoomTags(trimmed)
    }
  }

  return []
}

function cleanCountMap(value, maxKeys = 16) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.entries(value).slice(0, maxKeys).reduce((result, [key, count]) => {
    const cleanKey = cleanString(key, 32) || 'unknown'
    result[cleanKey] = boundedInteger(count, 0, 500, 0)
    return result
  }, {})
}

function cleanMediaSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return {
    inbound_audio_kbps: boundedNumber(value.inbound_audio_kbps, 0, 1000000),
    inbound_video_kbps: boundedNumber(value.inbound_video_kbps, 0, 1000000),
    outbound_audio_kbps: boundedNumber(value.outbound_audio_kbps, 0, 1000000),
    outbound_video_kbps: boundedNumber(value.outbound_video_kbps, 0, 1000000),
  }
}

function normalizeRtcQuality(value) {
  const quality = cleanString(value, 24).toLowerCase()
  return validRtcQualities.has(quality) ? quality : 'unknown'
}

function participantStatusForQuality(quality) {
  return ['failed', 'poor', 'degraded', 'connecting'].includes(quality) ? 'reconnecting' : 'connected'
}

function sanitizeRtcQualitySample(payload = {}) {
  const sample = {
    quality: normalizeRtcQuality(payload.quality),
    peer_count: boundedInteger(payload.peer_count ?? payload.peerCount, 0, 500, 0),
    measured_peer_count: boundedInteger(payload.measured_peer_count ?? payload.measuredPeerCount, 0, 500, 0),
    incoming_kbps: boundedNumber(payload.incoming_kbps ?? payload.incomingKbps, 0, 1000000),
    outgoing_kbps: boundedNumber(payload.outgoing_kbps ?? payload.outgoingKbps, 0, 1000000),
    rtt_ms: boundedNumber(payload.rtt_ms ?? payload.rttMs, 0, 60000),
    packet_loss_pct: boundedNumber(payload.packet_loss_pct ?? payload.packetLossPct, 0, 100),
    available_outgoing_kbps: boundedNumber(payload.available_outgoing_kbps ?? payload.availableOutgoingKbps, 0, 1000000),
    local_candidate_types: cleanStringArray(payload.local_candidate_types ?? payload.localCandidateTypes),
    remote_candidate_types: cleanStringArray(payload.remote_candidate_types ?? payload.remoteCandidateTypes),
    peer_states: cleanCountMap(payload.peer_states ?? payload.peerStates),
    media_summary: cleanMediaSummary(payload.media ?? payload.media_summary ?? payload.mediaSummary),
  }

  if (sample.measured_peer_count > sample.peer_count) {
    sample.peer_count = sample.measured_peer_count
  }

  return sample
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function roleNames(user) {
  return (Array.isArray(user?.roles) ? user.roles : [])
    .map((role) => (typeof role === 'string' ? role : role?.name))
    .filter(Boolean)
}

function userHasRole(user, roleName) {
  return roleNames(user).includes(roleName)
}

function deterministicSignalingRoom(room) {
  if (!room?.tenant_id || !room?.id) return ''
  return `webrtc_tenant_${room.tenant_id}_room_${room.id}`
}

async function findActiveSignalingRooms(roomId) {
  const sessions = await query(
    `
    SELECT signaling_room
    FROM rtc_sessions
    WHERE room_id = :roomId
    AND status = 'active'
    AND signaling_room IS NOT NULL
    AND signaling_room <> ''
    GROUP BY signaling_room
    ORDER BY MAX(id) DESC
    `,
    { roomId }
  )

  return sessions.map((session) => String(session.signaling_room || '').trim()).filter(Boolean)
}

async function emitRoomRealtime(req, room, eventName, payload = {}) {
  const io = req.app.get('io')
  if (!io || !room?.id || !eventName) return false

  const channels = new Set(await findActiveSignalingRooms(room.id))
  const fallbackChannel = deterministicSignalingRoom(room)
  if (fallbackChannel) channels.add(fallbackChannel)
  if (!channels.size) return false

  channels.forEach((channel) => {
    io.to(channel).emit(eventName, {
      roomId: channel,
      databaseRoomId: room.id,
      ...payload,
    })
  })

  return true
}

async function ensureRoomFollowSchema() {
  if (!roomFollowSchemaPromise) {
    roomFollowSchemaPromise = query(`
      CREATE TABLE IF NOT EXISTS user_follows (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        follower_id BIGINT UNSIGNED NOT NULL,
        followed_user_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_follow (tenant_id, follower_id, followed_user_id),
        INDEX idx_user_follows_follower (tenant_id, follower_id),
        INDEX idx_user_follows_followed (tenant_id, followed_user_id),
        CONSTRAINT fk_room_user_follows_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_room_user_follows_follower FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_room_user_follows_followed FOREIGN KEY (followed_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).catch((error) => {
      roomFollowSchemaPromise = null
      throw error
    })
  }

  return roomFollowSchemaPromise
}

function roomSupportsVideo(roomType) {
  return validRoomTypes.has(roomType)
}

function isOneToOneRoom(roomType) {
  return ['one_to_one_audio', 'one_to_one_video'].includes(roomType)
}

function rtcProfileForRoomType(roomType) {
  const liveBroadcast = ['solo_live', 'pk_live'].includes(roomType)
  return {
    channel_profile: liveBroadcast ? 'live_broadcasting' : 'communication',
    agora_web_mode: liveBroadcast ? 'live' : 'rtc',
    client_role: liveBroadcast ? 'broadcaster' : 'broadcaster',
    media_type: roomSupportsVideo(roomType) ? 'video' : 'audio',
  }
}

function defaultRtcModeForRoom(roomType) {
  return roomSupportsVideo(roomType) ? 'video' : 'audio'
}

function serializeRoom(row) {
  if (!row) return null

  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    tenant_name: row.tenant_name || null,
    owner_id: Number(row.owner_id),
    owner_name: row.owner_name || null,
    owner_avatar_url: row.owner_avatar_url || null,
    owner_region: row.owner_region || null,
    owner_followed: Boolean(Number(row.owner_followed || 0)),
    name: row.name,
    description: row.description,
    profile_image: row.profile_image,
    room_type: row.room_type,
    privacy_type: row.privacy_type,
    is_password_protected: row.privacy_type === 'password',
    max_mic_count: Number(row.max_mic_count || 0),
    stage_requests_enabled: row.stage_requests_enabled === undefined || row.stage_requests_enabled === null
      ? true
      : Boolean(Number(row.stage_requests_enabled)),
    active_participants: Number(row.active_participants || 0),
    active_speakers: Number(row.active_speakers || 0),
    active_participant_previews: parseActiveParticipantPreviews(row.active_participant_previews),
    theme: row.theme,
    tags: parseRoomTags(row.tags_json),
    chat_enabled: Boolean(Number(row.chat_enabled)),
    gift_enabled: Boolean(Number(row.gift_enabled)),
    screen_share_enabled: Boolean(Number(row.screen_share_enabled)),
    ai_security_enabled: Boolean(Number(row.ai_security_enabled)),
    rtc_profile: rtcProfileForRoomType(row.room_type),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function parseActiveParticipantPreviews(value) {
  let previews = []

  try {
    if (Array.isArray(value)) {
      previews = value
    } else if (Buffer.isBuffer(value)) {
      previews = JSON.parse(value.toString('utf8'))
    } else if (typeof value === 'string' && value.trim()) {
      previews = JSON.parse(value)
    }
  } catch {
    previews = []
  }

  return previews
    .filter(Boolean)
    .slice(0, 8)
    .map((participant) => ({
      user_id: Number(participant.user_id || 0) || null,
      name: cleanString(participant.name || '', 80) || null,
      avatar_url: cleanString(participant.avatar_url || '', 255) || null,
    }))
}

function normalizeStageRequestStatus(value, fallback = 'pending') {
  const status = cleanString(value, 30).toLowerCase()
  return stageRequestStatuses.has(status) ? status : fallback
}

function serializeStageRequest(row) {
  if (!row) return null

  const requesterUserId = Number(row.requester_user_id || row.user_id || 0)
  const requestedRtcMode = row.requested_rtc_mode === 'audio' ? 'audio' : 'video'
  const requesterName = row.requester_name || row.user_name || (requesterUserId ? `User #${requesterUserId}` : 'Guest')

  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    room_id: Number(row.room_id),
    session_id: row.session_id ? Number(row.session_id) : null,
    participant_id: row.participant_id ? Number(row.participant_id) : null,
    requester_user_id: requesterUserId,
    user_id: requesterUserId,
    userId: requesterUserId,
    user_name: requesterName,
    userName: requesterName,
    user_gender: row.requester_gender || row.user_gender || '',
    userGender: row.requester_gender || row.user_gender || '',
    user_avatar_url: row.requester_avatar_url || row.user_avatar_url || '',
    userAvatarUrl: row.requester_avatar_url || row.user_avatar_url || '',
    requested_mic: Boolean(Number(row.requested_mic)),
    requestedMic: Boolean(Number(row.requested_mic)),
    requested_camera: Boolean(Number(row.requested_camera)),
    requestedCamera: Boolean(Number(row.requested_camera)),
    requested_rtc_mode: requestedRtcMode,
    requestedRtcMode: requestedRtcMode,
    status: normalizeStageRequestStatus(row.status),
    response_by: row.response_by ? Number(row.response_by) : null,
    responded_at: row.responded_at || null,
    expires_at: row.expires_at || null,
    requested_at: row.created_at || row.requested_at || null,
    requestedAt: row.created_at || row.requested_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

async function expireStageRequests(connection, roomId) {
  await connection.execute(
    `
    UPDATE room_stage_requests
    SET status = 'expired',
        updated_at = NOW()
    WHERE room_id = ?
    AND status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at <= NOW()
    `,
    [roomId]
  )
}

function stageRequestStatusSql(statuses, params) {
  const cleanStatuses = (Array.isArray(statuses) ? statuses : [statuses])
    .map((status) => normalizeStageRequestStatus(status, ''))
    .filter((status) => stageRequestStatuses.has(status))

  if (!cleanStatuses.length) return ''

  const placeholders = cleanStatuses.map((status) => {
    params.push(status)
    return '?'
  })

  return `AND sr.status IN (${placeholders.join(', ')})`
}

async function fetchStageRequests(connection, roomId, options = {}) {
  const params = [roomId]
  const statusSql = stageRequestStatusSql(options.statuses || ['pending'], params)
  let userSql = ''

  if (options.userId) {
    userSql = 'AND sr.requester_user_id = ?'
    params.push(options.userId)
  }

  const limit = Math.min(100, Math.max(1, Number(options.limit || 30)))

  const [rows] = await connection.execute(
    `
    SELECT
      sr.*,
      u.name AS requester_name,
      u.avatar_url AS requester_avatar_url,
      u.gender AS requester_gender
    FROM room_stage_requests sr
    LEFT JOIN users u ON u.id = sr.requester_user_id
    WHERE sr.room_id = ?
    ${statusSql}
    ${userSql}
    ORDER BY
      FIELD(sr.status, 'pending', 'approved', 'rejected', 'cancelled', 'expired'),
      sr.created_at DESC,
      sr.id DESC
    LIMIT ${limit}
    `,
    params
  )

  return rows.map(serializeStageRequest).filter(Boolean)
}

async function latestStageRequestForUser(connection, roomId, userId, statuses = ['pending']) {
  const requests = await fetchStageRequests(connection, roomId, { userId, statuses, limit: 1 })
  return requests[0] || null
}

async function fetchStageRequestById(connection, roomId, requestId) {
  const [rows] = await connection.execute(
    `
    SELECT
      sr.*,
      u.name AS requester_name,
      u.avatar_url AS requester_avatar_url,
      u.gender AS requester_gender
    FROM room_stage_requests sr
    LEFT JOIN users u ON u.id = sr.requester_user_id
    WHERE sr.room_id = ?
    AND sr.id = ?
    LIMIT 1
    `,
    [roomId, requestId]
  )

  return serializeStageRequest(rows[0])
}

function roomSelectSql(options = {}) {
  const includeViewerFields = Boolean(options.includeViewerFields)

  return `
    SELECT
      r.id, r.tenant_id, r.owner_id, r.name, r.description, r.profile_image,
      r.room_type, r.privacy_type, r.max_mic_count, r.stage_requests_enabled, r.theme, r.tags_json,
      r.chat_enabled, r.gift_enabled, r.screen_share_enabled, r.ai_security_enabled,
      r.status, r.created_at, r.updated_at,
      tenant.name AS tenant_name,
      owner.name AS owner_name,
      owner.avatar_url AS owner_avatar_url,
      owner.current_residence AS owner_region,
      ${includeViewerFields ? 'CASE WHEN followed_owner.followed_user_id IS NULL THEN 0 ELSE 1 END' : '0'} AS owner_followed,
      COALESCE(active_counts.active_participants, 0) AS active_participants,
      COALESCE(active_counts.active_speakers, 0) AS active_speakers,
      active_counts.active_participant_previews AS active_participant_previews
    FROM rooms r
    LEFT JOIN tenants tenant ON tenant.id = r.tenant_id
    LEFT JOIN users owner ON owner.id = r.owner_id
    ${includeViewerFields ? `
    LEFT JOIN user_follows followed_owner
      ON followed_owner.tenant_id = r.tenant_id
      AND followed_owner.follower_id = :feedViewerUserId
      AND followed_owner.followed_user_id = r.owner_id
    ` : ''}
    LEFT JOIN (
      SELECT
        active_sessions.room_id,
        COUNT(active_participants.id) AS active_participants,
        SUM(CASE
          WHEN active_participants.id IS NOT NULL
          AND active_participants.role_in_room IN ('owner', 'admin', 'moderator', 'speaker')
          THEN 1
          ELSE 0
        END) AS active_speakers,
        COALESCE(CONCAT('[', GROUP_CONCAT(
          CASE
            WHEN active_participants.id IS NULL THEN NULL
            ELSE CAST(JSON_OBJECT(
              'user_id', active_participants.user_id,
              'name', COALESCE(active_users.name, CONCAT('User #', active_participants.user_id)),
              'avatar_url', active_users.avatar_url
            ) AS CHAR)
          END
          ORDER BY active_participants.updated_at DESC, active_participants.id DESC
          SEPARATOR ','
        ), ']'), '[]') AS active_participant_previews
      FROM rtc_sessions active_sessions
      LEFT JOIN rtc_session_participants active_participants
        ON active_participants.session_id = active_sessions.id
        AND active_participants.left_at IS NULL
        AND active_participants.updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
      LEFT JOIN users active_users ON active_users.id = active_participants.user_id
      WHERE active_sessions.status = 'active'
      GROUP BY active_sessions.room_id
    ) active_counts ON active_counts.room_id = r.id
  `
}

async function findPublicRoomById(roomId) {
  await ensureRoomCreationSchema()
  const rows = await query(
    `
    ${roomSelectSql()}
    WHERE r.id = :roomId
    LIMIT 1
    `,
    { roomId }
  )

  return serializeRoom(rows[0])
}

function addInCondition(conditions, params, column, values, paramPrefix) {
  const keys = values.map((value, index) => {
    const key = `${paramPrefix}${index}`
    params[key] = value
    return `:${key}`
  })

  conditions.push(`${column} IN (${keys.join(', ')})`)
}

function getRoomListOptions(req) {
  const page = Math.max(1, parseInteger(firstQueryValue(req.query.page), 1) || 1)
  const perPage = Math.min(60, Math.max(1, parseInteger(firstQueryValue(req.query.per_page), 24) || 24))
  const search = cleanString(firstQueryValue(req.query.q || req.query.search), 80)
  const status = cleanString(firstQueryValue(req.query.status), 20) || 'active'
  const type = cleanString(firstQueryValue(req.query.type || req.query.room_type), 30) || 'all'
  const privacy = cleanString(firstQueryValue(req.query.privacy || req.query.privacy_type), 30) || 'all'
  const sort = cleanString(firstQueryValue(req.query.sort), 30) || 'newest'
  const feed = cleanString(firstQueryValue(req.query.feed), 30)
  const region = cleanString(firstQueryValue(req.query.region), 120)

  if (status !== 'all' && !validRoomStatuses.has(status)) {
    return { error: 'Invalid room status filter.' }
  }

  if (!roomTypeGroups[type] && type !== 'all' && !validRoomTypes.has(type)) {
    return { error: 'Invalid room type filter.' }
  }

  if (privacy !== 'all' && !validPrivacyTypes.has(privacy)) {
    return { error: 'Invalid privacy filter.' }
  }

  if (!sortOptions[sort]) {
    return { error: 'Invalid room sort option.' }
  }

  if (feed && !validRoomFeeds.has(feed)) {
    return { error: 'Invalid room feed filter.' }
  }

  return { page, perPage, search, status, type, privacy, sort, feed, region }
}

function buildRoomListWhere(options, tenantId, userId, user) {
  const roles = Array.isArray(user?.roles) ? user.roles : []
  const isPlatformAdmin = roles.includes('super_admin')
  const canAuditOwnTenant = roles.includes('client_admin')
  const conditions = []
  const params = { tenantId }

  if (!userId) {
    conditions.push("r.status = 'active'")
  } else if (options.status !== 'all') {
    conditions.push('r.status = :status')
    params.status = options.status
  }

  if (options.type !== 'all') {
    const roomTypes = roomTypeGroups[options.type] || [options.type]
    addInCondition(conditions, params, 'r.room_type', roomTypes, 'roomType')
  }

  if (options.privacy !== 'all') {
    conditions.push('r.privacy_type = :privacy')
    params.privacy = options.privacy
  }

  if (options.sort === 'newest') {
    conditions.push(`r.created_at >= DATE_SUB(NOW(), INTERVAL ${newestRoomWindowDays} DAY)`)
  } else if (options.sort === 'oldest') {
    conditions.push(`r.created_at < DATE_SUB(NOW(), INTERVAL ${newestRoomWindowDays} DAY)`)
  }

  if (!userId) {
    conditions.push("r.privacy_type IN ('public', 'password')")
  } else if (isPlatformAdmin) {
    // Platform admins can audit every room.
  } else if (options.privacy === 'private') {
    params.viewerUserId = userId
    conditions.push(`
      (
        r.owner_id = :viewerUserId
        ${canAuditOwnTenant ? 'OR r.tenant_id = :tenantId' : ''}
        OR EXISTS (
          SELECT 1
          FROM room_roles viewer_roles
          WHERE viewer_roles.room_id = r.id
          AND viewer_roles.user_id = :viewerUserId
        )
      )
    `)
  } else {
    params.viewerUserId = userId
    conditions.push(`
      (
        r.privacy_type <> 'private'
        OR r.owner_id = :viewerUserId
        ${canAuditOwnTenant ? 'OR r.tenant_id = :tenantId' : ''}
        OR EXISTS (
          SELECT 1
          FROM room_roles viewer_roles
          WHERE viewer_roles.room_id = r.id
          AND viewer_roles.user_id = :viewerUserId
        )
      )
    `)
  }

  if (options.search) {
    conditions.push(`
      (
        r.name LIKE :search
        OR r.description LIKE :search
        OR CAST(r.tags_json AS CHAR) LIKE :search
        OR CAST(r.id AS CHAR) LIKE :search
        OR EXISTS (
          SELECT 1
          FROM tenants search_tenant
          WHERE search_tenant.id = r.tenant_id
          AND search_tenant.name LIKE :search
        )
      )
    `)
    params.search = `%${options.search}%`
  }

  if (options.feed === 'following') {
    if (!userId) {
      conditions.push('1 = 0')
    } else {
      params.feedUserId = userId
      conditions.push(`
        (
          r.owner_id = :feedUserId
          OR EXISTS (
            SELECT 1
            FROM user_follows feed_follows
            WHERE feed_follows.tenant_id = r.tenant_id
            AND feed_follows.follower_id = :feedUserId
            AND feed_follows.followed_user_id = r.owner_id
          )
        )
      `)
    }
  }

  if (options.feed === 'party') {
    addInCondition(conditions, params, 'r.room_type', ['group_audio', 'group_video', 'audio', 'youtube_audio'], 'partyRoomType')
  }

  if (options.feed === 'pk') {
    conditions.push("r.room_type = 'pk_live'")
  }

  if (options.feed === 'live') {
    addInCondition(conditions, params, 'r.room_type', ['solo_live', 'pk_live', 'video', 'group_video'], 'liveRoomType')
  }

  if (options.feed === 'nearby') {
    if (!options.region) {
      conditions.push('1 = 0')
    } else {
      params.feedRegion = options.region.toLowerCase()
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM users nearby_owner
          WHERE nearby_owner.id = r.owner_id
          AND LOWER(nearby_owner.current_residence) = :feedRegion
        )
      `)
    }
  }

  return { whereSql: conditions.length ? conditions.join(' AND ') : '1 = 1', params }
}

function canSeePrivateRoom(user, room) {
  if (!user || !room) return false
  const roles = Array.isArray(user?.roles) ? user.roles : []
  if (roles.includes('super_admin')) return true
  if (roles.includes('client_admin') && Number(room.tenant_id) === Number(user.tenant_id)) return true
  return false
}

function validateRoomPayload(payload) {
  const errors = {}
  const name = cleanString(payload.name, 150)
  const description = cleanString(payload.description, 700)
  const profileImage = cleanString(payload.profile_image, 255)
  const theme = cleanString(payload.theme, 100)
  const tags = parseRoomTags(payload.tags ?? payload.room_tags ?? payload.tags_json)
  const roomType = cleanString(payload.room_type, 30) || 'video'
  const privacyType = cleanString(payload.privacy_type, 30) || 'public'
  const password = cleanString(payload.password, 100)
  const defaultMicCount = isOneToOneRoom(roomType) ? 2 : 8
  const maxMicCount = parseInteger(payload.max_mic_count, defaultMicCount)
  const maxAllowedSeats = isOneToOneRoom(roomType) ? 2 : MAX_ROOM_SEATS

  if (!name) errors.name = 'Room name is required.'
  if (name && name.length < 3) errors.name = 'Room name must be at least 3 characters.'
  if (!validRoomTypes.has(roomType)) errors.room_type = 'Invalid room type.'
  if (!validPrivacyTypes.has(privacyType)) errors.privacy_type = 'Invalid privacy type.'
  if (maxMicCount === null || maxMicCount < 1 || maxMicCount > maxAllowedSeats) {
    errors.max_mic_count = isOneToOneRoom(roomType)
      ? 'One-to-one rooms support exactly 1 or 2 seats.'
      : `Max mic count must be between 1 and ${MAX_ROOM_SEATS}.`
  }
  if (privacyType === 'password' && password.length < 4) {
    errors.password = 'Password-protected rooms need a password of at least 4 characters.'
  }

  return {
    errors,
    data: {
      name,
      description: description || null,
      profile_image: profileImage || null,
      room_type: roomType,
      privacy_type: privacyType,
      password: privacyType === 'password' ? password : '',
      max_mic_count: maxMicCount || defaultMicCount,
      stage_requests_enabled: parseBoolean(payload.stage_requests_enabled ?? payload.audience_requests_enabled, true),
      theme: theme || null,
      tags,
      chat_enabled: parseBoolean(payload.chat_enabled, true),
      gift_enabled: parseBoolean(payload.gift_enabled, false),
      screen_share_enabled: parseBoolean(payload.screen_share_enabled, false),
      ai_security_enabled: parseBoolean(payload.ai_security_enabled, false),
    },
  }
}

async function getRoomRole(connection, roomId, userId) {
  const [rows] = await connection.execute(
    `
    SELECT role
    FROM room_roles
    WHERE room_id = ?
    AND user_id = ?
    AND role IN ('admin', 'moderator')
    ORDER BY FIELD(role, 'admin', 'moderator')
    LIMIT 1
    `,
    [roomId, userId]
  )

  if (!rows.length) return 'end_user'
  return normalizeRoomRole(rows[0].role)
}

async function stageSeatCount(connection, sessionId, excludeUserId = null) {
  const params = [sessionId]
  let excludeSql = ''

  if (excludeUserId) {
    excludeSql = 'AND user_id <> ?'
    params.push(excludeUserId)
  }

  const [rows] = await connection.execute(
    `
    SELECT COUNT(*) AS active_count
    FROM rtc_session_participants
    WHERE session_id = ?
    AND left_at IS NULL
    AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
    AND (
      role_in_room IN ('owner', 'admin', 'moderator', 'speaker')
      OR mic_enabled = 1
      OR camera_enabled = 1
      OR screen_shared = 1
    )
    ${excludeSql}
    `,
    params
  )

  return Number(rows[0]?.active_count || 0)
}

async function canAccessPrivateRoom(roomId, userId, ownerId) {
  if (ownerId === userId) return true

  const rows = await query(
    `
    SELECT id
    FROM room_roles
    WHERE room_id = :roomId
    AND user_id = :userId
    AND role <> 'owner'
    LIMIT 1
    `,
    { roomId, userId }
  )

  return rows.length > 0
}

function tokenGrantsRoomJoin(user, roomId) {
  const claims = user?.token_claims || {}
  if (claims.token_use !== 'rtc_room') return false
  if (Number(claims.room_id) !== Number(roomId)) return false
  const permissions = Array.isArray(claims.permissions) ? claims.permissions : []
  return permissions.includes('room:join') || permissions.includes('join')
}

function normalizeModerationAction(action) {
  const normalized = cleanString(action, 40)
  return normalized === 'mute' ? 'mute_mic' : normalized
}

function parseBanOptions(payload = {}) {
  const durationMinutes = parseInteger(payload.duration_minutes, null)
  const requestedBanType = cleanString(payload.ban_type, 20)
  const banType = requestedBanType || (durationMinutes ? 'temporary' : 'permanent')
  const reason = cleanString(payload.reason, 500)

  if (!validBanTypes.has(banType)) {
    throw createHttpError(422, 'Invalid ban type.')
  }

  if (banType === 'temporary' && (!durationMinutes || durationMinutes < 1 || durationMinutes > 43200)) {
    throw createHttpError(422, 'Temporary bans must be between 1 minute and 30 days.')
  }

  return {
    banType,
    durationMinutes: banType === 'temporary' ? durationMinutes : null,
    reason: reason || null,
  }
}

async function getRoomControls(connection, room, userId, options = {}) {
  await ensureRoomStageRequestSchema()
  const isOwner = Number(room.owner_id) === Number(userId)
  const role = options.roleOverride || (isOwner ? 'owner' : await getRoomRole(connection, room.id, userId))
  const [participants] = await connection.execute(
    `
    SELECT
      p.id, p.session_id, p.room_id, p.user_id, p.peer_uid, p.role_in_room,
      CASE
        WHEN p.user_id = ? THEN 'owner'
        ELSE COALESCE(
          current_roles.effective_role,
          CASE WHEN p.role_in_room IN ('speaker', 'audience') THEN p.role_in_room ELSE 'end_user' END
        )
      END AS effective_role_in_room,
      p.joined_at, p.left_at, p.duration_seconds, p.mic_enabled, p.camera_enabled,
      p.screen_shared, p.connection_status, p.created_at, p.updated_at,
      u.name AS user_name,
      u.email AS user_email,
      u.avatar_url AS user_avatar_url,
      u.gender AS user_gender
    FROM rtc_session_participants p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN (
      SELECT
        room_id,
        user_id,
        CASE
          WHEN SUM(role = 'admin') > 0 THEN 'admin'
          WHEN SUM(role = 'moderator') > 0 THEN 'moderator'
          ELSE NULL
        END AS effective_role
      FROM room_roles
      WHERE room_id = ?
      GROUP BY room_id, user_id
    ) current_roles ON current_roles.room_id = p.room_id AND current_roles.user_id = p.user_id
    WHERE p.room_id = ?
    AND p.left_at IS NULL
    ORDER BY FIELD(effective_role_in_room, 'owner', 'admin', 'moderator', 'speaker', 'audience', 'end_user'), p.joined_at ASC
    `,
    [room.owner_id, room.id, room.id]
  )
  const [roles] = await connection.execute(
    `
    SELECT
      rr.id, rr.room_id, rr.user_id, rr.role, rr.created_at,
      u.name AS user_name,
      u.email AS user_email,
      u.avatar_url AS user_avatar_url
    FROM room_roles rr
    LEFT JOIN users u ON u.id = rr.user_id
    WHERE rr.room_id = ?
    AND (rr.role <> 'owner' OR rr.user_id = ?)
    ORDER BY FIELD(rr.role, 'owner', 'admin', 'moderator'), rr.created_at ASC
    `,
    [room.id, room.owner_id]
  )
  const [assignableUsers] = await connection.execute(
    `
    SELECT id, name, email, avatar_url
    FROM users
    WHERE tenant_id = ?
    AND status = 'active'
    AND id <> ?
    ORDER BY name ASC, email ASC, id ASC
    LIMIT 500
    `,
    [room.tenant_id, room.owner_id]
  )
  await expireStageRequests(connection, room.id)
  const capabilities = roomRoleCapabilities(role)
  const stageRequests = capabilities.can_approve_stage
    ? await fetchStageRequests(connection, room.id, { statuses: ['pending'], limit: 50 })
    : []
  const activeBans = capabilities.can_manage
    ? await fetchActiveRoomBans(connection, room.id)
    : []

  return {
    role,
    capabilities,
    can_manage: capabilities.can_manage,
    can_publish_media: capabilities.can_publish_media,
    can_update_settings: capabilities.can_update_settings,
    can_assign_roles: capabilities.can_assign_roles,
    can_approve_stage: capabilities.can_approve_stage,
    room: serializeRoom(room),
    roles: roles.map((roomRole) => ({
      id: roomRole.id,
      room_id: roomRole.room_id,
      user_id: roomRole.user_id,
      role: roomRole.role,
      user_name: roomRole.user_name || `User #${roomRole.user_id}`,
      user_email: roomRole.user_email,
      user_avatar_url: roomRole.user_avatar_url,
      created_at: roomRole.created_at,
    })),
    assignable_users: assignableUsers.map((assignableUser) => ({
      id: assignableUser.id,
      name: assignableUser.name || `User #${assignableUser.id}`,
      email: assignableUser.email,
      avatar_url: assignableUser.avatar_url,
    })),
    stage_requests: stageRequests,
    active_bans: activeBans,
    participants: participants.map((participant) => {
      const effectiveRole = normalizeRoomRole(participant.effective_role_in_room || participant.role_in_room || 'end_user')
      const participantCapabilities = roomRoleCapabilities(effectiveRole)

      return {
        id: participant.id,
        session_id: participant.session_id,
        room_id: participant.room_id,
        user_id: participant.user_id,
        peer_uid: participant.peer_uid,
        role_in_room: effectiveRole,
        session_role_in_room: participant.role_in_room,
        capabilities: participantCapabilities,
        stage_access: {
          role: effectiveRole,
          can_publish: participantCapabilities.can_publish_media,
          requires_approval: !participantCapabilities.can_publish_media,
          requests_enabled: room.stage_requests_enabled === undefined || room.stage_requests_enabled === null
            ? true
            : Boolean(Number(room.stage_requests_enabled)),
          status: participantCapabilities.can_publish_media ? 'approved' : 'audience',
        },
        joined_at: participant.joined_at,
        left_at: participant.left_at,
        duration_seconds: Number(participant.duration_seconds || 0),
        mic_enabled: Boolean(Number(participant.mic_enabled)),
        camera_enabled: Boolean(Number(participant.camera_enabled)),
        screen_shared: Boolean(Number(participant.screen_shared)),
        connection_status: participant.connection_status,
        can_moderate: Number(participant.user_id) !== Number(userId) && canModerateTarget(role, effectiveRole),
        user_name: participant.user_name || `User #${participant.user_id}`,
        user_email: participant.user_email,
        user_avatar_url: participant.user_avatar_url,
        user_gender: participant.user_gender,
        created_at: participant.created_at,
        updated_at: participant.updated_at,
      }
    }),
  }
}

async function isUserBanned(roomId, userId) {
  await expireRoomBansByRoom(roomId)

  const rows = await query(
    `
    SELECT id
    FROM room_bans
    WHERE room_id = :roomId
    AND banned_user_id = :userId
    AND status = 'active'
    AND (
      ban_type = 'permanent'
      OR ends_at IS NULL
      OR ends_at > NOW()
    )
    LIMIT 1
    `,
    { roomId, userId }
  )

  return rows.length > 0
}

async function expireRoomBansByRoom(roomId, connection = null) {
  const runner = connection || { execute: (sql, params) => query(sql, params) }
  await runner.execute(
    `
    UPDATE room_bans
    SET status = 'expired',
        updated_at = NOW()
    WHERE room_id = ?
    AND status = 'active'
    AND ban_type = 'temporary'
    AND ends_at IS NOT NULL
    AND ends_at <= NOW()
    `,
    [roomId]
  )
}

function mapRoomBan(row) {
  if (!row) return null

  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    room_id: Number(row.room_id),
    banned_user_id: Number(row.banned_user_id),
    banned_by: Number(row.banned_by),
    ban_type: row.ban_type,
    reason: row.reason || '',
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user_name: row.user_name || `User #${row.banned_user_id}`,
    user_email: row.user_email || '',
    user_avatar_url: row.user_avatar_url || '',
    user_gender: row.user_gender || '',
    banned_by_name: row.banned_by_name || `User #${row.banned_by}`,
  }
}

async function fetchActiveRoomBans(connection, roomId) {
  await expireRoomBansByRoom(roomId, connection)

  const [bans] = await connection.execute(
    `
    SELECT
      rb.*,
      banned_user.name AS user_name,
      banned_user.email AS user_email,
      banned_user.avatar_url AS user_avatar_url,
      banned_user.gender AS user_gender,
      moderator.name AS banned_by_name
    FROM room_bans rb
    LEFT JOIN users banned_user ON banned_user.id = rb.banned_user_id
    LEFT JOIN users moderator ON moderator.id = rb.banned_by
    WHERE rb.room_id = ?
    AND rb.status = 'active'
    AND (
      rb.ban_type = 'permanent'
      OR rb.ends_at IS NULL
      OR rb.ends_at > NOW()
    )
    ORDER BY rb.created_at DESC, rb.id DESC
    LIMIT 100
    `,
    [roomId]
  )

  return bans.map(mapRoomBan).filter(Boolean)
}

router.get('/', optionalAuthMiddleware, async (req, res, next) => {
  try {
    await ensureRoomCreationSchema()
    const options = getRoomListOptions(req)
    if (options.error) return res.status(422).json({ message: options.error })
    const tenantId = req.user?.tenant_id || 1
    const includeViewerFields = Boolean(req.user?.id)

    if (includeViewerFields) await ensureRoomFollowSchema()

    const { whereSql, params } = buildRoomListWhere(options, tenantId, req.user?.id || null, req.user)
    if (includeViewerFields) params.feedViewerUserId = req.user.id
    const offset = (options.page - 1) * options.perPage
    const limitSql = Number(options.perPage)
    const offsetSql = Number(offset)

    const rooms = await query(
      `
      ${roomSelectSql({ includeViewerFields })}
      WHERE ${whereSql}
      ORDER BY ${sortOptions[options.sort]}
      LIMIT ${limitSql}
      OFFSET ${offsetSql}
      `,
      params
    )

    const countRows = await query(
      `
      SELECT COUNT(*) AS total
      FROM rooms r
      WHERE ${whereSql}
      `,
      params
    )

    const total = Number(countRows[0]?.total || 0)
    const totalPages = Math.max(1, Math.ceil(total / options.perPage))

    return res.json({
      rooms: {
        data: rooms.map(serializeRoom),
        meta: {
          page: options.page,
          per_page: options.perPage,
          total,
          total_pages: totalPages,
        },
        filters: {
          search: options.search,
          status: options.status,
          type: options.type,
          privacy: options.privacy,
          sort: options.sort,
          feed: options.feed,
          region: options.region,
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/', authMiddleware, async (req, res, next) => {
  try {
    await ensureRoomFeatureSchema()
    await ensureRoomCreationSchema()
    const { errors, data } = validateRoomPayload(req.body || {})

    if (Object.keys(errors).length) {
      return res.status(422).json({
        message: 'Please fix the room details and try again.',
        errors,
      })
    }

    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : null

    const roomId = await transaction(async (connection) => {
      const [insertResult] = await connection.execute(
        `
        INSERT INTO rooms (
          tenant_id, owner_id, name, description, profile_image, room_type,
          privacy_type, password_hash, max_mic_count, stage_requests_enabled, theme, tags_json,
          chat_enabled, gift_enabled, screen_share_enabled, ai_security_enabled,
          status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
        `,
        [
          req.user.tenant_id,
          req.user.id,
          data.name,
          data.description,
          data.profile_image,
          data.room_type,
          data.privacy_type,
          passwordHash,
          data.max_mic_count,
          data.stage_requests_enabled ? 1 : 0,
          data.theme,
          data.tags.length ? JSON.stringify(data.tags) : null,
          data.chat_enabled ? 1 : 0,
          data.gift_enabled ? 1 : 0,
          data.screen_share_enabled ? 1 : 0,
          data.ai_security_enabled ? 1 : 0,
        ]
      )

      await connection.execute(
        `
        DELETE FROM room_roles
        WHERE room_id = ?
        AND role = 'owner'
        `,
        [insertResult.insertId]
      )

      await connection.execute(
        `
        INSERT INTO room_roles (room_id, user_id, role, created_at)
        VALUES (?, ?, 'owner', NOW())
        `,
        [insertResult.insertId, req.user.id]
      )

      return insertResult.insertId
    })

    const room = await findPublicRoomById(roomId)

    return res.status(201).json({ message: 'Room created successfully', room })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const result = await transaction(async (connection) => {
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        AND tenant_id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [roomId, req.user.tenant_id]
      )

      if (!rooms.length) throw createHttpError(404, 'Room not found.')

      const room = rooms[0]
      if (Number(room.owner_id) !== Number(req.user.id)) {
        throw createHttpError(403, 'Only the room owner can delete this room.')
      }

      await connection.execute(
        `
        DELETE FROM rooms
        WHERE id = ?
        AND tenant_id = ?
        AND owner_id = ?
        `,
        [room.id, room.tenant_id, req.user.id]
      )

      const [remainingRows] = await connection.execute(
        `
        SELECT COUNT(*) AS count
        FROM rooms
        `
      )
      const remainingRooms = Number(remainingRows[0]?.count || 0)
      if (remainingRooms === 0) await connection.execute('ALTER TABLE rooms AUTO_INCREMENT = 1')

      return {
        room_id: room.id,
        deleted: true,
        remaining_rooms: remainingRooms,
      }
    })

    return res.json({
      message: result.remaining_rooms === 0
        ? 'Room deleted. Room IDs will restart from 1.'
        : 'Room deleted from database.',
      ...result,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const room = await findPublicRoomById(roomId)
    if (!room) return res.status(404).json({ message: 'Room not found.' })
    if (!req.user && room.status !== 'active') return res.status(404).json({ message: 'Room not found.' })
    if (room.privacy_type === 'private' && !req.user) {
      return res.status(404).json({ message: 'Room not found.' })
    }
    if (
      room.privacy_type === 'private'
      && !canSeePrivateRoom(req.user, room)
      && !(await canAccessPrivateRoom(room.id, req.user.id, room.owner_id))
    ) {
      return res.status(403).json({ message: 'This room is private.' })
    }
    return res.json({ room })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/controls', authMiddleware, async (req, res, next) => {
  try {
    await ensureRoomCreationSchema()
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const result = await transaction(async (connection) => {
      const isPlatformAdmin = userHasRole(req.user, 'super_admin')
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        ${isPlatformAdmin ? '' : 'AND tenant_id = ?'}
        LIMIT 1
        `,
        isPlatformAdmin ? [roomId] : [roomId, req.user.tenant_id]
      )

      if (!rooms.length) throw createHttpError(404, 'Room not found.')
      const actorRole = isPlatformAdmin
        ? 'owner'
        : Number(rooms[0].owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, rooms[0].id, req.user.id)
      if (!canManageRoom(actorRole)) throw createHttpError(403, 'Only room managers can view room controls.')

      return getRoomControls(connection, rooms[0], req.user.id, { roleOverride: actorRole })
    })

    return res.json({ controls: result })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/controls', authMiddleware, async (req, res, next) => {
  try {
    await ensureRoomCreationSchema()
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const result = await transaction(async (connection) => {
      const isPlatformAdmin = userHasRole(req.user, 'super_admin')
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        ${isPlatformAdmin ? '' : 'AND tenant_id = ?'}
        LIMIT 1
        `,
        isPlatformAdmin ? [roomId] : [roomId, req.user.tenant_id]
      )

      if (!rooms.length) throw createHttpError(404, 'Room not found.')

      const room = rooms[0]
      const actorRole = isPlatformAdmin
        ? 'owner'
        : Number(room.owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, room.id, req.user.id)

      if (!canUpdateRoomSettings(actorRole)) throw createHttpError(403, 'Only the room owner or room admin can update room controls.')

      const updates = []
      const values = []
      const booleanFields = ['chat_enabled', 'gift_enabled', 'screen_share_enabled', 'ai_security_enabled', 'stage_requests_enabled']

      for (const field of booleanFields) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
          const nextValue = parseBoolean(req.body[field], Boolean(Number(room[field]))) ? 1 : 0
          updates.push(`${field} = ?`)
          values.push(nextValue)
        }
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'theme')) {
        const theme = cleanString(req.body.theme, 100)
        if (theme && !validControlThemes.has(theme)) throw createHttpError(422, 'Invalid room theme.')
        updates.push('theme = ?')
        values.push(theme || null)
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'privacy_type')) {
        if (actorRole !== 'owner') throw createHttpError(403, 'Only the room owner can change room privacy.')
        const privacyType = cleanString(req.body.privacy_type, 30)
        const password = cleanString(req.body?.password, 100)

        if (!validPrivacyTypes.has(privacyType)) throw createHttpError(422, 'Invalid privacy type.')

        updates.push('privacy_type = ?')
        values.push(privacyType)

        if (privacyType === 'password') {
          if (password) {
            if (password.length < 4) throw createHttpError(422, 'Room password must be at least 4 characters.')
            updates.push('password_hash = ?')
            values.push(await bcrypt.hash(password, 10))
          } else if (!room.password_hash || room.privacy_type !== 'password') {
            throw createHttpError(422, 'A password is required when switching to password privacy.')
          }
        } else {
          updates.push('password_hash = NULL')
        }
      } else if (Object.prototype.hasOwnProperty.call(req.body || {}, 'password')) {
        if (actorRole !== 'owner') throw createHttpError(403, 'Only the room owner can change room password.')
        const password = cleanString(req.body.password, 100)
        if (room.privacy_type !== 'password') throw createHttpError(422, 'Switch room privacy to password before setting a password.')
        if (password.length < 4) throw createHttpError(422, 'Room password must be at least 4 characters.')
        updates.push('password_hash = ?')
        values.push(await bcrypt.hash(password, 10))
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'max_mic_count')) {
        const maxMicCount = parseInteger(req.body.max_mic_count, null)
        if (!maxMicCount || maxMicCount < 1 || maxMicCount > MAX_ROOM_SEATS) {
          throw createHttpError(422, `Max mic count must be between 1 and ${MAX_ROOM_SEATS}.`)
        }
        updates.push('max_mic_count = ?')
        values.push(maxMicCount)
      }

      if (updates.length) {
        await connection.execute(
          `
          UPDATE rooms
          SET ${updates.join(', ')},
              updated_at = NOW()
          WHERE id = ?
          ${isPlatformAdmin ? '' : 'AND tenant_id = ?'}
          `,
          isPlatformAdmin ? [...values, room.id] : [...values, room.id, req.user.tenant_id]
        )
      }

      const [updatedRooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        ${isPlatformAdmin ? '' : 'AND tenant_id = ?'}
        LIMIT 1
        `,
        isPlatformAdmin ? [room.id] : [room.id, req.user.tenant_id]
      )

      return getRoomControls(connection, updatedRooms[0], req.user.id, { roleOverride: actorRole })
    })

    try {
      await emitRoomRealtime(req, result.room, 'room-controls-updated', {
        controls: result,
        updatedByUserId: req.user.id,
      })
    } catch (broadcastError) {
      console.error('[rooms] controls realtime broadcast failed', broadcastError)
    }

    return res.json({
      message: 'Room controls updated.',
      controls: result,
    })
  } catch (error) {
    next(error)
  }
})

async function roomRoleLimit(connection, tenantId) {
  const [plans] = await connection.execute(
    `
    SELECT sp.max_room_admins
    FROM tenant_plan_assignments tpa
    INNER JOIN service_plans sp ON sp.id = tpa.plan_id
    WHERE tpa.tenant_id = ?
    AND tpa.status = 'active'
    ORDER BY tpa.id DESC
    LIMIT 1
    `,
    [tenantId]
  )

  return Number(plans[0]?.max_room_admins || 0)
}

async function updateRoomRoleEndpoint(req, res, next, removeRole = false) {
  try {
    const roomId = parseInteger(req.params.id, null)
    const targetUserId = parseInteger(req.params.userId ?? req.body?.user_id ?? req.body?.userId, null)
    const role = cleanString(req.body?.role, 30).toLowerCase()

    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })
    if (!targetUserId || targetUserId < 1) return res.status(422).json({ message: 'Invalid user ID.' })
    if (!removeRole && !ASSIGNABLE_ROOM_ROLES.has(role)) return res.status(422).json({ message: 'Assign admin or moderator role.' })

    const result = await transaction(async (connection) => {
      const isPlatformAdmin = userHasRole(req.user, 'super_admin')
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        ${isPlatformAdmin ? '' : 'AND tenant_id = ?'}
        LIMIT 1
        FOR UPDATE
        `,
        isPlatformAdmin ? [roomId] : [roomId, req.user.tenant_id]
      )

      if (!rooms.length) throw createHttpError(404, 'Room not found.')
      const room = rooms[0]
      const actorRole = isPlatformAdmin
        ? 'owner'
        : Number(room.owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, room.id, req.user.id)

      if (!canAssignRoomRoles(actorRole)) {
        throw createHttpError(403, 'Only the room owner can assign room admins or moderators.')
      }
      if (Number(targetUserId) === Number(room.owner_id)) {
        throw createHttpError(422, 'The owner already has full room permissions.')
      }

      const [users] = await connection.execute(
        `
        SELECT id, tenant_id, name, email
        FROM users
        WHERE id = ?
        AND tenant_id = ?
        LIMIT 1
        `,
        [targetUserId, room.tenant_id]
      )
      if (!users.length) throw createHttpError(404, 'User was not found in this tenant.')

      await connection.execute(
        `
        DELETE FROM room_roles
        WHERE room_id = ?
        AND user_id = ?
        AND role IN ('admin', 'moderator')
        `,
        [room.id, targetUserId]
      )

      if (!removeRole) {
        const limit = await roomRoleLimit(connection, room.tenant_id)
        if (limit > 0) {
          const [roleCounts] = await connection.execute(
            `
            SELECT COUNT(DISTINCT user_id) AS count
            FROM room_roles
            WHERE room_id = ?
            AND role IN ('admin', 'moderator')
            `,
            [room.id]
          )
          if (Number(roleCounts[0]?.count || 0) >= limit) {
            throw createHttpError(422, `This package allows ${limit} room admin/moderator seat${limit === 1 ? '' : 's'}.`)
          }
        }

        await connection.execute(
          `
          INSERT INTO room_roles (room_id, user_id, role, created_at)
          VALUES (?, ?, ?, NOW())
          `,
          [room.id, targetUserId, role]
        )
      }

      return {
        room,
        target_user: users[0],
        assigned_role: removeRole ? null : role,
        controls: await getRoomControls(connection, room, req.user.id, { roleOverride: actorRole }),
      }
    })

    try {
      await emitRoomRealtime(req, result.room, 'room-roles-updated', {
        targetUserId,
        role: result.assigned_role,
        controls: result.controls,
        updatedByUserId: req.user.id,
      })
    } catch (broadcastError) {
      console.error('[rooms] role realtime broadcast failed', broadcastError)
    }

    return res.json({
      message: removeRole ? 'Room role removed.' : `Room ${result.assigned_role} role assigned.`,
      target_user: result.target_user,
      role: result.assigned_role,
      controls: result.controls,
    })
  } catch (error) {
    next(error)
  }
}

router.post('/:id/roles', authMiddleware, (req, res, next) => updateRoomRoleEndpoint(req, res, next, false))
router.put('/:id/roles/:userId', authMiddleware, (req, res, next) => updateRoomRoleEndpoint(req, res, next, false))
router.delete('/:id/roles/:userId', authMiddleware, (req, res, next) => updateRoomRoleEndpoint(req, res, next, true))

router.get('/:id/stage-requests', authMiddleware, async (req, res, next) => {
  try {
    await ensureRoomStageRequestSchema()
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const requestedStatus = cleanString(firstQueryValue(req.query.status), 30) || 'pending'
    const statuses = requestedStatus === 'all'
      ? Array.from(stageRequestStatuses)
      : [normalizeStageRequestStatus(requestedStatus)]

    const result = await transaction(async (connection) => {
      const isPlatformAdmin = userHasRole(req.user, 'super_admin')
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        ${isPlatformAdmin ? '' : 'AND tenant_id = ?'}
        LIMIT 1
        `,
        isPlatformAdmin ? [roomId] : [roomId, req.user.tenant_id]
      )

      if (!rooms.length) throw createHttpError(404, 'Room not found.')

      const room = rooms[0]
      const actorRole = isPlatformAdmin
        ? 'owner'
        : Number(room.owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, room.id, req.user.id)
      await expireStageRequests(connection, room.id)

      const canViewRoomQueue = actorRole === 'owner'
      const requests = await fetchStageRequests(connection, room.id, {
        statuses,
        userId: canViewRoomQueue ? null : req.user.id,
        limit: canViewRoomQueue ? 50 : 10,
      })

      return { room: serializeRoom(room), role: actorRole, requests }
    })

    return res.json(result)
  } catch (error) {
    next(error)
  }
})

router.post('/:id/stage-requests', authMiddleware, async (req, res, next) => {
  try {
    await ensureRoomStageRequestSchema()
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const requestedRtcMode = cleanString(req.body?.requested_rtc_mode ?? req.body?.requestedRtcMode, 20) === 'audio' ? 'audio' : 'video'
    const requestedMic = parseBoolean(req.body?.requested_mic ?? req.body?.requestedMic, true)
    const requestedCamera = requestedRtcMode === 'video' && parseBoolean(req.body?.requested_camera ?? req.body?.requestedCamera, true)

    const result = await transaction(async (connection) => {
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        AND status = 'active'
        LIMIT 1
        `,
        [roomId]
      )

      if (!rooms.length) throw createHttpError(404, 'Room not found.')

      const room = rooms[0]
      if (room.stage_requests_enabled !== undefined && room.stage_requests_enabled !== null && !Boolean(Number(room.stage_requests_enabled))) {
        throw createHttpError(403, 'Stage requests are closed for this room.')
      }

      if (Number(room.tenant_id) !== Number(req.user.tenant_id) && !userHasRole(req.user, 'super_admin')) {
        throw createHttpError(403, 'You can only request stage access in your tenant.')
      }

      await expireStageRequests(connection, room.id)

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
        [room.id, req.user.id]
      )

      if (!participants.length) {
        throw createHttpError(409, 'Enter the room before requesting to join the stage.')
      }

      const participant = participants[0]
      const roomRole = Number(room.owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, room.id, req.user.id)
      const effectiveRole = canPublishRoomMedia(roomRole)
        ? roomRole
        : participant.role_in_room || 'audience'

      if (canPublishRoomMedia(effectiveRole)) {
        throw createHttpError(422, 'You already have permission to join the stage.')
      }

      await connection.execute(
        `
        UPDATE room_stage_requests
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE room_id = ?
        AND requester_user_id = ?
        AND status = 'pending'
        `,
        [room.id, req.user.id]
      )

      const [insertResult] = await connection.execute(
        `
        INSERT INTO room_stage_requests (
          tenant_id, room_id, session_id, participant_id, requester_user_id,
          requested_mic, requested_camera, requested_rtc_mode, status,
          expires_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 10 MINUTE), NOW(), NOW())
        `,
        [
          room.tenant_id,
          room.id,
          participant.session_id,
          participant.id,
          req.user.id,
          requestedMic ? 1 : 0,
          requestedCamera ? 1 : 0,
          requestedRtcMode,
        ]
      )

      return {
        room: serializeRoom(room),
        request: await fetchStageRequestById(connection, room.id, insertResult.insertId),
      }
    })

    try {
      await emitRoomRealtime(req, result.room, 'stage-join-request-received', {
        request: result.request,
      })
    } catch (broadcastError) {
      console.error('[rooms] stage request realtime broadcast failed', broadcastError)
    }

    return res.status(201).json({
      message: 'Request sent to the room owner.',
      request: result.request,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/stage-requests/:requestId/cancel', authMiddleware, async (req, res, next) => {
  try {
    await ensureRoomStageRequestSchema()
    const roomId = parseInteger(req.params.id, null)
    const requestId = parseInteger(req.params.requestId, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })
    if (!requestId || requestId < 1) return res.status(422).json({ message: 'Invalid stage request ID.' })

    const result = await transaction(async (connection) => {
      const [requests] = await connection.execute(
        `
        SELECT sr.*, r.tenant_id, r.owner_id
        FROM room_stage_requests sr
        INNER JOIN rooms r ON r.id = sr.room_id
        WHERE sr.id = ?
        AND sr.room_id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [requestId, roomId]
      )

      if (!requests.length) throw createHttpError(404, 'Stage request not found.')

      const request = requests[0]
      if (Number(request.requester_user_id) !== Number(req.user.id)) {
        throw createHttpError(403, 'Only the requester can cancel this stage request.')
      }

      if (request.status === 'pending') {
        await connection.execute(
          `
          UPDATE room_stage_requests
          SET status = 'cancelled',
              updated_at = NOW()
          WHERE id = ?
          `,
          [request.id]
        )
      }

      return {
        room: await findPublicRoomById(roomId),
        request: await fetchStageRequestById(connection, roomId, requestId),
      }
    })

    try {
      await emitRoomRealtime(req, result.room, 'stage-join-request-cancelled', {
        requestId,
        request_id: requestId,
        userId: req.user.id,
        user_id: req.user.id,
        request: result.request,
      })
    } catch (broadcastError) {
      console.error('[rooms] stage request cancel realtime broadcast failed', broadcastError)
    }

    return res.json({
      message: 'Stage request cancelled.',
      request: result.request,
    })
  } catch (error) {
    next(error)
  }
})

async function stageRequestResponseEndpoint(req, res, next, action) {
  try {
    const roomId = parseInteger(req.params.id, null)
    const requestId = parseInteger(req.params.requestId, null)

    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })
    if (!requestId || requestId < 1) return res.status(422).json({ message: 'Invalid stage request ID.' })

    const result = await applyStagePermission({
      roomId,
      requestId,
      action,
      actor: req.user,
    })

    try {
      await emitRoomRealtime(req, result.room, 'stage-permission-updated', {
        targetUserId: result.target_user_id,
        target_user_id: result.target_user_id,
        requestId,
        request_id: requestId,
        request: result.request,
        action: result.action,
        approved: result.approved,
        participant: result.participant,
        ownerUserId: req.user.id,
        controls: result.controls,
      })
    } catch (broadcastError) {
      console.error('[rooms] stage request response realtime broadcast failed', broadcastError)
    }

    return res.json({
      message: result.approved ? 'Stage request approved.' : 'Request declined.',
      ...result,
    })
  } catch (error) {
    next(error)
  }
}

router.post('/:id/stage-requests/:requestId/approve', authMiddleware, (req, res, next) => stageRequestResponseEndpoint(req, res, next, 'approve'))
router.post('/:id/stage-requests/:requestId/reject', authMiddleware, (req, res, next) => stageRequestResponseEndpoint(req, res, next, 'reject'))

async function applyModerationAction({ roomId, targetUserId, action, actor, body = {} }) {
  const normalizedAction = normalizeModerationAction(action)

  if (!validModerationActions.has(normalizedAction)) {
    throw createHttpError(422, 'Invalid moderation action.')
  }

  return transaction(async (connection) => {
    const [rooms] = await connection.execute(
      `
      SELECT *
      FROM rooms
      WHERE id = ?
      LIMIT 1
      `,
      [roomId]
    )

    if (!rooms.length) throw createHttpError(404, 'Room not found.')

    const room = rooms[0]
    if (Number(room.tenant_id) !== Number(actor.tenant_id) && !userHasRole(actor, 'super_admin')) {
      throw createHttpError(403, 'You can only moderate rooms in your tenant.')
    }

    const [targetUsers] = await connection.execute(
      `
      SELECT id, name, email
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [targetUserId]
    )

    if (!targetUsers.length) throw createHttpError(404, 'Target user not found.')

    const targetUser = targetUsers[0]
    const actorRole = userHasRole(actor, 'super_admin')
      ? 'owner'
      : Number(room.owner_id) === Number(actor.id)
      ? 'owner'
      : await getRoomRole(connection, room.id, actor.id)
    const targetRole = await getRoomRole(connection, room.id, targetUserId)

    if (!canModerateTarget(actorRole, targetRole)) {
      throw createHttpError(403, 'You can only moderate participants below your room role.')
    }

    if (['kick', 'ban'].includes(normalizedAction) && targetUserId === actor.id) {
      throw createHttpError(422, 'Use Leave Room instead of moderating yourself.')
    }

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
      [room.id, targetUserId]
    )

    const participant = participants[0] || null

    if (normalizedAction !== 'ban' && !participant) {
      throw createHttpError(404, 'Participant is not currently in this room.')
    }

    let ban = null
    let eventType = 'mute_by_moderator'
    let eventSessionId = participant?.session_id || null
    let eventData = {
      rtc_provider: 'native_webrtc',
      moderation_action: normalizedAction,
      moderator_user_id: actor.id,
      target_user_id: targetUserId,
    }

    if (normalizedAction === 'mute_mic') {
      await connection.execute(
        `
        UPDATE rtc_session_participants
        SET mic_enabled = 0,
            updated_at = NOW()
        WHERE id = ?
        `,
        [participant.id]
      )
      eventType = 'mute_by_moderator'
      eventData = { ...eventData, mic_enabled: false }
    }

    if (normalizedAction === 'disable_camera') {
      await connection.execute(
        `
        UPDATE rtc_session_participants
        SET camera_enabled = 0,
            updated_at = NOW()
        WHERE id = ?
        `,
        [participant.id]
      )
      eventType = 'camera_off'
      eventData = { ...eventData, camera_enabled: false }
    }

    if (normalizedAction === 'kick') {
      const leaveResult = await closeParticipantSession(connection, room, participant, targetUserId)
      eventType = 'kick_by_moderator'
      eventData = {
        ...eventData,
        duration_seconds: leaveResult.durationSeconds,
        billable_minutes: leaveResult.billableMinutes,
        usage_log_id: leaveResult.usageLogId,
      }
    }

    if (normalizedAction === 'ban') {
      const banOptions = parseBanOptions(body)

      await connection.execute(
        `
        UPDATE room_bans
        SET status = 'revoked',
            updated_at = NOW()
        WHERE room_id = ?
        AND banned_user_id = ?
        AND status = 'active'
        `,
        [room.id, targetUserId]
      )

      let insertBan
      if (banOptions.banType === 'temporary') {
        ;[insertBan] = await connection.execute(
          `
          INSERT INTO room_bans (
            tenant_id, room_id, banned_user_id, banned_by, ban_type,
            reason, starts_at, ends_at, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, 'temporary', ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE), 'active', NOW(), NOW())
          `,
          [room.tenant_id, room.id, targetUserId, actor.id, banOptions.reason, banOptions.durationMinutes]
        )
      } else {
        ;[insertBan] = await connection.execute(
          `
          INSERT INTO room_bans (
            tenant_id, room_id, banned_user_id, banned_by, ban_type,
            reason, starts_at, ends_at, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, 'permanent', ?, NOW(), NULL, 'active', NOW(), NOW())
          `,
          [room.tenant_id, room.id, targetUserId, actor.id, banOptions.reason]
        )
      }

      const [banRows] = await connection.execute(
        `
        SELECT *
        FROM room_bans
        WHERE id = ?
        LIMIT 1
        `,
        [insertBan.insertId]
      )
      ban = banRows[0]

      if (participant) {
        const leaveResult = await closeParticipantSession(connection, room, participant, targetUserId)
        eventSessionId = participant.session_id
        eventData = {
          ...eventData,
          duration_seconds: leaveResult.durationSeconds,
          billable_minutes: leaveResult.billableMinutes,
          usage_log_id: leaveResult.usageLogId,
        }
      } else {
        const [activeSessions] = await connection.execute(
          `
          SELECT id
          FROM rtc_sessions
          WHERE room_id = ?
          AND status = 'active'
          ORDER BY id DESC
          LIMIT 1
          `,
          [room.id]
        )
        eventSessionId = activeSessions[0]?.id || null
      }

      eventType = 'ban_by_moderator'
      eventData = {
        ...eventData,
        ban_id: ban.id,
        ban_type: ban.ban_type,
        reason: ban.reason,
        ends_at: ban.ends_at,
      }
    }

    if (eventSessionId) {
      await connection.execute(
        `
        INSERT INTO rtc_events (tenant_id, room_id, session_id, user_id, event_type, event_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          room.tenant_id,
          room.id,
          eventSessionId,
          targetUserId,
          eventType,
          JSON.stringify(eventData),
        ]
      )
    }

    let updatedParticipant = null
    if (participant) {
      const [updatedParticipants] = await connection.execute(
        `
        SELECT *
        FROM rtc_session_participants
        WHERE id = ?
        LIMIT 1
        `,
        [participant.id]
      )
      updatedParticipant = updatedParticipants[0] || null
    }

    return {
      action: normalizedAction,
      target_user_id: targetUserId,
      target_user: targetUser,
      participant: updatedParticipant,
      ban,
      controls: await getRoomControls(connection, room, actor.id, { roleOverride: actorRole }),
    }
  })
}

async function moderationEndpoint(req, res, next, forcedAction = null) {
  try {
    const roomId = parseInteger(req.params.id, null)
    const targetUserId = parseInteger(req.params.userId, null)
    const action = forcedAction || req.body?.action

    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })
    if (!targetUserId || targetUserId < 1) return res.status(422).json({ message: 'Invalid participant user ID.' })

    const result = await applyModerationAction({
      roomId,
      targetUserId,
      action,
      actor: req.user,
      body: req.body || {},
    })

    try {
      await emitRoomRealtime(req, result.controls?.room, 'moderation-action', {
        targetUserId,
        target_user_id: targetUserId,
        action: result.action,
        participant: result.participant,
        ban: result.ban,
        moderatorUserId: req.user.id,
        controls: result.controls,
      })
    } catch (broadcastError) {
      console.error('[rooms] moderation realtime broadcast failed', broadcastError)
    }

    return res.json({
      message: 'Moderation action applied.',
      ...result,
    })
  } catch (error) {
    next(error)
  }
}

router.post('/:id/participants/:userId/moderation', authMiddleware, (req, res, next) => moderationEndpoint(req, res, next))
router.post('/:id/participants/:userId/mute', authMiddleware, (req, res, next) => moderationEndpoint(req, res, next, 'mute_mic'))
router.post('/:id/participants/:userId/kick', authMiddleware, (req, res, next) => moderationEndpoint(req, res, next, 'kick'))
router.post('/:id/participants/:userId/ban', authMiddleware, (req, res, next) => moderationEndpoint(req, res, next, 'ban'))

router.get('/:id/bans', authMiddleware, async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const result = await transaction(async (connection) => {
      const isPlatformAdmin = userHasRole(req.user, 'super_admin')
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        ${isPlatformAdmin ? '' : 'AND tenant_id = ?'}
        LIMIT 1
        `,
        isPlatformAdmin ? [roomId] : [roomId, req.user.tenant_id]
      )

      if (!rooms.length) throw createHttpError(404, 'Room not found.')

      const room = rooms[0]
      const actorRole = isPlatformAdmin
        ? 'owner'
        : Number(room.owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, room.id, req.user.id)

      if (!canManageRoom(actorRole)) throw createHttpError(403, 'Only room managers can view room bans.')

      return {
        room: serializeRoom(room),
        role: actorRole,
        bans: await fetchActiveRoomBans(connection, room.id),
      }
    })

    return res.json(result)
  } catch (error) {
    next(error)
  }
})

router.delete('/:id/bans/:banId', authMiddleware, async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.id, null)
    const banId = parseInteger(req.params.banId, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })
    if (!banId || banId < 1) return res.status(422).json({ message: 'Invalid ban ID.' })

    const result = await transaction(async (connection) => {
      const isPlatformAdmin = userHasRole(req.user, 'super_admin')
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE id = ?
        ${isPlatformAdmin ? '' : 'AND tenant_id = ?'}
        LIMIT 1
        FOR UPDATE
        `,
        isPlatformAdmin ? [roomId] : [roomId, req.user.tenant_id]
      )

      if (!rooms.length) throw createHttpError(404, 'Room not found.')

      const room = rooms[0]
      await expireRoomBansByRoom(room.id, connection)

      const [bans] = await connection.execute(
        `
        SELECT *
        FROM room_bans
        WHERE id = ?
        AND room_id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [banId, room.id]
      )

      if (!bans.length) throw createHttpError(404, 'Room ban not found.')

      const ban = bans[0]
      if (ban.status !== 'active') throw createHttpError(409, `This ban is already ${ban.status}.`)

      const actorRole = isPlatformAdmin
        ? 'owner'
        : Number(room.owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, room.id, req.user.id)
      const targetRole = await getRoomRole(connection, room.id, ban.banned_user_id)

      if (!canModerateTarget(actorRole, targetRole)) {
        throw createHttpError(403, 'You can only unban users below your room role.')
      }

      await connection.execute(
        `
        UPDATE room_bans
        SET status = 'revoked',
            updated_at = NOW()
        WHERE id = ?
        `,
        [ban.id]
      )

      const [updatedBans] = await connection.execute(
        `
        SELECT
          rb.*,
          banned_user.name AS user_name,
          banned_user.email AS user_email,
          banned_user.avatar_url AS user_avatar_url,
          banned_user.gender AS user_gender,
          moderator.name AS banned_by_name
        FROM room_bans rb
        LEFT JOIN users banned_user ON banned_user.id = rb.banned_user_id
        LEFT JOIN users moderator ON moderator.id = rb.banned_by
        WHERE rb.id = ?
        LIMIT 1
        `,
        [ban.id]
      )

      return {
        room: serializeRoom(room),
        ban: mapRoomBan(updatedBans[0]),
        target_user_id: Number(ban.banned_user_id),
        controls: await getRoomControls(connection, room, req.user.id, { roleOverride: actorRole }),
      }
    })

    try {
      await emitRoomRealtime(req, result.room, 'room-ban-revoked', {
        ban: result.ban,
        targetUserId: result.target_user_id,
        target_user_id: result.target_user_id,
        moderatorUserId: req.user.id,
        controls: result.controls,
      })
    } catch (broadcastError) {
      console.error('[rooms] ban revoke realtime broadcast failed', broadcastError)
    }

    return res.json({
      message: 'Room ban revoked.',
      ...result,
    })
  } catch (error) {
    next(error)
  }
})

async function applyStagePermission({ roomId, targetUserId, requestId = null, action, actor }) {
  await ensureRoomStageRequestSchema()
  const normalizedAction = cleanString(action, 30).toLowerCase()
  if (!stagePermissionActions.has(normalizedAction)) {
    throw createHttpError(422, 'Choose approve, reject, or remove.')
  }

  return transaction(async (connection) => {
    const [rooms] = await connection.execute(
      `
      SELECT *
      FROM rooms
      WHERE id = ?
      LIMIT 1
      `,
      [roomId]
    )

    if (!rooms.length) throw createHttpError(404, 'Room not found.')

    const room = rooms[0]
    if (Number(room.tenant_id) !== Number(actor.tenant_id) && !userHasRole(actor, 'super_admin')) {
      throw createHttpError(403, 'You can only manage rooms in your tenant.')
    }

    const actorRole = userHasRole(actor, 'super_admin')
      ? 'owner'
      : Number(room.owner_id) === Number(actor.id)
      ? 'owner'
      : await getRoomRole(connection, room.id, actor.id)

    if (!canApproveStageRequests(actorRole)) {
      throw createHttpError(403, 'Only the room owner can approve stage join requests.')
    }

    let stageRequest = null
    if (requestId) {
      const [stageRequestRows] = await connection.execute(
        `
        SELECT *
        FROM room_stage_requests
        WHERE id = ?
        AND room_id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [requestId, room.id]
      )

      if (!stageRequestRows.length) throw createHttpError(404, 'Stage request not found.')
      stageRequest = stageRequestRows[0]

      if (!['approve', 'reject'].includes(normalizedAction)) {
        throw createHttpError(422, 'Stage request endpoints only support approve or reject.')
      }

      if (stageRequest.status !== 'pending') {
        throw createHttpError(409, `This stage request is already ${stageRequest.status}.`)
      }

      targetUserId = Number(stageRequest.requester_user_id)
    }

    if (!targetUserId || targetUserId < 1) {
      throw createHttpError(422, 'Invalid participant user ID.')
    }

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
      [room.id, targetUserId]
    )

    if (!participants.length) throw createHttpError(404, 'Participant is not currently in this room.')

    const participant = participants[0]
    const targetRoomRole = Number(room.owner_id) === Number(targetUserId)
      ? 'owner'
      : await getRoomRole(connection, room.id, targetUserId)
    const effectiveTargetRole = canPublishRoomMedia(targetRoomRole)
      ? targetRoomRole
      : participant.role_in_room || 'audience'

    if (!roleCanBeMovedByStagePermission(effectiveTargetRole)) {
      throw createHttpError(422, 'Room managers already have stage access.')
    }

    const nextRole = normalizedAction === 'approve' ? 'speaker' : 'audience'
    if (normalizedAction === 'approve') {
      const activeStageSeats = await stageSeatCount(connection, participant.session_id, targetUserId)
      const maxParticipants = Math.max(1, Number(room.max_mic_count || 1))
      if (activeStageSeats >= maxParticipants) {
        throw createHttpError(409, 'The room stage is full. Free a mic seat before approving another speaker.')
      }
    }

    await connection.execute(
      `
      UPDATE rtc_session_participants
      SET role_in_room = ?,
          mic_enabled = CASE WHEN ? = 'speaker' THEN mic_enabled ELSE 0 END,
          camera_enabled = CASE WHEN ? = 'speaker' THEN camera_enabled ELSE 0 END,
          screen_shared = CASE WHEN ? = 'speaker' THEN screen_shared ELSE 0 END,
          updated_at = NOW()
      WHERE id = ?
      `,
      [nextRole, nextRole, nextRole, nextRole, participant.id]
    )

    if (normalizedAction !== 'remove') {
      const nextRequestStatus = normalizedAction === 'approve' ? 'approved' : 'rejected'

      if (stageRequest) {
        await connection.execute(
          `
          UPDATE room_stage_requests
          SET status = ?,
              response_by = ?,
              responded_at = NOW(),
              participant_id = ?,
              session_id = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [nextRequestStatus, actor.id, participant.id, participant.session_id, stageRequest.id]
        )
      } else {
        await connection.execute(
          `
          UPDATE room_stage_requests
          SET status = ?,
              response_by = ?,
              responded_at = NOW(),
              participant_id = ?,
              session_id = ?,
              updated_at = NOW()
          WHERE room_id = ?
          AND requester_user_id = ?
          AND status = 'pending'
          ORDER BY id DESC
          LIMIT 1
          `,
          [nextRequestStatus, actor.id, participant.id, participant.session_id, room.id, targetUserId]
        )
      }

      await connection.execute(
        `
        UPDATE room_stage_requests
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE room_id = ?
        AND requester_user_id = ?
        AND status = 'pending'
        `,
        [room.id, targetUserId]
      )
    } else {
      await connection.execute(
        `
        UPDATE room_stage_requests
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE room_id = ?
        AND requester_user_id = ?
        AND status = 'pending'
        `,
        [room.id, targetUserId]
      )
    }

    const [updatedParticipants] = await connection.execute(
      `SELECT * FROM rtc_session_participants WHERE id = ? LIMIT 1`,
      [participant.id]
    )

    const updatedRole = normalizeRoomRole(updatedParticipants[0]?.role_in_room || nextRole, 'audience')
    const updatedCapabilities = roomRoleCapabilities(updatedRole)
    const updatedParticipant = updatedParticipants[0]
      ? {
          ...updatedParticipants[0],
          role_in_room: updatedRole,
          capabilities: updatedCapabilities,
          stage_access: {
            role: updatedRole,
            can_publish: updatedCapabilities.can_publish_media,
            requires_approval: !updatedCapabilities.can_publish_media,
            requests_enabled: room.stage_requests_enabled === undefined || room.stage_requests_enabled === null
              ? true
              : Boolean(Number(room.stage_requests_enabled)),
            status: updatedCapabilities.can_publish_media ? 'approved' : 'audience',
          },
        }
      : null
    const updatedRequest = stageRequest
      ? await fetchStageRequestById(connection, room.id, stageRequest.id)
      : await latestStageRequestForUser(connection, room.id, targetUserId, ['approved', 'rejected', 'cancelled'])
    const controls = await getRoomControls(connection, room, actor.id, { roleOverride: actorRole })

    return {
      action: normalizedAction,
      approved: normalizedAction === 'approve',
      target_user_id: targetUserId,
      request: updatedRequest,
      participant: updatedParticipant,
      controls,
      room: controls.room,
    }
  })
}

router.post('/:id/participants/:userId/stage', authMiddleware, async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.id, null)
    const targetUserId = parseInteger(req.params.userId, null)

    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })
    if (!targetUserId || targetUserId < 1) return res.status(422).json({ message: 'Invalid participant user ID.' })

    const result = await applyStagePermission({
      roomId,
      targetUserId,
      action: req.body?.action || 'approve',
      actor: req.user,
    })

    try {
      await emitRoomRealtime(req, result.room, 'stage-permission-updated', {
        targetUserId,
        target_user_id: targetUserId,
        request: result.request,
        action: result.action,
        approved: result.approved,
        participant: result.participant,
        ownerUserId: req.user.id,
        controls: result.controls,
      })
    } catch (broadcastError) {
      console.error('[rooms] stage permission realtime broadcast failed', broadcastError)
    }

    return res.json({
      message: result.approved ? 'Stage request approved.' : 'Stage request declined.',
      ...result,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/join', authMiddleware, async (req, res, next) => {
  try {
    await ensureRoomFeatureSchema()
    await ensureRoomStageRequestSchema()
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const rooms = await query(
      `
      SELECT *
      FROM rooms
      WHERE id = :roomId
      AND status = 'active'
      LIMIT 1
      `,
      { roomId }
    )

    if (!rooms.length) return res.status(404).json({ message: 'Room not found.' })

    const room = rooms[0]
    const publicRoom = await findPublicRoomById(room.id)

    if (await isUserBanned(room.id, req.user.id)) {
      return res.status(403).json({ message: 'You are banned from this room.' })
    }

    const hasIssuedRoomToken = tokenGrantsRoomJoin(req.user, room.id)

    if (
      room.privacy_type === 'private'
      && !hasIssuedRoomToken
      && !canSeePrivateRoom(req.user, room)
      && !(await canAccessPrivateRoom(room.id, req.user.id, room.owner_id))
    ) {
      return res.status(403).json({ message: 'This room is private.' })
    }

    if (room.privacy_type === 'password' && !hasIssuedRoomToken) {
      const password = cleanString(req.body?.password, 100)
      if (!password || !(await bcrypt.compare(password, room.password_hash))) {
        return res.status(403).json({ message: 'Invalid room password.' })
      }
    }

    const requestedRtcMode = cleanString(req.body?.rtc_mode, 20) || defaultRtcModeForRoom(room.room_type)

    if (!validRtcModes.has(requestedRtcMode)) {
      return res.status(422).json({ message: 'Invalid RTC mode.' })
    }

    const effectiveRtcMode = requestedRtcMode === 'video' && !roomSupportsVideo(room.room_type)
      ? 'audio'
      : requestedRtcMode

    const requestedJoinOptions = {
      rtc_mode: effectiveRtcMode,
      mic_enabled: parseBoolean(req.body?.mic_enabled, true),
      camera_enabled: effectiveRtcMode === 'video' && parseBoolean(req.body?.camera_enabled, true),
      screen_shared: false,
    }

    const result = await transaction(async (connection) => {
      const [activeSessions] = await connection.execute(
        `
        SELECT *
        FROM rtc_sessions
        WHERE room_id = ?
        AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
        `,
        [room.id]
      )

      let session = activeSessions[0]

      if (!session) {
        const signalingRoom = `webrtc_tenant_${room.tenant_id}_room_${room.id}`

        const [insertSession] = await connection.execute(
          `
          INSERT INTO rtc_sessions (
            tenant_id, room_id, rtc_provider, signaling_room, session_type,
            started_by, started_at, status, total_duration_seconds,
            total_participant_minutes, created_at, updated_at
          )
          VALUES (?, ?, 'native_webrtc', ?, ?, ?, NOW(), 'active', 0, 0, NOW(), NOW())
          `,
          [room.tenant_id, room.id, signalingRoom, room.room_type, req.user.id]
        )

        const [newSessions] = await connection.execute(`SELECT * FROM rtc_sessions WHERE id = ? LIMIT 1`, [insertSession.insertId])
        session = newSessions[0]
      }

      const [activeParticipants] = await connection.execute(
        `
        SELECT *
        FROM rtc_session_participants
        WHERE session_id = ?
        AND user_id = ?
        AND left_at IS NULL
        ORDER BY id DESC
        LIMIT 1
        `,
        [session.id, req.user.id]
      )

      const currentRoomRole = Number(room.owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, room.id, req.user.id)
      const defaultSessionRole = canPublishRoomMedia(currentRoomRole) ? currentRoomRole : 'audience'
      await expireStageRequests(connection, room.id)

      if (activeParticipants.length) {
        const existingSessionRole = normalizeRoomRole(activeParticipants[0].role_in_room || defaultSessionRole, 'audience')
        const reusableSessionRole = roleCanBeMovedByStagePermission(existingSessionRole) ? existingSessionRole : 'audience'
        const effectiveSessionRole = canPublishRoomMedia(currentRoomRole) ? currentRoomRole : reusableSessionRole
        const canPublishOnJoin = canPublishRoomMedia(effectiveSessionRole)
        const joinOptions = {
          rtc_mode: requestedJoinOptions.rtc_mode,
          mic_enabled: canPublishOnJoin && requestedJoinOptions.mic_enabled,
          camera_enabled: canPublishOnJoin && requestedJoinOptions.camera_enabled,
          screen_shared: false,
        }

        await connection.execute(
          `
          UPDATE rtc_session_participants
          SET role_in_room = ?,
              mic_enabled = ?,
              camera_enabled = ?,
              screen_shared = ?,
              connection_status = 'connected',
              updated_at = NOW()
          WHERE id = ?
          `,
          [
            effectiveSessionRole,
            joinOptions.mic_enabled ? 1 : 0,
            joinOptions.camera_enabled ? 1 : 0,
            joinOptions.screen_shared ? 1 : 0,
            activeParticipants[0].id,
          ]
        )

        const [participants] = await connection.execute(
          `SELECT * FROM rtc_session_participants WHERE id = ? LIMIT 1`,
          [activeParticipants[0].id]
        )

        const stageRequest = canPublishOnJoin
          ? null
          : await latestStageRequestForUser(connection, room.id, req.user.id, ['pending'])

        return {
          alreadyJoined: true,
          session,
          participant: participants[0],
          rtcMode: joinOptions.rtc_mode,
          stageRole: effectiveSessionRole,
          stageRequest,
        }
      }

      const canPublishOnJoin = canPublishRoomMedia(defaultSessionRole)
      const joinOptions = {
        rtc_mode: requestedJoinOptions.rtc_mode,
        mic_enabled: canPublishOnJoin && requestedJoinOptions.mic_enabled,
        camera_enabled: canPublishOnJoin && requestedJoinOptions.camera_enabled,
        screen_shared: false,
      }
      const activeCount = canPublishOnJoin ? await stageSeatCount(connection, session.id) : 0
      const maxParticipants = Math.max(1, Number(room.max_mic_count || 1))

      if (activeCount >= maxParticipants) {
        throw createHttpError(409, 'The room stage is full. Wait for the owner to free a mic seat.')
      }

      const [insertParticipant] = await connection.execute(
        `
        INSERT INTO rtc_session_participants (
          session_id, room_id, user_id, peer_uid, role_in_room, joined_at,
          duration_seconds, mic_enabled, camera_enabled, screen_shared,
          connection_status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, NOW(), 0, ?, ?, ?, 'connected', NOW(), NOW())
        `,
        [
          session.id,
          room.id,
          req.user.id,
          req.user.id,
          defaultSessionRole,
          joinOptions.mic_enabled ? 1 : 0,
          joinOptions.camera_enabled ? 1 : 0,
          joinOptions.screen_shared ? 1 : 0,
        ]
      )

      const [participants] = await connection.execute(`SELECT * FROM rtc_session_participants WHERE id = ? LIMIT 1`, [insertParticipant.insertId])

      await connection.execute(
        `
        INSERT INTO rtc_events (tenant_id, room_id, session_id, user_id, event_type, event_data, created_at)
        VALUES (?, ?, ?, ?, 'join', ?, NOW())
        `,
        [
          room.tenant_id,
          room.id,
          session.id,
          req.user.id,
          JSON.stringify({
            room_type: room.room_type,
            rtc_provider: 'native_webrtc',
            rtc_mode: joinOptions.rtc_mode,
            role_in_room: defaultSessionRole,
            mic_enabled: joinOptions.mic_enabled,
            camera_enabled: joinOptions.camera_enabled,
          }),
        ]
      )

      const stageRequest = canPublishOnJoin
        ? null
        : await latestStageRequestForUser(connection, room.id, req.user.id, ['pending'])

      return {
        alreadyJoined: false,
        session,
        participant: participants[0],
        rtcMode: joinOptions.rtc_mode,
        stageRole: defaultSessionRole,
        stageRequest,
      }
    })

    const joinedRole = normalizeRoomRole(result.stageRole || result.participant.role_in_room || 'audience', 'audience')
    const joinedCapabilities = roomRoleCapabilities(joinedRole)

    return res.json({
      message: result.alreadyJoined ? 'Already joined room' : 'Joined room successfully',
      room: publicRoom,
      session: result.session,
      participant: result.participant,
      rtc: {
        provider: 'native_webrtc',
        profile: rtcProfileForRoomType(room.room_type),
        signaling_room: result.session.signaling_room,
        user_id: req.user.id,
        peer_uid: result.participant.peer_uid,
        already_joined: result.alreadyJoined,
        rtc_mode: result.rtcMode,
        mic_enabled: Boolean(Number(result.participant.mic_enabled)),
        camera_enabled: Boolean(Number(result.participant.camera_enabled)),
        stage_access: {
          role: joinedRole,
          can_publish: joinedCapabilities.can_publish_media,
          requires_approval: !joinedCapabilities.can_publish_media,
          requests_enabled: room.stage_requests_enabled === undefined || room.stage_requests_enabled === null
            ? true
            : Boolean(Number(room.stage_requests_enabled)),
          status: joinedCapabilities.can_publish_media
            ? 'approved'
            : result.stageRequest
            ? 'pending'
            : 'audience',
        },
        role_capabilities: joinedCapabilities,
        stage_request: result.stageRequest,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/media-state', authMiddleware, async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const rooms = await query(
      `
      SELECT *
      FROM rooms
      WHERE id = :roomId
      AND status = 'active'
      LIMIT 1
      `,
      { roomId }
    )

    if (!rooms.length) return res.status(404).json({ message: 'Room not found.' })

    const room = rooms[0]

    const result = await transaction(async (connection) => {
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
        [room.id, req.user.id]
      )

      if (!participants.length) {
        throw createHttpError(409, 'Join the room before changing mic or camera state.')
      }

      const participant = participants[0]
      const currentMicEnabled = Boolean(Number(participant.mic_enabled))
      const currentCameraEnabled = Boolean(Number(participant.camera_enabled))
      const currentScreenShared = Boolean(Number(participant.screen_shared))
      const roomRole = Number(room.owner_id) === Number(req.user.id)
        ? 'owner'
        : await getRoomRole(connection, room.id, req.user.id)
      const effectiveParticipantRole = canPublishRoomMedia(roomRole)
        ? roomRole
        : roleCanBeMovedByStagePermission(participant.role_in_room)
        ? normalizeRoomRole(participant.role_in_room, 'audience')
        : 'audience'
      const micEnabled = parseBoolean(req.body?.mic_enabled, currentMicEnabled)
      const cameraEnabled = roomSupportsVideo(room.room_type)
        ? parseBoolean(req.body?.camera_enabled, currentCameraEnabled)
        : false
      const screenShared = parseBoolean(req.body?.screen_shared, currentScreenShared)
      const wantsToPublish = micEnabled || cameraEnabled || screenShared

      if (screenShared && !Boolean(Number(room.screen_share_enabled))) {
        throw createHttpError(403, 'Screen share is disabled in this room.')
      }

      if (wantsToPublish && !canPublishRoomMedia(effectiveParticipantRole)) {
        throw createHttpError(403, 'Ask the room owner for permission before joining the mic or camera stage.')
      }

      await connection.execute(
        `
        UPDATE rtc_session_participants
        SET role_in_room = ?,
            mic_enabled = ?,
            camera_enabled = ?,
            screen_shared = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [
          effectiveParticipantRole,
          micEnabled ? 1 : 0,
          cameraEnabled ? 1 : 0,
          screenShared ? 1 : 0,
          participant.id,
        ]
      )

      const mediaChanges = []
      if (currentMicEnabled !== micEnabled) mediaChanges.push(micEnabled ? 'mic_on' : 'mic_off')
      if (currentCameraEnabled !== cameraEnabled) mediaChanges.push(cameraEnabled ? 'camera_on' : 'camera_off')
      if (currentScreenShared !== screenShared) mediaChanges.push(screenShared ? 'screen_share_start' : 'screen_share_stop')

      for (const eventType of mediaChanges) {
        await connection.execute(
          `
          INSERT INTO rtc_events (tenant_id, room_id, session_id, user_id, event_type, event_data, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NOW())
          `,
          [
            room.tenant_id,
            room.id,
            participant.session_id,
            req.user.id,
            eventType,
            JSON.stringify({
              rtc_provider: 'native_webrtc',
              mic_enabled: micEnabled,
              camera_enabled: cameraEnabled,
              screen_shared: screenShared,
            }),
          ]
        )
      }

      const [updatedParticipants] = await connection.execute(
        `SELECT * FROM rtc_session_participants WHERE id = ? LIMIT 1`,
        [participant.id]
      )

      return { participant: updatedParticipants[0], stageRole: effectiveParticipantRole, mediaChanges }
    })

    const mediaRole = normalizeRoomRole(result.stageRole || result.participant.role_in_room || 'audience', 'audience')
    const mediaCapabilities = roomRoleCapabilities(mediaRole)

    return res.json({
      message: 'Media state updated',
      participant: result.participant,
      rtc: {
        mic_enabled: Boolean(Number(result.participant.mic_enabled)),
        camera_enabled: Boolean(Number(result.participant.camera_enabled)),
        screen_shared: Boolean(Number(result.participant.screen_shared)),
        stage_access: {
          role: mediaRole,
          can_publish: mediaCapabilities.can_publish_media,
          requires_approval: !mediaCapabilities.can_publish_media,
          requests_enabled: room.stage_requests_enabled === undefined || room.stage_requests_enabled === null
            ? true
            : Boolean(Number(room.stage_requests_enabled)),
          status: mediaCapabilities.can_publish_media ? 'approved' : 'audience',
        },
        role_capabilities: mediaCapabilities,
      },
      events: result.mediaChanges,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/quality', authMiddleware, async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const rooms = await query(
      `
      SELECT *
      FROM rooms
      WHERE id = :roomId
      AND status = 'active'
      LIMIT 1
      `,
      { roomId }
    )

    if (!rooms.length) return res.status(404).json({ message: 'Room not found.' })

    const room = rooms[0]
    const sample = sanitizeRtcQualitySample(req.body || {})

    const result = await transaction(async (connection) => {
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
        [room.id, req.user.id]
      )

      if (!participants.length) {
        throw createHttpError(409, 'Join the room before sending RTC quality.')
      }

      const participant = participants[0]
      const participantStatus = participantStatusForQuality(sample.quality)

      const [insertResult] = await connection.execute(
        `
        INSERT INTO rtc_quality_samples (
          tenant_id, room_id, session_id, participant_id, user_id,
          quality, peer_count, measured_peer_count,
          incoming_kbps, outgoing_kbps, rtt_ms, packet_loss_pct, available_outgoing_kbps,
          local_candidate_types, remote_candidate_types, peer_states, media_summary, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          room.tenant_id,
          room.id,
          participant.session_id,
          participant.id,
          req.user.id,
          sample.quality,
          sample.peer_count,
          sample.measured_peer_count,
          sample.incoming_kbps,
          sample.outgoing_kbps,
          sample.rtt_ms,
          sample.packet_loss_pct,
          sample.available_outgoing_kbps,
          JSON.stringify(sample.local_candidate_types),
          JSON.stringify(sample.remote_candidate_types),
          JSON.stringify(sample.peer_states),
          JSON.stringify(sample.media_summary),
        ]
      )

      if (participant.connection_status !== participantStatus) {
        await connection.execute(
          `
          UPDATE rtc_session_participants
          SET connection_status = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [participantStatus, participant.id]
        )
      }

      return {
        id: insertResult.insertId,
        participant_status: participantStatus,
      }
    })

    return res.json({
      message: 'RTC quality recorded',
      quality: sample.quality,
      sample_id: result.id,
      participant_status: result.participant_status,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/leave', authMiddleware, async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.id, null)
    if (!roomId || roomId < 1) return res.status(422).json({ message: 'Invalid room ID.' })

    const rooms = await query(
      `
      SELECT *
      FROM rooms
      WHERE id = :roomId
      LIMIT 1
      `,
      { roomId }
    )

    if (!rooms.length) return res.status(404).json({ message: 'Room not found.' })

    const room = rooms[0]

    const result = await transaction(async (connection) => {
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
        [room.id, req.user.id]
      )

      let leavePayload = {
        left: false,
        message: 'User is not currently inside this room.',
        room_ended: false,
        room_status: room.status,
      }
      let closedParticipants = 0

      if (participants.length) {
        const participant = participants[0]
        const leaveResult = await closeParticipantSession(connection, room, participant, req.user.id)
        closedParticipants += leaveResult.alreadyClosed ? 0 : 1

        await connection.execute(
          `
          INSERT INTO rtc_events (tenant_id, room_id, session_id, user_id, event_type, event_data, created_at)
          VALUES (?, ?, ?, ?, 'leave', ?, NOW())
          `,
          [
            room.tenant_id,
            room.id,
            participant.session_id,
            req.user.id,
            JSON.stringify({
              duration_seconds: leaveResult.durationSeconds,
              billable_minutes: leaveResult.billableMinutes,
              usage_log_id: leaveResult.usageLogId,
              rtc_provider: 'native_webrtc',
              leave_only: true,
            }),
          ]
        )

        leavePayload = {
          left: true,
          message: 'Left room successfully',
          duration_seconds: leaveResult.durationSeconds,
          billable_minutes: leaveResult.billableMinutes,
          usage_log_id: leaveResult.usageLogId,
          usage_logged: Boolean(leaveResult.usageLogId),
          room_ended: false,
          room_status: room.status,
        }
      }

      return {
        ...leavePayload,
        closed_participants: closedParticipants,
      }
    })

    return res.json(result)
  } catch (error) {
    next(error)
  }
})

module.exports = router
