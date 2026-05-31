const express = require('express')
const { query } = require('../config/db')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()

const validMessageTypes = new Set(['text', 'image', 'voice', 'gift', 'system'])
let chatSchemaPromise = null

async function ensureChatSchema() {
  if (!chatSchemaPromise) {
    chatSchemaPromise = query(
      `
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
      `
    ).catch((error) => {
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
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/rooms/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    const roomId = parsePositiveInteger(req.params.id)
    const body = cleanMessageBody(req.body?.message_body).trim()
    const messageType = String(req.body?.message_type || 'text').trim()
    const parentMessageId = parsePositiveInteger(req.body?.parent_message_id)

    if (!roomId) return res.status(422).json({ message: 'Invalid room ID.' })

    if (!body) return res.status(422).json({ message: 'Message body is required.' })
    if (body.length > 1200) return res.status(422).json({ message: 'Message body must be 1200 characters or fewer.' })
    if (!validMessageTypes.has(messageType)) return res.status(422).json({ message: 'Invalid message type.' })

    const rooms = await query(
      `
      SELECT *
      FROM rooms
      WHERE id = :roomId
      AND tenant_id = :tenantId
      LIMIT 1
      `,
      { roomId, tenantId: req.user.tenant_id }
    )

    if (!rooms.length) return res.status(404).json({ message: 'Room not found.' })

    const room = rooms[0]

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
        messageBody: body,
        mediaUrl: req.body?.media_url || null,
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
