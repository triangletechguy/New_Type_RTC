const express = require('express')
const { query, transaction } = require('../config/db')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()

const validMessageTypes = new Set(['text', 'image', 'voice', 'gift', 'system'])
const roomGiftCatalog = [
  { id: 'star', label: 'Star', emoji: '\u2b50', coin_value: 10 },
  { id: 'heart', label: 'Heart', emoji: '\u2764\ufe0f', coin_value: 25 },
  { id: 'cheer', label: 'Cheer', emoji: '\ud83c\udf89', coin_value: 50 },
]
const imageDataUrlPattern = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i
const giftDataUrlPattern = /^data:(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/(octet-stream|x-svga));base64,[a-z0-9+/=\s]+$/i
const audioDataUrlPattern = /^data:audio\/(webm|ogg|mpeg|mp3|mp4|wav|x-m4a)(;codecs=[^;]+)?;base64,[a-z0-9+/=\s]+$/i
const maxImageDataUrlLength = 7 * 1024 * 1024
const maxGiftDataUrlLength = 9 * 1024 * 1024
const maxAudioDataUrlLength = 7 * 1024 * 1024
const aiSecurityRules = [
  { label: 'abuse', pattern: /\b(abuse|harass|bully|threaten|hate speech)\b/i },
  { label: 'adult content', pattern: /\b(nude|nudity|porn|sexual explicit)\b/i },
  { label: 'violence', pattern: /\b(violent|kill|murder|attack this user)\b/i },
  { label: 'scam', pattern: /\b(spam|scam|fraud|phishing|fake giveaway)\b/i },
  { label: 'private transaction', pattern: /\b(private transaction|off[-\s]?platform payment|wire transfer|crypto wallet|western union)\b/i },
]
let chatSchemaPromise = null

