const { query } = require('../config/db')
const { closeActiveParticipantForUser, touchActiveParticipant } = require('../services/rtcSessionLifecycle')

const PRESENCE_CLOSE_GRACE_MS = Math.max(5000, Number(process.env.RTC_PRESENCE_CLOSE_GRACE_MS || 15000))

function registerSignaling(io) {
  const rooms = new Map()
  const pendingPresenceCloseTimers = new Map()

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

  function normalizeCameraEnabled(value, rtcMode, defaultValue = false) {
    return normalizeRtcMode(rtcMode) === 'video' && normalizeBoolean(value, defaultValue)
  }

  function serializeUser(socketId, user) {
    return {
      socketId,
      userId: user.userId,
      userName: user.userName,
      userGender: user.userGender,
      userAvatarUrl: user.userAvatarUrl,
      rtcMode: user.rtcMode,
      micEnabled: user.micEnabled,
      cameraEnabled: user.cameraEnabled,
      screenShared: user.screenShared,
    }
  }

  function parseDatabaseRoomId(roomId) {
    const direct = Number(roomId || 0)
    if (Number.isInteger(direct) && direct > 0) return direct

    const match = String(roomId || '').match(/(?:^|_)room_(\d+)$/)
    const parsed = Number(match?.[1] || 0)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  function resolveDatabaseRoomId(roomId, user = {}, payload = {}) {
    const fromPayload = Number(payload.databaseRoomId || payload.roomDbId || 0)
    if (Number.isInteger(fromPayload) && fromPayload > 0) return fromPayload

    const fromUser = Number(user.databaseRoomId || 0)
    if (Number.isInteger(fromUser) && fromUser > 0) return fromUser

    return parseDatabaseRoomId(roomId)
  }

  function presenceKey(databaseRoomId, userId) {
    return `${databaseRoomId}:${userId}`
  }

  function userSocketRoom(userId) {
    return `user:${Number(userId || 0)}`
  }

  function cancelPendingPresenceClose(databaseRoomId, userId) {
    if (!databaseRoomId || !userId) return

    const key = presenceKey(databaseRoomId, userId)
    const timer = pendingPresenceCloseTimers.get(key)
    if (!timer) return

    clearTimeout(timer)
    pendingPresenceCloseTimers.delete(key)
  }

  function schedulePresenceClose(databaseRoomId, user, reason) {
    if (!databaseRoomId || !user?.userId) return

    const key = presenceKey(databaseRoomId, user.userId)
    cancelPendingPresenceClose(databaseRoomId, user.userId)

    const timer = setTimeout(() => {
      pendingPresenceCloseTimers.delete(key)
      closeActiveParticipantForUser({
        roomId: databaseRoomId,
        userId: user.userId,
        eventType: 'disconnect',
        reason,
      }).catch((error) => {
        console.error('[signaling] stale participant cleanup failed', error)
      })
    }, PRESENCE_CLOSE_GRACE_MS)

    pendingPresenceCloseTimers.set(key, timer)
  }

  function closePresenceNow(databaseRoomId, user, eventType, reason) {
    if (!databaseRoomId || !user?.userId) return

    cancelPendingPresenceClose(databaseRoomId, user.userId)
    closeActiveParticipantForUser({
      roomId: databaseRoomId,
      userId: user.userId,
      eventType,
      reason,
    }).catch((error) => {
      console.error('[signaling] participant close failed', error)
    })
  }

  async function fetchOwnedChatMessage(messageId, userId) {
    const messages = await query(
      `
      SELECT
        cm.*,
        u.name AS sender_name,
        u.avatar_url AS sender_avatar_url,
        u.gender AS sender_gender
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

  async function fetchAuthorizedDeletedChatMessage(messageId, userId) {
    const messages = await query(
      `
      SELECT id, sender_id, is_deleted, is_unsent
      FROM chat_messages
      WHERE id = :messageId
      AND (
        sender_id = :userId
        OR deleted_by = :userId
      )
      LIMIT 1
      `,
      { messageId, userId }
    )

    return messages[0] || null
  }

  function getSocketRoomUser(roomId, socketId) {
    return rooms.get(String(roomId))?.get(socketId) || null
  }

  function removeDuplicateUserSockets(roomKey, users, userId, keepSocketId) {
    const normalizedUserId = Number(userId || 0)
    if (!normalizedUserId) return []

    const removedUsers = []

    for (const [socketId, roomUser] of users.entries()) {
      if (socketId === keepSocketId || Number(roomUser?.userId || 0) !== normalizedUserId) continue

      users.delete(socketId)
      removedUsers.push({ socketId, user: roomUser })

      const duplicateSocket = io.sockets.sockets.get(socketId)
      if (duplicateSocket) {
        duplicateSocket.leave(roomKey)
        duplicateSocket.emit('room-session-replaced', { roomId: roomKey })
      }
    }

    return removedUsers
  }

  function removeSocketFromRooms(socket, reason = 'disconnect') {
    for (const [roomId, users] of rooms.entries()) {
      if (users.has(socket.id)) {
        const user = users.get(socket.id)
        const databaseRoomId = resolveDatabaseRoomId(roomId, user)
        users.delete(socket.id)
        const userStillPresent = Array.from(users.values()).some((roomUser) => (
          roomUser?.userId && Number(roomUser.userId) === Number(user.userId)
        ))

        socket.to(roomId).emit('user-left', {
          socketId: socket.id,
          userId: user.userId,
          userName: user.userName,
        })

        if (reason === 'leave-room' && !userStillPresent) {
          closePresenceNow(databaseRoomId, user, 'leave', reason)
        } else if (reason === 'disconnect' && !userStillPresent) {
          schedulePresenceClose(databaseRoomId, user, reason)
        }

        if (users.size === 0) rooms.delete(roomId)
      }
    }
  }

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id)

    socket.on('join-room', ({ roomId, databaseRoomId, roomDbId, userId, userName, userGender, userAvatarUrl, rtcMode, micEnabled, cameraEnabled, screenShared } = {}, acknowledge) => {
      if (!roomId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing signaling room ID.' })
        }
        return
      }

      const roomKey = String(roomId)
      const users = getRoomUsers(roomKey)
      const resolvedDatabaseRoomId = resolveDatabaseRoomId(roomKey, {}, { databaseRoomId, roomDbId })
      const replacedUsers = removeDuplicateUserSockets(roomKey, users, userId, socket.id)

      const existingUsers = Array.from(users.entries()).map(([socketId, user]) => serializeUser(socketId, user))

      replacedUsers.forEach(({ socketId, user }) => {
        socket.to(roomKey).emit('user-left', {
          socketId,
          userId: user.userId,
          userName: user.userName,
        })
      })

      users.set(socket.id, {
        userId: userId || null,
        databaseRoomId: resolvedDatabaseRoomId,
        userName: userName || 'Guest',
        userGender: userGender || '',
        userAvatarUrl: userAvatarUrl || '',
        rtcMode: normalizeRtcMode(rtcMode),
        micEnabled: normalizeBoolean(micEnabled, true),
        cameraEnabled: normalizeCameraEnabled(cameraEnabled, rtcMode, false),
        screenShared: normalizeBoolean(screenShared, false),
      })

      socket.join(roomKey)
      if (userId) socket.join(userSocketRoom(userId))
      cancelPendingPresenceClose(resolvedDatabaseRoomId, userId)
      if (resolvedDatabaseRoomId && userId) {
        touchActiveParticipant({
          roomId: resolvedDatabaseRoomId,
          userId,
          micEnabled: normalizeBoolean(micEnabled, true),
          cameraEnabled: normalizeCameraEnabled(cameraEnabled, rtcMode, false),
          screenShared: normalizeBoolean(screenShared, false),
        }).catch((error) => console.error('[signaling] presence touch failed', error))
      }

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
        userGender: userGender || '',
        userAvatarUrl: userAvatarUrl || '',
        rtcMode: normalizeRtcMode(rtcMode),
        micEnabled: normalizeBoolean(micEnabled, true),
        cameraEnabled: normalizeCameraEnabled(cameraEnabled, rtcMode, false),
        screenShared: normalizeBoolean(screenShared, false),
      })

      console.log(`Socket ${socket.id} joined room ${roomKey}`)
    })

    socket.on('rtc-presence', ({ roomId, databaseRoomId, roomDbId, micEnabled, cameraEnabled, screenShared } = {}, acknowledge) => {
      if (!roomId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing signaling room ID.' })
        }
        return
      }

      const roomKey = String(roomId)
      const users = rooms.get(roomKey)
      const currentUser = users?.get(socket.id)

      if (!users || !currentUser?.userId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Socket is not in this signaling room.' })
        }
        return
      }

      const resolvedDatabaseRoomId = resolveDatabaseRoomId(roomKey, currentUser, { databaseRoomId, roomDbId })
      const nextUser = {
        ...currentUser,
        databaseRoomId: resolvedDatabaseRoomId,
        micEnabled: normalizeBoolean(micEnabled, currentUser.micEnabled),
        cameraEnabled: normalizeCameraEnabled(cameraEnabled, currentUser.rtcMode, currentUser.cameraEnabled),
        screenShared: normalizeBoolean(screenShared, currentUser.screenShared),
      }

      users.set(socket.id, nextUser)
      cancelPendingPresenceClose(resolvedDatabaseRoomId, currentUser.userId)

      touchActiveParticipant({
        roomId: resolvedDatabaseRoomId,
        userId: currentUser.userId,
        micEnabled: nextUser.micEnabled,
        cameraEnabled: nextUser.cameraEnabled,
        screenShared: nextUser.screenShared,
      }).then((result) => {
        if (typeof acknowledge === 'function') acknowledge({ ok: true, ...result })
      }).catch((error) => {
        if (typeof acknowledge === 'function') acknowledge({ ok: false, message: error.message || 'Presence update failed.' })
      })
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

    socket.on('media-state-change', ({ roomId, rtcMode, micEnabled, cameraEnabled, screenShared } = {}, acknowledge) => {
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
        cameraEnabled: normalizeCameraEnabled(cameraEnabled, nextRtcMode, currentUser.cameraEnabled),
        screenShared: normalizeBoolean(screenShared, currentUser.screenShared),
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
          ? await fetchAuthorizedDeletedChatMessage(messageId, currentUser.userId)
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
          ? await fetchAuthorizedDeletedChatMessage(messageId, currentUser.userId)
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
      removeSocketFromRooms(socket, 'leave-room')
    })

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id)
      removeSocketFromRooms(socket, 'disconnect')
    })
  })
}

module.exports = {
  registerSignaling,
}
