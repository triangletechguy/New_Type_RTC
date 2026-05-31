import { useEffect, useRef, useState } from 'react'
import { avatarForIndex, chatAssets } from '../../assets/rtc/catalog'
import { apiRequest } from '../../services/api'
import { formatChatTime } from '../../utils/formatters'
import { giftById, giftIconForId, giftLabelForId } from '../../utils/gifts'

const maxPhotoBytes = 5 * 1024 * 1024
const supportedPhotoTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function chatSenderName(message, currentUser) {
  if (isOwnMessage(message, currentUser)) return 'You'
  return message.sender_name || `User #${message.sender_id || 'system'}`
}

function isOwnMessage(message, currentUser) {
  return Number(message?.sender_id) === Number(currentUser?.id)
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
  const [photoDraft, setPhotoDraft] = useState(null)
  const [deletingMessageIds, setDeletingMessageIds] = useState({})
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editText, setEditText] = useState('')
  const [savingEditId, setSavingEditId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteForEveryone, setDeleteForEveryone] = useState(true)
  const [blockTarget, setBlockTarget] = useState(null)
  const [blockingUserIds, setBlockingUserIds] = useState({})
  const [blockedSenderIds, setBlockedSenderIds] = useState([])
  const [chatEnabled, setChatEnabled] = useState(room?.chat_enabled !== false)
  const [typingUsers, setTypingUsers] = useState({})
  const messagesEndRef = useRef(null)
  const composerRef = useRef(null)
  const photoInputRef = useRef(null)
  const refocusComposerRef = useRef(false)
  const typingTimeoutRef = useRef(null)

  const realtimeConnected = Boolean(socket?.connected && signalingRoom)
  const typingNames = Object.values(typingUsers)
    .filter(Boolean)
    .filter((typingUser) => typingUser.id !== user?.id)
    .map((typingUser) => typingUser.name || 'Someone')
  const canSend = chatEnabled && (Boolean(text.trim()) || Boolean(photoDraft)) && !sending
  const canModerate = canModerateChat(user, room)
  const visibleMessages = messages.filter((message) => (
    !Boolean(Number(message.is_deleted || message.is_unsent))
    && !blockedSenderIds.some((id) => Number(id) === Number(message.sender_id))
  ))
  const typingText = typingNames.length
    ? `${typingNames.slice(0, 2).join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing...`
    : realtimeConnected ? 'No one is typing' : 'Typing status starts after RTC connects'

  function appendMessage(message) {
    if (!message?.id) return
    if (blockedSenderIds.some((id) => Number(id) === Number(message.sender_id))) return

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

  function openPhotoPicker() {
    if (!chatEnabled || sending) return
    photoInputRef.current?.click()
  }

  async function selectPhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setStatus('')
      if (!supportedPhotoTypes.has(file.type)) {
        setStatus('Choose a PNG, JPG, GIF, or WebP photo.')
        return
      }

      if (file.size > maxPhotoBytes) {
        setStatus('Photo must be smaller than 5 MB.')
        return
      }

      const dataUrl = await readFileAsDataUrl(file)
      setPhotoDraft({
        dataUrl,
        name: file.name,
        size: file.size,
      })
      refocusComposerRef.current = true
    } catch (error) {
      setStatus(error.message)
    } finally {
      event.target.value = ''
    }
  }

  function clearPhotoDraft() {
    setPhotoDraft(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  async function sendMessage(event) {
    event.preventDefault()
    const value = text.trim()
    if ((!value && !photoDraft) || sending) return

    try {
      setSending(true)
      setStatus('')
      const messageType = photoDraft ? 'image' : 'text'
      const data = await apiRequest(`/rooms/${roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          message_body: value,
          message_type: messageType,
          ...(photoDraft ? { media_url: photoDraft.dataUrl } : {}),
        }),
      })
      appendMessage(data.chat_message)
      setText('')
      clearPhotoDraft()
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
    if (event.key === 'Enter' && !event.shiftKey) {
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
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [visibleMessages.length])

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
  }, [socket, signalingRoom])

  return (
    <aside className="chat-panel glass-card">
      <div className="chat-panel-header">
        <div>
          <span className="eyebrow">Room Chat</span>
          <h3>Live Chat</h3>
        </div>
        <span className={realtimeConnected ? 'chat-connection online' : 'chat-connection'}>
          {typingNames.length ? 'Typing' : realtimeConnected ? 'Realtime' : 'Saved'}
        </span>
      </div>

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
          const giftMessage = message.message_type === 'gift'
          const imageMessage = message.message_type === 'image'
          const gift = giftMessage ? giftById(message.media_url) : null
          const systemMessage = message.message_type === 'system'
          const canModify = mine && message.message_type === 'text'
          const canDelete = canDeleteMessage(message)
          const canBlock = canBlockMessage(message)
          const deleting = Boolean(deletingMessageIds[message.id])
          const editing = editingMessageId === message.id
          const savingEdit = savingEditId === message.id
          const photoCaption = imageMessage && message.message_body !== 'sent a photo'
            ? String(message.message_body || '').trim()
            : ''
          const bubbleClass = giftMessage
            ? 'chat-bubble gift-message'
            : imageMessage ? 'chat-bubble image-message' : systemMessage ? 'chat-bubble system-message' : 'chat-bubble'

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
                ) : giftMessage ? (
                  <p className="chat-gift-message">
                    <span className="chat-gift-icon"><img src={gift?.icon || giftIconForId(message.media_url)} alt="" /></span>
                    <span>{message.message_body || `sent ${giftLabelForId(message.media_url)}`}</span>
                  </p>
                ) : imageMessage ? (
                  <div className="chat-image-message">
                    <a href={message.media_url} target="_blank" rel="noreferrer" aria-label="Open photo">
                      <img className="chat-photo" src={message.media_url} alt={`${senderName} sent`} loading="lazy" />
                    </a>
                    {photoCaption ? <p>{photoCaption}</p> : null}
                  </div>
                ) : (
                  <p>{message.message_body}</p>
                )}
                {(canModify || canDelete || canBlock) && !editing && (
                  <div className="chat-actions">
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
        {photoDraft ? (
          <div className="chat-photo-draft">
            <img src={photoDraft.dataUrl} alt="" />
            <span>
              <strong>{photoDraft.name || 'Photo'}</strong>
              <small>{Math.max(1, Math.round(photoDraft.size / 1024))} KB ready</small>
            </span>
            <button type="button" onClick={clearPhotoDraft} disabled={sending} aria-label="Remove photo">x</button>
          </div>
        ) : null}
        <input
          ref={photoInputRef}
          className="chat-photo-input"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={selectPhoto}
          disabled={!chatEnabled || sending}
        />
        <textarea
          ref={composerRef}
          value={text}
          onChange={(event) => updateText(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          onBlur={stopTyping}
          placeholder={chatEnabled ? (photoDraft ? 'Add a caption' : 'Message this room') : 'Chat is disabled'}
          maxLength={1200}
          rows={2}
          disabled={!chatEnabled || sending}
        />
        {!chatEnabled ? <small className="chat-disabled-note">Owner controls currently have Chat turned off.</small> : null}
        <div className="chat-form-footer">
          <span>{text.length}/1200</span>
          <div className="chat-form-actions">
            <button type="button" className="secondary-button chat-photo-button" onClick={openPhotoPicker} disabled={!chatEnabled || sending}>
              Photo
            </button>
            <button className="primary-button" type="submit" disabled={!canSend}>
              {sending ? 'Sending' : 'Send'}
            </button>
          </div>
        </div>
      </form>
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