async function ensureChatSchema() {
  if (!chatSchemaPromise) {
    chatSchemaPromise = (async () => {
      await query(`
      CREATE TABLE IF NOT EXISTS chat_message_hides (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        message_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        hidden_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_chat_message_hide (message_id, user_id),
        INDEX idx_chat_message_hides_user_id (user_id),
        CONSTRAINT fk_chat_message_hides_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_message_hides_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)

      await query(`
      CREATE TABLE IF NOT EXISTS chat_message_reactions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        room_id BIGINT UNSIGNED NOT NULL,
        message_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        emoji VARCHAR(64) NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_chat_message_reaction (message_id, user_id, emoji),
        INDEX idx_chat_message_reactions_message (message_id),
        INDEX idx_chat_message_reactions_room (tenant_id, room_id, created_at),
        CONSTRAINT fk_chat_message_reactions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_message_reactions_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_message_reactions_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_message_reactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)

      await query(`
      CREATE TABLE IF NOT EXISTS room_gift_transactions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        room_id BIGINT UNSIGNED NOT NULL,
        message_id BIGINT UNSIGNED NOT NULL,
        sender_id BIGINT UNSIGNED NOT NULL,
        owner_user_id BIGINT UNSIGNED NOT NULL,
        gift_id VARCHAR(80) NOT NULL,
        gift_label VARCHAR(120) NOT NULL,
        gift_emoji VARCHAR(64) NOT NULL,
        coin_value INT UNSIGNED NOT NULL DEFAULT 0,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        total_coins INT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_room_gift_message (message_id),
        INDEX idx_room_gifts_room_created (room_id, created_at),
        INDEX idx_room_gifts_sender (tenant_id, sender_id, created_at),
        INDEX idx_room_gifts_owner (tenant_id, owner_user_id, created_at),
        CONSTRAINT fk_room_gifts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_room_gifts_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_room_gifts_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_room_gifts_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_room_gifts_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)

      await query(`
      CREATE TABLE IF NOT EXISTS chat_user_blocks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        room_id BIGINT UNSIGNED NOT NULL,
        blocker_id BIGINT UNSIGNED NOT NULL,
        blocked_user_id BIGINT UNSIGNED NOT NULL,
        blocked_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_chat_user_block (room_id, blocker_id, blocked_user_id),
        INDEX idx_chat_user_blocks_blocker (blocker_id),
        INDEX idx_chat_user_blocks_blocked_user (blocked_user_id),
        CONSTRAINT fk_chat_blocks_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_blocks_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_blocks_blocked_user FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)

      await query('ALTER TABLE chat_messages MODIFY media_url MEDIUMTEXT NULL')

      await query(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        sender_id BIGINT UNSIGNED NOT NULL,
        recipient_id BIGINT UNSIGNED NOT NULL,
        message_type ENUM('text', 'image', 'voice', 'system') DEFAULT 'text',
        message_body TEXT NULL,
        media_url MEDIUMTEXT NULL,
        is_deleted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_direct_messages_sender (sender_id),
        INDEX idx_direct_messages_recipient (recipient_id),
        INDEX idx_direct_messages_pair (tenant_id, sender_id, recipient_id, id),
        CONSTRAINT fk_direct_messages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_direct_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_direct_messages_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)

      await query(`
      CREATE TABLE IF NOT EXISTS direct_message_hides (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        message_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        hidden_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_direct_message_hide (message_id, user_id),
        INDEX idx_direct_message_hides_user_id (user_id),
        CONSTRAINT fk_direct_message_hides_message FOREIGN KEY (message_id) REFERENCES direct_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_direct_message_hides_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)

      await query(`
      CREATE TABLE IF NOT EXISTS direct_message_reactions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        message_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        emoji VARCHAR(64) NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_direct_message_reaction (message_id, user_id, emoji),
        INDEX idx_direct_message_reactions_message (message_id),
        INDEX idx_direct_message_reactions_tenant (tenant_id, created_at),
        CONSTRAINT fk_direct_message_reactions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_direct_message_reactions_message FOREIGN KEY (message_id) REFERENCES direct_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_direct_message_reactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)

      await query(`
      CREATE TABLE IF NOT EXISTS user_follows (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        follower_id BIGINT UNSIGNED NOT NULL,
        followed_user_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_follow (tenant_id, follower_id, followed_user_id),
        INDEX idx_user_follows_follower (tenant_id, follower_id),
        INDEX idx_user_follows_followed (tenant_id, followed_user_id),
        CONSTRAINT fk_user_follows_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_user_follows_follower FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_user_follows_followed FOREIGN KEY (followed_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)

      await query(`
      CREATE TABLE IF NOT EXISTS user_follow_requests (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        requester_id BIGINT UNSIGNED NOT NULL,
        recipient_id BIGINT UNSIGNED NOT NULL,
        status ENUM('pending', 'accepted', 'rejected', 'cancelled') DEFAULT 'pending',
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        responded_at TIMESTAMP NULL DEFAULT NULL,
        UNIQUE KEY unique_follow_request_pair (tenant_id, requester_id, recipient_id),
        INDEX idx_follow_requests_recipient (tenant_id, recipient_id, status),
        INDEX idx_follow_requests_requester (tenant_id, requester_id, status),
        CONSTRAINT fk_follow_requests_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_follow_requests_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_follow_requests_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
      )
      `)
    })().catch((error) => {
      chatSchemaPromise = null
      throw error
    })
  }

  return chatSchemaPromise
}

function parsePositiveInteger(value, defaultValue = null) {
  if (value === undefined || value === null || value === '') return defaultValue
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function cleanMessageBody(value) {
  return String(value || '').replace(/\s+$/g, '')
}

function cleanMediaUrl(value) {
  return String(value || '').trim()
}

function cleanGiftId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

function giftForPayload(payload = {}, body = '', mediaUrl = '') {
  const giftId = cleanGiftId(payload.gift_id || payload.giftId || mediaUrl)
  if (giftId) {
    const gift = roomGiftCatalog.find((item) => item.id === giftId)
    if (gift) return gift
  }

  const cleanBody = String(body || '').trim().toLowerCase()
  return roomGiftCatalog.find((gift) => {
    const label = gift.label.toLowerCase()
    return cleanBody === label || cleanBody === `${gift.emoji} ${gift.label}`.toLowerCase()
  }) || null
}

function parseGiftQuantity(value) {
  if (value === undefined || value === null || value === '') return 1
  const quantity = Number(value)
  return Number.isInteger(quantity) && quantity > 0 && quantity <= 99 ? quantity : null
}

function giftMessageBody(gift, quantity = 1) {
  return quantity > 1 ? `${gift.emoji} ${gift.label} x${quantity}` : `${gift.emoji} ${gift.label}`
}

function cleanReactionEmoji(value) {
  return String(value || '').trim()
}

function reactionEmojiError(emoji) {
  if (!emoji) return 'Reaction is required.'
  if (emoji.length > 64) return 'Reaction is too long.'
  if (/[\u0000-\u001f\u007f]/.test(emoji)) return 'Reaction is invalid.'
  return ''
}

function imageMediaError(mediaUrl) {
  if (!mediaUrl) return 'Photo is required.'
  if (mediaUrl.length > maxImageDataUrlLength) return 'Photo must be smaller than 5 MB.'

  if (mediaUrl.startsWith('data:')) {
    return imageDataUrlPattern.test(mediaUrl) ? '' : 'Photo must be a PNG, JPG, GIF, or WebP image.'
  }

  try {
    const url = new URL(mediaUrl)
    return ['http:', 'https:'].includes(url.protocol) ? '' : 'Photo URL must be HTTP or HTTPS.'
  } catch {
    return 'Photo URL is invalid.'
  }
}

function audioMediaError(mediaUrl) {
  if (!mediaUrl) return 'Audio message is required.'
  if (mediaUrl.length > maxAudioDataUrlLength) return 'Audio message must be smaller than 5 MB.'

  if (mediaUrl.startsWith('data:')) {
    return audioDataUrlPattern.test(mediaUrl) ? '' : 'Audio must be WebM, OGG, MP3, MP4, M4A, or WAV.'
  }

  try {
    const url = new URL(mediaUrl)
    return ['http:', 'https:'].includes(url.protocol) ? '' : 'Audio URL must be HTTP or HTTPS.'
  } catch {
    return 'Audio URL is invalid.'
  }
}

function giftMediaError(mediaUrl) {
  if (!mediaUrl) return ''
  if (mediaUrl.length > maxGiftDataUrlLength) return 'Gift asset must be smaller than 7 MB.'

  if (mediaUrl.startsWith('data:')) {
    return giftDataUrlPattern.test(mediaUrl) ? '' : 'Gift asset must be SVG, SVGA, PNG, JPG, GIF, or WebP.'
  }

  try {
    const url = new URL(mediaUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return 'Gift asset URL must be HTTP or HTTPS.'
    const cleanPath = url.pathname.toLowerCase()
    return /\.(svga|svg|png|jpe?g|gif|webp)$/.test(cleanPath)
      ? ''
      : 'Gift asset URL must end with .svga, .svg, .png, .jpg, .jpeg, .gif, or .webp.'
  } catch {
    return 'Gift asset URL is invalid.'
  }
}

function aiMessageSecurityError(messageBody, messageType = 'text') {
  if (!['text', 'image', 'gift'].includes(messageType)) return ''

  const text = String(messageBody || '')
    .toLowerCase()
    .replace(/[\s_.,;:!?()[\]{}'"`~<>|/\\-]+/g, ' ')
    .trim()

  if (!text) return ''

  const matchedRule = aiSecurityRules.find((rule) => rule.pattern.test(text))
  return matchedRule ? `AI security blocked this message for ${matchedRule.label}.` : ''
}

function messageSelectSql() {
  return `
    SELECT
      cm.*,
      u.name AS sender_name,
      u.avatar_url AS sender_avatar_url,
      u.gender AS sender_gender
    FROM chat_messages cm
    LEFT JOIN users u ON u.id = cm.sender_id
  `
}

function directMessageSelectSql() {
  return `
    SELECT
      dm.*,
      sender.name AS sender_name,
      sender.avatar_url AS sender_avatar_url,
      sender.gender AS sender_gender,
      recipient.name AS recipient_name,
      recipient.avatar_url AS recipient_avatar_url,
      recipient.gender AS recipient_gender
    FROM direct_messages dm
    LEFT JOIN users sender ON sender.id = dm.sender_id
    LEFT JOIN users recipient ON recipient.id = dm.recipient_id
  `
}

async function attachReactionSummaries(messages, tableName, userId) {
  const validTables = new Set(['chat_message_reactions', 'direct_message_reactions'])
  const list = Array.isArray(messages) ? messages.filter(Boolean) : []
  if (!list.length) return list
  if (!validTables.has(tableName)) throw new Error('Invalid reaction table.')

  const messageIds = [...new Set(list.map((message) => Number(message.id)).filter(Boolean))]
  if (!messageIds.length) {
    return list.map((message) => ({ ...message, reactions: [], reaction_count: 0 }))
  }

  const params = { userId: Number(userId || 0) }
  const placeholders = messageIds.map((messageId, index) => {
    const key = `messageId${index}`
    params[key] = messageId
    return `:${key}`
  })

  const rows = await query(
    `
    SELECT
      message_id,
      emoji,
      COUNT(*) AS count,
      SUM(CASE WHEN user_id = :userId THEN 1 ELSE 0 END) AS reacted_by_me,
      MIN(created_at) AS first_reacted_at
    FROM ${tableName}
    WHERE message_id IN (${placeholders.join(', ')})
    GROUP BY message_id, emoji
    ORDER BY first_reacted_at ASC, emoji ASC
    `,
    params
  )

  const reactionsByMessageId = rows.reduce((map, row) => {
    const messageId = Number(row.message_id)
    if (!map.has(messageId)) map.set(messageId, [])
    map.get(messageId).push({
      emoji: row.emoji,
      count: Number(row.count || 0),
      reacted_by_me: Boolean(Number(row.reacted_by_me || 0)),
    })
    return map
  }, new Map())

  return list.map((message) => {
    const reactions = reactionsByMessageId.get(Number(message.id)) || []
    return {
      ...message,
      reactions,
      reaction_count: reactions.reduce((total, reaction) => total + Number(reaction.count || 0), 0),
    }
  })
}

function mapGiftTransaction(row) {
  if (!row) return null

  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    room_id: Number(row.room_id),
    message_id: Number(row.message_id),
    sender_id: Number(row.sender_id),
    owner_user_id: Number(row.owner_user_id),
    gift_id: row.gift_id,
    label: row.gift_label,
    emoji: row.gift_emoji,
    coin_value: Number(row.coin_value || 0),
    quantity: Number(row.quantity || 1),
    total_coins: Number(row.total_coins || 0),
    created_at: row.created_at,
  }
}

async function attachRoomGiftTransactions(messages) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : []
  if (!list.length) return list

  const messageIds = [...new Set(
    list
      .filter((message) => message.message_type === 'gift')
      .map((message) => Number(message.id))
      .filter(Boolean)
  )]

  if (!messageIds.length) return list

  const params = {}
  const placeholders = messageIds.map((messageId, index) => {
    const key = `giftMessageId${index}`
    params[key] = messageId
    return `:${key}`
  })

  const rows = await query(
    `
    SELECT *
    FROM room_gift_transactions
    WHERE message_id IN (${placeholders.join(', ')})
    `,
    params
  )

  const giftsByMessageId = rows.reduce((map, row) => {
    map.set(Number(row.message_id), mapGiftTransaction(row))
    return map
  }, new Map())

  return list.map((message) => {
    const gift = giftsByMessageId.get(Number(message.id))
    return gift ? { ...message, gift } : message
  })
}

