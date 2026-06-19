const { query } = require('../config/db')
const { closeActiveParticipantForUser, touchActiveParticipant } = require('../services/rtcSessionLifecycle')
const { canPublishRoomMedia, normalizeRoomRole } = require('../utils/roomRoles')

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

  async function fetchParticipantStageAccess(databaseRoomId, userId) {
    if (!databaseRoomId || !userId) return null

    const rows = await query(
      `
      SELECT
        r.owner_id,
        p.role_in_room
      FROM rooms r
      LEFT JOIN rtc_session_participants p
        ON p.room_id = r.id
        AND p.user_id = :userId
        AND p.left_at IS NULL
      WHERE r.id = :roomId
      ORDER BY p.id DESC
      LIMIT 1
      `,
      { roomId: databaseRoomId, userId }
    )

    if (!rows.length) return { stageRole: 'audience', canPublish: false }
    if (Number(rows[0].owner_id || 0) === Number(userId || 0)) {
      return { stageRole: 'owner', canPublish: true }
    }

    const stageRole = normalizeRoomRole(rows[0].role_in_room || 'audience', 'audience')
    return {
      stageRole,
      canPublish: canPublishRoomMedia(stageRole),
    }
  }

  async function activeRoomBanForUser(databaseRoomId, userId) {
    if (!databaseRoomId || !userId) return null

    await query(
      `
      UPDATE room_bans
      SET status = 'expired',
          updated_at = NOW()
      WHERE room_id = :roomId
      AND banned_user_id = :userId
      AND status = 'active'
      AND ban_type = 'temporary'
      AND ends_at IS NOT NULL
      AND ends_at <= NOW()
      `,
      { roomId: databaseRoomId, userId }
    )

    const bans = await query(
      `
      SELECT id, room_id, banned_user_id, ban_type, reason, starts_at, ends_at, status
      FROM room_bans
      WHERE room_id = :roomId
      AND banned_user_id = :userId
      AND status = 'active'
      AND (
        ban_type = 'permanent'
        OR ends_at IS NULL
        OR ends_at > NOW()
      )
      ORDER BY id DESC
      LIMIT 1
      `,
      { roomId: databaseRoomId, userId }
    )

    return bans[0] || null
  }

  function serializeUser(socketId, user) {
    return {
      socketId,
      userId: user.userId,
      userName: user.userName,
      userGender: user.userGender,
      userAvatarUrl: user.userAvatarUrl,
      stageRole: user.stageRole,
      canPublish: user.canPublish,
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
        eventType: 'connection_lost',
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

  function socketIsInRoom(socketId, roomKey) {
    return Boolean(io.sockets.adapter.rooms.get(roomKey)?.has(socketId))
  }

  function socketRoomsForPeer(socketId) {
    const peerSocket = io.sockets.sockets.get(socketId)
    return Array.from(peerSocket?.rooms || []).filter((roomId) => roomId !== socketId)
  }

  function sharedSignalingRoom(sourceSocket, targetSocketId) {
    const targetRooms = new Set(socketRoomsForPeer(targetSocketId))

    for (const roomId of sourceSocket.rooms || []) {
      if (roomId !== sourceSocket.id && targetRooms.has(roomId)) return roomId
    }

    return null
  }

  function acknowledgeSignal(acknowledge, payload) {
    if (typeof acknowledge === 'function') acknowledge(payload)
  }

  function forwardPeerSignal(socket, eventName, targetSocketId, payload, acknowledge) {
    if (!targetSocketId || !payload) {
      acknowledgeSignal(acknowledge, { ok: false, message: 'Missing WebRTC target or payload.' })
      return
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId)
    if (!targetSocket) {
      const message = 'Target peer is no longer connected.'
      if (eventName !== 'webrtc-ice-candidate') {
        socket.emit('peer-signal-error', { eventName, targetSocketId, message })
      }
      acknowledgeSignal(acknowledge, { ok: false, message })
      return
    }

    const roomId = sharedSignalingRoom(socket, targetSocketId)
    if (!roomId) {
      const message = 'Target peer is not in this signaling room.'
      if (eventName !== 'webrtc-ice-candidate') {
        socket.emit('peer-signal-error', { eventName, targetSocketId, message })
      }
      acknowledgeSignal(acknowledge, { ok: false, message })
      return
    }

    targetSocket.emit(eventName, { fromSocketId: socket.id, ...payload })
    acknowledgeSignal(acknowledge, { ok: true, roomId, targetSocketId })
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

    socket.on('join-room', async ({ roomId, databaseRoomId, roomDbId, userId, userName, userGender, userAvatarUrl, stageRole, canPublish, rtcMode, micEnabled, cameraEnabled, screenShared } = {}, acknowledge) => {
      if (!roomId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'Missing signaling room ID.' })
        }
        return
      }

      try {
        const roomKey = String(roomId)
        const users = getRoomUsers(roomKey)
        const resolvedDatabaseRoomId = resolveDatabaseRoomId(roomKey, {}, { databaseRoomId, roomDbId })
        const activeBan = resolvedDatabaseRoomId && userId
          ? await activeRoomBanForUser(resolvedDatabaseRoomId, userId)
          : null

        if (activeBan) {
          const payload = {
            ok: false,
            reason: 'banned',
            message: 'You are banned from this room.',
            ban: activeBan,
          }
          socket.emit('room-access-denied', payload)
          if (typeof acknowledge === 'function') acknowledge(payload)
          return
        }

        const stageAccess = resolvedDatabaseRoomId && userId
          ? await fetchParticipantStageAccess(resolvedDatabaseRoomId, userId)
          : null
        const effectiveStageRole = stageAccess?.stageRole || stageRole || 'audience'
        const effectiveCanPublish = stageAccess
          ? stageAccess.canPublish
          : normalizeBoolean(canPublish, false)
        const effectiveRtcMode = normalizeRtcMode(rtcMode)
        const effectiveMicEnabled = effectiveCanPublish && normalizeBoolean(micEnabled, true)
        const effectiveCameraEnabled = effectiveCanPublish && normalizeCameraEnabled(cameraEnabled, effectiveRtcMode, false)
        const effectiveScreenShared = effectiveCanPublish && normalizeBoolean(screenShared, false)
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
          stageRole: effectiveStageRole,
          canPublish: effectiveCanPublish,
          rtcMode: effectiveRtcMode,
          micEnabled: effectiveMicEnabled,
          cameraEnabled: effectiveCameraEnabled,
          screenShared: effectiveScreenShared,
        })

        socket.join(roomKey)
        if (userId) socket.join(userSocketRoom(userId))
        cancelPendingPresenceClose(resolvedDatabaseRoomId, userId)
        if (resolvedDatabaseRoomId && userId) {
          touchActiveParticipant({
            roomId: resolvedDatabaseRoomId,
            userId,
            micEnabled: effectiveMicEnabled,
            cameraEnabled: effectiveCameraEnabled,
            screenShared: effectiveScreenShared,
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
          stageRole: effectiveStageRole,
          canPublish: effectiveCanPublish,
          rtcMode: effectiveRtcMode,
          micEnabled: effectiveMicEnabled,
          cameraEnabled: effectiveCameraEnabled,
          screenShared: effectiveScreenShared,
        })

        console.log(`Socket ${socket.id} joined room ${roomKey}`)
      } catch (error) {
        console.error('[signaling] join-room failed', error)
        if (typeof acknowledge === 'function') {
          acknowledge({
            ok: false,
            message: error.message || 'Signaling room join failed.',
          })
        }
      }
    })

    socket.on('stage-join-request', ({ roomId, requestedMic, requestedCamera, requestedRtcMode } = {}, acknowledge) => {
      if (!roomId) {
        acknowledgeSignal(acknowledge, { ok: false, message: 'Missing signaling room ID.' })
        return
      }

      const roomKey = String(roomId)
      const users = rooms.get(roomKey)
      const currentUser = users?.get(socket.id)

      if (!users || !currentUser) {
        acknowledgeSignal(acknowledge, { ok: false, message: 'Socket is not in this signaling room.' })
        return
      }

      const request = {
        id: `${roomKey}:${currentUser.userId || socket.id}:${Date.now()}`,
        roomId: roomKey,
        socketId: socket.id,
        userId: currentUser.userId || null,
        userName: currentUser.userName || 'Guest',
        userGender: currentUser.userGender || '',
        userAvatarUrl: currentUser.userAvatarUrl || '',
        requestedMic: normalizeBoolean(requestedMic, true),
        requestedCamera: normalizeRtcMode(requestedRtcMode || currentUser.rtcMode) === 'video' && normalizeBoolean(requestedCamera, true),
        requestedRtcMode: normalizeRtcMode(requestedRtcMode || currentUser.rtcMode),
        requestedAt: new Date().toISOString(),
      }

      socket.to(roomKey).emit('stage-join-request-received', { request })
      acknowledgeSignal(acknowledge, { ok: true, request })
    })

    socket.on('stage-join-request-cancelled', ({ roomId, requestId } = {}, acknowledge) => {
      if (!roomId) {
        acknowledgeSignal(acknowledge, { ok: false, message: 'Missing signaling room ID.' })
        return
      }

      const roomKey = String(roomId)
      const users = rooms.get(roomKey)
      const currentUser = users?.get(socket.id)

      if (!users || !currentUser) {
        acknowledgeSignal(acknowledge, { ok: false, message: 'Socket is not in this signaling room.' })
        return
      }

      socket.to(roomKey).emit('stage-join-request-cancelled', {
        requestId,
        userId: currentUser.userId || null,
        socketId: socket.id,
      })
      acknowledgeSignal(acknowledge, { ok: true })
    })

    socket.on('rtc-presence', async ({ roomId, databaseRoomId, roomDbId, micEnabled, cameraEnabled, screenShared } = {}, acknowledge) => {
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
      let stageAccess = null

      try {
        stageAccess = await fetchParticipantStageAccess(resolvedDatabaseRoomId, currentUser.userId)
      } catch (error) {
        if (typeof acknowledge === 'function') acknowledge({ ok: false, message: error.message || 'Presence permission check failed.' })
        return
      }

      const nextCanPublish = stageAccess ? stageAccess.canPublish : currentUser.canPublish
      const nextMicEnabled = normalizeBoolean(micEnabled, currentUser.micEnabled)
      const nextCameraEnabled = normalizeCameraEnabled(cameraEnabled, currentUser.rtcMode, currentUser.cameraEnabled)
      const nextScreenShared = normalizeBoolean(screenShared, currentUser.screenShared)

      if ((nextMicEnabled || nextCameraEnabled || nextScreenShared) && !nextCanPublish) {
        if (typeof acknowledge === 'function') {
          acknowledge({
            ok: false,
            message: 'Ask the room owner for permission before joining the mic or camera stage.',
          })
        }
        return
      }

      const nextUser = {
        ...currentUser,
        databaseRoomId: resolvedDatabaseRoomId,
        stageRole: stageAccess?.stageRole || currentUser.stageRole || 'audience',
        canPublish: nextCanPublish,
        micEnabled: nextCanPublish && nextMicEnabled,
        cameraEnabled: nextCanPublish && nextCameraEnabled,
        screenShared: nextCanPublish && nextScreenShared,
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

    socket.on('room-peers', ({ roomId } = {}, acknowledge) => {
      if (!roomId) {
        acknowledgeSignal(acknowledge, { ok: false, message: 'Missing signaling room ID.' })
        return
      }

      const roomKey = String(roomId)
      if (!socketIsInRoom(socket.id, roomKey)) {
        acknowledgeSignal(acknowledge, { ok: false, message: 'Socket is not in this signaling room.' })
        return
      }

      const users = rooms.get(roomKey) || new Map()
      const existingUsers = Array.from(users.entries())
        .filter(([socketId]) => socketId !== socket.id)
        .map(([socketId, user]) => serializeUser(socketId, user))

      acknowledgeSignal(acknowledge, {
        ok: true,
        roomId: roomKey,
        socketId: socket.id,
        users: existingUsers,
      })
    })

    socket.on('webrtc-offer', ({ targetSocketId, offer } = {}, acknowledge) => {
      forwardPeerSignal(socket, 'webrtc-offer', targetSocketId, offer ? { offer } : null, acknowledge)
    })

    socket.on('webrtc-answer', ({ targetSocketId, answer } = {}, acknowledge) => {
      forwardPeerSignal(socket, 'webrtc-answer', targetSocketId, answer ? { answer } : null, acknowledge)
    })

    socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate } = {}, acknowledge) => {
      forwardPeerSignal(socket, 'webrtc-ice-candidate', targetSocketId, candidate ? { candidate } : null, acknowledge)
    })

    socket.on('media-state-change', async ({ roomId, stageRole, canPublish, rtcMode, micEnabled, cameraEnabled, screenShared } = {}, acknowledge) => {
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

      try {
        const resolvedDatabaseRoomId = resolveDatabaseRoomId(roomKey, currentUser)
        const stageAccess = resolvedDatabaseRoomId && currentUser.userId
          ? await fetchParticipantStageAccess(resolvedDatabaseRoomId, currentUser.userId)
          : null
        const nextRtcMode = normalizeRtcMode(rtcMode || currentUser.rtcMode)
        const nextStageRole = stageAccess?.stageRole || stageRole || currentUser.stageRole || 'audience'
        const nextCanPublish = stageAccess
          ? stageAccess.canPublish
          : normalizeBoolean(canPublish, currentUser.canPublish)
        const nextMicEnabled = normalizeBoolean(micEnabled, currentUser.micEnabled)
        const nextCameraEnabled = normalizeCameraEnabled(cameraEnabled, nextRtcMode, currentUser.cameraEnabled)
        const nextScreenShared = normalizeBoolean(screenShared, currentUser.screenShared)
        const wantsToPublish = nextMicEnabled || nextCameraEnabled || nextScreenShared

        if (wantsToPublish && !nextCanPublish) {
          acknowledgeSignal(acknowledge, {
            ok: false,
            message: 'Ask the room owner for permission before joining the mic or camera stage.',
          })
          return
        }

        const nextUser = {
          ...currentUser,
          stageRole: nextStageRole,
          canPublish: nextCanPublish,
          rtcMode: nextRtcMode,
          micEnabled: nextCanPublish && nextMicEnabled,
          cameraEnabled: nextCanPublish && nextCameraEnabled,
          screenShared: nextCanPublish && nextScreenShared,
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
      } catch (error) {
        acknowledgeSignal(acknowledge, {
          ok: false,
          message: error.message || 'Media state signaling failed.',
        })
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
