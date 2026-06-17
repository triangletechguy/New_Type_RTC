import { useEffect, useRef, useState } from 'react'
import messageComposerIcon from '../../assets/message.svg'
import { avatarForUser, liveRoomAssets } from '../../assets/rtc/catalog'
import { LoadingMovie } from '../common/LoadingMovie'
import { apiRequest } from '../../services/api'
import { formatChatTime } from '../../utils/formatters'
import { analyzeRoomTextForGuard, isAiGuardEnabled } from '../../utils/aiGuard'
import { defaultEmojiReactions, isValidEmoji, searchEmojiCategories } from '../../utils/emoji'
import { translateApp } from '../rooms/roomsStaticData'

const maxAudioBytes = 5 * 1024 * 1024
const maxPhotoBytes = 6 * 1024 * 1024
const maxPhotoInputBytes = 12 * 1024 * 1024
const photoMaxDimension = 1280
const photoCompressionQuality = 0.72
const audioBitsPerSecond = 32000
const recordingAudioConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}
const roomChatSyncIntervalMs = 5000
const inboxSyncIntervalMs = 5000
const roomGifts = [
  { id: 'star', label: 'Star', emoji: '⭐', coin_value: 10 },
  { id: 'heart', label: 'Heart', emoji: '❤️', coin_value: 25 },
  { id: 'cheer', label: 'Cheer', emoji: '🎉', coin_value: 50 },
]

function EmojiPicker({ open, query, onQueryChange, onPick, onClose, label = 'Emoji picker', t = (value) => value }) {
  if (!open) return null

  const categories = searchEmojiCategories(query)

  return (
    <section className="chat-emoji-picker" aria-label={label}>
      <header>
        <strong>{t('Emoji')}</strong>
        <button type="button" onClick={onClose} aria-label={t('Close emoji picker')}>x</button>
      </header>
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t('Search emoji')}
        aria-label={t('Search emoji')}
      />
      <div className="chat-emoji-groups">
        {categories.length ? categories.map((category) => (
          <div className="chat-emoji-group" key={category.id}>
            <span>{t(category.label)}</span>
            <div className="chat-emoji-grid">
              {category.emojis.map((emoji) => (
                <button
                  key={`${category.id}-${emoji}`}
                  type="button"
                  onClick={() => onPick(emoji)}
                  aria-label={t('Insert {emoji}', { emoji })}
                  title={emoji}
                >
                  <span className="chat-emoji-glyph" aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
          </div>
        )) : (
          <small>{t('No emoji found.')}</small>
        )}
      </div>
    </section>
  )
}

function reactionSummaries(message) {
  return Array.isArray(message?.reactions) ? message.reactions.filter((reaction) => reaction?.emoji) : []
}

function roomGiftForMessage(message) {
  const transaction = message?.gift || message?.gift_transaction
  if (transaction?.gift_id || transaction?.id) {
    const fallbackGift = roomGifts.find((gift) => gift.id === transaction.gift_id || gift.id === transaction.id)
    return {
      id: transaction.gift_id || transaction.id || fallbackGift?.id || 'gift',
      label: transaction.label || transaction.gift_label || fallbackGift?.label || 'Gift',
      emoji: transaction.emoji || transaction.gift_emoji || fallbackGift?.emoji || '🎁',
      coin_value: Number(transaction.coin_value || fallbackGift?.coin_value || 0),
      quantity: Number(transaction.quantity || 1),
      total_coins: Number(transaction.total_coins || transaction.coin_value || fallbackGift?.coin_value || 0),
    }
  }

  const mediaId = String(message?.media_url || '').trim().toLowerCase()
  const body = String(message?.message_body || '').trim().toLowerCase()

  return roomGifts.find((gift) => (
    gift.id === mediaId
    || gift.label.toLowerCase() === body
    || `${gift.emoji} ${gift.label}`.toLowerCase() === body
  )) || null
}

function formatGiftCoins(value, t = (text) => text) {
  const coins = Number(value || 0)
  return t('{coins} coins', { coins: coins.toLocaleString() })
}

function standaloneEmojiBody(value) {
  const compactEmoji = String(value || '').replace(/\s+/g, '')
  return isValidEmoji(compactEmoji) ? compactEmoji : ''
}

function MessageReactions({
  message,
  disabled,
  pickerOpen,
  pickerQuery,
  onPickerQueryChange,
  onToggle,
  onOpenPicker,
  onClosePicker,
  onPickEmoji,
  t = (value) => value,
}) {
  const reactions = reactionSummaries(message)

  return (
    <div className={reactions.length || pickerOpen ? 'chat-reactions active' : 'chat-reactions'}>
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          className={reaction.reacted_by_me ? 'chat-reaction-pill mine' : 'chat-reaction-pill'}
          onClick={() => onToggle(message, reaction.emoji)}
          disabled={disabled}
          aria-label={t(reaction.reacted_by_me ? 'Remove {emoji} reaction' : 'Add {emoji} reaction', { emoji: reaction.emoji })}
          title={`${reaction.emoji} ${reaction.count || 0}`}
        >
          <span className="chat-emoji-glyph" aria-hidden="true">{reaction.emoji}</span>
          <b>{reaction.count || 0}</b>
        </button>
      ))}
      <button
        type="button"
        className="chat-reaction-add"
        onClick={() => (pickerOpen ? onClosePicker() : onOpenPicker(message))}
        disabled={disabled}
        aria-label={t('Add emoji reaction')}
        title={t('Add reaction')}
      >
        <span className="chat-emoji-glyph" aria-hidden="true">🙂</span>
      </button>
      {pickerOpen ? (
        <div className="chat-reaction-picker">
          <div className="chat-reaction-quick" aria-label={t('Quick reactions')}>
            {defaultEmojiReactions.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onPickEmoji(message, emoji)}
                disabled={disabled}
                aria-label={t('React with {emoji}', { emoji })}
                title={t('React with {emoji}', { emoji })}
              >
                <span className="chat-emoji-glyph" aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
          <EmojiPicker
            open
            query={pickerQuery}
            onQueryChange={onPickerQueryChange}
            onPick={(emoji) => onPickEmoji(message, emoji)}
            onClose={onClosePicker}
            label={t('Reaction emoji picker')}
            t={t}
          />
        </div>
      ) : null}
    </div>
  )
}

function preferredAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''

  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function createVoiceRecorder(stream) {
  const mimeType = preferredAudioMimeType()
  const baseOptions = { audioBitsPerSecond }

  if (mimeType) {
    try {
      return new MediaRecorder(stream, { ...baseOptions, mimeType })
    } catch {
      // Some mobile browsers over-report MIME support; fall back to browser defaults.
    }
  }

  return new MediaRecorder(stream, baseOptions)
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
    !Boolean(Number(message?.is_deleted || message?.is_unsent))
    && !blockedSenderIds.some((id) => Number(id) === Number(message?.sender_id))
  )
}

function messageIdValue(message) {
  const id = Number(message?.id || 0)
  return Number.isFinite(id) ? id : 0
}

function positiveIdValue(value) {
  const id = Number(value || 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function messageBelongsToRoom(message, roomId) {
  const messageRoomId = positiveIdValue(message?.room_id)
  const currentRoomId = positiveIdValue(roomId)
  return !messageRoomId || !currentRoomId || messageRoomId === currentRoomId
}

function eventBelongsToRoom(payloadRoomId, roomId) {
  const incomingRoomId = positiveIdValue(payloadRoomId)
  const currentRoomId = positiveIdValue(roomId)
  return !incomingRoomId || !currentRoomId || incomingRoomId === currentRoomId
}

function latestMessageId(messages = []) {
  return messages.reduce((latest, message) => Math.max(latest, messageIdValue(message)), 0)
}

function sortMessagesById(messages = []) {
  return [...messages].sort((a, b) => messageIdValue(a) - messageIdValue(b))
}

function directMessagePeerId(message, currentUser) {
  const currentUserId = Number(currentUser?.id || 0)
  const senderId = Number(message?.sender_id || 0)
  const recipientId = Number(message?.recipient_id || 0)

  if (!currentUserId) return 0
  if (senderId === currentUserId) return recipientId
  if (recipientId === currentUserId) return senderId
  return 0
}

function liveAudioTrackFromStream(stream) {
  return stream?.getAudioTracks?.().find((track) => track.readyState === 'live') || null
}

function requestFreshAudioRecordingStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: recordingAudioConstraints,
    video: false,
  })
}

async function createAudioRecordingStream(localStream) {
  const activeRoomMicTrack = liveAudioTrackFromStream(localStream)

  if (activeRoomMicTrack) {
    const recordingTrack = activeRoomMicTrack.clone()
    recordingTrack.enabled = true
    return new MediaStream([recordingTrack])
  }

  return requestFreshAudioRecordingStream()
}

function inboxEditKey(message) {
  return `inbox-${messageIdValue(message)}`
}

function messageActionKey(message) {
  return message?.__scope === 'inbox' ? inboxEditKey(message) : String(messageIdValue(message))
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

function formatFileSize(bytes) {
  const size = Number(bytes || 0)
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

function dataUrlExtension(dataUrl = '') {
  const match = String(dataUrl).match(/^data:image\/([a-z0-9.+-]+);/i)
  const type = match?.[1]?.toLowerCase() || 'jpg'
  if (type === 'jpeg') return 'jpg'
  if (type === 'svg+xml') return 'svg'
  return type.replace(/[^a-z0-9]/g, '') || 'jpg'
}

function photoDownloadName(prefix, id, dataUrl) {
  return `${prefix || 'chat'}-photo-${id || Date.now()}.${dataUrlExtension(dataUrl)}`
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not optimize this photo.'))
    image.src = dataUrl
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not optimize this photo.'))
    }, type, quality)
  })
}