async function hydrateRoomMessages(messages, userId) {
  const withReactions = await attachRoomMessageReactions(messages, userId)
  return attachRoomGiftTransactions(withReactions)
}

async function roomGiftSummary(roomId, tenantId, userId = null) {
  const [summaryRows, senderRows] = await Promise.all([
    query(
      `
      SELECT
        COUNT(*) AS gift_count,
        COUNT(DISTINCT sender_id) AS sender_count,
        COALESCE(SUM(total_coins), 0) AS total_coins,
        COALESCE(SUM(CASE WHEN sender_id = :userId THEN total_coins ELSE 0 END), 0) AS my_total_coins
      FROM room_gift_transactions
      WHERE room_id = :roomId
      AND tenant_id = :tenantId
      `,
      { roomId, tenantId, userId: Number(userId || 0) }
    ),
    query(
      `
      SELECT
        rgt.sender_id,
        u.name AS sender_name,
        u.avatar_url AS sender_avatar_url,
        u.gender AS sender_gender,
        COUNT(*) AS gift_count,
        COALESCE(SUM(rgt.total_coins), 0) AS total_coins
      FROM room_gift_transactions rgt
      LEFT JOIN users u ON u.id = rgt.sender_id
      WHERE rgt.room_id = :roomId
      AND rgt.tenant_id = :tenantId
      GROUP BY rgt.sender_id, u.name, u.avatar_url, u.gender
      ORDER BY total_coins DESC, gift_count DESC, rgt.sender_id ASC
      LIMIT 5
      `,
      { roomId, tenantId }
    ),
  ])

  const summary = summaryRows[0] || {}
  return {
    total_coins: Number(summary.total_coins || 0),
    gift_count: Number(summary.gift_count || 0),
    sender_count: Number(summary.sender_count || 0),
    my_total_coins: Number(summary.my_total_coins || 0),
    top_senders: senderRows.map((row) => ({
      sender_id: Number(row.sender_id),
      sender_name: row.sender_name,
      sender_avatar_url: row.sender_avatar_url,
      sender_gender: row.sender_gender,
      gift_count: Number(row.gift_count || 0),
      total_coins: Number(row.total_coins || 0),
    })),
  }
}

async function attachRoomMessageReactions(messages, userId) {
  return attachReactionSummaries(messages, 'chat_message_reactions', userId)
}

async function attachDirectMessageReactions(messages, userId) {
  return attachReactionSummaries(messages, 'direct_message_reactions', userId)
}

async function fetchChatMessageById(messageId, userId) {
  const messages = await query(`${messageSelectSql()} WHERE cm.id = :id LIMIT 1`, { id: messageId })
  const hydratedMessages = await hydrateRoomMessages(messages, userId)
  return hydratedMessages[0] || null
}

function userHasTenantModerationRole(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : []
  return roles.some((role) => ['super_admin', 'client_admin', 'admin', 'moderator'].includes(
    typeof role === 'string' ? role : role?.name
  ))
}

async function canDeleteMessageForEveryone(message, user) {
  if (Number(message.sender_id) === Number(user.id)) return true
  if (userHasTenantModerationRole(user)) return true

  const roles = await query(
    `
    SELECT role
    FROM room_roles
    WHERE room_id = :roomId
    AND user_id = :userId
    AND role IN ('owner', 'admin', 'moderator')
    LIMIT 1
    `,
    { roomId: message.room_id, userId: user.id }
  )

  return roles.length > 0
}

async function findRoomForChat(roomId) {
  const rooms = await query(
    `
    SELECT *
    FROM rooms
    WHERE id = :roomId
    LIMIT 1
    `,
    { roomId }
  )

  return rooms[0] || null
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

function deterministicSignalingRoom(room) {
  if (!room?.tenant_id || !room?.id) return ''
  return `webrtc_tenant_${room.tenant_id}_room_${room.id}`
}

async function emitRoomRealtime(req, room, eventName, payload = {}) {
  const io = req.app?.get('io')
  if (!io || !room?.id || !eventName) return false

  const channels = new Set(await findActiveSignalingRooms(room.id))
  const fallbackChannel = deterministicSignalingRoom(room)
  if (fallbackChannel) channels.add(fallbackChannel)
  if (!channels.size) return false

  const realtimePayload = {
    ...payload,
    source: 'http',
  }

  channels.forEach((channel) => {
    io.to(String(channel)).emit(eventName, realtimePayload)
  })

  return true
}

async function broadcastRoomChatMessage(req, room, message, extraPayload = {}) {
  if (!message?.id) return false
  return emitRoomRealtime(req, room, 'chat-message', { message, ...extraPayload })
}

async function blockedUserIdsForRoom(roomId, userId) {
  const blockedRows = await query(
    `
    SELECT blocked_user_id
    FROM chat_user_blocks
    WHERE room_id = :roomId
    AND blocker_id = :userId
    `,
    { roomId, userId }
  )

  return blockedRows.map((row) => Number(row.blocked_user_id)).filter(Boolean)
}

async function findUserForDirectMessage(userId, tenantId) {
  const users = await query(
    `
    SELECT id, name, avatar_url, gender
    FROM users
    WHERE id = :userId
    AND tenant_id = :tenantId
    LIMIT 1
    `,
    { userId, tenantId }
  )

  return users[0] || null
}

async function findFollowableUser(userId, tenantId) {
  const users = await query(
    `
    SELECT id, name, avatar_url, gender
    FROM users
    WHERE id = :userId
    AND tenant_id = :tenantId
    AND status = 'active'
    LIMIT 1
    `,
    { userId, tenantId }
  )

  return users[0] || null
}

async function userFollowsPeer(followerId, peerId, tenantId) {
  if (!followerId || !peerId || Number(followerId) === Number(peerId)) return false

  const rows = await query(
    `
    SELECT id
    FROM user_follows
    WHERE tenant_id = :tenantId
    AND follower_id = :followerId
    AND followed_user_id = :peerId
    LIMIT 1
    `,
    { tenantId, followerId, peerId }
  )

  return rows.length > 0
}

async function usersHaveDirectMessageRelationship(userId, peerId, tenantId) {
  if (!userId || !peerId || Number(userId) === Number(peerId)) return false

  const rows = await query(
    `
    SELECT id
    FROM user_follows
    WHERE tenant_id = :tenantId
    AND (
      (follower_id = :userId AND followed_user_id = :peerId)
      OR (follower_id = :peerId AND followed_user_id = :userId)
    )
    LIMIT 1
    `,
    { tenantId, userId, peerId }
  )

  return rows.length > 0
}

function userSocketRoom(userId) {
  return `user:${Number(userId || 0)}`
}

function emitUserRealtime(req, userId, eventName, payload) {
  const io = req.app?.get('io')
  if (!io || !userId) return false
  io.to(userSocketRoom(userId)).emit(eventName, payload)
  return true
}

function emitDirectMessageRealtime(req, message, eventName, payload = {}) {
  if (!message?.sender_id || !message?.recipient_id) return false

  emitUserRealtime(req, message.sender_id, eventName, payload)
  emitUserRealtime(req, message.recipient_id, eventName, payload)
  return true
}

async function findDirectMessageForUser(messageId, user) {
  const messages = await query(
    `
    SELECT *
    FROM direct_messages
    WHERE id = :messageId
    AND tenant_id = :tenantId
    AND (sender_id = :userId OR recipient_id = :userId)
    LIMIT 1
    `,
    { messageId, tenantId: user.tenant_id, userId: user.id }
  )

  return messages[0] || null
}

async function fetchDirectMessageById(messageId, userId = null) {
  const messages = await query(`${directMessageSelectSql()} WHERE dm.id = :id LIMIT 1`, { id: messageId })
  const hydratedMessages = userId
    ? await attachDirectMessageReactions(messages, userId)
    : messages
  return hydratedMessages[0] || null
}

function mapFollowRequest(row) {
  if (!row) return null

  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    requester_id: Number(row.requester_id),
    recipient_id: Number(row.recipient_id),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    responded_at: row.responded_at,
    requester: {
      id: Number(row.requester_id),
      name: row.requester_name,
      avatar_url: row.requester_avatar_url,
      gender: row.requester_gender,
    },
    recipient: {
      id: Number(row.recipient_id),
      name: row.recipient_name,
      avatar_url: row.recipient_avatar_url,
      gender: row.recipient_gender,
    },
  }
}

