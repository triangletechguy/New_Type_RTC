const { query } = require('../config/db')

function registerSignaling(io) {
  const rooms = new Map()

  function getRoomUsers(roomId) {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map())
    }
    return rooms.get(roomId)
  }

  function normalizeBoolean(value, defaultValue) {
    if (value === undefined || value === null) return defaultValue
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value === 1
    return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase())
  }

  function normalizeRtcMode(value) {
    return value === 'audio' ? 'audio' : 'video'
  }

  function serializeUser(socketId, user) {
    return {
      socketId,
      userId: user.userId,
      userName: user.userName,
      rtcMode: user.rtcMode,
      micEnabled: user.micEnabled,
      cameraEnabled: user.cameraEnabled,
    }
  }

  async function fetchOwnedChatMessage(messageId, userId) {
    const messages = await query(
      `
      SELECT
        cm.*,
        u.name AS sender_name,
        u.avatar_url AS sender_avatar_url
      FROM chat_messages cm
      LEFT JOIN users u ON u.id = cm.sender_id
      WHERE cm.id = :messageId
      AND cm.sender_id = :userId
      LIMIT 1
      `,
      { messageId, userId }
    )

    return messages[0] || null
  }

  async function fetchOwnedDeletedChatMessage(messageId, userId) {
    const messages = await query(
      `
      SELECT id, sender_id, is_deleted, is_unsent
      FROM chat_messages
      WHERE id = :messageId
      AND sender_id = :userId
      LIMIT 1
      `,
      { messageId, userId }
    )

    return messages[0] || null
  }

  function getSocketRoomUser(roomId, socketId) {
    return rooms.get(String(roomId))?.get(socketId) || null
  }

  function removeSocketFromRooms(socket) {
    for (const [roomId, users] of rooms.entries()) {
      if (users.has(socket.id)) {
        const user = users.get(socket.id)
        users.delete(socket.id)

        socket.to(roomId).emit('user-left', {
          socketId: socket.id,
          userId: user.userId,
          userName: user.userName,
        })

        if (users.size === 0) rooms.delete(roomId)
      }
    }
  }

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id)

    socket.on('join-room', ({ roomId, userId, userName, rtcMode, micEnabled, cameraEnabled } = {}, acknowledge) => {
      if (!roomId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing signaling room ID.' })
        }
        return
      }

      const roomKey = String(roomId)
      const users = getRoomUsers(roomKey)

      const existingUsers = Array.from(users.entries()).map(([socketId, user]) => serializeUser(socketId, user))

      users.set(socket.id, {
        userId: userId || null,
        userName: userName || 'Guest',
        rtcMode: normalizeRtcMode(rtcMode),
        micEnabled: normalizeBoolean(micEnabled, true),
        cameraEnabled: normalizeBoolean(cameraEnabled, normalizeRtcMode(rtcMode) === 'video'),
      })

      socket.join(roomKey)

      socket.emit('existing-users', {
        ok: true,
        roomId: roomKey,
        socketId: socket.id,
        users: existingUsers,
      })

      if (typeof acknowledge === 'function') {
        acknowledge({
          ok: true,
          roomId: roomKey,
          socketId: socket.id,
          users: existingUsers,
        })
      }

      socket.to(roomKey).emit('user-joined', {
        socketId: socket.id,
        userId: userId || null,
        userName: userName || 'Guest',
        rtcMode: normalizeRtcMode(rtcMode),
        micEnabled: normalizeBoolean(micEnabled, true),
        cameraEnabled: normalizeBoolean(cameraEnabled, normalizeRtcMode(rtcMode) === 'video'),
      })

      console.log(`Socket ${socket.id} joined room ${roomKey}`)
    })

    socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
      if (!targetSocketId || !offer) return
      socket.to(targetSocketId).emit('webrtc-offer', { fromSocketId: socket.id, offer })
    })

    socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
      if (!targetSocketId || !answer) return
      socket.to(targetSocketId).emit('webrtc-answer', { fromSocketId: socket.id, answer })
    })

    socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
      if (!targetSocketId || !candidate) return
      socket.to(targetSocketId).emit('webrtc-ice-candidate', { fromSocketId: socket.id, candidate })
    })

    socket.on('media-state-change', ({ roomId, rtcMode, micEnabled, cameraEnabled } = {}, acknowledge) => {
      if (!roomId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing signaling room ID.' })
        }
        return
      }

      const roomKey = String(roomId)
      const users = rooms.get(roomKey)
      const currentUser = users?.get(socket.id)

      if (!users || !currentUser) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Socket is not in this signaling room.' })
        }
        return
      }

      const nextRtcMode = normalizeRtcMode(rtcMode || currentUser.rtcMode)
      const nextUser = {
        ...currentUser,
        rtcMode: nextRtcMode,
        micEnabled: normalizeBoolean(micEnabled, currentUser.micEnabled),
        cameraEnabled: normalizeBoolean(cameraEnabled, currentUser.cameraEnabled),
      }

      users.set(socket.id, nextUser)

      const payload = {
        roomId: roomKey,
        ...serializeUser(socket.id, nextUser),
      }

      socket.to(roomKey).emit('media-state-change', payload)

      if (typeof acknowledge === 'function') {
        acknowledge({ ok: true, ...payload })
      }
    })

    socket.on('moderation-action', ({ roomId, targetUserId, action, participant } = {}, acknowledge) => {
      if (!roomId || !targetUserId || !action) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing moderation room, target, or action.' })
        }
        return
      }

      const payload = {
        roomId: String(roomId),
        targetUserId,
        action,
        participant: participant || null,
        moderatorSocketId: socket.id,
      }

      socket.to(String(roomId)).emit('moderation-action', payload)

      if (typeof acknowledge === 'function') {
        acknowledge({ ok: true, ...payload })
      }
    })

    socket.on('chat-message', async ({ roomId, message } = {}, acknowledge) => {
      if (!roomId || !message?.id) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing chat room or message.' })
        }
        return
      }

      try {
        const currentUser = getSocketRoomUser(roomId, socket.id)
        const savedMessage = currentUser?.userId
          ? await fetchOwnedChatMessage(message.id, currentUser.userId)
          : null

        if (!savedMessage || Number(savedMessage.is_deleted) || Number(savedMessage.is_unsent)) {
          if (typeof acknowledge === 'function') {
            acknowledge({ ok: false, message: 'Message broadcast is not authorized.' })
          }
          return
        }

        socket.to(String(roomId)).emit('chat-message', { message: savedMessage, socketId: socket.id })

        if (typeof acknowledge === 'function') {
          acknowledge({ ok: true })
        }
      } catch (error) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: error.message || 'Message broadcast failed.' })
        }
      }
    })

    socket.on('chat-message-unsent', async ({ roomId, messageId } = {}, acknowledge) => {
      if (!roomId || !messageId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing chat room or message ID.' })
        }
        return
      }

      try {
        const currentUser = getSocketRoomUser(roomId, socket.id)
        const deletedMessage = currentUser?.userId
          ? await fetchOwnedDeletedChatMessage(messageId, currentUser.userId)
          : null

        if (!deletedMessage || (!Number(deletedMessage.is_deleted) && !Number(deletedMessage.is_unsent))) {
          if (typeof acknowledge === 'function') {
            acknowledge({ ok: false, message: 'Message delete is not authorized.' })
          }
          return
        }

        socket.to(String(roomId)).emit('chat-message-unsent', {
          messageId,
          socketId: socket.id,
        })

        if (typeof acknowledge === 'function') {
          acknowledge({ ok: true })
        }
      } catch (error) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: error.message || 'Message delete broadcast failed.' })
        }
      }
    })

    socket.on('chat-message-deleted', async ({ roomId, messageId } = {}, acknowledge) => {
      if (!roomId || !messageId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing chat room or message ID.' })
        }
        return
      }

      try {
        const currentUser = getSocketRoomUser(roomId, socket.id)
        const deletedMessage = currentUser?.userId
          ? await fetchOwnedDeletedChatMessage(messageId, currentUser.userId)
          : null

        if (!deletedMessage || (!Number(deletedMessage.is_deleted) && !Number(deletedMessage.is_unsent))) {
          if (typeof acknowledge === 'function') {
            acknowledge({ ok: false, message: 'Message delete is not authorized.' })
          }
          return
        }

        socket.to(String(roomId)).emit('chat-message-deleted', {
          messageId,
          socketId: socket.id,
        })

        if (typeof acknowledge === 'function') {
          acknowledge({ ok: true })
        }
      } catch (error) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: error.message || 'Message delete broadcast failed.' })
        }
      }
    })

    socket.on('chat-message-edited', async ({ roomId, message } = {}, acknowledge) => {
      if (!roomId || !message?.id) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing chat room or message.' })
        }
        return
      }

      try {
        const currentUser = getSocketRoomUser(roomId, socket.id)
        const updatedMessage = currentUser?.userId
          ? await fetchOwnedChatMessage(message.id, currentUser.userId)
          : null

        if (!updatedMessage || Number(updatedMessage.is_deleted) || Number(updatedMessage.is_unsent)) {
          if (typeof acknowledge === 'function') {
            acknowledge({ ok: false, message: 'Message edit is not authorized.' })
          }
          return
        }

        socket.to(String(roomId)).emit('chat-message-edited', {
          message: updatedMessage,
          socketId: socket.id,
        })

        if (typeof acknowledge === 'function') {
          acknowledge({ ok: true })
        }
      } catch (error) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: error.message || 'Message edit broadcast failed.' })
        }
      }
    })

    socket.on('typing-start', ({ roomId, user }) => {
      if (!roomId) return
      socket.to(String(roomId)).emit('typing-start', { user, socketId: socket.id })
    })

    socket.on('typing-stop', ({ roomId, user }) => {
      if (!roomId) return
      socket.to(String(roomId)).emit('typing-stop', { user, socketId: socket.id })
    })

    socket.on('leave-room', () => {
      removeSocketFromRooms(socket)
    })

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id)
      removeSocketFromRooms(socket)
    })
  })
}

module.exports = {
  registerSignaling,
}
