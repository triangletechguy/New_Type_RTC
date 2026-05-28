import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../services/api'
import { formatChatTime, getInitials } from '../../utils/formatters'

function chatSenderName(message, currentUser) {
  if (message.sender_id === currentUser?.id) return 'You'
  return message.sender_name || `User #${message.sender_id || 'system'}`
}

export function ChatPanel({ roomId, signalingRoom, socket, user, room }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [deletingMessageIds, setDeletingMessageIds] = useState({})
  const [chatEnabled, setChatEnabled] = useState(room?.chat_enabled !== false)
  const [typingUsers, setTypingUsers] = useState({})
  const messagesEndRef = useRef(null)
  const composerRef = useRef(null)
  const refocusComposerRef = useRef(false)
  const typingTimeoutRef = useRef(null)

  const realtimeConnected = Boolean(socket?.connected && signalingRoom)
  const typingNames = Object.values(typingUsers)
    .filter(Boolean)
    .filter((typingUser) => typingUser.id !== user?.id)
    .map((typingUser) => typingUser.name || 'Someone')
  const canSend = chatEnabled && Boolean(text.trim()) && !sending

  function appendMessage(message) {
    if (!message?.id) return
    setMessages((previous) => {
      if (previous.some((item) => item.id === message.id)) return previous
      return [...previous, message]
    })
  }

  function markMessageUnsent(messageId, replacement = {}) {
    setMessages((previous) => previous.map((message) => {
      if (message.id !== messageId) return message

      return {
        ...message,
        ...replacement,
        id: message.id,
        is_deleted: 1,
        is_unsent: 1,
        message_body: '',
      }
    }))
  }

  async function loadMessages() {
    if (!roomId) return
    try {
      setLoading(true)
      setStatus('')
      const data = await apiRequest(`/rooms/${roomId}/messages`)
      setMessages(data.messages || [])
      setChatEnabled(data.meta?.chat_enabled !== false)
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

  async function sendMessage(event) {
    event.preventDefault()
    const value = text.trim()
    if (!value || sending) return

    try {
      setSending(true)
      setStatus('')
      const data = await apiRequest(`/rooms/${roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message_body: value, message_type: 'text' }),
      })
      appendMessage(data.chat_message)
      setText('')
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

  async function unsendMessage(message) {
    if (!message?.id || message.sender_id !== user?.id || message.is_deleted) return

    const previousMessage = message
    setDeletingMessageIds((previous) => ({ ...previous, [message.id]: true }))
    setStatus('')
    markMessageUnsent(message.id)

    try {
      const data = await apiRequest(`/messages/${message.id}`, { method: 'DELETE' })
      markMessageUnsent(message.id, data.chat_message || {})

      if (socket && signalingRoom) {
        socket.timeout(3000).emit(
          'chat-message-unsent',
          {
            roomId: signalingRoom,
            messageId: message.id,
            message: data.chat_message,
          },
          (error, response) => {
            if (error || !response?.ok) setStatus('Message unsent. Realtime update will resume when signaling reconnects.')
          }
        )
      }
    } catch (error) {
      setMessages((previous) => previous.map((item) => (item.id === previousMessage.id ? previousMessage : item)))
      setStatus(`Unsend failed: ${error.message}`)
    } finally {
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

  useEffect(() => {
    setChatEnabled(room?.chat_enabled !== false)
  }, [room?.chat_enabled])

  useEffect(() => {
    loadMessages()
  }, [roomId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  useEffect(() => {
    if (!sending && refocusComposerRef.current) {
      refocusComposerRef.current = false
      composerRef.current?.focus()
    }
  }, [sending])

  useEffect(() => {
    if (!socket) return undefined
    const handleMessage = ({ message }) => appendMessage(message)
    const handleMessageUnsent = ({ messageId, message }) => {
      if (!messageId) return
      markMessageUnsent(messageId, message || {})
    }
    const handleTypingStart = ({ user: typingUser, socketId }) => {
      if (!typingUser || typingUser.id === user?.id) return
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
    socket.on('chat-message-unsent', handleMessageUnsent)
    socket.on('typing-start', handleTypingStart)
    socket.on('typing-stop', handleTypingStop)

    return () => {
      socket.off('chat-message', handleMessage)
      socket.off('chat-message-unsent', handleMessageUnsent)
      socket.off('typing-start', handleTypingStart)
      socket.off('typing-stop', handleTypingStop)
    }
  }, [socket, user?.id])

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
          {realtimeConnected ? 'Realtime' : 'Saved'}
        </span>
      </div>

      <div className="messages">
        {loading ? (
          <div className="empty-chat">Loading chat...</div>
        ) : messages.length === 0 ? (
          <div className="empty-chat">
            <div className="empty-chat-mark">#</div>
            <strong>No messages yet</strong>
            <span>The conversation will appear here.</span>
          </div>
        ) : messages.map((message) => {
          const mine = message.sender_id === user?.id
          const senderName = chatSenderName(message, user)
          const isUnsent = Boolean(Number(message.is_deleted || message.is_unsent))
          const canUnsend = mine && !isUnsent
          const deleting = Boolean(deletingMessageIds[message.id])

          return (
            <div className={mine ? 'chat-row mine' : 'chat-row'} key={`${message.id}-${message.created_at || ''}`}>
              <div className="chat-avatar">{getInitials(senderName)}</div>
              <div className={isUnsent ? 'chat-bubble unsent' : 'chat-bubble'}>
                <div className="chat-meta">
                  <strong>{senderName}</strong>
                  <time>{formatChatTime(message.created_at)}</time>
                </div>
                <p>{isUnsent ? (mine ? 'You unsent this message.' : 'This message was unsent.') : message.message_body}</p>
                {canUnsend && (
                  <div className="chat-actions">
                    <button type="button" onClick={() => unsendMessage(message)} disabled={deleting}>
                      {deleting ? 'Unsending' : 'Unsend'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="typing-line">
        {typingNames.length ? `${typingNames.slice(0, 2).join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing` : '\u00a0'}
      </div>

      <form className="chat-form" onSubmit={sendMessage}>
        <textarea
          ref={composerRef}
          value={text}
          onChange={(event) => updateText(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={chatEnabled ? 'Message this room' : 'Chat is disabled'}
          maxLength={1200}
          rows={2}
          disabled={!chatEnabled || sending}
        />
        <div className="chat-form-footer">
          <span>{text.length}/1200</span>
          <button className="primary-button" type="submit" disabled={!canSend}>
            {sending ? 'Sending' : 'Send'}
          </button>
        </div>
      </form>
      {status && <small className="warning-text">{status}</small>}
    </aside>
  )
}