function followRequestSelectSql() {
  return `
    SELECT
      fr.*,
      requester.name AS requester_name,
      requester.avatar_url AS requester_avatar_url,
      requester.gender AS requester_gender,
      recipient.name AS recipient_name,
      recipient.avatar_url AS recipient_avatar_url,
      recipient.gender AS recipient_gender
    FROM user_follow_requests fr
    LEFT JOIN users requester ON requester.id = fr.requester_id
    LEFT JOIN users recipient ON recipient.id = fr.recipient_id
  `
}

async function findFollowRequestById(requestId, tenantId) {
  const rows = await query(
    `
    ${followRequestSelectSql()}
    WHERE fr.id = :requestId
    AND fr.tenant_id = :tenantId
    LIMIT 1
    `,
    { requestId, tenantId }
  )

  return mapFollowRequest(rows[0])
}

async function createOrRefreshFollowRequest(requesterId, recipientId, tenantId) {
  await query(
    `
    INSERT INTO user_follow_requests (tenant_id, requester_id, recipient_id, status, responded_at)
    VALUES (:tenantId, :requesterId, :recipientId, 'pending', NULL)
    ON DUPLICATE KEY UPDATE
      status = IF(status = 'accepted', status, 'pending'),
      responded_at = IF(status = 'accepted', responded_at, NULL),
      updated_at = CURRENT_TIMESTAMP
    `,
    { tenantId, requesterId, recipientId }
  )

  const rows = await query(
    `
    ${followRequestSelectSql()}
    WHERE fr.tenant_id = :tenantId
    AND fr.requester_id = :requesterId
    AND fr.recipient_id = :recipientId
    LIMIT 1
    `,
    { tenantId, requesterId, recipientId }
  )

  return mapFollowRequest(rows[0])
}

