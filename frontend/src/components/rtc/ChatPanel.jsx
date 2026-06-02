import { useEffect, useRef, useState } from 'react'
import { avatarForIndex, chatAssets } from '../../assets/rtc/catalog'
import { apiRequest } from '../../services/api'
import { formatChatTime } from '../../utils/formatters'

const maxAudioBytes = 5 * 1024 * 1024

function preferredAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''

  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function shouldSendOnEnter() {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(min-width: 821px) and (hover: hover) and (pointer: fine)').matches
}

function chatSenderName(message, currentUser) {
  if (isOwnMessage(message, currentUser)) return 'You'
  return message.sender_name || `User #${message.sender_id || 'system'}`
}

function isOwnMessage(message, currentUser) {
  return Number(message?.sender_id) === Number(currentUser?.id)
}

function isVisibleRoomMessage(message, blockedSenderIds = []) {
  return (
    message?.message_type !== 'gift'
    && !Boolean(Number(message?.is_deleted || message?.is_unsent))
    && !blockedSenderIds.some((id) => Number(id) === Number(message?.sender_id))
  )
}

function userAvatarMediaUrl(user) {
  const avatar = user?.avatar_url || avatarForIndex(Number(user?.id || 0))
  if (!avatar) return ''
  if (/^data:image\//i.test(avatar) || /^https?:\/\//i.test(avatar)) return avatar
  if (typeof window === 'undefined') return avatar

  try {
    return new URL(avatar, window.location.origin).href
  } catch {
    return ''
  }
}

function roleNames(user) {
  return (Array.isArray(user?.roles) ? user.roles : [])
    .map((role) => (typeof role === 'string' ? role : role?.name))
    .filter(Boolean)
}

function canModerateChat(currentUser, room) {
  if (!currentUser) return false
  if (Number(room?.owner_id) === Number(currentUser.id)) return true

  const roles = roleNames(currentUser)
  return roles.some((role) => ['super_admin', 'client_admin', 'admin', 'moderator'].includes(role))
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read this photo.'))
    reader.readAsDataURL(file)
  })
}