async function optimizePhotoFile(file) {
  const originalDataUrl = await readFileAsDataUrl(file)

  if (
    typeof document === 'undefined'
    || !file.type?.startsWith('image/')
    || file.type === 'image/gif'
    || file.type === 'image/svg+xml'
  ) {
    return {
      dataUrl: originalDataUrl,
      name: file.name || 'Photo',
      size: file.size,
      originalSize: file.size,
      optimized: false,
    }
  }

  try {
    const image = await loadImageFromDataUrl(originalDataUrl)
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    if (!sourceWidth || !sourceHeight) throw new Error('Could not optimize this photo.')

    const scale = Math.min(1, photoMaxDimension / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not optimize this photo.')

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const blob = await canvasToBlob(canvas, 'image/jpeg', photoCompressionQuality)
    if (!blob || blob.size >= file.size) {
      return {
        dataUrl: originalDataUrl,
        name: file.name || 'Photo',
        size: file.size,
        originalSize: file.size,
        optimized: false,
      }
    }

    const dataUrl = await readFileAsDataUrl(blob)
    const baseName = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo'
    return {
      dataUrl,
      name: `${baseName}.jpg`,
      size: blob.size,
      originalSize: file.size,
      optimized: true,
    }
  } catch {
    return {
      dataUrl: originalDataUrl,
      name: file.name || 'Photo',
      size: file.size,
      originalSize: file.size,
      optimized: false,
    }
  }
}

export function ChatPanel({
  roomId,
  signalingRoom,
  socket,
  user,
  room,
  localStream = null,
  focusRequest = 0,
  externalMessage = null,
  inboxPeerRequest = null,
  followRefreshKey = 0,
  language = 'English',
  presentation = 'default',
  participantPreview = [],
  guideText = '',
  onParticipantAction,
  onMessagesChange,
}) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [photoDraft, setPhotoDraft] = useState(null)
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
  const [imagePreview, setImagePreview] = useState(null)
  const [chatMode, setChatMode] = useState('comments')
  const [inboxThreads, setInboxThreads] = useState([])
  const [inboxMessages, setInboxMessages] = useState([])
  const [inboxTarget, setInboxTarget] = useState(null)
  const [inboxText, setInboxText] = useState('')
  const [loadingInbox, setLoadingInbox] = useState(false)
  const [sendingInbox, setSendingInbox] = useState(false)
  const [followedContactIds, setFollowedContactIds] = useState([])
  const [followingUserIds, setFollowingUserIds] = useState({})
  const [requestedContactIds, setRequestedContactIds] = useState([])
  const [chatEnabled, setChatEnabled] = useState(room?.chat_enabled !== false)
  const [giftSummary, setGiftSummary] = useState(null)
  const [typingUsers, setTypingUsers] = useState({})
  const [socketConnected, setSocketConnected] = useState(Boolean(socket?.connected))
  const [emojiPickerTarget, setEmojiPickerTarget] = useState('')
  const [emojiQuery, setEmojiQuery] = useState('')
  const [reactionPickerTarget, setReactionPickerTarget] = useState('')
  const [reactionQuery, setReactionQuery] = useState('')
  const messagesRef = useRef(null)
  const messagesEndRef = useRef(null)
  const inboxMessagesRef = useRef(null)
  const inboxEndRef = useRef(null)
  const composerRef = useRef(null)
  const inboxComposerRef = useRef(null)
  const editComposerRef = useRef(null)
  const roomPhotoInputRef = useRef(null)
  const inboxPhotoInputRef = useRef(null)
  const recorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingStreamRef = useRef(null)
  const recordingStartedAtRef = useRef(0)
  const recordingTimerRef = useRef(null)
  const refocusComposerRef = useRef(false)
  const typingTimeoutRef = useRef(null)
  const previousRoomMessageCountRef = useRef(0)
  const previousInboxMessageCountRef = useRef(0)
  const latestRoomMessageIdRef = useRef(0)
  const t = (key, replacements = {}) => translateApp(language, key, replacements)
  const joinerPresentation = presentation === 'joiner'

  const realtimeConnected = Boolean(socketConnected && signalingRoom)
  const typingNames = Object.values(typingUsers)
    .filter(Boolean)
    .filter((typingUser) => typingUser.id !== user?.id)
    .map((typingUser) => typingUser.name || t('Someone'))
  const canSend = chatEnabled && (Boolean(text.trim()) || Boolean(photoDraft) || Boolean(audioDraft)) && !sending && !recording
  const canSendInbox = Boolean(inboxTarget?.id)
    && (Boolean(inboxText.trim()) || Boolean(photoDraft) || Boolean(audioDraft))
    && !sendingInbox
    && !recording
  const canModerate = canModerateChat(user, room)
  const visibleMessages = messages.filter((message) => isVisibleRoomMessage(message, blockedSenderIds))
  const aiGuardActive = isAiGuardEnabled(room)
  const giftEnabled = room?.gift_enabled !== false
  const typingText = typingNames.length
    ? `${typingNames.slice(0, 2).join(', ')} ${t(typingNames.length > 1 ? 'are typing...' : 'is typing...')}`
    : realtimeConnected ? t('No one is typing') : t('Typing status starts after RTC connects')

  function toggleEmojiPicker(target) {
    setReactionPickerTarget('')
    const nextTarget = emojiPickerTarget === target ? '' : target
    setEmojiPickerTarget(nextTarget)
    if (nextTarget) setEmojiQuery('')
  }

  function closeEmojiPicker() {
    setEmojiPickerTarget('')
  }

  function emojiTargetRef(target) {
    if (target === 'room') return composerRef
    if (target === 'inbox') return inboxComposerRef
    if (target.startsWith('edit:')) return editComposerRef
    return { current: null }
  }

  function emojiTargetValue(target) {
    if (target === 'room') return text
    if (target === 'inbox') return inboxText
    if (target.startsWith('edit:')) return editText
    return ''
  }

  function setEmojiTargetValue(target, value) {
    if (target === 'room') {
      updateText(value)
      return
    }

    if (target === 'inbox') {
      setInboxText(value)
      return
    }

    if (target.startsWith('edit:')) setEditText(value)
  }

  function insertEmoji(emoji) {
    if (!isValidEmoji(emoji) || !emojiPickerTarget) return

    const target = emojiPickerTarget
    const textarea = emojiTargetRef(target).current
    const currentValue = emojiTargetValue(target)
    const selectionStart = Number.isInteger(textarea?.selectionStart) ? textarea.selectionStart : currentValue.length
    const selectionEnd = Number.isInteger(textarea?.selectionEnd) ? textarea.selectionEnd : selectionStart
    const nextValue = `${currentValue.slice(0, selectionStart)}${emoji}${currentValue.slice(selectionEnd)}`

    if (nextValue.length > 1200) {
      setStatus(t('Message body must be 1200 characters or fewer.'))
      return
    }

    setEmojiTargetValue(target, nextValue)
    const nextCaret = selectionStart + emoji.length
    window.requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange?.(nextCaret, nextCaret)
    })
  }

  function reactionTarget(scope, message) {
    const id = messageIdValue(message)
    return id ? `${scope}:${id}` : ''
  }

  function openReactionPicker(scope, message) {
    const target = reactionTarget(scope, message)
    if (!target) return
    setEmojiPickerTarget('')
    setReactionQuery('')
    setReactionPickerTarget(target)
  }

  function closeReactionPicker() {
    setReactionPickerTarget('')
  }

  function mergeReactionSummaries(previousReactions = [], nextReactions = [], { preserveMine = false } = {}) {
    const previousByEmoji = new Map(
      reactionSummaries({ reactions: previousReactions }).map((reaction) => [reaction.emoji, reaction])
    )

    return reactionSummaries({ reactions: nextReactions }).map((reaction) => ({
      ...reaction,
      count: Number(reaction.count || 0),
      reacted_by_me: preserveMine
        ? Boolean(previousByEmoji.get(reaction.emoji)?.reacted_by_me)
        : Boolean(reaction.reacted_by_me),
    }))
  }

  function applyReactionUpdateToMessage(message, update = {}) {
    const incomingReactions = update.reactions || update.message?.reactions || []
    const reactions = mergeReactionSummaries(message.reactions, incomingReactions, { preserveMine: true })
    return {
      ...message,
      reactions,
      reaction_count: Number(update.reaction_count ?? update.message?.reaction_count ?? reactions.reduce((total, reaction) => total + Number(reaction.count || 0), 0)),
    }
  }

  function applyRoomReactionUpdate(update = {}) {
    const messageId = Number(update.message_id || update.message?.id || 0)
    if (!messageId) return
    setMessages((previous) => previous.map((message) => (
      message.id === messageId ? applyReactionUpdateToMessage(message, update) : message
    )))
  }

  function applyInboxReactionUpdate(update = {}) {
    const messageId = Number(update.message_id || update.message?.id || 0)
    if (!messageId) return
    setInboxMessages((previous) => previous.map((message) => (
      message.id === messageId ? applyReactionUpdateToMessage(message, update) : message
    )))
  }

  function appendMessage(message) {
    if (!message?.id) return
    if (!messageBelongsToRoom(message, roomId)) return
    if (!isVisibleRoomMessage(message, blockedSenderIds)) return

    setMessages((previous) => {
      const nextMessages = previous.some((item) => item.id === message.id)
        ? previous.map((item) => (item.id === message.id ? { ...item, ...message } : item))
        : [...previous, message]

      return sortMessagesById(nextMessages)
    })
  }

  function upsertInboxMessage(message) {
    if (!message?.id || !directMessagePeerId(message, user)) return

    setInboxMessages((previous) => {
      const nextMessages = previous.some((item) => item.id === message.id)
        ? previous.map((item) => (item.id === message.id ? { ...item, ...message } : item))
        : [...previous, message]

      return sortMessagesById(nextMessages)
    })
  }

  function mergeRoomMessages(incomingMessages) {
    const incoming = Array.isArray(incomingMessages)
      ? incomingMessages.filter((message) => (
        message?.id
        && messageBelongsToRoom(message, roomId)
        && isVisibleRoomMessage(message, blockedSenderIds)
      ))
      : []

    if (!incoming.length) return

    setMessages((previous) => {
      const byId = new Map()
      previous.forEach((message) => {
        if (message?.id) byId.set(messageIdValue(message), message)
      })
      incoming.forEach((message) => {
        const id = messageIdValue(message)
        byId.set(id, { ...(byId.get(id) || {}), ...message })
      })

      return sortMessagesById(Array.from(byId.values()))
    })
  }

  function replaceMessage(updatedMessage) {
    if (!updatedMessage?.id) return
    if (!messageBelongsToRoom(updatedMessage, roomId)) return
    setMessages((previous) => previous.map((message) => (
      message.id === updatedMessage.id ? { ...message, ...updatedMessage } : message
    )))
  }

  function removeMessage(messageId) {
    setMessages((previous) => previous.filter((message) => message.id !== messageId))
    if (editingMessageId === String(messageId)) cancelEdit()
  }

  function replaceInboxMessage(updatedMessage) {
    if (!updatedMessage?.id) return
    setInboxMessages((previous) => previous.map((message) => (
      message.id === updatedMessage.id ? { ...message, ...updatedMessage } : message
    )))
  }

  function removeInboxMessage(messageId) {
    setInboxMessages((previous) => previous.filter((message) => message.id !== messageId))
    if (editingMessageId === inboxEditKey({ id: messageId })) cancelEdit()
  }

  function wasEdited(message) {
    if (!message?.created_at || !message?.updated_at) return false
    return String(message.created_at) !== String(message.updated_at)
  }

  async function loadMessages({ afterId = 0, silent = false } = {}) {
    if (!roomId) return
    try {
      if (!silent) {
        setLoading(true)
        setStatus('')
      }

      const params = new URLSearchParams()
      if (afterId) {
        params.set('after_id', String(afterId))
        params.set('limit', '100')
      }

      const data = await apiRequest(`/rooms/${roomId}/messages${params.toString() ? `?${params}` : ''}`)
      if (afterId) mergeRoomMessages(data.messages || [])
      else setMessages(data.messages || [])
      setChatEnabled(data.meta?.chat_enabled !== false)
      if (data.meta?.gift_summary) setGiftSummary(data.meta.gift_summary)
      setBlockedSenderIds(data.meta?.blocked_user_ids || [])
    } catch (error) {
      setStatus(error.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function syncMissedRoomMessages({ full = false } = {}) {
    if (!roomId) return
    const shouldFullRefresh = full || !(socketConnected && signalingRoom)

    await loadMessages({
      afterId: shouldFullRefresh ? 0 : latestRoomMessageIdRef.current,
      silent: true,
    })
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
    if (chatMode === 'comments' && (!chatEnabled || sending)) return
    if (chatMode === 'inbox' && (!inboxTarget?.id || sendingInbox)) return
    const input = chatMode === 'inbox' ? inboxPhotoInputRef.current : roomPhotoInputRef.current
    input?.click()
  }

  async function stagePhotoDraft(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type?.startsWith('image/')) {
      setStatus('Choose an image file.')
      return
    }

    if (file.size > maxPhotoInputBytes) {
      setStatus('Photo message must be smaller than 12 MB before optimization.')
      return
    }

    try {
      setStatus('Optimizing photo...')
      const optimizedPhoto = await optimizePhotoFile(file)
      if (optimizedPhoto.size > maxPhotoBytes) {
        setStatus('Photo message is still too large after optimization.')
        return
      }

      setPhotoDraft({
        dataUrl: optimizedPhoto.dataUrl,
        name: optimizedPhoto.name,
        size: optimizedPhoto.size,
        originalSize: optimizedPhoto.originalSize,
      })
      setAudioDraft(null)
      setStatus(optimizedPhoto.optimized
        ? `Photo optimized from ${formatFileSize(optimizedPhoto.originalSize)} to ${formatFileSize(optimizedPhoto.size)}.`
        : '')
      refocusComposerRef.current = true
    } catch (error) {
      setStatus(error.message)
    }
  }

  function clearPhotoDraft() {
    setPhotoDraft(null)
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
    if (chatMode === 'comments' && (!chatEnabled || sending)) return
    if (chatMode === 'inbox' && (!inboxTarget?.id || sendingInbox)) return
    if (recording) return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('Audio recording is not supported in this browser.')
      return
    }

    try {
      setStatus('')
      setAudioDraft(null)
      setPhotoDraft(null)
      const stream = await createAudioRecordingStream(localStream)
      const recorder = createVoiceRecorder(stream)
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
          if (!blob.size) {
            setStatus('No voice audio was captured. Check microphone permission and try again.')
            return
          }
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
      recorder.start(250)
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

  function clearComposerDrafts() {
    clearPhotoDraft()
    cancelAudioDraft()
  }

  function guardBlocksRoomText(value, { focusComposer = false } = {}) {
    if (!aiGuardActive || !value) return false

    const analysis = analyzeRoomTextForGuard(value)
    if (!analysis) return false

    setStatus(t('AI guard blocked this room message. Remove "{term}" or rephrase it.', { term: analysis.matchedKeyword }))
    if (focusComposer) refocusComposerRef.current = true
    return true
  }

  async function sendMessage(event) {
    event.preventDefault()
    const value = text.trim()
    if ((!value && !photoDraft && !audioDraft) || sending || recording) return

    try {
      setSending(true)
      setStatus('')
      const messageType = audioDraft ? 'voice' : photoDraft ? 'image' : 'text'
      if (messageType === 'text' && guardBlocksRoomText(value, { focusComposer: true })) return

      const data = await apiRequest(`/rooms/${roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          message_body: photoDraft && !value ? 'sent a photo' : value,
          message_type: messageType,
          ...(photoDraft ? { media_url: photoDraft.dataUrl } : {}),
          ...(audioDraft ? { media_url: audioDraft.dataUrl } : {}),
        }),
      })
      appendMessage(data.chat_message)
      setText('')
      clearPhotoDraft()
      cancelAudioDraft()
      closeEmojiPicker()
      refocusComposerRef.current = true
      emitTyping(false)
      window.clearTimeout(typingTimeoutRef.current)

      if (!data.realtime_broadcasted && socket && signalingRoom) {
        socket.timeout(8000).emit(
          'chat-message',
          {
            roomId: signalingRoom,
            message: { id: data.chat_message.id },
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

  async function sendGift(gift) {
    if (!gift?.id || !chatEnabled || !giftEnabled || sending || recording) return

    try {
      setSending(true)
      setStatus('')
      const data = await apiRequest(`/rooms/${roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          message_type: 'gift',
          gift_id: gift.id,
          quantity: 1,
          message_body: `${gift.emoji} ${gift.label}`,
        }),
      })
      appendMessage(data.chat_message)
      if (data.gift_summary) setGiftSummary(data.gift_summary)

      if (!data.realtime_broadcasted && socket && signalingRoom) {
        socket.timeout(8000).emit(
          'chat-message',
          {
            roomId: signalingRoom,
            message: { id: data.chat_message.id },
          },
          (error, response) => {
            if (error || !response?.ok) setStatus('Gift saved. Realtime delivery will resume when signaling reconnects.')
          }
        )
      }
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSending(false)
    }
  }

  async function toggleRoomReaction(message, emoji) {
    const messageId = messageIdValue(message)
    if (!messageId || !isValidEmoji(emoji)) return

    try {
      setStatus('')
      const data = await apiRequest(`/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      })
      if (data.chat_message) replaceMessage(data.chat_message)
      closeReactionPicker()
    } catch (error) {
      setStatus(`Reaction failed: ${error.message}`)
    }
  }

  async function toggleInboxReaction(message, emoji) {
    const messageId = messageIdValue(message)
    if (!messageId || !isValidEmoji(emoji)) return

    try {
      setStatus('')
      const data = await apiRequest(`/direct-messages/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      })
      if (data.direct_message) replaceInboxMessage(data.direct_message)
      closeReactionPicker()
      loadInboxThreads({ quiet: true })
    } catch (error) {
      setStatus(`Reaction failed: ${error.message}`)
    }
  }

  function startEdit(message) {
    if (!message?.id || !isOwnMessage(message, user) || message.is_deleted) return
    setEditingMessageId(String(message.id))
    setEditText(message.message_body || '')
    setEmojiPickerTarget('')
    setStatus('')
  }

  function startInboxEdit(message) {
    if (!message?.id || !isOwnMessage(message, user) || message.is_deleted || message.message_type !== 'text') return
    setEditingMessageId(inboxEditKey(message))
    setEditText(message.message_body || '')
    setEmojiPickerTarget('')
    setStatus('')
  }

  function cancelEdit() {
    setEditingMessageId(null)
    setEditText('')
    setSavingEditId(null)
    if (emojiPickerTarget.startsWith('edit:')) closeEmojiPicker()
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

    if (guardBlocksRoomText(value)) return

    const previousMessage = message
    setSavingEditId(String(message.id))
    setStatus('')
    replaceMessage({ ...message, message_body: value, updated_at: new Date().toISOString() })

    try {
      const data = await apiRequest(`/messages/${message.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ message_body: value }),
      })
      replaceMessage(data.chat_message)
      cancelEdit()

      if (!data.realtime_broadcasted && socket && signalingRoom) {
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

  async function saveInboxEdit(message, event) {
    event?.preventDefault()
    const value = editText.trim()
    const editKey = inboxEditKey(message)

    if (!message?.id || !isOwnMessage(message, user) || savingEditId || message.message_type !== 'text') return
    if (!value) {
      setStatus('Edited message cannot be empty.')
      return
    }

    if (value === String(message.message_body || '').trim()) {
      cancelEdit()
      return
    }

    const previousMessage = message
    setSavingEditId(editKey)
    setStatus('')
    replaceInboxMessage({ ...message, message_body: value, updated_at: new Date().toISOString() })

    try {
      const data = await apiRequest(`/direct-messages/messages/${message.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ message_body: value }),
      })
      replaceInboxMessage(data.direct_message)
      cancelEdit()
      loadInboxThreads({ quiet: true })
    } catch (error) {
      replaceInboxMessage(previousMessage)
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

  function handleInboxEditKeyDown(message, event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      saveInboxEdit(message, event)
    }
  }

  function canDeleteMessage(message) {
    if (!message?.id || message.is_deleted) return false
    return Boolean(user?.id)
  }

  function canDeleteMessageForEveryone(message) {
    if (!message?.id || message.is_deleted) return false
    if (message.__scope === 'inbox') return isOwnMessage(message, user)
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

  function requestDeleteInboxMessage(message) {
    if (!canDeleteMessage(message)) return
    const target = { ...message, __scope: 'inbox' }
    setDeleteTarget(target)
    setDeleteForEveryone(canDeleteMessageForEveryone(target))
    setStatus('')
  }

  function closeDeleteModal() {
    if (deleteTarget && deletingMessageIds[messageActionKey(deleteTarget)]) return
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

  function isFollowedContact(userId) {
    const normalizedId = Number(userId)
    return Boolean(normalizedId && followedContactIds.some((id) => Number(id) === normalizedId))
  }

  async function requestFollowFromMessage(message) {
    const peerId = Number(message?.sender_id || 0)
    if (!peerId || isOwnMessage(message, user) || followingUserIds[peerId]) return

    setFollowingUserIds((previous) => ({ ...previous, [peerId]: true }))
    setStatus('')

    try {
      const data = await apiRequest(`/users/${peerId}/follow-requests`, { method: 'POST' })
      if (data.following) {
        setFollowedContactIds((previous) => (
          previous.some((id) => Number(id) === peerId) ? previous : [...previous, peerId]
        ))
        setStatus(`You are connected with ${data.peer?.name || chatSenderName(message, user)}. Private messages are open.`)
      } else {
        setRequestedContactIds((previous) => (
          previous.some((id) => Number(id) === peerId) ? previous : [...previous, peerId]
        ))
        setStatus(`Follow request sent to ${data.peer?.name || chatSenderName(message, user)}.`)
      }
      loadInboxThreads({ quiet: true })
    } catch (error) {
      setStatus(`Follow request failed: ${error.message}`)
    } finally {
      setFollowingUserIds((previous) => {
        const next = { ...previous }
        delete next[peerId]
        return next
      })
    }
  }

  async function loadInboxThreads({ quiet = false } = {}) {
    try {
      if (!quiet) setLoadingInbox(true)
      if (!quiet) setStatus('')
      const data = await apiRequest('/direct-messages/contacts')
      const contacts = data.contacts || data.threads || []
      setInboxThreads(contacts)
      setFollowedContactIds(contacts.map((contact) => Number(contact.peer_id)).filter(Boolean))
    } catch (error) {
      if (!quiet) setStatus(`Inbox failed: ${error.message}`)
    } finally {
      if (!quiet) setLoadingInbox(false)
    }
  }

  async function loadInboxConversation(peer, { quiet = false } = {}) {
    if (!peer?.id && !peer?.peer_id) return
    const peerId = Number(peer.id || peer.peer_id)
    const target = {
      id: peerId,
      name: peer.name || peer.peer_name || `User #${peerId}`,
      avatar_url: peer.avatar_url || peer.peer_avatar_url || '',
      gender: peer.gender || peer.peer_gender || '',
    }

    if (!quiet) {
      setInboxTarget(target)
      setChatMode('inbox')
      setLoadingInbox(true)
      setStatus('')
      previousInboxMessageCountRef.current = 0
    }

    try {
      const data = await apiRequest(`/direct-messages/${peerId}`)
      if (!quiet) {
        setInboxTarget(data.peer ? {
          id: Number(data.peer.id),
          name: data.peer.name || target.name,
          avatar_url: data.peer.avatar_url || target.avatar_url,
          gender: data.peer.gender || target.gender,
        } : target)
      }
      setInboxMessages(data.messages || [])
    } catch (error) {
      if (!quiet) setStatus(`Inbox failed: ${error.message}`)
    } finally {
      if (!quiet) setLoadingInbox(false)
    }
  }

  async function refreshInboxConversation({ quiet = true } = {}) {
    if (!inboxTarget?.id) return

    await loadInboxConversation(inboxTarget, { quiet })
  }

  function openInboxFromMessage(message) {
    if (!message?.sender_id || isOwnMessage(message, user)) return
    loadInboxConversation({
      id: message.sender_id,
      name: message.sender_name,
      avatar_url: message.sender_avatar_url,
      gender: message.sender_gender,
    })
  }

  function showRoomComments({ focusComposer = false } = {}) {
    setChatMode('comments')
    setLoadingInbox(false)
    setStatus('')
    closeEmojiPicker()
    closeReactionPicker()
    if (!recording) clearComposerDrafts()
    previousRoomMessageCountRef.current = 0

    window.requestAnimationFrame(() => {
      scrollToLatestMessage(messagesEndRef)
      if (focusComposer) composerRef.current?.focus()
    })
  }

  function showPersonalInbox() {
    setStatus('')
    closeEmojiPicker()
    closeReactionPicker()
    previousInboxMessageCountRef.current = 0

    if (chatMode === 'inbox') {
      loadInboxThreads()
      return
    }

    setChatMode('inbox')
    if (!recording) clearComposerDrafts()
  }

  function participantActionLabel(participant) {
    const status = String(participant?.followStatus || '')
    if (participant?.isSelf) return t('You')
    if (status === 'following') return t('Message')
    if (status === 'requested') return t('Requested')
    if (status === 'incoming') return t('Respond')
    if (status === 'loading') return t('...')
    return t('Follow')
  }

  function participantActionDisabled(participant) {
    const status = String(participant?.followStatus || '')
    return participant?.isSelf || status === 'requested' || status === 'loading' || !Number(participant?.id || 0)
  }

  function handleParticipantAction(participant) {
    if (participantActionDisabled(participant) || typeof onParticipantAction !== 'function') return
    onParticipantAction({
      id: Number(participant.id),
      name: participant.name,
      avatar_url: participant.avatarUrl || participant.avatar_url || '',
      gender: participant.gender || '',
    })
  }

  async function sendInboxMessage(event) {
    event.preventDefault()
    const value = inboxText.trim()
    if ((!value && !photoDraft && !audioDraft) || !inboxTarget?.id || sendingInbox || recording) return

    try {
      setSendingInbox(true)
      setStatus('')
      const messageType = audioDraft ? 'voice' : photoDraft ? 'image' : 'text'
      const data = await apiRequest(`/direct-messages/${inboxTarget.id}`, {
        method: 'POST',
        body: JSON.stringify({
          message_body: photoDraft && !value ? 'sent a photo' : value,
          message_type: messageType,
          ...(photoDraft ? { media_url: photoDraft.dataUrl } : {}),
          ...(audioDraft ? { media_url: audioDraft.dataUrl } : {}),
        }),
      })
      upsertInboxMessage(data.direct_message)
      setInboxText('')
      clearComposerDrafts()
      closeEmojiPicker()
      loadInboxThreads({ quiet: true })
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
    const deleteKey = messageActionKey(message)
    const previousMessages = messages
    const previousInboxMessages = inboxMessages
    setDeletingMessageIds((previous) => ({ ...previous, [deleteKey]: true }))
    setStatus('')

    if (message.__scope === 'inbox') removeInboxMessage(message.id)
    else removeMessage(message.id)

    try {
      const endpoint = message.__scope === 'inbox'
        ? `/direct-messages/messages/${message.id}`
        : `/messages/${message.id}`
      const data = await apiRequest(endpoint, {
        method: 'DELETE',
        body: JSON.stringify({ for_everyone: shouldDeleteForEveryone }),
      })

      if (message.__scope !== 'inbox' && data.deleted_for_everyone && !data.realtime_broadcasted && socket && signalingRoom) {
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

      if (message.__scope === 'inbox') loadInboxThreads({ quiet: true })
    } catch (error) {
      if (message.__scope === 'inbox') setInboxMessages(previousInboxMessages)
      else setMessages(previousMessages)
      setStatus(`Delete failed: ${error.message}`)
    } finally {
      setDeleteTarget(null)
      setDeletingMessageIds((previous) => {
        const next = { ...previous }
        delete next[deleteKey]
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

  function handleInboxComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return
    event.preventDefault()
    sendInboxMessage(event)
  }

  function stopTyping() {
    window.clearTimeout(typingTimeoutRef.current)
    emitTyping(false)
  }

  function openImagePreview({ src, alt, caption, downloadName = '' }) {
    if (!src) return
    setImagePreview({
      src,
      alt: alt || 'Chat photo',
      caption: caption || '',
      downloadName: downloadName || photoDownloadName('chat', '', src),
    })
  }

  function closeImagePreview() {
    setImagePreview(null)
  }

  function shouldStickToLatestMessage(container) {
    if (!container) return true
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom < 96
  }

  function scrollToLatestMessage(endRef) {
    window.requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ block: 'end' })
    })
  }

  useEffect(() => {
    setChatEnabled(room?.chat_enabled !== false)
  }, [room?.chat_enabled])

  useEffect(() => {
    if (!focusRequest) return
    showRoomComments({ focusComposer: true })
    window.requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [focusRequest])

  useEffect(() => {
    appendMessage(externalMessage)
  }, [externalMessage])

  useEffect(() => {
    onMessagesChange?.(visibleMessages)
  }, [messages, blockedSenderIds, onMessagesChange])

  useEffect(() => {
    latestRoomMessageIdRef.current = latestMessageId(messages)
  }, [messages])

  useEffect(() => {
    previousRoomMessageCountRef.current = 0
    setGiftSummary(null)
    loadMessages()
  }, [roomId])

  useEffect(() => {
    if (!roomId) return undefined

    const interval = window.setInterval(() => {
      syncMissedRoomMessages().catch((error) => {
        if (!realtimeConnected) setStatus(`Chat sync failed: ${error.message}`)
      })
    }, roomChatSyncIntervalMs)

    return () => window.clearInterval(interval)
  }, [roomId, realtimeConnected])

  useEffect(() => {
    if (chatMode === 'inbox') loadInboxThreads()
  }, [chatMode])

  useEffect(() => {
    if (joinerPresentation) setChatMode('comments')
  }, [joinerPresentation])

  useEffect(() => {
    if (chatMode !== 'inbox' || !inboxTarget?.id) return undefined

    const interval = window.setInterval(() => {
      refreshInboxConversation({ quiet: true }).catch((error) => setStatus(`Inbox sync failed: ${error.message}`))
      loadInboxThreads({ quiet: true })
    }, inboxSyncIntervalMs)

    return () => window.clearInterval(interval)
  }, [chatMode, inboxTarget?.id])

  useEffect(() => {
    if (user?.id) loadInboxThreads({ quiet: true })
  }, [user?.id])

  useEffect(() => {
    if (!followRefreshKey || !user?.id) return
    loadInboxThreads({ quiet: true })
  }, [followRefreshKey, user?.id])

  useEffect(() => {
    if (!inboxPeerRequest?.id) return
    loadInboxConversation(inboxPeerRequest)
  }, [inboxPeerRequest?.key])

  useEffect(() => {
    if (!imagePreview) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') closeImagePreview()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [imagePreview])

  useEffect(() => {
    const previousCount = previousRoomMessageCountRef.current
    const shouldScroll = previousCount === 0 || shouldStickToLatestMessage(messagesRef.current)
    previousRoomMessageCountRef.current = visibleMessages.length
    if (shouldScroll) scrollToLatestMessage(messagesEndRef)
  }, [visibleMessages.length])

  useEffect(() => {
    const previousCount = previousInboxMessageCountRef.current
    const shouldScroll = previousCount === 0 || shouldStickToLatestMessage(inboxMessagesRef.current)
    previousInboxMessageCountRef.current = inboxMessages.length
    if (shouldScroll) scrollToLatestMessage(inboxEndRef)
  }, [inboxMessages.length, chatMode])

  useEffect(() => {
    if (!sending && refocusComposerRef.current) {
      refocusComposerRef.current = false
      composerRef.current?.focus()
    }
  }, [sending])

  useEffect(() => {
    setSocketConnected(Boolean(socket?.connected))
    if (!socket) return undefined
    const syncAfterReconnect = () => {
      syncMissedRoomMessages({ full: true }).catch((error) => setStatus(`Chat sync failed: ${error.message}`))
    }
    const handleConnect = () => {
      setSocketConnected(true)
      syncAfterReconnect()
    }
    const handleDisconnect = () => {
      setSocketConnected(false)
    }
    const handleMessage = ({ message, room_id: payloadRoomId, gift_summary: incomingGiftSummary } = {}) => {
      if (!eventBelongsToRoom(payloadRoomId, roomId)) return
      appendMessage(message)
      if (incomingGiftSummary) setGiftSummary(incomingGiftSummary)
    }
    const handleMessageEdited = ({ message, room_id: payloadRoomId } = {}) => {
      if (!eventBelongsToRoom(payloadRoomId, roomId)) return
      replaceMessage(message)
    }
    const handleMessageReaction = (update = {}) => {
      if (!eventBelongsToRoom(update.room_id, roomId)) return
      applyRoomReactionUpdate(update)
    }
    const handleMessageDeleted = ({ messageId, room_id: payloadRoomId } = {}) => {
      if (!eventBelongsToRoom(payloadRoomId, roomId)) return
      if (!messageId) return
      removeMessage(messageId)
    }
    const handleMessageUnsent = ({ messageId, message, room_id: payloadRoomId } = {}) => {
      if (!eventBelongsToRoom(payloadRoomId, roomId)) return
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
    const handleDirectMessage = ({ direct_message: directMessage } = {}) => {
      const peerId = directMessagePeerId(directMessage, user)
      if (!peerId) return

      if (Number(inboxTarget?.id || 0) === peerId) {
        upsertInboxMessage(directMessage)
      }

      loadInboxThreads({ quiet: true })

      if (Number(directMessage.sender_id) !== Number(user?.id) && Number(inboxTarget?.id || 0) !== peerId) {
        setStatus(`New private message from ${directMessage.sender_name || `User #${directMessage.sender_id}`}.`)
      }
    }
    const handleDirectMessageEdited = ({ direct_message: directMessage } = {}) => {
      const peerId = directMessagePeerId(directMessage, user)
      if (!peerId) return
      if (Number(inboxTarget?.id || 0) === peerId) replaceInboxMessage(directMessage)
      loadInboxThreads({ quiet: true })
    }
    const handleDirectMessageReaction = (update = {}) => {
      applyInboxReactionUpdate(update)
      loadInboxThreads({ quiet: true })
    }
    const handleDirectMessageDeleted = ({ message_id: messageId } = {}) => {
      if (!messageId) return
      removeInboxMessage(messageId)
      loadInboxThreads({ quiet: true })
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('chat-message', handleMessage)
    socket.on('chat-message-edited', handleMessageEdited)
    socket.on('chat-message-reaction', handleMessageReaction)
    socket.on('chat-message-deleted', handleMessageDeleted)
    socket.on('chat-message-unsent', handleMessageUnsent)
    socket.on('direct-message', handleDirectMessage)
    socket.on('direct-message-edited', handleDirectMessageEdited)
    socket.on('direct-message-reaction', handleDirectMessageReaction)
    socket.on('direct-message-deleted', handleDirectMessageDeleted)
    socket.on('typing-start', handleTypingStart)
    socket.on('typing-stop', handleTypingStop)
    socket.io?.on('reconnect', syncAfterReconnect)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('chat-message', handleMessage)
      socket.off('chat-message-edited', handleMessageEdited)
      socket.off('chat-message-reaction', handleMessageReaction)
      socket.off('chat-message-deleted', handleMessageDeleted)
      socket.off('chat-message-unsent', handleMessageUnsent)
      socket.off('direct-message', handleDirectMessage)
      socket.off('direct-message-edited', handleDirectMessageEdited)
      socket.off('direct-message-reaction', handleDirectMessageReaction)
      socket.off('direct-message-deleted', handleDirectMessageDeleted)
      socket.off('typing-start', handleTypingStart)
      socket.off('typing-stop', handleTypingStop)
      socket.io?.off('reconnect', syncAfterReconnect)
    }
  }, [socket, roomId, signalingRoom, user?.id, blockedSenderIds, inboxTarget?.id])

  useEffect(() => {
    if (!emojiPickerTarget && !reactionPickerTarget) return undefined

    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      closeEmojiPicker()
      closeReactionPicker()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [emojiPickerTarget, reactionPickerTarget])

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
    <>
    <aside className={joinerPresentation ? 'chat-panel glass-card joiner-chat-panel' : 'chat-panel glass-card'}>
      {joinerPresentation ? (
        <>
          <div className="joiner-chat-roster" aria-label={t('Room people')}>
            <div>
              {participantPreview.slice(0, 5).map((participant, index) => (
                <button
                  key={participant.id || `${participant.name}-${index}`}
                  type="button"
                  className="joiner-roster-avatar"
                  onClick={() => handleParticipantAction(participant)}
                  disabled={participantActionDisabled(participant)}
                  aria-label={`${participant.name || t('User')} - ${participantActionLabel(participant)}`}
                  title={`${participant.name || t('User')} - ${participantActionLabel(participant)}`}
                >
                  <span className="image-avatar">
                    <img
                      src={participant.avatarUrl || avatarForUser({ id: participant.id, name: participant.name }, participant.id || index)}
                      alt=""
                      loading="lazy"
                    />
                  </span>
                  <span className="joiner-roster-popover" aria-hidden="true">
                    <strong>{participant.name || t('User')}</strong>
                    <small>{participantActionLabel(participant)}</small>
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={chatMode === 'inbox' ? 'joiner-message-toggle is-open' : 'joiner-message-toggle'}
              onClick={chatMode === 'inbox' ? showRoomComments : showPersonalInbox}
              aria-label={chatMode === 'inbox' ? t('Room chat') : t('Inbox')}
            >
              <span className="joiner-message-toggle-icon" aria-hidden="true">
                <img src={messageComposerIcon} alt="" loading="lazy" />
              </span>
            </button>
          </div>
          {chatMode === 'comments' ? (
            <p className="joiner-chat-guide">
              {guideText || t('Please respect each other and chat in friendly manner. Abuse, sexual and violent contents are not allowed. All violators will be banned.')}
            </p>
          ) : (
            <p className="joiner-chat-guide compact">
              {inboxTarget?.name ? t('Message {name}', { name: inboxTarget.name }) : t('Personal Inbox')}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="chat-panel-header">
            <div>
              <span className="eyebrow">{chatMode === 'inbox' ? t('Personal Inbox') : t('Room Comments')}</span>
              <h3>{chatMode === 'inbox' ? (inboxTarget?.name || t('Inbox')) : t('Live Chat')}</h3>
            </div>
            <span className={realtimeConnected ? 'chat-connection online' : 'chat-connection'}>
              {chatMode === 'inbox' ? t('Private') : typingNames.length ? t('Typing') : realtimeConnected ? t('Realtime') : t('Saved')}
            </span>
          </div>
          <div className="chat-mode-tabs" role="tablist" aria-label={t('Message section')}>
            <button
              type="button"
              className={chatMode === 'comments' ? 'active' : ''}
              onClick={showRoomComments}
              role="tab"
              aria-selected={chatMode === 'comments'}
            >
              {t('Room')}
            </button>
            <button
              type="button"
              className={chatMode === 'inbox' ? 'active' : ''}
              onClick={showPersonalInbox}
              role="tab"
              aria-selected={chatMode === 'inbox'}
            >
              {t('Inbox')}
            </button>
          </div>
        </>
      )}

      <div className="chat-mode-panel" hidden={chatMode !== 'comments'} data-chat-mode="comments">
      <div className="messages" ref={messagesRef} role="log" aria-label={t('Room chat messages')}>
        {loading ? (
          <LoadingMovie label={t('Loading chat')} compact />
        ) : visibleMessages.map((message) => {
          const mine = isOwnMessage(message, user)
          const senderName = mine ? t('You') : chatSenderName(message, user)
          const senderAvatar = avatarForUser(message, Number(message.sender_id || 0))
          const imageMessage = message.message_type === 'image'
          const avatarMessage = imageMessage && String(message.message_body || '').trim() === 'sent an avatar'
          const voiceMessage = message.message_type === 'voice'
          const giftMessage = message.message_type === 'gift'
          const gift = giftMessage ? roomGiftForMessage(message) : null
          const emojiOnlyBody = message.message_type === 'text' ? standaloneEmojiBody(message.message_body) : ''
          const standaloneEmoji = giftMessage || Boolean(emojiOnlyBody)
          const systemMessage = message.message_type === 'system'
          const canModify = mine && message.message_type === 'text'
          const canDelete = canDeleteMessage(message)
          const canBlock = canBlockMessage(message)
          const followedSender = !mine && isFollowedContact(message.sender_id)
          const canMessage = !mine && Boolean(message.sender_id) && followedSender
          const canFollow = !mine && Boolean(message.sender_id) && !followedSender
          const deleting = Boolean(deletingMessageIds[messageActionKey(message)])
          const following = Boolean(followingUserIds[Number(message.sender_id || 0)])
          const requested = requestedContactIds.some((id) => Number(id) === Number(message.sender_id || 0))
          const editing = editingMessageId === String(message.id)
          const savingEdit = savingEditId === String(message.id)
          const photoCaption = imageMessage && !['sent a photo', 'sent an avatar'].includes(String(message.message_body || '').trim())
            ? String(message.message_body || '').trim()
            : ''
          const reactionKey = reactionTarget('room', message)
          const reactionPickerOpen = reactionPickerTarget === reactionKey
          const bubbleClass = `${imageMessage
            ? 'chat-bubble image-message' : voiceMessage ? 'chat-bubble voice-message' : giftMessage ? 'chat-bubble gift-message' : systemMessage ? 'chat-bubble system-message' : 'chat-bubble'}${reactionPickerOpen ? ' reaction-picker-open' : ''}`

          return (
            <div className={`${mine ? 'chat-row mine' : 'chat-row'}${standaloneEmoji ? ' standalone-emoji-row' : ''}${giftMessage ? ' gift-row' : ''}`} key={`${message.id}-${message.created_at || ''}`}>
              <div className="chat-avatar image-avatar">
                <img src={senderAvatar} alt={senderName} loading="lazy" />
              </div>
              <div className={bubbleClass}>
                {!standaloneEmoji ? (
                  <div className="chat-meta">
                    <strong>{senderName}</strong>
                    <time>{formatChatTime(message.created_at)}{wasEdited(message) ? ` ${t('edited')}` : ''}</time>
                  </div>
                ) : null}
                {editing ? (
                  <form className="chat-edit-form" onSubmit={(event) => saveEdit(message, event)}>
                    <textarea
                      ref={editComposerRef}
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      onKeyDown={(event) => handleEditKeyDown(message, event)}
                      maxLength={1200}
                      rows={2}
                      autoFocus
                    />
                    <div className="chat-edit-tools">
                      <button type="button" className="chat-emoji-button compact" onClick={() => toggleEmojiPicker(`edit:${messageActionKey(message)}`)} aria-label={t('Emoji')} title={t('Emoji')}>
                        <span className="chat-emoji-glyph" aria-hidden="true">🙂</span>
                      </button>
                      <span>{editText.length}/1200</span>
                    </div>
                    <EmojiPicker
                      open={emojiPickerTarget === `edit:${messageActionKey(message)}`}
                      query={emojiQuery}
                      onQueryChange={setEmojiQuery}
                      onPick={insertEmoji}
                      onClose={closeEmojiPicker}
                      label={t('Edit message emoji picker')}
                      t={t}
                    />
                    <div className="chat-edit-actions">
                      <button type="submit" disabled={savingEdit || !editText.trim()}>
                        {savingEdit ? <LoadingMovie label={t('Saving')} inline /> : t('Save')}
                      </button>
                      <button type="button" className="secondary" onClick={cancelEdit} disabled={savingEdit}>
                        {t('Cancel')}
                      </button>
                    </div>
                  </form>
                ) : imageMessage ? (
                  <div className="chat-image-message">
                    <button
                      type="button"
                      className="chat-photo-preview-button"
                      onClick={() => openImagePreview({
                        src: message.media_url,
                        alt: `${senderName} sent`,
                        caption: photoCaption,
                        downloadName: photoDownloadName('room', message.id, message.media_url),
                      })}
                      aria-label={avatarMessage ? t('Preview avatar') : t('Preview image')}
                    >
                      <img className={avatarMessage ? 'chat-photo chat-avatar-share' : 'chat-photo'} src={message.media_url} alt={`${senderName} sent`} loading="lazy" />
                    </button>
                    {photoCaption ? <p>{photoCaption}</p> : null}
                  </div>
                ) : voiceMessage ? (
                  <div className="chat-voice-message">
                    <audio controls src={message.media_url}></audio>
                    <span>{message.message_body || t('Voice message')}</span>
                  </div>
                ) : giftMessage ? (
                  <div className="chat-gift-message">
                    <span className="chat-gift-emoji chat-emoji-glyph" role="img" aria-label={gift?.label || t('Gift')}>{gift?.emoji || '🎁'}</span>
                    <strong>{t(gift?.label || 'Gift')}</strong>
                    <small>{formatGiftCoins(gift?.total_coins || gift?.coin_value || 0, t)}</small>
                  </div>
                ) : emojiOnlyBody ? (
                  <div className="chat-standalone-emoji-message">
                    <span className="chat-standalone-emoji chat-emoji-glyph" role="img" aria-label={t('Emoji')}>{emojiOnlyBody}</span>
                  </div>
                ) : (
                  <p>{message.message_body}</p>
                )}
                {!editing && !systemMessage && !standaloneEmoji ? (
                  <MessageReactions
                    message={message}
                    disabled={!chatEnabled}
                    pickerOpen={reactionPickerOpen}
                    pickerQuery={reactionQuery}
                    onPickerQueryChange={setReactionQuery}
                    onToggle={toggleRoomReaction}
                    onOpenPicker={(targetMessage) => openReactionPicker('room', targetMessage)}
                    onClosePicker={closeReactionPicker}
                    onPickEmoji={toggleRoomReaction}
                    t={t}
                  />
                ) : null}
                {(canModify || canDelete || canBlock || canMessage || canFollow) && !editing && !standaloneEmoji && (
                  <div className="chat-actions">
                    {canFollow ? (
                      <button type="button" className="neutral" onClick={() => requestFollowFromMessage(message)} disabled={following || requested}>
                        {following ? t('Requesting') : requested ? t('Requested') : t('Follow')}
                      </button>
                    ) : null}
                    {canMessage ? (
                      <button type="button" className="neutral" onClick={() => openInboxFromMessage(message)}>
                        {t('Message')}
                      </button>
                    ) : null}
                    {canModify ? (
                      <button type="button" className="neutral" onClick={() => startEdit(message)} disabled={deleting}>
                        {t('Edit')}
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button type="button" className="danger" onClick={() => requestDeleteMessage(message)} disabled={deleting}>
                        {deleting ? t('Deleting') : t('Delete')}
                      </button>
                    ) : null}
                    {canBlock ? (
                      <button type="button" className="block" onClick={() => requestBlockUser(message)} disabled={Boolean(blockingUserIds[message.sender_id])}>
                        {blockingUserIds[message.sender_id] ? t('Blocking') : t('Block')}
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
              <strong>{t('Photo')}</strong>
              <small>{photoDraft.name || t('Ready to send')}</small>
            </span>
            <button type="button" onClick={clearPhotoDraft} disabled={sending} aria-label={t('Remove photo')}>x</button>
          </div>
        ) : null}
        {audioDraft ? (
          <div className="chat-audio-draft">
            <audio controls src={audioDraft.dataUrl}></audio>
            <span>{formatDuration(audioDraft.durationMs)} {t('voice note')}</span>
            <button type="button" onClick={cancelAudioDraft} disabled={sending} aria-label={t('Remove audio')}>x</button>
          </div>
        ) : null}
        {recording ? (
          <div className="chat-recording-line">
            <span>{formatDuration(recordingMs)}</span>
            <b>{t('Recording voice message')}</b>
          </div>
        ) : null}
        <textarea
          ref={composerRef}
          value={text}
          onChange={(event) => updateText(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          onBlur={stopTyping}
          placeholder={chatEnabled ? ((photoDraft || audioDraft) ? t('Add a caption') : joinerPresentation ? t('Send a chat') : t('Message this room')) : t('Chat is disabled')}
          maxLength={1200}
          rows={2}
          disabled={!chatEnabled || sending || recording}
        />
        <EmojiPicker
          open={emojiPickerTarget === 'room'}
          query={emojiQuery}
          onQueryChange={setEmojiQuery}
          onPick={insertEmoji}
          onClose={closeEmojiPicker}
          label={t('Room message emoji picker')}
          t={t}
        />
        {!chatEnabled ? <small className="chat-disabled-note">{t('Chat is turned off for this room.')}</small> : null}
        <div className="chat-form-footer">
          <span>{text.length}/1200</span>
          <div className="chat-form-actions">
            <input
              ref={roomPhotoInputRef}
              className="chat-photo-input"
              type="file"
              accept="image/*"
              onChange={stagePhotoDraft}
              disabled={!chatEnabled || sending}
            />
            <button type="button" className="secondary-button chat-emoji-button" onClick={() => toggleEmojiPicker('room')} disabled={!chatEnabled || sending || recording} aria-label={t('Emoji')} title={t('Emoji')}>
              <span className="chat-emoji-glyph" aria-hidden="true">🙂</span>
            </button>
            <button type="button" className="secondary-button chat-photo-button" onClick={openPhotoPicker} disabled={!chatEnabled || sending} aria-label={t('Photo')} title={t('Photo')}>
              <img src={liveRoomAssets.composerPhoto} alt="" loading="lazy" />
              <span>{t('Photo')}</span>
            </button>
            <button
              type="button"
              className={recording ? 'secondary-button chat-audio-button recording' : 'secondary-button chat-audio-button'}
              onClick={recording ? stopAudioRecording : startAudioRecording}
              disabled={!chatEnabled || sending}
              aria-label={recording ? t('Stop recording') : t('Audio')}
              title={recording ? t('Stop recording') : t('Audio')}
            >
              <img src={liveRoomAssets.composerMic} alt="" loading="lazy" />
              <span>{recording ? t('Stop') : t('Audio')}</span>
            </button>
            {roomGifts.map((gift) => (
              <button
                key={gift.id}
                type="button"
                className="secondary-button chat-gift-button"
                onClick={() => sendGift(gift)}
                disabled={!chatEnabled || !giftEnabled || sending || recording}
                aria-label={t('Send {gift} gift', { gift: t(gift.label) })}
                title={t('Send {gift} gift', { gift: t(gift.label) })}
              >
                <span className="chat-emoji-glyph" aria-hidden="true">{gift.emoji}</span>
                <small>{t(gift.label)}</small>
              </button>
            ))}
            <button className="primary-button" type="submit" disabled={!canSend}>
              {sending ? t('Sending') : t('Send')}
            </button>
          </div>
        </div>
      </form>
      </div>

      <div className="chat-mode-panel" hidden={chatMode !== 'inbox'} data-chat-mode="inbox">
      <div className="personal-inbox">
        <div className="inbox-thread-strip">
          {loadingInbox && !inboxThreads.length ? (
            <LoadingMovie label={t('Loading inbox')} inline />
          ) : inboxThreads.length ? inboxThreads.map((thread) => {
            const active = Number(inboxTarget?.id) === Number(thread.peer_id)
            const preview = thread.last_message?.message_type === 'voice'
              ? t('Voice message')
              : thread.last_message?.message_type === 'image' ? t('Photo') : thread.last_message?.message_body

            return (
              <button key={thread.peer_id} type="button" className={active ? 'active' : ''} onClick={() => loadInboxConversation(thread)}>
                <span className="image-avatar"><img src={avatarForUser(thread, thread.peer_id)} alt="" loading="lazy" /></span>
                <b>{thread.peer_name || `User #${thread.peer_id}`}</b>
                <small>{preview || t('Start chat')}</small>
              </button>
            )
          }) : (
            <span>{t('No followed contacts yet')}</span>
          )}
        </div>

        <div className="messages inbox-messages" ref={inboxMessagesRef} role="log" aria-label={t('Private inbox messages')}>
          {!inboxTarget ? (
            <div className="empty-chat">
              <strong>{t('Personal inbox')}</strong>
              <span>{t('Follow a user first, then choose them here to start a private chat.')}</span>
            </div>
          ) : loadingInbox ? (
            <LoadingMovie label={t('Loading conversation')} compact />
          ) : inboxMessages.length === 0 ? (
            <div className="empty-chat">
              <strong>{inboxTarget.name}</strong>
              <span>{t('No private messages yet.')}</span>
            </div>
          ) : inboxMessages.map((message) => {
            const mine = Number(message.sender_id) === Number(user?.id)
            const senderName = mine ? t('You') : message.sender_name || inboxTarget.name
            const imageMessage = message.message_type === 'image'
            const voiceMessage = message.message_type === 'voice'
            const body = message.message_body || ''
            const emojiOnlyBody = message.message_type === 'text' ? standaloneEmojiBody(body) : ''
            const editKey = inboxEditKey(message)
            const canModify = mine && message.message_type === 'text'
            const canDelete = canDeleteMessage(message)
            const editing = editingMessageId === editKey
            const savingEdit = savingEditId === editKey
            const deleting = Boolean(deletingMessageIds[editKey])
            const reactionKey = reactionTarget('inbox', message)
            const reactionPickerOpen = reactionPickerTarget === reactionKey
            const bubbleClass = `${imageMessage ? 'chat-bubble image-message' : voiceMessage ? 'chat-bubble voice-message' : 'chat-bubble'}${reactionPickerOpen ? ' reaction-picker-open' : ''}`

            return (
              <div className={`${mine ? 'chat-row mine' : 'chat-row'}${emojiOnlyBody ? ' standalone-emoji-row' : ''}`} key={`dm-${message.id}`}>
                <div className="chat-avatar image-avatar">
                  <img src={mine ? avatarForUser(user, user?.id || message.sender_id || 0) : avatarForUser({ ...inboxTarget, sender_gender: message.sender_gender }, message.sender_id || 0)} alt={senderName} loading="lazy" />
                </div>
                <div className={bubbleClass}>
                  {!emojiOnlyBody ? (
                    <div className="chat-meta">
                      <strong>{senderName}</strong>
                      <time>{formatChatTime(message.created_at)}{wasEdited(message) ? ` ${t('edited')}` : ''}</time>
                    </div>
                  ) : null}
                  {editing ? (
                    <form className="chat-edit-form" onSubmit={(event) => saveInboxEdit(message, event)}>
                      <textarea
                        ref={editComposerRef}
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        onKeyDown={(event) => handleInboxEditKeyDown(message, event)}
                        maxLength={1200}
                        rows={2}
                        autoFocus
                      />
                      <div className="chat-edit-tools">
                        <button type="button" className="chat-emoji-button compact" onClick={() => toggleEmojiPicker(`edit:${messageActionKey({ ...message, __scope: 'inbox' })}`)} aria-label={t('Emoji')} title={t('Emoji')}>
                          <span className="chat-emoji-glyph" aria-hidden="true">🙂</span>
                        </button>
                        <span>{editText.length}/1200</span>
                      </div>
                      <EmojiPicker
                        open={emojiPickerTarget === `edit:${messageActionKey({ ...message, __scope: 'inbox' })}`}
                        query={emojiQuery}
                        onQueryChange={setEmojiQuery}
                        onPick={insertEmoji}
                        onClose={closeEmojiPicker}
                        label={t('Edit private message emoji picker')}
                        t={t}
                      />
                      <div className="chat-edit-actions">
                        <button type="submit" disabled={savingEdit || !editText.trim()}>
                          {savingEdit ? <LoadingMovie label={t('Saving')} inline /> : t('Save')}
                        </button>
                        <button type="button" className="secondary" onClick={cancelEdit} disabled={savingEdit}>
                          {t('Cancel')}
                        </button>
                      </div>
                    </form>
                  ) : imageMessage ? (
                    <div className="chat-image-message">
                      <button
                        type="button"
                        className="chat-photo-preview-button"
                        onClick={() => openImagePreview({
                          src: message.media_url,
                          alt: `${senderName} sent`,
                          caption: body && body !== 'sent a photo' ? body : '',
                          downloadName: photoDownloadName('inbox', message.id, message.media_url),
                        })}
                        aria-label={t('Preview photo')}
                      >
                        <img className="chat-photo" src={message.media_url} alt={`${senderName} sent`} loading="lazy" />
                      </button>
                      {body && body !== 'sent a photo' ? <p>{body}</p> : null}
                    </div>
                  ) : voiceMessage ? (
                    <div className="chat-voice-message">
                      <audio controls src={message.media_url}></audio>
                      <span>{body || t('Voice message')}</span>
                    </div>
                  ) : emojiOnlyBody ? (
                    <div className="chat-standalone-emoji-message">
                      <span className="chat-standalone-emoji chat-emoji-glyph" role="img" aria-label={t('Emoji')}>{emojiOnlyBody}</span>
                    </div>
                  ) : (
                    <p>{body}</p>
                  )}
                  {!editing && !emojiOnlyBody ? (
                    <MessageReactions
                      message={message}
                      disabled={!inboxTarget}
                      pickerOpen={reactionPickerOpen}
                      pickerQuery={reactionQuery}
                      onPickerQueryChange={setReactionQuery}
                      onToggle={toggleInboxReaction}
                      onOpenPicker={(targetMessage) => openReactionPicker('inbox', targetMessage)}
                      onClosePicker={closeReactionPicker}
                      onPickEmoji={toggleInboxReaction}
                      t={t}
                    />
                  ) : null}
                  {(canModify || canDelete) && !editing && !emojiOnlyBody ? (
                    <div className="chat-actions">
                      {canModify ? (
                        <button type="button" className="neutral" onClick={() => startInboxEdit(message)} disabled={deleting}>
                          {t('Edit')}
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button type="button" className="danger" onClick={() => requestDeleteInboxMessage(message)} disabled={deleting}>
                          {deleting ? t('Deleting') : t('Delete')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
          <div ref={inboxEndRef} />
        </div>
      </div>

      <form className="chat-form" onSubmit={sendInboxMessage}>
        {photoDraft ? (
          <div className="chat-photo-draft">
            <img src={photoDraft.dataUrl} alt="" />
            <span>
              <strong>{t('Photo')}</strong>
              <small>{photoDraft.name || t('Ready to send')}</small>
            </span>
            <button type="button" onClick={clearPhotoDraft} disabled={sendingInbox} aria-label={t('Remove photo')}>x</button>
          </div>
        ) : null}
        {audioDraft ? (
          <div className="chat-audio-draft">
            <audio controls src={audioDraft.dataUrl}></audio>
            <span>{formatDuration(audioDraft.durationMs)} {t('voice note')}</span>
            <button type="button" onClick={cancelAudioDraft} disabled={sendingInbox} aria-label={t('Remove audio')}>x</button>
          </div>
        ) : null}
        {recording ? (
          <div className="chat-recording-line">
            <span>{formatDuration(recordingMs)}</span>
            <b>{t('Recording voice message')}</b>
          </div>
        ) : null}
        <textarea
          ref={inboxComposerRef}
          value={inboxText}
          onChange={(event) => setInboxText(event.target.value)}
          onKeyDown={handleInboxComposerKeyDown}
          placeholder={inboxTarget ? ((photoDraft || audioDraft) ? t('Add a caption') : t('Message {name}', { name: inboxTarget.name })) : t('Choose a private chat')}
          maxLength={1200}
          rows={2}
          disabled={!inboxTarget || sendingInbox || recording}
        />
        <EmojiPicker
          open={emojiPickerTarget === 'inbox'}
          query={emojiQuery}
          onQueryChange={setEmojiQuery}
          onPick={insertEmoji}
          onClose={closeEmojiPicker}
          label={t('Private message emoji picker')}
          t={t}
        />
        <div className="chat-form-footer">
          <span>{inboxText.length}/1200</span>
          <div className="chat-form-actions">
            <input
              ref={inboxPhotoInputRef}
              className="chat-photo-input"
              type="file"
              accept="image/*"
              onChange={stagePhotoDraft}
              disabled={!inboxTarget || sendingInbox}
            />
            <button type="button" className="secondary-button chat-emoji-button" onClick={() => toggleEmojiPicker('inbox')} disabled={!inboxTarget || sendingInbox || recording} aria-label={t('Emoji')} title={t('Emoji')}>
              <span className="chat-emoji-glyph" aria-hidden="true">🙂</span>
            </button>
            <button type="button" className="secondary-button chat-photo-button" onClick={openPhotoPicker} disabled={!inboxTarget || sendingInbox} aria-label={t('Photo')} title={t('Photo')}>
              <img src={liveRoomAssets.composerPhoto} alt="" loading="lazy" />
              <span>{t('Photo')}</span>
            </button>
            <button
              type="button"
              className={recording ? 'secondary-button chat-audio-button recording' : 'secondary-button chat-audio-button'}
              onClick={recording ? stopAudioRecording : startAudioRecording}
              disabled={!inboxTarget || sendingInbox}
              aria-label={recording ? t('Stop recording') : t('Audio')}
              title={recording ? t('Stop recording') : t('Audio')}
            >
              <img src={liveRoomAssets.composerMic} alt="" loading="lazy" />
              <span>{recording ? t('Stop') : t('Audio')}</span>
            </button>
            <button className="primary-button" type="submit" disabled={!canSendInbox}>
              {sendingInbox ? t('Sending') : t('Send')}
            </button>
          </div>
        </div>
      </form>
      </div>
      {status && <small className="warning-text">{t(status)}</small>}

      {deleteTarget ? (
        <div className="chat-delete-backdrop" onMouseDown={closeDeleteModal}>
          <section className="chat-delete-modal" role="dialog" aria-modal="true" aria-labelledby="chat-delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <h3 id="chat-delete-title">{t('Delete message')}</h3>
            <p>{t('Are you sure you want to delete this message?')}</p>
            <label className={canDeleteMessageForEveryone(deleteTarget) ? 'chat-delete-option' : 'chat-delete-option disabled'}>
              <input
                type="checkbox"
                checked={deleteForEveryone && canDeleteMessageForEveryone(deleteTarget)}
                disabled={!canDeleteMessageForEveryone(deleteTarget) || Boolean(deletingMessageIds[messageActionKey(deleteTarget)])}
                onChange={(event) => setDeleteForEveryone(event.target.checked)}
              />
              <span>
                {canDeleteMessageForEveryone(deleteTarget)
                  ? (deleteTarget.__scope === 'inbox' ? t('Delete for everyone in this chat') : t('Delete for everyone in this room'))
                  : t('Delete only for me')}
              </span>
            </label>
            {canDeleteMessageForEveryone(deleteTarget) ? (
              <small className="chat-delete-hint">{deleteForEveryone ? t('Everyone will lose this message.') : t('Only your chat will hide this message.')}</small>
            ) : null}
            <footer>
              <button type="button" className="secondary-button" onClick={closeDeleteModal} disabled={Boolean(deletingMessageIds[messageActionKey(deleteTarget)])}>{t('CANCEL')}</button>
              <button type="button" className="danger-button" onClick={confirmDeleteMessage} disabled={Boolean(deletingMessageIds[messageActionKey(deleteTarget)])}>
                {deletingMessageIds[messageActionKey(deleteTarget)] ? t('DELETING...') : t('DELETE')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {blockTarget ? (
        <div className="chat-delete-backdrop" onMouseDown={closeBlockModal}>
          <section className="chat-delete-modal" role="dialog" aria-modal="true" aria-labelledby="chat-block-title" onMouseDown={(event) => event.stopPropagation()}>
            <h3 id="chat-block-title">{t('Block user')}</h3>
            <p>{t('Block {name} in this room?', { name: chatSenderName(blockTarget, user) })}</p>
            <small className="chat-delete-hint">{t('Their current messages will disappear from your chat and new messages from them will be hidden.')}</small>
            <footer>
              <button type="button" className="secondary-button" onClick={closeBlockModal} disabled={Boolean(blockingUserIds[blockTarget.sender_id])}>{t('CANCEL')}</button>
              <button type="button" className="danger-button" onClick={confirmBlockUser} disabled={Boolean(blockingUserIds[blockTarget.sender_id])}>
                {blockingUserIds[blockTarget.sender_id] ? t('BLOCKING...') : t('BLOCK')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </aside>
    {imagePreview ? (
      <div className="chat-image-preview-backdrop" onMouseDown={closeImagePreview}>
        <section className="chat-image-preview-modal" role="dialog" aria-modal="true" aria-label={t('Photo preview')} onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <strong>{t('Photo')}</strong>
            <button type="button" onClick={closeImagePreview} aria-label={t('Close photo preview')}>x</button>
          </header>
          <img src={imagePreview.src} alt={imagePreview.alt} />
          {imagePreview.caption ? <p>{imagePreview.caption}</p> : null}
          <footer>
            <a className="chat-image-download-action" href={imagePreview.src} download={imagePreview.downloadName || 'chat-photo.jpg'}>{t('Download')}</a>
          </footer>
        </section>
      </div>
    ) : null}
    </>
  )
}
