const FEATURE_LABELS = {
  normal_audio_room: 'normal audio rooms',
  youtube_audio_room: 'YouTube audio rooms',
  noise_cancellation: 'noise cancellation',
  voice_changer: 'voice changer',
  one_to_one_voice_calling: 'one-to-one voice calling',
  group_voice_chat: 'group voice chat',
  normal_video_group_chat: 'video group chat',
  one_to_one_video_calling: 'one-to-one video calling',
  live_video_pk: 'PK live rooms',
  solo_video_live: 'solo live rooms',
  video_filter_beauty: 'video filters and beauty effects',
  message_chat: 'chat and media',
  room_roles: 'room role management',
  private_room_password: 'private/password rooms',
  screen_share: 'screen sharing',
  ai_security_audio: 'AI audio guard',
  ai_security_video: 'AI video guard',
  room_theme: 'room themes',
  room_share: 'room sharing',
  comment_reply: 'comment replies',
  company_billing: 'company billing',
  admin_panel_analytics: 'admin analytics',
  rtc_connection_indicator: 'RTC connection indicator',
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function createEntitlementError(status, code, message) {
  const error = createHttpError(status, message)
  error.code = code
  return error
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function roomSupportsVideo(roomType) {
  return ['video', 'one_to_one_video', 'group_video', 'solo_live', 'pk_live'].includes(roomType)
}

function roomTypeFeature(roomType) {
  if (roomType === 'audio') return 'normal_audio_room'
  if (roomType === 'youtube_audio') return 'youtube_audio_room'
  if (roomType === 'one_to_one_audio') return 'one_to_one_voice_calling'
  if (roomType === 'one_to_one_video') return 'one_to_one_video_calling'
  if (roomType === 'group_audio') return 'group_voice_chat'
  if (roomType === 'solo_live') return 'solo_video_live'
  if (roomType === 'pk_live') return 'live_video_pk'
  return 'normal_video_group_chat'
}

function allFeatureKeys() {
  return Object.keys(FEATURE_LABELS)
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

function boolValue(value) {
  return value === true || value === 1 || value === '1'
}

function normalizeRoomConfig(config = {}) {
  const roomType = firstValue(config.room_type, config.roomType) || 'video'
  return {
    room_type: roomType,
    privacy_type: firstValue(config.privacy_type, config.privacyType) || 'public',
    max_mic_count: Number(firstValue(config.max_mic_count, config.maxMicCount) || 0),
    theme: firstValue(config.theme),
    chat_enabled: boolValue(firstValue(config.chat_enabled, config.chatEnabled)),
    gift_enabled: boolValue(firstValue(config.gift_enabled, config.giftEnabled)),
    screen_share_enabled: boolValue(firstValue(config.screen_share_enabled, config.screenShareEnabled)),
    ai_security_enabled: boolValue(firstValue(config.ai_security_enabled, config.aiSecurityEnabled)),
    room_supports_video: roomSupportsVideo(roomType),
  }
}

function requiredFeatureKeysForRoom(config = {}) {
  const room = normalizeRoomConfig(config)
  const required = new Set([roomTypeFeature(room.room_type)])

  if (['private', 'password'].includes(room.privacy_type)) required.add('private_room_password')
  if (room.chat_enabled || room.gift_enabled) required.add('message_chat')
  if (room.screen_share_enabled) required.add('screen_share')
  if (room.ai_security_enabled) required.add(room.room_supports_video ? 'ai_security_video' : 'ai_security_audio')
  if (room.theme) required.add('room_theme')

  return [...required]
}

async function getTenantEntitlements(connection, tenantId) {
  const [rows] = await connection.execute(
    `
    SELECT
      t.id AS tenant_id,
      t.name AS tenant_name,
      t.status AS tenant_status,
      t.default_room_limit,
      t.default_participant_limit,
      sp.id AS plan_id,
      sp.code AS plan_code,
      sp.name AS plan_name,
      sp.max_rooms,
      sp.max_participants_per_room,
      sp.included_features
    FROM tenants t
    LEFT JOIN (
      SELECT latest.tenant_id, latest.plan_id
      FROM tenant_plan_assignments latest
      INNER JOIN (
        SELECT tenant_id, MAX(id) AS latest_id
        FROM tenant_plan_assignments
        WHERE status = 'active'
        GROUP BY tenant_id
      ) chosen ON chosen.latest_id = latest.id
    ) active_plan ON active_plan.tenant_id = t.id
    LEFT JOIN service_plans sp ON sp.id = active_plan.plan_id
    WHERE t.id = ?
    LIMIT 1
    `,
    [tenantId]
  )

  const row = rows[0]
  if (!row) throw createEntitlementError(404, 'company_suspended', 'Client company was not found.')
  if (!['active', 'pending'].includes(row.tenant_status)) {
    throw createEntitlementError(422, 'company_suspended', 'RTC rooms are disabled while this company is suspended or cancelled.')
  }

  return {
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    tenant_status: row.tenant_status,
    plan_id: row.plan_id,
    plan_code: row.plan_code,
    plan_name: row.plan_name || 'Client-company billing',
    room_limit: Number(row.default_room_limit || row.max_rooms || 0),
    participant_limit: Number(row.default_participant_limit || row.max_participants_per_room || 0),
    features: new Set(row.plan_id ? parseJsonArray(row.included_features) : allFeatureKeys()),
  }
}

async function assertTenantCanUseRoomConfig(connection, tenantId, config, options = {}) {
  const entitlements = await getTenantEntitlements(connection, tenantId)
  const room = normalizeRoomConfig(config)
  const missing = requiredFeatureKeysForRoom(room).filter((feature) => !entitlements.features.has(feature))

  if (options.enforceFeatureAccess && missing.length) {
    const labels = missing.map((feature) => FEATURE_LABELS[feature] || feature).join(', ')
    throw createEntitlementError(422, 'permission_denied', `${entitlements.plan_name} does not include ${labels}. Update company billing access or choose another room setup.`)
  }

  if (options.enforceSeatLimit && entitlements.participant_limit > 0 && room.max_mic_count > entitlements.participant_limit) {
    throw createEntitlementError(422, 'room_capacity_reached', `${entitlements.plan_name} is configured for up to ${entitlements.participant_limit} stage seats per room.`)
  }

  if (options.enforceRoomLimit && !options.skipRoomLimit && entitlements.room_limit > 0) {
    const [counts] = await connection.execute(
      `
      SELECT COUNT(*) AS count
      FROM rooms
      WHERE tenant_id = ?
      AND status <> 'ended'
      `,
      [tenantId]
    )
    const activeRoomCount = Number(counts[0]?.count || 0)
    if (activeRoomCount >= entitlements.room_limit) {
      throw createEntitlementError(422, 'room_capacity_reached', `${entitlements.plan_name} is configured for ${entitlements.room_limit} available room${entitlements.room_limit === 1 ? '' : 's'}. Admins can review company billing capacity.`)
    }
  }

  return entitlements
}

module.exports = {
  assertTenantCanUseRoomConfig,
  requiredFeatureKeysForRoom,
}