export function ChatPanel({ roomId, signalingRoom, socket, user, room, focusRequest = 0, externalMessage = null, onMessagesChange }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [avatarDraft, setAvatarDraft] = useState(null)
  const [audioDraft, setAudioDraft] = useState(null)
  const [recording, setRecording] = useState(false)
  const [recordingMs, setRecordingMs] = useState(0)
  const [deletingMessageIds, setDeletingMessageIds] = useState({})
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editText, setEditText] = useState('')
  const [savingEditId, setSavingEditId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteForEveryone, setDeleteForEveryone] = useState(true)
  const [blockTarget, setBlockTarget] = useState(null)
  const [blockingUserIds, setBlockingUserIds] = useState({})
  const [blockedSenderIds, setBlockedSenderIds] = useState([])
  const [chatMode, setChatMode] = useState('comments')
  const [inboxThreads, setInboxThreads] = useState([])
  const [inboxMessages, setInboxMessages] = useState([])
  const [inboxTarget, setInboxTarget] = useState(null)
  const [inboxText, setInboxText] = useState('')
  const [loadingInbox, setLoadingInbox] = useState(false)
  const [sendingInbox, setSendingInbox] = useState(false)
  const [chatEnabled, setChatEnabled] = useState(room?.chat_enabled !== false)
  const [typingUsers, setTypingUsers] = useState({})
  const messagesEndRef = useRef(null)
  const inboxEndRef = useRef(null)
  const composerRef = useRef(null)
  const recorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingStreamRef = useRef(null)
  const recordingStartedAtRef = useRef(0)
  const recordingTimerRef = useRef(null)
  const refocusComposerRef = useRef(false)
  const typingTimeoutRef = useRef(null)

  const realtimeConnected = Boolean(socket?.connected && signalingRoom)
  const typingNames = Object.values(typingUsers)
    .filter(Boolean)
    .filter((typingUser) => typingUser.id !== user?.id)
    .map((typingUser) => typingUser.name || 'Someone')
  const canSend = chatEnabled && (Boolean(text.trim()) || Boolean(avatarDraft) || Boolean(audioDraft)) && !sending && !recording
  const canModerate = canModerateChat(user, room)
  const visibleMessages = messages.filter((message) => isVisibleRoomMessage(message, blockedSenderIds))
  const typingText = typingNames.length
    ? `${typingNames.slice(0, 2).join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing...`
    : realtimeConnected ? 'No one is typing' : 'Typing status starts after RTC connects'

  function appendMessage(message) {
    if (!message?.id) return
    if (!isVisibleRoomMessage(message, blockedSenderIds)) return

    setMessages((previous) => {
      if (previous.some((item) => item.id === message.id)) {
        return previous.map((item) => (item.id === message.id ? { ...item, ...message } : item))
      }
      return [...previous, message]
    })
  }

  function replaceMessage(updatedMessage) {
    if (!updatedMessage?.id) return
    setMessages((previous) => previous.map((message) => (
      message.id === updatedMessage.id ? { ...message, ...updatedMessage } : message
    )))
  }

  function removeMessage(messageId) {
    setMessages((previous) => previous.filter((message) => message.id !== messageId))
    if (editingMessageId === messageId) cancelEdit()
  }

  function wasEdited(message) {
    if (!message?.created_at || !message?.updated_at) return false
    return String(message.created_at) !== String(message.updated_at)
  }

  async function loadMessages() {
    if (!roomId) return
    try {
      setLoading(true)
      setStatus('')
      const data = await apiRequest(`/rooms/${roomId}/messages`)
      setMessages(data.messages || [])
      setChatEnabled(data.meta?.chat_enabled !== false)
      setBlockedSenderIds(data.meta?.blocked_user_ids || [])
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoading(false)
    }
  }

  function emitTyping(active) {
    if (!socket || !signalingRoom) return
    socket.emit(active ? 'typing-start' : 'typing-stop', {
      roomId: signalingRoom,
      user: {
        id: user?.id,
        name: user?.name || 'User',
      },
    })
  }

  function updateText(value) {
    setText(value)

    if (!value.trim()) {
      emitTyping(false)
      return
    }

    emitTyping(true)
    window.clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = window.setTimeout(() => emitTyping(false), 1400)
  }

  function stageAvatarDraft() {
    if (!chatEnabled || sending) return

    const dataUrl = userAvatarMediaUrl(user)
    if (!dataUrl) {
      setStatus('No avatar is available for this account.')
      return
    }

    setStatus('')
    setAvatarDraft({ dataUrl })
    setAudioDraft(null)
    refocusComposerRef.current = true
  }

  function clearAvatarDraft() {
    setAvatarDraft(null)
  }

  function stopRecordingTracks() {
    recordingStreamRef.current?.getTracks?.().forEach((track) => {
      try { track.stop() } catch {}
    })
    recordingStreamRef.current = null
  }

  function clearRecordingTimer() {
    window.clearInterval(recordingTimerRef.current)
    recordingTimerRef.current = null
  }

  async function startAudioRecording() {
    if (!chatEnabled || sending || recording) return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('Audio recording is not supported in this browser.')
      return
    }

    try {
      setStatus('')
      setAudioDraft(null)
      setAvatarDraft(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = preferredAudioMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recordingChunksRef.current = []
      recordingStreamRef.current = stream
      recorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordingChunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        clearRecordingTimer()
        setRecording(false)
        stopRecordingTracks()

        try {
          const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          recordingChunksRef.current = []
          if (!blob.size) return
          if (blob.size > maxAudioBytes) {
            setStatus('Audio message must be smaller than 5 MB.')
            return
          }
          const dataUrl = await readFileAsDataUrl(blob)
          setAudioDraft({
            dataUrl,
            size: blob.size,
            durationMs: Date.now() - recordingStartedAtRef.current,
          })
          refocusComposerRef.current = true
        } catch (error) {
          setStatus(error.message)
        } finally {
          recorderRef.current = null
        }
      }

      recordingStartedAtRef.current = Date.now()
      setRecordingMs(0)
      setRecording(true)
      recorder.start()
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingMs(Date.now() - recordingStartedAtRef.current)
      }, 250)
    } catch (error) {
      clearRecordingTimer()
      setRecording(false)
      stopRecordingTracks()
      setStatus(`Audio recording failed: ${error.message}`)
    }
  }

  function stopAudioRecording() {
    if (!recording || !recorderRef.current) return
    try {
      recorderRef.current.stop()
    } catch (error) {
      setStatus(error.message)
      clearRecordingTimer()
      setRecording(false)
      stopRecordingTracks()
    }
  }

  function cancelAudioDraft() {
    setAudioDraft(null)
  }

  async function sendMessage(event) {
    event.preventDefault()
    const value = text.trim()
    if ((!value && !avatarDraft && !audioDraft) || sending || recording) return

    try {
      setSending(true)
      setStatus('')
      const messageType = audioDraft ? 'voice' : avatarDraft ? 'image' : 'text'
      const data = await apiRequest(`/rooms/${roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          message_body: avatarDraft && !value ? 'sent an avatar' : value,
          message_type: messageType,
          ...(avatarDraft ? { media_url: avatarDraft.dataUrl } : {}),
          ...(audioDraft ? { media_url: audioDraft.dataUrl } : {}),
        }),
      })
      appendMessage(data.chat_message)
      setText('')
      clearAvatarDraft()
      cancelAudioDraft()
      refocusComposerRef.current = true
      emitTyping(false)
      window.clearTimeout(typingTimeoutRef.current)

      if (socket && signalingRoom) {
        socket.timeout(3000).emit(
          'chat-message',
          {
            roomId: signalingRoom,
            message: data.chat_message,
          },
          (error, response) => {
            if (error || !response?.ok) setStatus('Message saved. Realtime delivery will resume when signaling reconnects.')
          }
        )
      }
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSending(false)
    }
  }

  function startEdit(message) {
    if (!message?.id || !isOwnMessage(message, user) || message.is_deleted) return
    setEditingMessageId(message.id)
    setEditText(message.message_body || '')
    setStatus('')
  }

  function cancelEdit() {
    setEditingMessageId(null)
    setEditText('')
    setSavingEditId(null)
  }

  async function saveEdit(message, event) {
    event?.preventDefault()
    const value = editText.trim()

    if (!message?.id || !isOwnMessage(message, user) || savingEditId) return
    if (!value) {
      setStatus('Edited message cannot be empty.')
      return
    }

    if (value === String(message.message_body || '').trim()) {
      cancelEdit()
      return
    }

    const previousMessage = message
    setSavingEditId(message.id)
    setStatus('')
    replaceMessage({ ...message, message_body: value, updated_at: new Date().toISOString() })

    try {
      const data = await apiRequest(`/messages/${message.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ message_body: value }),
      })
      replaceMessage(data.chat_message)
      cancelEdit()

      if (socket && signalingRoom) {
        socket.timeout(3000).emit(
          'chat-message-edited',
          {
            roomId: signalingRoom,
            message: data.chat_message,
          },
          (error, response) => {
            if (error || !response?.ok) setStatus('Message edited. Realtime update will resume when signaling reconnects.')
          }
        )
      }
    } catch (error) {
      replaceMessage(previousMessage)
      setStatus(`Edit failed: ${error.message}`)
    } finally {
      setSavingEditId(null)
    }
  }

  function handleEditKeyDown(message, event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      saveEdit(message, event)
    }
  }

  function canDeleteMessage(message) {
    if (!message?.id || message.is_deleted) return false
    return Boolean(user?.id)
  }

  function canDeleteMessageForEveryone(message) {
    if (!message?.id || message.is_deleted) return false
    return isOwnMessage(message, user) || canModerate
  }

  function canBlockMessage(message) {
    if (!message?.id || !message.sender_id || isOwnMessage(message, user)) return false
    return !blockedSenderIds.some((id) => Number(id) === Number(message.sender_id))
  }

  function requestDeleteMessage(message) {
    if (!canDeleteMessage(message)) return
    setDeleteTarget(message)
    setDeleteForEveryone(canDeleteMessageForEveryone(message))
    setStatus('')
  }

  function closeDeleteModal() {
    if (deleteTarget && deletingMessageIds[deleteTarget.id]) return
    setDeleteTarget(null)
  }

  function requestBlockUser(message) {
    if (!canBlockMessage(message)) return
    setBlockTarget(message)
    setStatus('')
  }

  function closeBlockModal() {
    if (blockTarget && blockingUserIds[blockTarget.sender_id]) return
    setBlockTarget(null)
  }

  async function confirmBlockUser() {
    const target = blockTarget
    const blockedUserId = Number(target?.sender_id)
    if (!target || !blockedUserId || blockingUserIds[blockedUserId]) return

    setBlockingUserIds((previous) => ({ ...previous, [blockedUserId]: true }))
    setStatus('')

    try {
      await apiRequest(`/rooms/${roomId}/blocks`, {
        method: 'POST',
        body: JSON.stringify({ blocked_user_id: blockedUserId }),
      })
      setBlockedSenderIds((previous) => (
        previous.some((id) => Number(id) === blockedUserId) ? previous : [...previous, blockedUserId]
      ))
      setMessages((previous) => previous.filter((message) => Number(message.sender_id) !== blockedUserId))
      setTypingUsers((previous) => Object.fromEntries(
        Object.entries(previous).filter(([, typingUser]) => Number(typingUser?.id) !== blockedUserId)
      ))
      setStatus(`${chatSenderName(target, user)} is blocked in this room.`)
      setBlockTarget(null)
    } catch (error) {
      setStatus(`Block failed: ${error.message}`)
    } finally {
      setBlockingUserIds((previous) => {
        const next = { ...previous }
        delete next[blockedUserId]
        return next
      })
    }
  }

  async function loadInboxThreads() {
    try {
      setLoadingInbox(true)
      setStatus('')
      const data = await apiRequest('/direct-messages/threads')
      setInboxThreads(data.threads || [])
    } catch (error) {
      setStatus(`Inbox failed: ${error.message}`)
    } finally {
      setLoadingInbox(false)
    }
  }

  async function loadInboxConversation(peer) {
    if (!peer?.id && !peer?.peer_id) return
    const peerId = Number(peer.id || peer.peer_id)
    const target = {
      id: peerId,
      name: peer.name || peer.peer_name || `User #${peerId}`,
      avatar_url: peer.avatar_url || peer.peer_avatar_url || '',
    }

    setInboxTarget(target)
    setChatMode('inbox')
    setLoadingInbox(true)
    setStatus('')

    try {
      const data = await apiRequest(`/direct-messages/${peerId}`)
      setInboxTarget(data.peer ? {
        id: Number(data.peer.id),
        name: data.peer.name || target.name,
        avatar_url: data.peer.avatar_url || target.avatar_url,
      } : target)
      setInboxMessages(data.messages || [])
    } catch (error) {
      setStatus(`Inbox failed: ${error.message}`)
    } finally {
      setLoadingInbox(false)
    }
  }

  function openInboxFromMessage(message) {
    if (!message?.sender_id || isOwnMessage(message, user)) return
    loadInboxConversation({
      id: message.sender_id,
      name: message.sender_name,
      avatar_url: message.sender_avatar_url,
    })
  }

  async function sendInboxMessage(event) {
    event.preventDefault()
    const value = inboxText.trim()
    if (!value || !inboxTarget?.id || sendingInbox) return

    try {
      setSendingInbox(true)
      setStatus('')
      const data = await apiRequest(`/direct-messages/${inboxTarget.id}`, {
        method: 'POST',
        body: JSON.stringify({ message_body: value, message_type: 'text' }),
      })
      setInboxMessages((previous) => [...previous, data.direct_message])
      setInboxText('')
      loadInboxThreads()
    } catch (error) {
      setStatus(`Send failed: ${error.message}`)
    } finally {
      setSendingInbox(false)
    }
  }

  async function confirmDeleteMessage() {
    const message = deleteTarget
    if (!canDeleteMessage(message)) return

    const shouldDeleteForEveryone = deleteForEveryone && canDeleteMessageForEveryone(message)
    const previousMessages = messages
    setDeletingMessageIds((previous) => ({ ...previous, [message.id]: true }))
    setStatus('')
    removeMessage(message.id)

    try {
      const data = await apiRequest(`/messages/${message.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ for_everyone: shouldDeleteForEveryone }),
      })

      if (data.deleted_for_everyone && socket && signalingRoom) {
        socket.timeout(3000).emit(
          'chat-message-deleted',
          {
            roomId: signalingRoom,
            messageId: message.id,
          },
          (error, response) => {
            if (error || !response?.ok) setStatus('Message deleted. Realtime update will resume when signaling reconnects.')
          }
        )
      }
    } catch (error) {
      setMessages(previousMessages)
      setStatus(`Delete failed: ${error.message}`)
    } finally {
      setDeleteTarget(null)
      setDeletingMessageIds((previous) => {
        const next = { ...previous }
        delete next[message.id]
        return next
      })
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && shouldSendOnEnter()) {
      event.preventDefault()
      sendMessage(event)
    }
  }

  function stopTyping() {
    window.clearTimeout(typingTimeoutRef.current)
    emitTyping(false)
  }

  useEffect(() => {
    setChatEnabled(room?.chat_enabled !== false)
  }, [room?.chat_enabled])

  useEffect(() => {
    if (!focusRequest) return
    composerRef.current?.focus()
    composerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusRequest])

  useEffect(() => {
    appendMessage(externalMessage)
  }, [externalMessage])

  useEffect(() => {
    onMessagesChange?.(visibleMessages)
  }, [messages, blockedSenderIds, onMessagesChange])

  useEffect(() => {
    loadMessages()
  }, [roomId])

  useEffect(() => {
    if (chatMode === 'inbox') loadInboxThreads()
  }, [chatMode])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [visibleMessages.length])

  useEffect(() => {
    inboxEndRef.current?.scrollIntoView({ block: 'end' })
  }, [inboxMessages.length, chatMode])

  useEffect(() => {
    if (!sending && refocusComposerRef.current) {
      refocusComposerRef.current = false
      composerRef.current?.focus()
    }
  }, [sending])

  useEffect(() => {
    if (!socket) return undefined
    const handleMessage = ({ message }) => appendMessage(message)
    const handleMessageEdited = ({ message }) => replaceMessage(message)
    const handleMessageDeleted = ({ messageId }) => {
      if (!messageId) return
      removeMessage(messageId)
    }
    const handleMessageUnsent = ({ messageId, message }) => {
      if (!messageId) return
      if (message?.is_deleted || message?.is_unsent || !message) removeMessage(messageId)
    }
    const handleTypingStart = ({ user: typingUser, socketId }) => {
      if (!typingUser || typingUser.id === user?.id) return
      if (blockedSenderIds.some((id) => Number(id) === Number(typingUser.id))) return
      setTypingUsers((previous) => ({ ...previous, [socketId || typingUser.id]: typingUser }))
    }
    const handleTypingStop = ({ user: typingUser, socketId }) => {
      setTypingUsers((previous) => {
        const copy = { ...previous }
        delete copy[socketId || typingUser?.id]
        return copy
      })
    }

    socket.on('chat-message', handleMessage)
    socket.on('chat-message-edited', handleMessageEdited)
    socket.on('chat-message-deleted', handleMessageDeleted)
    socket.on('chat-message-unsent', handleMessageUnsent)
    socket.on('typing-start', handleTypingStart)
    socket.on('typing-stop', handleTypingStop)

    return () => {
      socket.off('chat-message', handleMessage)
      socket.off('chat-message-edited', handleMessageEdited)
      socket.off('chat-message-deleted', handleMessageDeleted)
      socket.off('chat-message-unsent', handleMessageUnsent)
      socket.off('typing-start', handleTypingStart)
      socket.off('typing-stop', handleTypingStop)
    }
  }, [socket, user?.id, blockedSenderIds])

  useEffect(() => () => {
    window.clearTimeout(typingTimeoutRef.current)
    emitTyping(false)
    if (recorderRef.current?.state !== 'inactive') {
      try { recorderRef.current.stop() } catch {}
    }
    clearRecordingTimer()
    stopRecordingTracks()
  }, [socket, signalingRoom])

  return (
    <aside className="chat-panel glass-card">
      <div className="chat-panel-header">
        <div>
          <span className="eyebrow">{chatMode === 'inbox' ? 'Personal Inbox' : 'Room Comments'}</span>
          <h3>{chatMode === 'inbox' ? (inboxTarget?.name || 'Inbox') : 'Live Chat'}</h3>
        </div>
        <span className={realtimeConnected ? 'chat-connection online' : 'chat-connection'}>
          {chatMode === 'inbox' ? 'Private' : typingNames.length ? 'Typing' : realtimeConnected ? 'Realtime' : 'Saved'}
        </span>
      </div>

      {chatMode === 'comments' ? (
      <>
      <div className="messages">
        {loading ? (
          <div className="empty-chat">Loading chat...</div>
        ) : visibleMessages.length === 0 ? (
          <div className="empty-chat">
            <img className="empty-chat-art" src={chatAssets.mobileChat} alt="" loading="lazy" />
            <strong>No messages yet</strong>
            <span>The conversation will appear here.</span>
          </div>
        ) : visibleMessages.map((message) => {
          const mine = isOwnMessage(message, user)
          const senderName = chatSenderName(message, user)
          const senderAvatar = message.sender_avatar_url || avatarForIndex(Number(message.sender_id || 0))
          const imageMessage = message.message_type === 'image'
          const avatarMessage = imageMessage && String(message.message_body || '').trim() === 'sent an avatar'
          const voiceMessage = message.message_type === 'voice'
          const systemMessage = message.message_type === 'system'
          const canModify = mine && message.message_type === 'text'
          const canDelete = canDeleteMessage(message)
          const canBlock = canBlockMessage(message)
          const canMessage = !mine && Boolean(message.sender_id)
          const deleting = Boolean(deletingMessageIds[message.id])
          const editing = editingMessageId === message.id
          const savingEdit = savingEditId === message.id
          const photoCaption = imageMessage && !['sent a photo', 'sent an avatar'].includes(String(message.message_body || '').trim())
            ? String(message.message_body || '').trim()
            : ''
          const bubbleClass = imageMessage
            ? 'chat-bubble image-message' : voiceMessage ? 'chat-bubble voice-message' : systemMessage ? 'chat-bubble system-message' : 'chat-bubble'

          return (
            <div className={mine ? 'chat-row mine' : 'chat-row'} key={`${message.id}-${message.created_at || ''}`}>
              <div className="chat-avatar image-avatar">
                <img src={senderAvatar} alt={senderName} loading="lazy" />
              </div>
              <div className={bubbleClass}>
                <div className="chat-meta">
                  <strong>{senderName}</strong>
                  <time>{formatChatTime(message.created_at)}{wasEdited(message) ? ' edited' : ''}</time>
                </div>
                {editing ? (
                  <form className="chat-edit-form" onSubmit={(event) => saveEdit(message, event)}>
                    <textarea
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      onKeyDown={(event) => handleEditKeyDown(message, event)}
                      maxLength={1200}
                      rows={2}
                      autoFocus
                    />
                    <div className="chat-edit-actions">
                      <button type="submit" disabled={savingEdit || !editText.trim()}>
                        {savingEdit ? 'Saving' : 'Save'}
                      </button>
                      <button type="button" className="secondary" onClick={cancelEdit} disabled={savingEdit}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : imageMessage ? (
                  <div className="chat-image-message">
                    <a href={message.media_url} target="_blank" rel="noreferrer" aria-label={avatarMessage ? 'Open avatar' : 'Open image'}>
                      <img className={avatarMessage ? 'chat-photo chat-avatar-share' : 'chat-photo'} src={message.media_url} alt={`${senderName} sent`} loading="lazy" />
                    </a>
                    {photoCaption ? <p>{photoCaption}</p> : null}
                  </div>
                ) : voiceMessage ? (
                  <div className="chat-voice-message">
                    <audio controls src={message.media_url}></audio>
                    <span>{message.message_body || 'Voice message'}</span>
                  </div>
                ) : (
                  <p>{message.message_body}</p>
                )}
                {(canModify || canDelete || canBlock || canMessage) && !editing && (
                  <div className="chat-actions">
                    {canMessage ? (
                      <button type="button" className="neutral" onClick={() => openInboxFromMessage(message)}>
                        Message
                      </button>
                    ) : null}
                    {canModify ? (
                      <button type="button" className="neutral" onClick={() => startEdit(message)} disabled={deleting}>
                        Edit
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button type="button" className="danger" onClick={() => requestDeleteMessage(message)} disabled={deleting}>
                        {deleting ? 'Deleting' : 'Delete'}
                      </button>
                    ) : null}
                    {canBlock ? (
                      <button type="button" className="block" onClick={() => requestBlockUser(message)} disabled={Boolean(blockingUserIds[message.sender_id])}>
                        {blockingUserIds[message.sender_id] ? 'Blocking' : 'Block'}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className={typingNames.length ? 'typing-line active' : 'typing-line'}>
        {typingText}
      </div>

      <form className="chat-form" onSubmit={sendMessage}>
        {avatarDraft ? (
          <div className="chat-photo-draft chat-avatar-draft">
            <img src={avatarDraft.dataUrl} alt="" />
            <span>
              <strong>Avatar</strong>
              <small>Your avatar is ready</small>
            </span>
            <button type="button" onClick={clearAvatarDraft} disabled={sending} aria-label="Remove avatar">x</button>
          </div>
        ) : null}
        {audioDraft ? (
          <div className="chat-audio-draft">
            <audio controls src={audioDraft.dataUrl}></audio>
            <span>{formatDuration(audioDraft.durationMs)} voice note</span>
            <button type="button" onClick={cancelAudioDraft} disabled={sending} aria-label="Remove audio">x</button>
          </div>
        ) : null}
        {recording ? (
          <div className="chat-recording-line">
            <span>{formatDuration(recordingMs)}</span>
            <b>Recording voice message</b>
          </div>
        ) : null}
        <textarea
          ref={composerRef}
          value={text}
          onChange={(event) => updateText(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          onBlur={stopTyping}
          placeholder={chatEnabled ? ((avatarDraft || audioDraft) ? 'Add a caption' : 'Message this room') : 'Chat is disabled'}
          maxLength={1200}
          rows={2}
          disabled={!chatEnabled || sending || recording}
        />
        {!chatEnabled ? <small className="chat-disabled-note">Owner controls currently have Chat turned off.</small> : null}
        <div className="chat-form-footer">
          <span>{text.length}/1200</span>
          <div className="chat-form-actions">
            <button type="button" className="secondary-button chat-avatar-button" onClick={stageAvatarDraft} disabled={!chatEnabled || sending}>
              Avatar
            </button>
            <button
              type="button"
              className={recording ? 'secondary-button chat-audio-button recording' : 'secondary-button chat-audio-button'}
              onClick={recording ? stopAudioRecording : startAudioRecording}
              disabled={!chatEnabled || sending}
            >
              {recording ? 'Stop' : 'Audio'}
            </button>
            <button className="primary-button" type="submit" disabled={!canSend}>
              {sending ? 'Sending' : 'Send'}
            </button>
          </div>
        </div>
      </form>
      </>
      ) : (
      <>
      <div className="personal-inbox">
        <div className="inbox-thread-strip">
          {loadingInbox && !inboxThreads.length ? (
            <span>Loading inbox...</span>
          ) : inboxThreads.length ? inboxThreads.map((thread) => {
            const active = Number(inboxTarget?.id) === Number(thread.peer_id)
            const preview = thread.last_message?.message_type === 'voice'
              ? 'Voice message'
              : thread.last_message?.message_type === 'image' ? 'Photo' : thread.last_message?.message_body

            return (
              <button key={thread.peer_id} type="button" className={active ? 'active' : ''} onClick={() => loadInboxConversation(thread)}>
                <span className="image-avatar"><img src={thread.peer_avatar_url || avatarForIndex(thread.peer_id)} alt="" loading="lazy" /></span>
                <b>{thread.peer_name || `User #${thread.peer_id}`}</b>
                <small>{preview || 'New chat'}</small>
              </button>
            )
          }) : (
            <span>No private chats yet</span>
          )}
        </div>

        <div className="messages inbox-messages">
          {!inboxTarget ? (
            <div className="empty-chat">
              <strong>Personal inbox</strong>
              <span>Tap Message on a room comment to start a private chat.</span>
            </div>
          ) : loadingInbox ? (
            <div className="empty-chat">Loading conversation...</div>
          ) : inboxMessages.length === 0 ? (
            <div className="empty-chat">
              <strong>{inboxTarget.name}</strong>
              <span>No private messages yet.</span>
            </div>
          ) : inboxMessages.map((message) => {
            const mine = Number(message.sender_id) === Number(user?.id)
            const senderName = mine ? 'You' : message.sender_name || inboxTarget.name
            const imageMessage = message.message_type === 'image'
            const voiceMessage = message.message_type === 'voice'
            const body = message.message_body || ''

            return (
              <div className={mine ? 'chat-row mine' : 'chat-row'} key={`dm-${message.id}`}>
                <div className="chat-avatar image-avatar">
                  <img src={(mine ? user?.avatar_url : inboxTarget.avatar_url) || avatarForIndex(message.sender_id || 0)} alt={senderName} loading="lazy" />
                </div>
                <div className={imageMessage ? 'chat-bubble image-message' : voiceMessage ? 'chat-bubble voice-message' : 'chat-bubble'}>
                  <div className="chat-meta">
                    <strong>{senderName}</strong>
                    <time>{formatChatTime(message.created_at)}</time>
                  </div>
                  {imageMessage ? (
                    <div className="chat-image-message">
                      <a href={message.media_url} target="_blank" rel="noreferrer" aria-label="Open photo">
                        <img className="chat-photo" src={message.media_url} alt={`${senderName} sent`} loading="lazy" />
                      </a>
                      {body && body !== 'sent a photo' ? <p>{body}</p> : null}
                    </div>
                  ) : voiceMessage ? (
                    <div className="chat-voice-message">
                      <audio controls src={message.media_url}></audio>
                      <span>{body || 'Voice message'}</span>
                    </div>
                  ) : (
                    <p>{body}</p>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={inboxEndRef} />
        </div>
      </div>

      <form className="chat-form" onSubmit={sendInboxMessage}>
        <textarea
          value={inboxText}
          onChange={(event) => setInboxText(event.target.value)}
          placeholder={inboxTarget ? `Message ${inboxTarget.name}` : 'Choose a private chat'}
          maxLength={1200}
          rows={2}
          disabled={!inboxTarget || sendingInbox}
        />
        <div className="chat-form-footer">
          <span>{inboxText.length}/1200</span>
          <div className="chat-form-actions">
            <button className="primary-button" type="submit" disabled={!inboxTarget || !inboxText.trim() || sendingInbox}>
              {sendingInbox ? 'Sending' : 'Send'}
            </button>
          </div>
        </div>
      </form>
      </>
      )}
      {status && <small className="warning-text">{status}</small>}

      {deleteTarget ? (
        <div className="chat-delete-backdrop" onMouseDown={closeDeleteModal}>
          <section className="chat-delete-modal" role="dialog" aria-modal="true" aria-labelledby="chat-delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <h3 id="chat-delete-title">Delete message</h3>
            <p>Are you sure you want to delete this message?</p>
            <label className={canDeleteMessageForEveryone(deleteTarget) ? 'chat-delete-option' : 'chat-delete-option disabled'}>
              <input
                type="checkbox"
                checked={deleteForEveryone && canDeleteMessageForEveryone(deleteTarget)}
                disabled={!canDeleteMessageForEveryone(deleteTarget) || Boolean(deletingMessageIds[deleteTarget.id])}
                onChange={(event) => setDeleteForEveryone(event.target.checked)}
              />
              <span>
                {canDeleteMessageForEveryone(deleteTarget)
                  ? 'Delete for everyone in this room'
                  : 'Delete only for me'}
              </span>
            </label>
            {canDeleteMessageForEveryone(deleteTarget) ? (
              <small className="chat-delete-hint">{deleteForEveryone ? 'Everyone will lose this message.' : 'Only your chat will hide this message.'}</small>
            ) : null}
            <footer>
              <button type="button" className="secondary-button" onClick={closeDeleteModal} disabled={Boolean(deletingMessageIds[deleteTarget.id])}>CANCEL</button>
              <button type="button" className="danger-button" onClick={confirmDeleteMessage} disabled={Boolean(deletingMessageIds[deleteTarget.id])}>
                {deletingMessageIds[deleteTarget.id] ? 'DELETING...' : 'DELETE'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {blockTarget ? (
        <div className="chat-delete-backdrop" onMouseDown={closeBlockModal}>
          <section className="chat-delete-modal" role="dialog" aria-modal="true" aria-labelledby="chat-block-title" onMouseDown={(event) => event.stopPropagation()}>
            <h3 id="chat-block-title">Block user</h3>
            <p>Block {chatSenderName(blockTarget, user)} in this room?</p>
            <small className="chat-delete-hint">Their current messages will disappear from your chat and new messages from them will be hidden.</small>
            <footer>
              <button type="button" className="secondary-button" onClick={closeBlockModal} disabled={Boolean(blockingUserIds[blockTarget.sender_id])}>CANCEL</button>
              <button type="button" className="danger-button" onClick={confirmBlockUser} disabled={Boolean(blockingUserIds[blockTarget.sender_id])}>
                {blockingUserIds[blockTarget.sender_id] ? 'BLOCKING...' : 'BLOCK'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </aside>
  )
}