router.get('/rooms/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const roomId = parsePositiveInteger(req.params.id)
    const limit = Math.min(100, parsePositiveInteger(req.query.limit, 50) || 50)
    const afterId = parsePositiveInteger(req.query.after_id)

    if (!roomId) return res.status(422).json({ message: 'Invalid room ID.' })

    const room = await findRoomForChat(roomId)
    if (!room) return res.status(404).json({ message: 'Room not found.' })
    if (Number(room.tenant_id) !== Number(req.user.tenant_id)) return res.status(404).json({ message: 'Room not found.' })
    const blockedUserIds = await blockedUserIdsForRoom(roomId, req.user.id)

    const params = { tenantId: room.tenant_id, roomId, userId: req.user.id }
    if (afterId) params.afterId = afterId

    const messages = await query(
      `
      ${messageSelectSql()}
      WHERE cm.tenant_id = :tenantId
      AND cm.room_id = :roomId
      ${afterId ? 'AND cm.id > :afterId' : ''}
      AND cm.is_deleted = 0
      AND NOT EXISTS (
        SELECT 1
        FROM chat_message_hides hidden
        WHERE hidden.message_id = cm.id
        AND hidden.user_id = :userId
      )
      AND NOT EXISTS (
        SELECT 1
        FROM chat_user_blocks blocked
        WHERE blocked.room_id = cm.room_id
        AND blocked.blocker_id = :userId
        AND blocked.blocked_user_id = cm.sender_id
      )
      ORDER BY cm.id DESC
      LIMIT ${limit}
      `,
      params
    )

    const hydratedMessages = await hydrateRoomMessages(messages.reverse(), req.user.id)
    const giftSummary = await roomGiftSummary(roomId, room.tenant_id, req.user.id)

    return res.json({
      messages: hydratedMessages,
      meta: {
        limit,
        chat_enabled: Boolean(Number(room.chat_enabled)),
        gift_enabled: Boolean(Number(room.gift_enabled)),
        gift_summary: giftSummary,
        blocked_user_ids: blockedUserIds,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/rooms/:id/gifts/summary', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const roomId = parsePositiveInteger(req.params.id)
    if (!roomId) return res.status(422).json({ message: 'Invalid room ID.' })

    const room = await findRoomForChat(roomId)
    if (!room || Number(room.tenant_id) !== Number(req.user.tenant_id)) {
      return res.status(404).json({ message: 'Room not found.' })
    }

    return res.json({
      room_id: roomId,
      gift_enabled: Boolean(Number(room.gift_enabled)),
      gift_summary: await roomGiftSummary(roomId, room.tenant_id, req.user.id),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/rooms/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const roomId = parsePositiveInteger(req.params.id)
    const body = cleanMessageBody(req.body?.message_body).trim()
    const messageType = String(req.body?.message_type || 'text').trim()
    const mediaUrl = cleanMediaUrl(req.body?.media_url)
    const parentMessageId = parsePositiveInteger(req.body?.parent_message_id)
    const gift = messageType === 'gift' ? giftForPayload(req.body, body, mediaUrl) : null
    const giftQuantity = messageType === 'gift' ? parseGiftQuantity(req.body?.quantity) : 1

    if (!roomId) return res.status(422).json({ message: 'Invalid room ID.' })

    if (body.length > 1200) return res.status(422).json({ message: 'Message body must be 1200 characters or fewer.' })
    if (!validMessageTypes.has(messageType)) return res.status(422).json({ message: 'Invalid message type.' })

    if (messageType === 'image') {
      const mediaError = imageMediaError(mediaUrl)
      if (mediaError) return res.status(422).json({ message: mediaError })
    } else if (messageType === 'voice') {
      const mediaError = audioMediaError(mediaUrl)
      if (mediaError) return res.status(422).json({ message: mediaError })
    } else if (messageType === 'gift') {
      if (!gift) return res.status(422).json({ message: 'Choose a valid gift before sending.' })
      if (!giftQuantity) return res.status(422).json({ message: 'Gift quantity must be between 1 and 99.' })
    } else if (!body) {
      return res.status(422).json({ message: 'Message body is required.' })
    }

    const room = await findRoomForChat(roomId)

    if (!room) return res.status(404).json({ message: 'Room not found.' })
    if (Number(room.tenant_id) !== Number(req.user.tenant_id)) return res.status(404).json({ message: 'Room not found.' })

    if (!room.chat_enabled) {
      return res.status(403).json({ message: 'Chat is disabled in this room.' })
    }
    if (messageType === 'gift' && !room.gift_enabled) {
      return res.status(403).json({ message: 'Gifts are disabled in this room.' })
    }
    if (Number(room.ai_security_enabled)) {
      const securityError = aiMessageSecurityError(body, messageType)
      if (securityError) return res.status(422).json({ message: securityError })
    }

    const messageBody = messageType === 'gift'
      ? giftMessageBody(gift, giftQuantity)
      : messageType === 'image'
        ? (body || 'sent a photo')
        : messageType === 'voice' ? (body || 'sent a voice message') : body
    const messageMediaUrl = messageType === 'gift'
      ? gift.id
      : ['image', 'voice'].includes(messageType) ? mediaUrl : mediaUrl || null

    const result = messageType === 'gift'
      ? await transaction(async (connection) => {
        const [messageResult] = await connection.execute(
          `
          INSERT INTO chat_messages (
            tenant_id, room_id, session_id, sender_id, parent_message_id,
            message_type, message_body, media_url, is_deleted, is_unsent,
            created_at, updated_at
          )
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, NOW(), NOW())
          `,
          [room.tenant_id, roomId, req.user.id, parentMessageId, messageType, messageBody, messageMediaUrl]
        )

        await connection.execute(
          `
          INSERT INTO room_gift_transactions (
            tenant_id, room_id, message_id, sender_id, owner_user_id,
            gift_id, gift_label, gift_emoji, coin_value, quantity, total_coins, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          `,
          [
            room.tenant_id,
            roomId,
            messageResult.insertId,
            req.user.id,
            room.owner_id,
            gift.id,
            gift.label,
            gift.emoji,
            gift.coin_value,
            giftQuantity,
            gift.coin_value * giftQuantity,
          ]
        )

        return messageResult
      })
      : await query(
        `
        INSERT INTO chat_messages (
          tenant_id, room_id, session_id, sender_id, parent_message_id,
          message_type, message_body, media_url, is_deleted, is_unsent,
          created_at, updated_at
        )
        VALUES (
          :tenantId, :roomId, NULL, :senderId, :parentMessageId,
          :messageType, :messageBody, :mediaUrl, 0, 0, NOW(), NOW()
        )
        `,
        {
          tenantId: room.tenant_id,
          roomId,
          senderId: req.user.id,
          parentMessageId,
          messageType,
          messageBody,
          mediaUrl: messageMediaUrl,
        }
      )

    const chatMessage = await fetchChatMessageById(result.insertId, req.user.id)
    const giftSummary = messageType === 'gift'
      ? await roomGiftSummary(roomId, room.tenant_id, req.user.id)
      : null
    let realtimeBroadcasted = false

    try {
      realtimeBroadcasted = await broadcastRoomChatMessage(
        req,
        room,
        chatMessage,
        giftSummary ? { gift_summary: giftSummary } : {}
      )
    } catch (broadcastError) {
      console.error('[chat] realtime broadcast failed', broadcastError)
    }

    return res.status(201).json({
      message: 'Message sent successfully',
      chat_message: chatMessage,
      ...(giftSummary ? { gift_summary: giftSummary } : {}),
      realtime_broadcasted: realtimeBroadcasted,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/messages/:id/reactions', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const messageId = parsePositiveInteger(req.params.id)
    const emoji = cleanReactionEmoji(req.body?.emoji)

    if (!messageId) return res.status(422).json({ message: 'Invalid message ID.' })
    const emojiError = reactionEmojiError(emoji)
    if (emojiError) return res.status(422).json({ message: emojiError })

    const messages = await query(
      `
      SELECT *
      FROM chat_messages
      WHERE id = :messageId
      AND tenant_id = :tenantId
      LIMIT 1
      `,
      { messageId, tenantId: req.user.tenant_id }
    )

    if (!messages.length) return res.status(404).json({ message: 'Message not found.' })
    const message = messages[0]

    if (Number(message.is_deleted) || Number(message.is_unsent)) {
      return res.status(422).json({ message: 'Deleted messages cannot be reacted to.' })
    }

    const room = await findRoomForChat(message.room_id)
    if (!room || Number(room.tenant_id) !== Number(req.user.tenant_id)) {
      return res.status(404).json({ message: 'Room not found.' })
    }

    const existingReactions = await query(
      `
      SELECT id
      FROM chat_message_reactions
      WHERE message_id = :messageId
      AND user_id = :userId
      AND emoji = :emoji
      LIMIT 1
      `,
      { messageId, userId: req.user.id, emoji }
    )

    const reacted = existingReactions.length === 0

    if (reacted) {
      await query(
        `
        INSERT IGNORE INTO chat_message_reactions (
          tenant_id, room_id, message_id, user_id, emoji, created_at
        )
        VALUES (
          :tenantId, :roomId, :messageId, :userId, :emoji, NOW()
        )
        `,
        {
          tenantId: req.user.tenant_id,
          roomId: message.room_id,
          messageId,
          userId: req.user.id,
          emoji,
        }
      )
    } else {
      await query(
        `
        DELETE FROM chat_message_reactions
        WHERE id = :reactionId
        AND user_id = :userId
        `,
        { reactionId: existingReactions[0].id, userId: req.user.id }
      )
    }

    const updatedMessage = await fetchChatMessageById(messageId, req.user.id)
    const realtimePayload = {
      message_id: updatedMessage.id,
      room_id: updatedMessage.room_id,
      emoji,
      reacted,
      reactions: updatedMessage.reactions,
      reaction_count: updatedMessage.reaction_count,
      message: updatedMessage,
    }
    let realtimeBroadcasted = false

    try {
      realtimeBroadcasted = await emitRoomRealtime(req, room, 'chat-message-reaction', realtimePayload)
    } catch (broadcastError) {
      console.error('[chat] realtime reaction broadcast failed', broadcastError)
    }

    return res.json({
      message: reacted ? 'Reaction added.' : 'Reaction removed.',
      reacted,
      chat_message: updatedMessage,
      reactions: updatedMessage.reactions,
      reaction_count: updatedMessage.reaction_count,
      realtime_broadcasted: realtimeBroadcasted,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/rooms/:id/blocks', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const roomId = parsePositiveInteger(req.params.id)
    const blockedUserId = parsePositiveInteger(req.body?.blocked_user_id)

    if (!roomId) return res.status(422).json({ message: 'Invalid room ID.' })
    if (!blockedUserId) return res.status(422).json({ message: 'Choose a user to block.' })
    if (Number(blockedUserId) === Number(req.user.id)) {
      return res.status(422).json({ message: 'You cannot block yourself.' })
    }

    const room = await findRoomForChat(roomId)
    if (!room) return res.status(404).json({ message: 'Room not found.' })

    const users = await query(
      `
      SELECT id
      FROM users
      WHERE id = :blockedUserId
      LIMIT 1
      `,
      { blockedUserId }
    )

    if (!users.length) return res.status(404).json({ message: 'User not found.' })

    await query(
      `
      INSERT IGNORE INTO chat_user_blocks (
        tenant_id, room_id, blocker_id, blocked_user_id, blocked_at
      )
      VALUES (
        :tenantId, :roomId, :blockerId, :blockedUserId, NOW()
      )
      `,
      {
        tenantId: room.tenant_id,
        roomId,
        blockerId: req.user.id,
        blockedUserId,
      }
    )

    return res.status(201).json({
      message: 'User blocked for this room.',
      room_id: roomId,
      blocked_user_id: blockedUserId,
    })
  } catch (error) {
    next(error)
  }
})

async function requestFollow(req, res, next) {
  try {
    await ensureChatSchema()

    const peerId = parsePositiveInteger(req.params.userId)
    if (!peerId) return res.status(422).json({ message: 'Invalid user ID.' })
    if (Number(peerId) === Number(req.user.id)) return res.status(422).json({ message: 'You cannot follow yourself.' })

    const peer = await findFollowableUser(peerId, req.user.tenant_id)
    if (!peer) return res.status(404).json({ message: 'User not found.' })

    const alreadyFollowing = await userFollowsPeer(req.user.id, peerId, req.user.tenant_id)
    if (alreadyFollowing) {
      return res.status(200).json({
        message: 'Already following.',
        following: true,
        peer,
      })
    }

    const request = await createOrRefreshFollowRequest(req.user.id, peerId, req.user.tenant_id)
    emitUserRealtime(req, peerId, 'follow-request-received', { request })

    return res.status(201).json({
      message: 'Follow request sent.',
      following: false,
      requested: true,
      peer,
      request,
    })
  } catch (error) {
    next(error)
  }
}

router.post('/users/:userId/follow', authMiddleware, requestFollow)
router.post('/users/:userId/follow-requests', authMiddleware, requestFollow)

router.delete('/users/:userId/follow', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const peerId = parsePositiveInteger(req.params.userId)
    if (!peerId) return res.status(422).json({ message: 'Invalid user ID.' })

    await query(
      `
      DELETE FROM user_follows
      WHERE tenant_id = :tenantId
      AND follower_id = :followerId
      AND followed_user_id = :peerId
      `,
      { tenantId: req.user.tenant_id, followerId: req.user.id, peerId }
    )

    return res.json({
      message: 'User unfollowed.',
      following: false,
      peer_id: peerId,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/follow-requests', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const [requestRows, followingRows] = await Promise.all([
      query(
        `
        ${followRequestSelectSql()}
        WHERE fr.tenant_id = :tenantId
        AND fr.status = 'pending'
        AND (fr.requester_id = :userId OR fr.recipient_id = :userId)
        ORDER BY fr.updated_at DESC, fr.id DESC
        LIMIT 120
        `,
        { tenantId: req.user.tenant_id, userId: req.user.id }
      ),
      query(
        `
        SELECT followed_user_id
        FROM user_follows
        WHERE tenant_id = :tenantId
        AND follower_id = :userId
        `,
        { tenantId: req.user.tenant_id, userId: req.user.id }
      ),
    ])

    const requests = requestRows.map(mapFollowRequest).filter(Boolean)

    return res.json({
      incoming: requests.filter((request) => Number(request.recipient_id) === Number(req.user.id)),
      outgoing: requests.filter((request) => Number(request.requester_id) === Number(req.user.id)),
      following_user_ids: followingRows.map((row) => Number(row.followed_user_id)).filter(Boolean),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/follow-requests/:id/accept', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const requestId = parsePositiveInteger(req.params.id)
    if (!requestId) return res.status(422).json({ message: 'Invalid follow request ID.' })

    const request = await findFollowRequestById(requestId, req.user.tenant_id)
    if (!request) return res.status(404).json({ message: 'Follow request not found.' })
    if (Number(request.recipient_id) !== Number(req.user.id)) return res.status(403).json({ message: 'Only the recipient can accept this request.' })
    if (request.status !== 'pending') return res.status(409).json({ message: 'This follow request is no longer pending.' })

    await query(
      `
      UPDATE user_follow_requests
      SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
      WHERE id = :requestId
      AND tenant_id = :tenantId
      AND recipient_id = :recipientId
      `,
      { requestId, tenantId: req.user.tenant_id, recipientId: req.user.id }
    )

    await query(
      `
      INSERT INTO user_follows (tenant_id, follower_id, followed_user_id)
      VALUES
        (:tenantId, :requesterId, :recipientId),
        (:tenantId, :recipientId, :requesterId)
      ON DUPLICATE KEY UPDATE created_at = created_at
      `,
      {
        tenantId: req.user.tenant_id,
        requesterId: request.requester_id,
        recipientId: request.recipient_id,
      }
    )

    const acceptedRequest = await findFollowRequestById(requestId, req.user.tenant_id)
    emitUserRealtime(req, request.requester_id, 'follow-request-accepted', { request: acceptedRequest })

    return res.json({
      message: 'Follow request accepted.',
      request: acceptedRequest,
      following_user_ids: [Number(request.requester_id)],
    })
  } catch (error) {
    next(error)
  }
})

router.post('/follow-requests/:id/reject', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const requestId = parsePositiveInteger(req.params.id)
    if (!requestId) return res.status(422).json({ message: 'Invalid follow request ID.' })

    const request = await findFollowRequestById(requestId, req.user.tenant_id)
    if (!request) return res.status(404).json({ message: 'Follow request not found.' })
    if (Number(request.recipient_id) !== Number(req.user.id)) return res.status(403).json({ message: 'Only the recipient can reject this request.' })
    if (request.status !== 'pending') return res.status(409).json({ message: 'This follow request is no longer pending.' })

    await query(
      `
      UPDATE user_follow_requests
      SET status = 'rejected', responded_at = CURRENT_TIMESTAMP
      WHERE id = :requestId
      AND tenant_id = :tenantId
      AND recipient_id = :recipientId
      `,
      { requestId, tenantId: req.user.tenant_id, recipientId: req.user.id }
    )

    const rejectedRequest = await findFollowRequestById(requestId, req.user.tenant_id)
    emitUserRealtime(req, request.requester_id, 'follow-request-rejected', { request: rejectedRequest })

    return res.json({
      message: 'Follow request rejected.',
      request: rejectedRequest,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/direct-messages/threads', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const rows = await query(
      `
      SELECT
        latest.peer_id,
        peer.name AS peer_name,
        peer.avatar_url AS peer_avatar_url,
        peer.gender AS peer_gender,
        dm.id AS last_message_id,
        dm.sender_id,
        dm.recipient_id,
        dm.message_type,
        dm.message_body,
        dm.media_url,
        dm.created_at,
        dm.updated_at
      FROM (
        SELECT
          CASE WHEN sender_id = :userId THEN recipient_id ELSE sender_id END AS peer_id,
          MAX(id) AS last_message_id
        FROM direct_messages
        WHERE tenant_id = :tenantId
        AND is_deleted = 0
        AND (sender_id = :userId OR recipient_id = :userId)
        AND NOT EXISTS (
          SELECT 1
          FROM direct_message_hides hidden
          WHERE hidden.message_id = direct_messages.id
          AND hidden.user_id = :userId
        )
        GROUP BY peer_id
      ) latest
      INNER JOIN direct_messages dm ON dm.id = latest.last_message_id
      INNER JOIN users peer ON peer.id = latest.peer_id
      WHERE EXISTS (
        SELECT 1
        FROM user_follows uf
        WHERE uf.tenant_id = :tenantId
        AND (
          (uf.follower_id = :userId AND uf.followed_user_id = latest.peer_id)
          OR (uf.follower_id = latest.peer_id AND uf.followed_user_id = :userId)
        )
      )
      ORDER BY dm.id DESC
      LIMIT 40
      `,
      { tenantId: req.user.tenant_id, userId: req.user.id }
    )

    return res.json({
      threads: rows.map((row) => ({
        peer_id: Number(row.peer_id),
        peer_name: row.peer_name,
        peer_avatar_url: row.peer_avatar_url,
        peer_gender: row.peer_gender,
        last_message: row,
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.get('/direct-messages/contacts', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const rows = await query(
      `
      SELECT
        u.id AS peer_id,
        u.name AS peer_name,
        u.avatar_url AS peer_avatar_url,
        u.gender AS peer_gender,
        contacts.following,
        contacts.follower,
        dm.id AS last_message_id,
        dm.sender_id,
        dm.recipient_id,
        dm.message_type,
        dm.message_body,
        dm.media_url,
        dm.created_at,
        dm.updated_at
      FROM (
        SELECT
          contact_edges.peer_id,
          MAX(contact_edges.following) AS following,
          MAX(contact_edges.follower) AS follower
        FROM (
          SELECT followed_user_id AS peer_id, 1 AS following, 0 AS follower
          FROM user_follows
          WHERE tenant_id = :tenantId
          AND follower_id = :userId
          UNION ALL
          SELECT follower_id AS peer_id, 0 AS following, 1 AS follower
          FROM user_follows
          WHERE tenant_id = :tenantId
          AND followed_user_id = :userId
        ) contact_edges
        GROUP BY contact_edges.peer_id
      ) contacts
      INNER JOIN users u ON u.id = contacts.peer_id
      LEFT JOIN (
        SELECT paired.peer_id, MAX(paired.id) AS last_message_id
        FROM (
          SELECT
            CASE WHEN sender_id = :userId THEN recipient_id ELSE sender_id END AS peer_id,
            id
          FROM direct_messages
          WHERE tenant_id = :tenantId
          AND is_deleted = 0
          AND (sender_id = :userId OR recipient_id = :userId)
          AND NOT EXISTS (
            SELECT 1
            FROM direct_message_hides hidden
            WHERE hidden.message_id = direct_messages.id
            AND hidden.user_id = :userId
          )
        ) paired
        GROUP BY paired.peer_id
      ) latest ON latest.peer_id = u.id
      LEFT JOIN direct_messages dm ON dm.id = latest.last_message_id
      WHERE u.tenant_id = :tenantId
      AND u.status = 'active'
      AND u.id <> :userId
      ORDER BY
        CASE WHEN latest.last_message_id IS NULL THEN 1 ELSE 0 END,
        latest.last_message_id DESC,
        u.name ASC,
        u.id ASC
      LIMIT 120
      `,
      { tenantId: req.user.tenant_id, userId: req.user.id }
    )

    return res.json({
      contacts: rows.map((row) => ({
        peer_id: Number(row.peer_id),
        peer_name: row.peer_name,
        peer_avatar_url: row.peer_avatar_url,
        peer_gender: row.peer_gender,
        following: Boolean(Number(row.following || 0)),
        follower: Boolean(Number(row.follower || 0)),
        mutual: Boolean(Number(row.following || 0) && Number(row.follower || 0)),
        last_message: row.last_message_id ? row : null,
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/direct-messages/messages/:id', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const messageId = parsePositiveInteger(req.params.id)
    const body = cleanMessageBody(req.body?.message_body).trim()

    if (!messageId) return res.status(422).json({ message: 'Invalid message ID.' })
    if (!body) return res.status(422).json({ message: 'Message body is required.' })
    if (body.length > 1200) return res.status(422).json({ message: 'Message body must be 1200 characters or fewer.' })

    const message = await findDirectMessageForUser(messageId, req.user)
    if (!message) return res.status(404).json({ message: 'Message not found.' })
    if (Number(message.sender_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'You can only edit your own message.' })
    }
    if (Number(message.is_deleted)) {
      return res.status(422).json({ message: 'Deleted messages cannot be edited.' })
    }
    if (message.message_type !== 'text') {
      return res.status(422).json({ message: 'Only text messages can be edited.' })
    }
    const securityError = aiMessageSecurityError(body, 'text')
    if (securityError) return res.status(422).json({ message: securityError })

    await query(
      `
      UPDATE direct_messages
      SET message_body = :messageBody,
          updated_at = NOW()
      WHERE id = :messageId
      `,
      { messageBody: body, messageId }
    )

    const directMessage = await fetchDirectMessageById(messageId, req.user.id)
    emitDirectMessageRealtime(req, directMessage, 'direct-message-edited', {
      direct_message: directMessage,
    })

    return res.json({
      message: 'Direct message updated successfully.',
      direct_message: directMessage,
    })
  } catch (error) {
    next(error)
  }
})

router.delete('/direct-messages/messages/:id', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const messageId = parsePositiveInteger(req.params.id)
    const deleteForEveryone = req.body?.for_everyone !== false

    if (!messageId) return res.status(422).json({ message: 'Invalid message ID.' })

    const message = await findDirectMessageForUser(messageId, req.user)
    if (!message) return res.status(404).json({ message: 'Message not found.' })

    if (!deleteForEveryone) {
      await query(
        `
        INSERT IGNORE INTO direct_message_hides (message_id, user_id, hidden_at)
        VALUES (:messageId, :userId, NOW())
        `,
        { messageId, userId: req.user.id }
      )

      return res.json({
        message: 'Message hidden from your inbox.',
        message_id: message.id,
        deleted_for_everyone: false,
      })
    }

    if (Number(message.sender_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Only the sender can delete this message for everyone.' })
    }

    await query(
      `
      UPDATE direct_messages
      SET is_deleted = 1,
          message_body = NULL,
          media_url = NULL,
          updated_at = NOW()
      WHERE id = :messageId
      `,
      { messageId }
    )

    emitDirectMessageRealtime(req, message, 'direct-message-deleted', {
      message_id: message.id,
      deleted_for_everyone: true,
    })

    return res.json({
      message: 'Direct message deleted successfully.',
      message_id: message.id,
      deleted_for_everyone: true,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/direct-messages/messages/:id/reactions', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const messageId = parsePositiveInteger(req.params.id)
    const emoji = cleanReactionEmoji(req.body?.emoji)

    if (!messageId) return res.status(422).json({ message: 'Invalid message ID.' })
    const emojiError = reactionEmojiError(emoji)
    if (emojiError) return res.status(422).json({ message: emojiError })

    const message = await findDirectMessageForUser(messageId, req.user)
    if (!message || Number(message.is_deleted)) return res.status(404).json({ message: 'Message not found.' })

    const existingReactions = await query(
      `
      SELECT id
      FROM direct_message_reactions
      WHERE message_id = :messageId
      AND user_id = :userId
      AND emoji = :emoji
      LIMIT 1
      `,
      { messageId, userId: req.user.id, emoji }
    )

    const reacted = existingReactions.length === 0

    if (reacted) {
      await query(
        `
        INSERT IGNORE INTO direct_message_reactions (
          tenant_id, message_id, user_id, emoji, created_at
        )
        VALUES (
          :tenantId, :messageId, :userId, :emoji, NOW()
        )
        `,
        {
          tenantId: req.user.tenant_id,
          messageId,
          userId: req.user.id,
          emoji,
        }
      )
    } else {
      await query(
        `
        DELETE FROM direct_message_reactions
        WHERE id = :reactionId
        AND user_id = :userId
        `,
        { reactionId: existingReactions[0].id, userId: req.user.id }
      )
    }

    const directMessage = await fetchDirectMessageById(messageId, req.user.id)
    const realtimePayload = {
      source: 'http',
      message_id: directMessage.id,
      emoji,
      reacted,
      reactions: directMessage.reactions,
      reaction_count: directMessage.reaction_count,
      direct_message: directMessage,
      message: directMessage,
    }

    emitDirectMessageRealtime(req, directMessage, 'direct-message-reaction', realtimePayload)

    return res.json({
      message: reacted ? 'Reaction added.' : 'Reaction removed.',
      reacted,
      direct_message: directMessage,
      reactions: directMessage.reactions,
      reaction_count: directMessage.reaction_count,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/direct-messages/:userId', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const peerId = parsePositiveInteger(req.params.userId)
    const limit = Math.min(100, parsePositiveInteger(req.query.limit, 50) || 50)

    if (!peerId) return res.status(422).json({ message: 'Invalid user ID.' })

    const peer = await findUserForDirectMessage(peerId, req.user.tenant_id)
    if (!peer) return res.status(404).json({ message: 'User not found.' })
    const canMessagePeer = await usersHaveDirectMessageRelationship(req.user.id, peerId, req.user.tenant_id)
    if (!canMessagePeer) return res.status(403).json({ message: 'Follow this user or accept their follow before starting a private chat.' })

    const messages = await query(
      `
      ${directMessageSelectSql()}
      WHERE dm.tenant_id = :tenantId
      AND dm.is_deleted = 0
      AND NOT EXISTS (
        SELECT 1
        FROM direct_message_hides hidden
        WHERE hidden.message_id = dm.id
        AND hidden.user_id = :userId
      )
      AND (
        (dm.sender_id = :userId AND dm.recipient_id = :peerId)
        OR (dm.sender_id = :peerId AND dm.recipient_id = :userId)
      )
      ORDER BY dm.id DESC
      LIMIT ${limit}
      `,
      { tenantId: req.user.tenant_id, userId: req.user.id, peerId }
    )

    const hydratedMessages = await attachDirectMessageReactions(messages.reverse(), req.user.id)

    return res.json({
      peer,
      messages: hydratedMessages,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/direct-messages/:userId', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const peerId = parsePositiveInteger(req.params.userId)
    const body = cleanMessageBody(req.body?.message_body).trim()
    const messageType = String(req.body?.message_type || 'text').trim()
    const mediaUrl = cleanMediaUrl(req.body?.media_url)

    if (!peerId) return res.status(422).json({ message: 'Invalid user ID.' })
    if (Number(peerId) === Number(req.user.id)) return res.status(422).json({ message: 'You cannot message yourself.' })
    if (!['text', 'image', 'voice'].includes(messageType)) return res.status(422).json({ message: 'Invalid message type.' })
    if (body.length > 1200) return res.status(422).json({ message: 'Message body must be 1200 characters or fewer.' })

    if (messageType === 'image') {
      const mediaError = imageMediaError(mediaUrl)
      if (mediaError) return res.status(422).json({ message: mediaError })
    } else if (messageType === 'voice') {
      const mediaError = audioMediaError(mediaUrl)
      if (mediaError) return res.status(422).json({ message: mediaError })
    } else if (!body) {
      return res.status(422).json({ message: 'Message body is required.' })
    }
    const securityError = aiMessageSecurityError(body, messageType)
    if (securityError) return res.status(422).json({ message: securityError })

    const peer = await findUserForDirectMessage(peerId, req.user.tenant_id)
    if (!peer) return res.status(404).json({ message: 'User not found.' })
    const canMessagePeer = await usersHaveDirectMessageRelationship(req.user.id, peerId, req.user.tenant_id)
    if (!canMessagePeer) return res.status(403).json({ message: 'Follow this user or accept their follow before sending a private message.' })

    const result = await query(
      `
      INSERT INTO direct_messages (
        tenant_id, sender_id, recipient_id, message_type, message_body,
        media_url, is_deleted, created_at, updated_at
      )
      VALUES (
        :tenantId, :senderId, :recipientId, :messageType, :messageBody,
        :mediaUrl, 0, NOW(), NOW()
      )
      `,
      {
        tenantId: req.user.tenant_id,
        senderId: req.user.id,
        recipientId: peerId,
        messageType,
        messageBody: messageType === 'image'
          ? (body || 'sent a photo')
          : messageType === 'voice' ? (body || 'sent a voice message') : body,
        mediaUrl: ['image', 'voice'].includes(messageType) ? mediaUrl : null,
      }
    )

    const directMessage = await fetchDirectMessageById(result.insertId, req.user.id)
    const realtimePayload = {
      direct_message: directMessage,
      peer,
    }

    emitUserRealtime(req, peerId, 'direct-message', realtimePayload)
    emitUserRealtime(req, req.user.id, 'direct-message', realtimePayload)

    return res.status(201).json({
      message: 'Direct message sent.',
      direct_message: directMessage,
      peer,
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/messages/:id', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const messageId = parsePositiveInteger(req.params.id)
    const body = cleanMessageBody(req.body?.message_body).trim()

    if (!messageId) return res.status(422).json({ message: 'Invalid message ID.' })
    if (!body) return res.status(422).json({ message: 'Message body is required.' })
    if (body.length > 1200) return res.status(422).json({ message: 'Message body must be 1200 characters or fewer.' })

    const messages = await query(
      `
      SELECT *
      FROM chat_messages
      WHERE id = :messageId
      AND tenant_id = :tenantId
      LIMIT 1
      `,
      { messageId, tenantId: req.user.tenant_id }
    )

    if (!messages.length) return res.status(404).json({ message: 'Message not found.' })

    const message = messages[0]

    if (Number(message.sender_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'You can only edit your own message.' })
    }

    if (Number(message.is_deleted) || Number(message.is_unsent)) {
      return res.status(422).json({ message: 'Deleted messages cannot be edited.' })
    }

    if (message.message_type !== 'text') {
      return res.status(422).json({ message: 'Only text messages can be edited.' })
    }

    const room = await findRoomForChat(message.room_id)
    if (Number(room?.ai_security_enabled)) {
      const securityError = aiMessageSecurityError(body, 'text')
      if (securityError) return res.status(422).json({ message: securityError })
    }

    await query(
      `
      UPDATE chat_messages
      SET message_body = :messageBody,
          updated_at = NOW()
      WHERE id = :messageId
      `,
      { messageBody: body, messageId }
    )

    const updatedMessage = await fetchChatMessageById(messageId, req.user.id)
    const updatedRoom = updatedMessage?.room_id ? room || await findRoomForChat(updatedMessage.room_id) : null
    let realtimeBroadcasted = false

    try {
      realtimeBroadcasted = updatedRoom
        ? await emitRoomRealtime(req, updatedRoom, 'chat-message-edited', { message: updatedMessage })
        : false
    } catch (broadcastError) {
      console.error('[chat] realtime edit broadcast failed', broadcastError)
    }

    return res.json({
      message: 'Message updated successfully.',
      chat_message: updatedMessage,
      realtime_broadcasted: realtimeBroadcasted,
    })
  } catch (error) {
    next(error)
  }
})

router.delete('/messages/:id', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const messageId = parsePositiveInteger(req.params.id)
    const deleteForEveryone = req.body?.for_everyone !== false
    if (!messageId) return res.status(422).json({ message: 'Invalid message ID.' })

    const messages = await query(
      `
      SELECT *
      FROM chat_messages
      WHERE id = :messageId
      AND tenant_id = :tenantId
      LIMIT 1
      `,
      { messageId, tenantId: req.user.tenant_id }
    )

    if (!messages.length) return res.status(404).json({ message: 'Message not found.' })

    const message = messages[0]

    if (!deleteForEveryone) {
      await query(
        `
        INSERT IGNORE INTO chat_message_hides (message_id, user_id, hidden_at)
        VALUES (:messageId, :userId, NOW())
        `,
        { messageId, userId: req.user.id }
      )

      return res.json({
        message: 'Message hidden from your chat.',
        message_id: message.id,
        room_id: message.room_id,
        deleted_for_everyone: false,
      })
    }

    if (!(await canDeleteMessageForEveryone(message, req.user))) {
      return res.status(403).json({ message: 'You do not have permission to delete this message.' })
    }

    await query(
      `
      UPDATE chat_messages
      SET is_deleted = 1,
          is_unsent = 1,
          message_body = NULL,
          deleted_by = :deletedBy,
          deleted_at = NOW(),
          updated_at = NOW()
      WHERE id = :messageId
      `,
      { deletedBy: req.user.id, messageId }
    )
    const room = message?.room_id ? await findRoomForChat(message.room_id) : null
    let realtimeBroadcasted = false

    try {
      realtimeBroadcasted = room
        ? await emitRoomRealtime(req, room, 'chat-message-deleted', {
          messageId: message.id,
          room_id: message.room_id,
        })
        : false
    } catch (broadcastError) {
      console.error('[chat] realtime delete broadcast failed', broadcastError)
    }

    return res.json({
      message: 'Message deleted successfully.',
      message_id: message.id,
      room_id: message.room_id,
      deleted_for_everyone: true,
      realtime_broadcasted: realtimeBroadcasted,
    })
  } catch (error) {
    next(error)
  }
})

module.exports = router
