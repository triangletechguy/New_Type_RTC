const express = require('express')
const { query } = require('../config/db')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()

const validMessageTypes = new Set(['text', 'image', 'voice', 'gift', 'system'])
const imageDataUrlPattern = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i
const audioDataUrlPattern = /^data:audio\/(webm|ogg|mpeg|mp3|mp4|wav|x-m4a)(;codecs=[^;]+)?;base64,[a-z0-9+/=\s]+$/i
const maxImageDataUrlLength = 7 * 1024 * 1024
const maxAudioDataUrlLength = 7 * 1024 * 1024
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

function messageSelectSql() {
  return `
    SELECT
      cm.*,
      u.name AS sender_name,
      u.avatar_url AS sender_avatar_url
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
      recipient.name AS recipient_name,
      recipient.avatar_url AS recipient_avatar_url
    FROM direct_messages dm
    LEFT JOIN users sender ON sender.id = dm.sender_id
    LEFT JOIN users recipient ON recipient.id = dm.recipient_id
  `
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

async function findRoomForChat(roomId, tenantId) {
  const rooms = await query(
    `
    SELECT *
    FROM rooms
    WHERE id = :roomId
    AND tenant_id = :tenantId
    LIMIT 1
    `,
    { roomId, tenantId }
  )

  return rooms[0] || null
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
    SELECT id, name, avatar_url
    FROM users
    WHERE id = :userId
    AND tenant_id = :tenantId
    LIMIT 1
    `,
    { userId, tenantId }
  )

  return users[0] || null
}

router.get('/rooms/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const roomId = parsePositiveInteger(req.params.id)
    const limit = Math.min(100, parsePositiveInteger(req.query.limit, 50) || 50)

    if (!roomId) return res.status(422).json({ message: 'Invalid room ID.' })

    const rooms = await query(
      `
      SELECT id, chat_enabled, gift_enabled
      FROM rooms
      WHERE id = :roomId
      AND tenant_id = :tenantId
      LIMIT 1
      `,
      { roomId, tenantId: req.user.tenant_id }
    )

    if (!rooms.length) return res.status(404).json({ message: 'Room not found.' })
    const blockedUserIds = await blockedUserIdsForRoom(roomId, req.user.id)

    const messages = await query(
      `
      ${messageSelectSql()}
      WHERE cm.tenant_id = :tenantId
      AND cm.room_id = :roomId
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
      { tenantId: req.user.tenant_id, roomId, userId: req.user.id }
    )

    return res.json({
      messages: messages.reverse(),
      meta: {
        limit,
        chat_enabled: Boolean(Number(rooms[0].chat_enabled)),
        gift_enabled: Boolean(Number(rooms[0].gift_enabled)),
        blocked_user_ids: blockedUserIds,
      },
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

    if (!roomId) return res.status(422).json({ message: 'Invalid room ID.' })

    if (body.length > 1200) return res.status(422).json({ message: 'Message body must be 1200 characters or fewer.' })
    if (!validMessageTypes.has(messageType)) return res.status(422).json({ message: 'Invalid message type.' })

    if (messageType === 'image') {
      const mediaError = imageMediaError(mediaUrl)
      if (mediaError) return res.status(422).json({ message: mediaError })
    } else if (messageType === 'voice') {
      const mediaError = audioMediaError(mediaUrl)
      if (mediaError) return res.status(422).json({ message: mediaError })
    } else if (!body) {
      return res.status(422).json({ message: 'Message body is required.' })
    }

    const room = await findRoomForChat(roomId, req.user.tenant_id)

    if (!room) return res.status(404).json({ message: 'Room not found.' })

    if (messageType !== 'gift' && !room.chat_enabled) {
      return res.status(403).json({ message: 'Chat is disabled in this room.' })
    }

    if (messageType === 'gift' && !room.gift_enabled) {
      return res.status(403).json({ message: 'Gifts are disabled in this room.' })
    }

    const result = await query(
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
        tenantId: req.user.tenant_id,
        roomId,
        senderId: req.user.id,
        parentMessageId,
        messageType,
        messageBody: messageType === 'image'
          ? (body || 'sent a photo')
          : messageType === 'voice' ? (body || 'sent a voice message') : body,
        mediaUrl: ['image', 'voice'].includes(messageType) ? mediaUrl : mediaUrl || null,
      }
    )

    const messages = await query(`${messageSelectSql()} WHERE cm.id = :id LIMIT 1`, {
      id: result.insertId,
    })

    return res.status(201).json({
      message: 'Message sent successfully',
      chat_message: messages[0],
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

    const room = await findRoomForChat(roomId, req.user.tenant_id)
    if (!room) return res.status(404).json({ message: 'Room not found.' })

    const users = await query(
      `
      SELECT id
      FROM users
      WHERE id = :blockedUserId
      AND tenant_id = :tenantId
      LIMIT 1
      `,
      { blockedUserId, tenantId: req.user.tenant_id }
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
        tenantId: req.user.tenant_id,
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

router.get('/direct-messages/threads', authMiddleware, async (req, res, next) => {
  try {
    await ensureChatSchema()

    const rows = await query(
      `
      SELECT
        latest.peer_id,
        peer.name AS peer_name,
        peer.avatar_url AS peer_avatar_url,
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
        GROUP BY peer_id
      ) latest
      INNER JOIN direct_messages dm ON dm.id = latest.last_message_id
      INNER JOIN users peer ON peer.id = latest.peer_id
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
        last_message: row,
      })),
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

    const messages = await query(
      `
      ${directMessageSelectSql()}
      WHERE dm.tenant_id = :tenantId
      AND dm.is_deleted = 0
      AND (
        (dm.sender_id = :userId AND dm.recipient_id = :peerId)
        OR (dm.sender_id = :peerId AND dm.recipient_id = :userId)
      )
      ORDER BY dm.id DESC
      LIMIT ${limit}
      `,
      { tenantId: req.user.tenant_id, userId: req.user.id, peerId }
    )

    return res.json({
      peer,
      messages: messages.reverse(),
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

    const peer = await findUserForDirectMessage(peerId, req.user.tenant_id)
    if (!peer) return res.status(404).json({ message: 'User not found.' })

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

    const messages = await query(`${directMessageSelectSql()} WHERE dm.id = :id LIMIT 1`, {
      id: result.insertId,
    })

    return res.status(201).json({
      message: 'Direct message sent.',
      direct_message: messages[0],
      peer,
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/messages/:id', authMiddleware, async (req, res, next) => {
  try {
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

    await query(
      `
      UPDATE chat_messages
      SET message_body = :messageBody,
          updated_at = NOW()
      WHERE id = :messageId
      `,
      { messageBody: body, messageId }
    )

    const updatedMessages = await query(`${messageSelectSql()} WHERE cm.id = :id LIMIT 1`, {
      id: messageId,
    })

    return res.json({
      message: 'Message updated successfully.',
      chat_message: updatedMessages[0],
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

    return res.json({
      message: 'Message deleted successfully.',
      message_id: message.id,
      room_id: message.room_id,
      deleted_for_everyone: true,
    })
  } catch (error) {
    next(error)
  }
})

module.exports = router
