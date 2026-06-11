import { useEffect, useMemo, useRef, useState } from 'react'
import { actionAvatarAssets, assetImage2Assets, avatarForIndex, avatarForUser, brandAssets, coverForDemoTone, coverForRoomType, liveRoomAssets, roomAssets } from '../../assets/rtc/catalog'
import { ProfilePanel } from '../profile/ProfilePanel'
import { LoadingMovie } from '../common/LoadingMovie'
import { apiRequest } from '../../services/api'
import { formatChatTime } from '../../utils/formatters'
import { canUseAdminDashboard } from '../../utils/roles'
import {
  buildRoomsPath,
  defaultSeatsForRoomType,
  defaultRoomForm,
  defaultRtcModeForRoom,
  getRoomMeta,
  liveRoomTypes,
  musicRoomTypes,
  maxSeatsForRoomType,
  normalizeRtcMode,
  privacyFilterOptions,
  roomFeatureOptions,
  roomFormPayload,
  roomFilterOptions,
  roomAllowsCamera,
  roomPrivacyOptions,
  roomSortOptions,
  roomTypeLabels,
  videoRoomTypes,
  rtcModeOptions,
  themeOptions,
  validateRoomForm,
} from '../../utils/roomConfig'
import {
  faqAnswers,
  faqTopics,
  feedTabs,
  feedbackCategories,
  feedbackTypes,
  languageStatus,
  maxFeedbackAttachmentSize,
  normalizeSettingsLanguage,
  policyDocuments,
  popularHelp,
  regions,
  settingsLanguageCodes,
  settingsLanguageOptions,
  settingsNav,
  translateApp,
} from './roomsStaticData'

const defaultFeedTab = feedTabs.find((item) => item.value === 'for_you') || { filter: 'all', sort: 'newest' }
const accessFilterValues = new Set(privacyFilterOptions.map((option) => option.value))
const appDownloadName = 'BuzzCast'
const appDownloadUrl = 'https://www.buzzcast.com'
const appDownloadQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=176x176&margin=1&data=${encodeURIComponent(appDownloadUrl)}`
const maxDmPhotoBytes = 5 * 1024 * 1024
const maxDmAudioBytes = 5 * 1024 * 1024
const dmAudioBitsPerSecond = 32000
const roomAccessCodeInputProps = {
  type: 'text',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  className: 'room-access-code-input',
}
const dmRecordingAudioConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

function initialsFromName(name) {
  return String(name || 'User')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U'
}

function compactNumber(value) {
  const number = Number(value || 0)
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`
  return String(number)
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Attachment could not be read. Please try another file.'))
    reader.readAsDataURL(file)
  })
}

function savedRoomSettings() {
  if (typeof window === 'undefined') return {}
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_room_settings') || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

function savedFeedbackRecords() {
  if (typeof window === 'undefined') return []
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_feedback_records') || '[]')
    return Array.isArray(saved) ? saved.slice(0, 20) : []
  } catch {
    return []
  }
}

function savedRecentRoomIds() {
  if (typeof window === 'undefined') return []
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_recent_mobile_room_ids') || '[]')
    return Array.isArray(saved) ? saved.map(String).filter(Boolean).slice(0, 24) : []
  } catch {
    return []
  }
}

function saveRecentRoomIds(ids) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('rtc_recent_mobile_room_ids', JSON.stringify(ids.slice(0, 24)))
}

function formatFeedbackRecordDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function compactText(value, maxLength = 56) {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}...`
}

function directMessageThreadId(peerId) {
  const normalizedId = Number(peerId || 0)
  return normalizedId ? `dm-${normalizedId}` : ''
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

function directMessageBody(message) {
  if (!message) return ''
  if (message.message_type === 'image') return message.message_body || 'Photo'
  if (message.message_type === 'voice') return message.message_body || 'Voice message'
  return message.message_body || message.body || ''
}

function normalizeDirectMessage(message, currentUser) {
  if (!message) return null

  return {
    ...message,
    body: directMessageBody(message),
    mine: Number(message.sender_id) === Number(currentUser?.id),
    createdAt: message.created_at || message.createdAt || message.updated_at || new Date().toISOString(),
  }
}

function directMessagePreview(message, currentUser) {
  if (!message) return 'No messages yet'
  const normalized = normalizeDirectMessage(message, currentUser)
  const prefix = normalized.mine ? 'You: ' : ''
  return compactText(`${prefix}${normalized.body || 'Message'}`)
}

function contactFromDirectMessage(message, peer, currentUser) {
  const peerId = Number(peer?.id || directMessagePeerId(message, currentUser) || 0)
  if (!peerId) return null

  const fromSender = Number(message?.sender_id || 0) === peerId
  return {
    peer_id: peerId,
    peer_name: peer?.name || (fromSender ? message.sender_name : message.recipient_name) || `User #${peerId}`,
    peer_avatar_url: peer?.avatar_url || (fromSender ? message.sender_avatar_url : message.recipient_avatar_url) || '',
    peer_gender: peer?.gender || (fromSender ? message.sender_gender : message.recipient_gender) || '',
    last_message: message,
  }
}

function preferredDmAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''

  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function createDmVoiceRecorder(stream) {
  const mimeType = preferredDmAudioMimeType()
  const baseOptions = { audioBitsPerSecond: dmAudioBitsPerSecond }

  if (mimeType) {
    try {
      return new MediaRecorder(stream, { ...baseOptions, mimeType })
    } catch {
      // Some browsers over-report MIME support; browser defaults are a safer fallback.
    }
  }

  return new MediaRecorder(stream, baseOptions)
}

function formatDmDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function directMessageActionKey(message) {
  return `dm-${message?.id || 'message'}`
}

function directMessageDownloadName(message) {
  const mediaUrl = String(message?.media_url || '')
  const dataType = mediaUrl.match(/^data:image\/([^;]+);/i)?.[1]
  const pathType = !dataType ? mediaUrl.split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1] : ''
  const extension = String(dataType || pathType || 'jpg').replace(/^jpeg$/i, 'jpg').toLowerCase()
  return `direct-message-${message?.id || Date.now()}.${extension}`
}

function validEmail(value) {
  return /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(value || '').trim())
}

function cardAvatarIndex(card, fallback = 0) {
  if (Number.isFinite(Number(card?.avatarIndex))) return Number(card.avatarIndex)
  if (card?.room?.id) return Number(card.room.id)
  const numericId = String(card?.id || '').match(/\d+/)?.[0]
  return Number(numericId || fallback)
}

function cardCover(card, fallback = 0) {
  if (card?.room) return coverForRoomType(card.room.room_type, card.room.privacy_type, cardAvatarIndex(card, fallback))
  if (card?.roomType || card?.privacy) return coverForRoomType(card.roomType, card.privacy, cardAvatarIndex(card, fallback))
  return coverForDemoTone(card?.tone, cardAvatarIndex(card, fallback))
}

function activeParticipantPreviews(card) {
  const previews = card?.room?.active_participant_previews || card?.activeParticipantPreviews || card?.active_participant_previews || []
  return Array.isArray(previews) ? previews.filter(Boolean) : []
}

function liveUserCount(card) {
  const previewCount = activeParticipantPreviews(card).length
  const count = Number(card?.room?.active_participants ?? card?.activeParticipants ?? card?.viewers ?? previewCount)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
}

function liveUserAvatarItems(card, maxVisible = 3) {
  const count = liveUserCount(card)
  const previews = activeParticipantPreviews(card)
  const visibleCount = Math.min(count, maxVisible)

  return Array.from({ length: visibleCount }, (_, offset) => {
    const participant = previews[offset] || {}
    const name = participant.name || participant.user_name || (offset === 0 ? card?.host : '') || `User ${offset + 1}`
    const avatarUrl = participant.avatar_url || participant.avatarUrl || ''

    return {
      key: `${card?.id || 'room'}-${participant.user_id || participant.userId || offset}`,
      name,
      src: avatarForUser({ ...participant, name, avatar_url: avatarUrl }, participant.user_id || participant.userId || offset),
      fallback: !avatarUrl,
    }
  })
}

function roomToFeedCard(room, index) {
  const meta = getRoomMeta(room.room_type)
  const ownerRegion = room.owner_region || room.owner_current_residence || room.country || ''
  const activeParticipants = liveUserCount({ room })
  const participantPreviews = activeParticipantPreviews({ room })
  return {
    id: `room-${room.id}`,
    room,
    title: room.name || `Live room ${room.id}`,
    host: room.owner_name || 'Room host',
    viewers: activeParticipants,
    activeParticipants,
    activeParticipantPreviews: participantPreviews,
    tone: ['aurora', 'warm', 'rose', 'sunset', 'slate', 'amber', 'night', 'plum'][index % 8],
    badge: room.privacy_type === 'password' ? 'Locked' : meta.short,
    category: meta.label,
    clientCompany: room.tenant_name || null,
    country: ownerRegion || 'Global',
    region: ownerRegion || '',
    following: Boolean(room.owner_followed),
    size: index === 0 ? 'feature' : '',
    roomType: room.room_type,
    privacy: room.privacy_type,
    avatarIndex: Number(room.id) || index,
  }
}

function upsertRoomById(roomList, nextRoom) {
  if (!nextRoom?.id) return roomList
  return [
    nextRoom,
    ...roomList.filter((room) => Number(room.id) !== Number(nextRoom.id)),
  ]
}

function createRoomErrorMessage(error) {
  const fieldMessages = Object.values(error?.errors || {}).flat().filter(Boolean)
  return error?.message || fieldMessages[0] || 'Room could not be created. Please try again.'
}

function defaultLiveRoomName(displayName) {
  const ownerName = String(displayName || '').trim()
  return ownerName ? `${ownerName} Live Room` : 'Enterprise Live Room'
}

function tabConfigForFeed(feed) {
  return feedTabs.find((item) => item.value === feed) || defaultFeedTab
}

function cardMatchesRoomFilters(card, filter, privacyFilter) {
  const roomType = card.room?.room_type || card.roomType
  const privacyType = roomAccessType(card)
  const accessFilter = normalizeAccessFilter(privacyFilter)
  const typeMatches = filter === 'all'
    || (filter === 'live' && liveRoomTypes.includes(roomType))
    || (filter === 'video' && videoRoomTypes.includes(roomType))
    || (filter === 'music' && musicRoomTypes.includes(roomType))
    || (filter === 'pk' && roomType === 'pk_live')
  const privacyMatches = accessFilter === 'all' || privacyType === accessFilter

  return typeMatches && privacyMatches
}

function normalizeAccessFilter(value) {
  const normalized = String(value || 'all').trim().toLowerCase()
  return accessFilterValues.has(normalized) ? normalized : 'all'
}

function roomAccessType(card) {
  const rawValue = card?.room?.privacy_type || card?.privacy || (card?.room?.is_password_protected ? 'password' : 'public')
  const normalized = String(rawValue || 'public').trim().toLowerCase()
  if (normalized === 'locked') return 'password'
  return accessFilterValues.has(normalized) && normalized !== 'all' ? normalized : 'public'
}

function IconButton({ label, children, badge, className = '', onClick }) {
  return (
    <button type="button" className={`buzzcast-icon-button ${className}`} onClick={onClick} aria-label={label} title={label}>
      <span className="buzzcast-icon-inner">{children}</span>
      {badge ? <em>{badge}</em> : null}
    </button>
  )
}

function AppIconSprite() {
  return (
    <svg className="buzzcast-svg-sprite" aria-hidden="true" focusable="false">
      <symbol id="icon-getTheAppIcon" viewBox="0 0 24 24">
        <path d="M7.25 2.75h9.5a2 2 0 0 1 2 2v14.5a2 2 0 0 1-2 2h-9.5a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Zm1 1.8a1.2 1.2 0 0 0-1.2 1.2v12.5a1.2 1.2 0 0 0 1.2 1.2h7.5a1.2 1.2 0 0 0 1.2-1.2V5.75a1.2 1.2 0 0 0-1.2-1.2h-7.5Z" />
        <path d="M9.6 5.8h4.8a.8.8 0 0 1 0 1.6H9.6a.8.8 0 0 1 0-1.6Zm1.6 10.7h1.6a.8.8 0 0 1 0 1.6h-1.6a.8.8 0 0 1 0-1.6Zm.8-7.6a.8.8 0 0 1 .8.8v2.85l.78-.78a.8.8 0 0 1 1.13 1.13l-2.15 2.15a.8.8 0 0 1-1.12 0L9.29 12.9a.8.8 0 1 1 1.13-1.13l.78.78V9.7a.8.8 0 0 1 .8-.8Z" />
      </symbol>
      <symbol id="icon-adminDashboardIcon" viewBox="0 0 24 24">
        <path d="M4.25 5.25a2 2 0 0 1 2-2h11.5a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H6.25a2 2 0 0 1-2-2v-9.5Zm2 .55a.55.55 0 0 0-.55.55v7.3c0 .3.25.55.55.55h11.5c.3 0 .55-.25.55-.55v-7.3a.55.55 0 0 0-.55-.55H6.25Z" />
        <path d="M7.65 8.1h3.7a.75.75 0 0 1 0 1.5h-3.7a.75.75 0 0 1 0-1.5Zm0 3.2h2.05a.75.75 0 0 1 0 1.5H7.65a.75.75 0 0 1 0-1.5Zm7.02-3.05h1.1a.75.75 0 0 1 .75.75v1.1a.75.75 0 0 1-.75.75h-1.1a.75.75 0 0 1-.75-.75V9a.75.75 0 0 1 .75-.75Zm-5.2 10.1h5.06a.8.8 0 0 1 0 1.6H9.47a.8.8 0 0 1 0-1.6Zm1.73-2.25h1.6v2.7h-1.6v-2.7Z" />
      </symbol>
      <symbol id="icon-rankingIcon" viewBox="0 0 24 24">
        <path d="M12 2.85 13.55 6l3.48.5-2.52 2.45.6 3.46L12 10.78 8.89 12.4l.6-3.46L6.97 6.5 10.45 6 12 2.85Z" />
        <path d="M9.05 12.55h5.9a1.4 1.4 0 0 1 1.4 1.4v5.2h-8.7v-5.2a1.4 1.4 0 0 1 1.4-1.4Zm-5.1 3.25a1.4 1.4 0 0 1 1.4-1.4H7.6v4.75H3.95V15.8Zm12.45-1.4h2.25a1.4 1.4 0 0 1 1.4 1.4v3.35H16.4V14.4Zm-13.2 5.55h17.6a.8.8 0 0 1 0 1.6H3.2a.8.8 0 0 1 0-1.6Z" />
      </symbol>
      <symbol id="icon-messageTopbarIcon" viewBox="0 0 24 24">
        <path d="M5.25 4.4h13.5a2.25 2.25 0 0 1 2.25 2.25v7.75a2.25 2.25 0 0 1-2.25 2.25h-5.62l-4.05 3.04a.9.9 0 0 1-1.44-.72v-2.32H5.25A2.25 2.25 0 0 1 3 14.4V6.65A2.25 2.25 0 0 1 5.25 4.4Zm0 1.75a.5.5 0 0 0-.5.5v7.75c0 .28.22.5.5.5h3.29c.5 0 .9.4.9.9v1.37l2.88-2.16a.9.9 0 0 1 .54-.18h5.89a.5.5 0 0 0 .5-.5V6.65a.5.5 0 0 0-.5-.5H5.25Z" />
        <path d="M8.1 10.5a1.05 1.05 0 1 1 2.1 0 1.05 1.05 0 0 1-2.1 0Zm2.85 0a1.05 1.05 0 1 1 2.1 0 1.05 1.05 0 0 1-2.1 0Zm2.85 0a1.05 1.05 0 1 1 2.1 0 1.05 1.05 0 0 1-2.1 0Z" />
      </symbol>
      <symbol id="icon-settingsIcon" viewBox="0 0 24 24">
        <path d="M12 8.1a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8Zm0 1.75a2.15 2.15 0 1 0 0 4.3 2.15 2.15 0 0 0 0-4.3Z" />
        <path d="M13.3 2.75a1.15 1.15 0 0 1 1.08.78l.45 1.33c.38.16.75.37 1.09.61l1.37-.29a1.15 1.15 0 0 1 1.2.54l1.3 2.25a1.15 1.15 0 0 1-.13 1.31l-.92 1.04a7.46 7.46 0 0 1 0 1.36l.92 1.04c.33.37.38.9.13 1.31l-1.3 2.25a1.15 1.15 0 0 1-1.2.54l-1.37-.29c-.34.24-.71.45-1.09.61l-.45 1.33a1.15 1.15 0 0 1-1.08.78h-2.6a1.15 1.15 0 0 1-1.08-.78l-.45-1.33a7.02 7.02 0 0 1-1.09-.61l-1.37.29a1.15 1.15 0 0 1-1.2-.54l-1.3-2.25a1.15 1.15 0 0 1 .13-1.31l.92-1.04a7.46 7.46 0 0 1 0-1.36l-.92-1.04a1.15 1.15 0 0 1-.13-1.31l1.3-2.25a1.15 1.15 0 0 1 1.2-.54l1.37.29c.34-.24.71-.45 1.09-.61l.45-1.33a1.15 1.15 0 0 1 1.08-.78h2.6Zm-.36 1.8h-1.88l-.5 1.5a.9.9 0 0 1-.57.56c-.52.18-1 .46-1.43.82a.9.9 0 0 1-.76.19l-1.55-.33-.94 1.62 1.04 1.17a.9.9 0 0 1 .2.77 5.71 5.71 0 0 0 0 1.72.9.9 0 0 1-.2.77L5.3 14.5l.94 1.62 1.55-.33a.9.9 0 0 1 .76.19c.43.36.91.64 1.43.82.27.09.48.3.57.56l.5 1.5h1.88l.5-1.5a.9.9 0 0 1 .57-.56c.52-.18 1-.46 1.43-.82a.9.9 0 0 1 .76-.19l1.55.33.94-1.62-1.04-1.17a.9.9 0 0 1-.2-.77 5.71 5.71 0 0 0 0-1.72.9.9 0 0 1 .2-.77l1.04-1.17-.94-1.62-1.55.33a.9.9 0 0 1-.76-.19A5.32 5.32 0 0 0 14 6.61a.9.9 0 0 1-.57-.56l-.5-1.5Z" />
      </symbol>
      <symbol id="icon-feedbackAndHelpIcon" viewBox="0 0 24 24">
        <path d="M4.25 4.25h15.5a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-6.2l-4.13 3.1a.9.9 0 0 1-1.44-.72v-2.38H4.25a2 2 0 0 1-2-2v-9.5a2 2 0 0 1 2-2Zm0 1.8a.2.2 0 0 0-.2.2v9.5c0 .11.09.2.2.2h4.63c.5 0 .9.4.9.9v1.48l2.95-2.21a.9.9 0 0 1 .54-.18h6.48a.2.2 0 0 0 .2-.2v-9.5a.2.2 0 0 0-.2-.2H4.25Z" />
        <path d="M7.2 9.1h9.6a.85.85 0 0 1 0 1.7H7.2a.85.85 0 1 1 0-1.7Zm0 3.4h5.9a.85.85 0 0 1 0 1.7H7.2a.85.85 0 1 1 0-1.7Z" />
      </symbol>
      <symbol id="icon-homeLiveIcon" viewBox="0 0 28 28">
        <path d="M5 7.5a2.5 2.5 0 0 1 2.5-2.5h8.7a2.5 2.5 0 0 1 2.5 2.5v1.82l3.2-2.02A1.35 1.35 0 0 1 24 8.44v11.12a1.35 1.35 0 0 1-2.1 1.14l-3.2-2.02v1.82a2.5 2.5 0 0 1-2.5 2.5H7.5A2.5 2.5 0 0 1 5 20.5v-13Zm2 0v13c0 .28.22.5.5.5h8.7a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5H7.5a.5.5 0 0 0-.5.5Zm11.7 4.18v4.64l3.3 2.08V9.6l-3.3 2.08Z" />
        <path d="M11.2 10.15a1 1 0 0 1 1.03.05l3.4 2.35a1 1 0 0 1 0 1.64l-3.4 2.36a1 1 0 0 1-1.57-.82V11a1 1 0 0 1 .54-.86Zm1.46 2.76v1.91l1.38-.95-1.38-.96Z" />
      </symbol>
      <symbol id="icon-icon_share" viewBox="0 0 20 20">
        <path d="M10 2.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Zm0 1.7a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z" />
        <path d="M4.2 17.6a5.8 5.8 0 1 1 11.6 0 .85.85 0 0 1-1.7 0 4.1 4.1 0 0 0-8.2 0 .85.85 0 0 1-1.7 0Z" />
      </symbol>
    </svg>
  )
}

function SvgIcon({ id, className = '' }) {
  return (
    <svg className={`buzzcast-svg-icon ${className}`} aria-hidden="true" focusable="false">
      <use href={`#${id}`} xlinkHref={`#${id}`}></use>
    </svg>
  )
}

function BuzzLogo() {
  return (
    <div className="buzzcast-logo">
      <div className="buzzcast-logo-mark image-mark">
        <img src={brandAssets.appIconSmall} alt="TalkEachOther" decoding="async" fetchPriority="high" />
      </div>
      <div>
        <strong>TalkEachOther</strong>
        <span>Video and music rooms</span>
      </div>
    </div>
  )
}

function FeedCard({ card, featured, onOpen, onDelete, canDelete = false, deleting = false }) {
  const cover = cardCover(card)
  const userCount = liveUserCount(card)
  const avatarItems = liveUserAvatarItems(card)
  const extraAvatarCount = Math.max(0, userCount - avatarItems.length)
  const roomMeta = getRoomMeta(card.room?.room_type || card.roomType)
  const privacy = card.room?.privacy_type || card.privacy || 'public'
  const imageLoading = featured ? 'eager' : 'lazy'
  const imagePriority = featured ? 'high' : 'low'

  return (
    <article className={`buzzcast-room-card ${featured ? 'featured' : ''}`}>
      <button type="button" className="buzzcast-card-button" onClick={() => onOpen(card)}>
        <div className={`buzzcast-media media-${card.tone || 'aurora'}`}>
          <img className="buzzcast-media-image" src={cover} alt="" loading={imageLoading} decoding="async" fetchPriority={imagePriority} />
          {card.badge ? <span className="buzzcast-card-badge">{card.badge}</span> : null}
          {card.sensitive ? <span className="buzzcast-sensitive-dot"></span> : null}
          <span className="buzzcast-viewers">{compactNumber(userCount)}</span>
          {avatarItems.length ? (
            <span className="buzzcast-seat-dots" aria-label={`${userCount} live user${userCount === 1 ? '' : 's'}`}>
              {avatarItems.map((avatar) => (
                <i key={avatar.key} className={avatar.fallback ? 'buzzcast-initial-avatar-dot' : ''} title={avatar.name}>
                  <img src={avatar.src} alt="" loading="lazy" decoding="async" fetchPriority="low" />
                </i>
              ))}
              {extraAvatarCount > 0 ? <i className="buzzcast-seat-more">+{compactNumber(extraAvatarCount)}</i> : null}
            </span>
          ) : null}
        </div>
        <div className="buzzcast-card-copy">
          <strong>{card.title}</strong>
          <span>{card.host}</span>
          <small className="buzzcast-card-meta">
            <b>{roomMeta.label}</b>
            <em>{privacy === 'public' ? `${compactNumber(userCount)} watching` : privacy}</em>
          </small>
        </div>
        <span className="buzzcast-mobile-live-count" aria-hidden="true">
          <i></i>{compactNumber(userCount)}
        </span>
      </button>
      {canDelete ? (
        <button
          type="button"
          className="buzzcast-room-delete-button"
          onClick={() => onDelete?.(card.room)}
          disabled={deleting}
          aria-label={`Delete ${card.title}`}
          title="Delete room"
        >
          <span aria-hidden="true">{deleting ? '...' : 'x'}</span>
          <small>{deleting ? 'Deleting' : 'Delete'}</small>
        </button>
      ) : null}
    </article>
  )
}

export function RoomsView({ onEnterRoom, user, onLogout, onUserUpdated, onView, onAuthRequired, language = 'English', onLanguageChange }) {
  const [rooms, setRooms] = useState([])
  const [roomMeta, setRoomMeta] = useState({ page: 1, per_page: 24, total: 0, total_pages: 1 })
  const [status, setStatus] = useState('Ready')
  const [roomId, setRoomId] = useState('')
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [joinPassword, setJoinPassword] = useState('')
  const [joinRtcMode, setJoinRtcMode] = useState('video')
  const [roomForm, setRoomForm] = useState(defaultRoomForm)
  const [formErrors, setFormErrors] = useState({})
  const [createdRoom, setCreatedRoom] = useState(null)
  const [pendingRoomDraft, setPendingRoomDraft] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState(defaultFeedTab.filter || 'all')
  const [privacyFilter, setPrivacyFilter] = useState('all')
  const [sort, setSort] = useState(defaultFeedTab.sort || 'newest')
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deletingRoomId, setDeletingRoomId] = useState(null)
  const [openingRoom, setOpeningRoom] = useState(false)
  const [activeSection, setActiveSection] = useState('live')
  const [activeFeed, setActiveFeed] = useState('for_you')
  const [mobileRoomGroup, setMobileRoomGroup] = useState('recently')
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  const [showMobileRoomProfile, setShowMobileRoomProfile] = useState(false)
  const [showMobileRoomTools, setShowMobileRoomTools] = useState(false)
  const [showMobileRoomLock, setShowMobileRoomLock] = useState(false)
  const [showMobileRoomSettings, setShowMobileRoomSettings] = useState(false)
  const [showMobileMembers, setShowMobileMembers] = useState(false)
  const [showRankings, setShowRankings] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [showDownloadQr, setShowDownloadQr] = useState(false)
  const [showHostPanel, setShowHostPanel] = useState(false)
  const [showJoinPanel, setShowJoinPanel] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [activeSettings, setActiveSettings] = useState('account')
  const [settingsStatus, setSettingsStatus] = useState('')
  const [selectedPolicyId, setSelectedPolicyId] = useState('')
  const [settingsDraft, setSettingsDraft] = useState(() => {
    const saved = savedRoomSettings()
    return {
      phoneBound: Boolean(saved.phoneBound),
      emailBound: Boolean(saved.emailBound || user?.email),
      loginPasswordSet: saved.loginPasswordSet !== false,
      deviceAlerts: saved.deviceAlerts !== false,
      messagePrivacy: saved.messagePrivacy || 'everyone',
      privateInvite: saved.privateInvite !== false,
      hideSensitive: saved.hideSensitive !== false,
      contentMode: saved.contentMode || 'warning',
      language: normalizeSettingsLanguage(saved.language || language || 'English'),
      region: user?.current_residence || saved.region || 'United States',
    }
  })
  const [securityAction, setSecurityAction] = useState(null)
  const [securityForm, setSecurityForm] = useState({
    phone: '',
    email: user?.email || '',
    password: '',
    passwordConfirm: '',
  })
  const [securityError, setSecurityError] = useState('')
  const [helpMode, setHelpMode] = useState('popular')
  const [activeHelp, setActiveHelp] = useState(popularHelp[0]?.id || '')
  const [activeFaq, setActiveFaq] = useState(faqTopics[0])
  const [activeThread, setActiveThread] = useState('')
  const [dmMessages, setDmMessages] = useState({})
  const [dmInput, setDmInput] = useState('')
  const [dmStatus, setDmStatus] = useState('')
  const [dmContacts, setDmContacts] = useState([])
  const [messageSearch, setMessageSearch] = useState('')
  const [loadingDmContacts, setLoadingDmContacts] = useState(false)
  const [loadingDmConversation, setLoadingDmConversation] = useState(false)
  const [sendingDm, setSendingDm] = useState(false)
  const [dmPhotoDraft, setDmPhotoDraft] = useState(null)
  const [dmAudioDraft, setDmAudioDraft] = useState(null)
  const [dmRecording, setDmRecording] = useState(false)
  const [dmRecordingMs, setDmRecordingMs] = useState(0)
  const [deletingDmMessageIds, setDeletingDmMessageIds] = useState({})
  const [dmDeleteTarget, setDmDeleteTarget] = useState(null)
  const [dmDeleteForEveryone, setDmDeleteForEveryone] = useState(false)
  const [dmImagePreview, setDmImagePreview] = useState(null)
  const [mobileRoomLockCode, setMobileRoomLockCode] = useState('199')
  const [liveChatMessages, setLiveChatMessages] = useState([])
  const [mobileToast, setMobileToast] = useState('')
  const [recentRoomIds, setRecentRoomIds] = useState(savedRecentRoomIds)
  const [readThreadIds, setReadThreadIds] = useState([])
  const [activeRanking, setActiveRanking] = useState('rooms')
  const [previewCard, setPreviewCard] = useState(null)
  const [acceptedWarnings, setAcceptedWarnings] = useState({})
  const [feedbackForm, setFeedbackForm] = useState({
    category: feedbackCategories[0],
    type: feedbackTypes[0],
    description: '',
    contact: user?.email || '',
    attachment: null,
  })
  const [feedbackRecords, setFeedbackRecords] = useState(savedFeedbackRecords)
  const [feedbackStatus, setFeedbackStatus] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const dmPhotoInputRef = useRef(null)
  const dmRecorderRef = useRef(null)
  const dmRecordingStreamRef = useRef(null)
  const dmRecordingChunksRef = useRef([])
  const dmRecordingStartedAtRef = useRef(0)
  const dmRecordingTimerRef = useRef(null)

  const displayName = user?.name || user?.email?.split('@')[0] || 'Guest'
  const displayId = user?.id || 0
  const profileInitials = initialsFromName(displayName)
  const profileAvatar = avatarForUser(user, displayId)
  const backAvatar = actionAvatarAssets.back
  const rankingAvatar = actionAvatarAssets.ranking
  const showAdminDashboard = canUseAdminDashboard(user) === true
  const selectedRoomNeedsPassword = selectedRoom?.privacy_type === 'password' && roomId === String(selectedRoom.id)
  const selectedRoomSupportsVideo = !selectedRoom || roomAllowsCamera(selectedRoom.room_type)
  const canJoinRoom = Boolean(roomId.trim()) && !openingRoom && (!selectedRoomNeedsPassword || Boolean(joinPassword.trim()))
  const roomLaunchPreview = createdRoom || pendingRoomDraft
  const roomLaunchPending = Boolean(pendingRoomDraft && !createdRoom)
  const roomLaunchTitle = createdRoom ? 'Created Room' : roomLaunchPending ? 'Preparing Room' : 'Quick Join'
  const roomLaunchButtonLabel = roomLaunchPending ? 'Preparing Room...' : openingRoom ? 'Opening...' : 'Open Room'
  const t = (key, replacements = {}) => translateApp(settingsDraft.language || 'English', key, replacements)

  const roomCards = useMemo(() => {
    const cardRooms = createdRoom?.id ? upsertRoomById(rooms, createdRoom) : rooms
    return cardRooms.map(roomToFeedCard)
  }, [createdRoom, rooms])
  const ownRoomCard = useMemo(() => {
    const ownLiveRoom = roomCards.find((card) => Number(card.room?.owner_id) === Number(user?.id))
    if (ownLiveRoom) {
      return {
        ...ownLiveRoom,
        title: ownLiveRoom.title || displayName,
        host: ownLiveRoom.host || displayName,
        avatarUrl: profileAvatar,
        isOwnRoom: true,
      }
    }

    if (createdRoom) {
      return {
        ...roomToFeedCard(createdRoom, 0),
        title: createdRoom.name || displayName,
        host: createdRoom.owner_name || displayName,
        avatarUrl: profileAvatar,
        isOwnRoom: true,
      }
    }

    return {
      id: 'own-mobile-room',
      title: displayName,
      host: settingsDraft.region || user?.current_residence || 'United States',
      viewers: 0,
      tone: 'mint',
      badge: 'Mine',
      category: 'Video Room',
      country: settingsDraft.region || user?.current_residence || 'United States',
      roomType: 'video',
      privacy: 'public',
      avatarIndex: displayId,
      avatarUrl: profileAvatar,
      isOwnRoom: true,
    }
  }, [createdRoom, displayId, displayName, profileAvatar, roomCards, settingsDraft.region, user?.current_residence, user?.id])
  const visibleCards = useMemo(() => {
    return roomCards
      .filter((card) => cardMatchesRoomFilters(card, filter, privacyFilter))
      .slice(0, 48)
  }, [filter, privacyFilter, roomCards])
  const recentRoomCards = useMemo(() => {
    const cardsById = new Map(visibleCards.map((card) => [String(card.id), card]))
    const rememberedCards = recentRoomIds
      .map((id) => cardsById.get(String(id)))
      .filter(Boolean)

    if (rememberedCards.length) return rememberedCards.slice(0, 24)
    return visibleCards.filter((card) => card.id !== ownRoomCard.id).slice(0, 24)
  }, [ownRoomCard.id, recentRoomIds, visibleCards])
  const searchTerm = search.trim().toLowerCase()
  const roomSearchResults = useMemo(() => {
    const includesTerm = (value) => String(value || '').toLowerCase().includes(searchTerm)
    const candidateCards = roomCards
      .filter((card) => cardMatchesRoomFilters(card, filter, privacyFilter))
      .filter((card) => !searchTerm || includesTerm(`${card.title} ${card.host} ${card.roomType} ${card.badge} ${card.category} ${card.privacy || 'public'} ${card.country}`))

    return candidateCards.slice(0, 8).map((card) => ({
      id: card.id,
      type: 'room',
      name: card.title,
      detail: `${getRoomMeta(card.roomType).label} - ${card.privacy || 'public'}`,
      avatarIndex: cardAvatarIndex(card),
      room: card.room,
      card,
    }))
  }, [filter, privacyFilter, roomCards, searchTerm])

  const activeHelpItem = popularHelp.find((item) => item.id === activeHelp) || popularHelp[0]
  const directMessageThreads = useMemo(() => {
    const messageTerm = messageSearch.trim().toLowerCase()

    return dmContacts
      .map((contact, index) => {
        const peerId = Number(contact.peer_id || contact.id || 0)
        const id = directMessageThreadId(peerId)
        if (!peerId || !id) return null

        const messages = dmMessages[id] || []
        const lastMessage = messages[messages.length - 1] || contact.last_message
        const name = contact.peer_name || contact.name || `User #${peerId}`
        const avatarUrl = avatarForUser({
          id: peerId,
          peer_id: peerId,
          name,
          peer_name: name,
          avatar_url: contact.peer_avatar_url || contact.avatar_url || '',
          peer_avatar_url: contact.peer_avatar_url || contact.avatar_url || '',
          gender: contact.peer_gender || contact.gender || '',
          peer_gender: contact.peer_gender || contact.gender || '',
        }, peerId || index)
        const previewText = directMessagePreview(lastMessage, user)
        const searchable = `${name} ${previewText}`.toLowerCase()
        const isFollowing = contact.following === undefined ? true : Boolean(contact.following)
        const isFollower = Boolean(contact.follower)
        const relationshipLabel = Boolean(contact.mutual) || (isFollowing && isFollower)
          ? 'Mutual follow'
          : isFollower && !isFollowing ? 'Follower' : 'Following'

        if (messageTerm && !searchable.includes(messageTerm)) return null

        return {
          id,
          kind: 'dm',
          peerId,
          name,
          avatarUrl,
          avatarIndex: peerId || index,
          previewText,
          time: lastMessage?.created_at ? formatChatTime(lastMessage.created_at) : '',
          unread: readThreadIds.includes(id) ? 0 : Number(contact.unread || 0),
          following: isFollowing || isFollower || Boolean(contact.mutual),
          relationshipLabel,
        }
      })
      .filter(Boolean)
  }, [dmContacts, dmMessages, messageSearch, readThreadIds, user])
  const messageThreads = directMessageThreads
  const activeThreadData = messageThreads.find((thread) => thread.id === activeThread) || messageThreads[0] || null
  const activeThreadMessages = activeThreadData ? (dmMessages[activeThreadData.id] || []) : []
  const canSendDm = Boolean(
    activeThreadData?.peerId
    && !sendingDm
    && !dmRecording
    && (dmInput.trim() || dmPhotoDraft || dmAudioDraft)
  )
  const activeFilterLabel = roomFilterOptions.find((option) => option.value === filter)?.label || 'All types'
  const searchPanelTitle = search.trim()
      ? `${roomSearchResults.length} ${activeFilterLabel} result${roomSearchResults.length === 1 ? '' : 's'}`
      : `${activeFilterLabel} rooms`
  const activeThreadFollowed = Boolean(activeThreadData?.following)
  const unreadThreadCount = messageThreads.reduce((total, thread) => total + Number(thread.unread || 0), 0)
  const dmNotice = !activeThreadData
    ? 'No follower conversations yet.'
    : activeThreadData.relationshipLabel === 'Follower'
      ? 'This user follows you. Private messages are open.'
      : activeThreadData.relationshipLabel === 'Following'
        ? 'You follow this user. Private messages are open.'
        : 'You follow each other. Private messages are open.'
  const rankingRows = useMemo(() => {
    const cards = roomCards

    if (activeRanking === 'hosts') {
      const hosts = new Map()
      cards.forEach((card) => {
        const key = card.host || 'Room host'
        const previous = hosts.get(key) || {
          key,
          name: key,
          detail: '0 rooms',
          score: 0,
          avatarIndex: cardAvatarIndex(card),
        }
        previous.score += Number(card.viewers || 0) + (card.room ? 120 : 0)
        previous.rooms = Number(previous.rooms || 0) + 1
        previous.detail = `${previous.rooms} room${previous.rooms === 1 ? '' : 's'} hosted`
        hosts.set(key, previous)
      })
      return Array.from(hosts.values()).sort((a, b) => b.score - a.score).slice(0, 10)
    }

    return cards
      .map((card) => ({
        key: card.id,
        name: card.title,
        detail: `${card.host} - ${getRoomMeta(card.roomType).label}`,
        score: Number(card.viewers || 0) + (card.room ? Number(card.room.active_participants || 0) * 25 : 0),
        avatarIndex: cardAvatarIndex(card),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
  }, [activeRanking, roomCards])

  function requireAuth(reason = 'Log in or sign up to continue.', mode = 'login') {
    if (user) return true
    onAuthRequired?.(reason, mode)
    return false
  }

  function userOwnsRoom(room) {
    return Boolean(room?.id && user?.id && Number(room.owner_id) === Number(user.id))
  }

  function isMobileViewport() {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 860px)').matches
  }

  function showMobileActionToast(message) {
    setMobileToast(message)
    if (typeof window !== 'undefined') {
      window.clearTimeout(showMobileActionToast.timeoutId)
      showMobileActionToast.timeoutId = window.setTimeout(() => setMobileToast(''), 1600)
    }
  }

  function closeMobileRoomSheets() {
    setShowMobileRoomProfile(false)
    setShowMobileRoomTools(false)
    setShowMobileRoomLock(false)
    setShowMobileRoomSettings(false)
    setShowMobileMembers(false)
  }

  function openMobileRoomOrCreate(card) {
    if (card?.room) {
      openCard(card)
      return
    }

    if (card?.isOwnRoom) {
      openHostPanel('Create a live room first, then the mobile room controls will connect to the real RTC room.')
      return
    }

    openCard(card)
  }

  function handleMobileJoinCard(card, options = {}) {
    if (card?.room) {
      closeMobileRoomSheets()
      joinRoomFromCard(card.room, options)
      return true
    }

    if (card?.isOwnRoom) {
      openHostPanel('Create a live room first, then join from mobile.')
      return false
    }

    showMobileActionToast('Select a live room first.')
    return false
  }

  async function shareMobileRoom(card) {
    const roomPath = card?.room?.id ? `/rooms/${card.room.id}` : '/'
    const url = typeof window !== 'undefined'
      ? new URL(roomPath, window.location.origin).toString()
      : roomPath
    const title = card?.title || 'TalkEachOther room'

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, text: `Join ${title} on TalkEachOther`, url })
        showMobileActionToast('Share sheet opened')
        return
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        showMobileActionToast('Room link copied')
        return
      }

      showMobileActionToast(url)
    } catch {
      showMobileActionToast('Share cancelled')
    }
  }

  async function refreshMobileRooms() {
    await loadRooms({ page: 1, quiet: true })
    showMobileActionToast('Rooms refreshed')
  }

  async function updateMobileRoomControls(card, payload, successMessage) {
    if (!card?.room) {
      if (card?.isOwnRoom) {
        openHostPanel('Create a live room first, then mobile tools can update it.')
      } else {
        showMobileActionToast('Join a real room before changing controls.')
      }
      return
    }

    try {
      setStatus('Updating room controls...')
      await apiRequest(`/rooms/${card.room.id}/controls`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setStatus(successMessage)
      showMobileActionToast(successMessage)
      setShowMobileRoomTools(false)
      await loadRooms({ page: roomMeta.page, quiet: true })
    } catch (error) {
      const message = error.message || 'Room controls could not be updated.'
      setStatus(message)
      showMobileActionToast(message)
    }
  }

  function nextThemeValue(currentTheme) {
    const currentIndex = themeOptions.findIndex((option) => option.value === currentTheme)
    return themeOptions[(currentIndex + 1 + themeOptions.length) % themeOptions.length]?.value || themeOptions[0]?.value || 'neon'
  }

  function confirmMobileRoomLock(card) {
    const password = mobileRoomLockCode.trim()
    if (password.length < 4) {
      showMobileActionToast('Use 4 digits for the lock code.')
      return
    }

    setShowMobileRoomLock(false)
    updateMobileRoomControls(card, { privacy_type: 'password', password }, 'Room locked with password.')
  }

  function pushSectionHistory(section, options = {}) {
    if (typeof window === 'undefined') return

    const state = {
      ...(window.history.state || {}),
      view: 'rooms',
      activeRoom: null,
      buzzcastSection: section,
      previewCardId: options.previewCardId || null,
    }
    const path = section === 'room' && options.previewCardId
      ? `/preview/${encodeURIComponent(options.previewCardId)}`
      : section === 'live'
        ? '/'
        : `/${section}`

    window.history.pushState(state, '', path)
  }

  function scrollMobileShellToTop() {
    if (!isMobileViewport()) return
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    })
  }

  function applySectionFromHistory(state = {}) {
    const section = state.buzzcastSection || 'live'
    if (section === 'room') {
      setPreviewCard(null)
      setActiveSection('live')
      return
    }

    if (['live', 'me', 'settings', 'help'].includes(section)) {
      setActiveSection(section)
      if (section !== 'room') setPreviewCard(null)
    }
  }

  function openProfileSection() {
    if (!requireAuth('Log in or sign up to open your profile.', 'login')) return
    setShowDownloadQr(false)
    pushSectionHistory('me')
    setActiveSection('me')
    scrollMobileShellToTop()
  }

  function openSettingsSection(nextSettings = activeSettings) {
    if (!requireAuth('Log in to manage your account settings.', 'login')) return
    setShowDownloadQr(false)
    pushSectionHistory('settings')
    setActiveSettings(nextSettings)
    setActiveSection('settings')
    scrollMobileShellToTop()
  }

  function openHostPanel(reason = 'Log in or sign up to create a live room.') {
    if (!requireAuth(reason, 'register')) return
    setShowJoinPanel(false)
    setShowHostPanel(true)
  }

  function openMessagesDrawer() {
    if (!requireAuth('Log in to open messages and chat with people.', 'login')) return
    setShowRankings(false)
    if (activeThread) {
      setReadThreadIds((previous) => previous.includes(activeThread) ? previous : [...previous, activeThread])
    }
    setShowMessages(true)
  }

  async function loadDirectMessageContacts({ quiet = false } = {}) {
    if (!user) return

    try {
      if (!quiet) setLoadingDmContacts(true)
      const data = await apiRequest('/direct-messages/contacts')
      const contacts = Array.isArray(data.contacts) ? data.contacts : data.threads || []
      setDmContacts(contacts)
      if (!contacts.length && !quiet) {
        setDmStatus('No follower contacts yet. Follow users or accept follows from live rooms to start private messages.')
      } else if (!quiet) {
        setDmStatus('')
      }
    } catch (error) {
      setDmStatus(`Messages failed: ${error.message}`)
    } finally {
      if (!quiet) setLoadingDmContacts(false)
    }
  }

  async function loadDirectMessageConversation(thread, { quiet = false } = {}) {
    const peerId = Number(thread?.peerId || thread?.peer_id || 0)
    const threadId = thread?.id || directMessageThreadId(peerId)
    if (!user || !peerId || !threadId) return

    try {
      if (!quiet) setLoadingDmConversation(true)
      const data = await apiRequest(`/direct-messages/${peerId}`)
      const messages = (data.messages || []).map((message) => normalizeDirectMessage(message, user)).filter(Boolean)
      setDmMessages((previous) => ({
        ...previous,
        [threadId]: messages,
      }))
      if (data.peer) {
        setDmContacts((previous) => previous.map((contact) => (
          Number(contact.peer_id || contact.id || 0) === peerId
            ? {
              ...contact,
              peer_name: data.peer.name || contact.peer_name,
              peer_avatar_url: data.peer.avatar_url || contact.peer_avatar_url,
              peer_gender: data.peer.gender || contact.peer_gender,
            }
            : contact
        )))
      }
      if (!quiet) setDmStatus('')
    } catch (error) {
      setDmStatus(`Conversation failed: ${error.message}`)
    } finally {
      if (!quiet) setLoadingDmConversation(false)
    }
  }

  function upsertDirectMessageContact(message, peer) {
    const contact = contactFromDirectMessage(message, peer, user)
    if (!contact) return

    setDmContacts((previous) => {
      const previousContact = previous.find((item) => Number(item.peer_id || item.id || 0) === Number(contact.peer_id))
      const nextContact = {
        ...previousContact,
        ...contact,
        following: previousContact?.following,
        follower: previousContact?.follower,
        mutual: previousContact?.mutual,
      }

      return [
        nextContact,
        ...previous.filter((item) => Number(item.peer_id || item.id || 0) !== Number(contact.peer_id)),
      ]
    })
  }

  function removeDirectMessageFromThread(threadId, messageId) {
    if (!threadId || !messageId) return

    setDmMessages((previous) => ({
      ...previous,
      [threadId]: (previous[threadId] || []).filter((message) => Number(message.id) !== Number(messageId)),
    }))
  }

  function clearDirectMessagePreview(peerId, messageId) {
    if (!peerId || !messageId) return

    setDmContacts((previous) => previous.map((contact) => {
      const contactPeerId = Number(contact.peer_id || contact.id || 0)
      const lastMessageId = Number(contact.last_message?.id || 0)
      if (contactPeerId !== Number(peerId) || lastMessageId !== Number(messageId)) return contact

      return {
        ...contact,
        last_message: null,
        unread: 0,
      }
    }))
  }

  function canDeleteDmMessageForEveryone(message) {
    return Boolean(message?.id && message.mine)
  }

  function requestDmDelete(message) {
    if (!message?.id || !activeThreadData?.peerId) return

    setDmDeleteTarget({
      message,
      peerId: activeThreadData.peerId,
      threadId: activeThreadData.id,
    })
    setDmDeleteForEveryone(canDeleteDmMessageForEveryone(message))
    setDmStatus('')
  }

  function closeDmDeletePrompt() {
    if (!dmDeleteTarget) return
    const pendingKey = directMessageActionKey(dmDeleteTarget.message)
    if (deletingDmMessageIds[pendingKey]) return
    setDmDeleteTarget(null)
    setDmDeleteForEveryone(false)
  }

  async function confirmDmDelete() {
    const target = dmDeleteTarget
    const message = target?.message
    if (!target?.threadId || !message?.id) return

    const pendingKey = directMessageActionKey(message)
    if (deletingDmMessageIds[pendingKey]) return

    const previousThreadMessages = dmMessages[target.threadId] || []
    const previousContacts = dmContacts
    const deleteForEveryone = dmDeleteForEveryone && canDeleteDmMessageForEveryone(message)

    setDeletingDmMessageIds((previous) => ({ ...previous, [pendingKey]: true }))
    setDmStatus('')
    removeDirectMessageFromThread(target.threadId, message.id)
    clearDirectMessagePreview(target.peerId, message.id)

    try {
      await apiRequest(`/direct-messages/messages/${message.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ for_everyone: deleteForEveryone }),
      })
      setDmDeleteTarget(null)
      setDmDeleteForEveryone(false)
      setDmStatus(deleteForEveryone ? 'Message deleted for everyone.' : 'Message deleted from your inbox.')
      loadDirectMessageContacts({ quiet: true })
    } catch (error) {
      setDmMessages((previous) => ({
        ...previous,
        [target.threadId]: previousThreadMessages,
      }))
      setDmContacts(previousContacts)
      setDmStatus(`Delete failed: ${error.message}`)
    } finally {
      setDeletingDmMessageIds((previous) => {
        const next = { ...previous }
        delete next[pendingKey]
        return next
      })
    }
  }

  function openDmImagePreview({ src, alt, caption, downloadName = '' }) {
    if (!src) return
    setDmImagePreview({
      src,
      alt: alt || 'Chat photo',
      caption: caption || '',
      downloadName: downloadName || directMessageDownloadName({ media_url: src }),
    })
  }

  function closeDmImagePreview() {
    setDmImagePreview(null)
  }

  function clearDmMediaDrafts() {
    setDmPhotoDraft(null)
    setDmAudioDraft(null)
  }

  function stopDmRecordingTracks() {
    dmRecordingStreamRef.current?.getTracks?.().forEach((track) => {
      try { track.stop() } catch {}
    })
    dmRecordingStreamRef.current = null
  }

  function clearDmRecordingTimer() {
    if (typeof window !== 'undefined') window.clearInterval(dmRecordingTimerRef.current)
    dmRecordingTimerRef.current = null
  }

  function openDmPhotoPicker() {
    if (!activeThreadData?.peerId || sendingDm || dmRecording) return
    dmPhotoInputRef.current?.click()
  }

  async function stageDmPhotoDraft(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type?.startsWith('image/')) {
      setDmStatus('Choose an image file.')
      return
    }

    if (file.size > maxDmPhotoBytes) {
      setDmStatus('Photo message must be 5 MB or smaller.')
      return
    }

    try {
      const dataUrl = await fileToDataUrl(file)
      if (dataUrl.length > 7 * 1024 * 1024) {
        setDmStatus('Photo message is too large after encoding.')
        return
      }

      setDmPhotoDraft({
        dataUrl,
        name: file.name || 'Photo',
        size: file.size,
      })
      setDmAudioDraft(null)
      setDmStatus('Photo ready to send.')
    } catch (error) {
      setDmStatus(error.message || 'Photo could not be read.')
    }
  }

  async function startDmAudioRecording() {
    if (!activeThreadData?.peerId || sendingDm || dmRecording) return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setDmStatus('Audio recording is not supported in this browser.')
      return
    }

    try {
      setDmStatus('')
      setDmPhotoDraft(null)
      setDmAudioDraft(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: dmRecordingAudioConstraints,
        video: false,
      })
      const recorder = createDmVoiceRecorder(stream)
      dmRecordingChunksRef.current = []
      dmRecordingStreamRef.current = stream
      dmRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data?.size) dmRecordingChunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        clearDmRecordingTimer()
        setDmRecording(false)
        stopDmRecordingTracks()

        try {
          const blob = new Blob(dmRecordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          dmRecordingChunksRef.current = []
          if (!blob.size) {
            setDmStatus('No voice audio was captured. Check microphone permission and try again.')
            return
          }
          if (blob.size > maxDmAudioBytes) {
            setDmStatus('Audio message must be 5 MB or smaller.')
            return
          }

          setDmAudioDraft({
            dataUrl: await fileToDataUrl(blob),
            size: blob.size,
            durationMs: Date.now() - dmRecordingStartedAtRef.current,
          })
          setDmStatus('Voice message ready to send.')
        } catch (error) {
          setDmStatus(error.message || 'Audio message could not be prepared.')
        } finally {
          dmRecorderRef.current = null
        }
      }

      dmRecordingStartedAtRef.current = Date.now()
      setDmRecordingMs(0)
      setDmRecording(true)
      recorder.start(250)
      dmRecordingTimerRef.current = window.setInterval(() => {
        setDmRecordingMs(Date.now() - dmRecordingStartedAtRef.current)
      }, 250)
    } catch (error) {
      clearDmRecordingTimer()
      setDmRecording(false)
      stopDmRecordingTracks()
      setDmStatus(`Audio recording failed: ${error.message}`)
    }
  }

  function stopDmAudioRecording() {
    if (!dmRecording || !dmRecorderRef.current) return
    try {
      dmRecorderRef.current.stop()
    } catch (error) {
      setDmStatus(error.message)
      clearDmRecordingTimer()
      setDmRecording(false)
      stopDmRecordingTracks()
    }
  }

  function cancelDmAudioRecording() {
    const recorder = dmRecorderRef.current
    if (recorder) {
      try {
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {}
    }
    dmRecorderRef.current = null
    dmRecordingChunksRef.current = []
    clearDmRecordingTimer()
    setDmRecording(false)
    stopDmRecordingTracks()
  }

  function toggleDmAudioRecording() {
    if (dmRecording) cancelDmAudioRecording()
    else startDmAudioRecording()
  }

  function toggleMessagesDrawer() {
    if (showMessages) {
      setShowMessages(false)
      return
    }

    openMessagesDrawer()
  }

  function openHelpSection() {
    setShowDownloadQr(false)
    pushSectionHistory('help')
    setActiveSection('help')
    setPreviewCard(null)
    setShowMessages(false)
    scrollMobileShellToTop()
  }

  function openRankings() {
    if (!requireAuth('Log in to view live rankings.', 'login')) return
    setShowMessages(false)
    setShowRankings(true)
  }

  function openMobileMomentsSection() {
    openSettingsSection()
  }

  function openMobileMessageSection() {
    if (showMessages) {
      setShowMessages(false)
      return
    }

    setShowDownloadQr(false)
    setActiveSection('live')
    setPreviewCard(null)
    openMessagesDrawer()
    scrollMobileShellToTop()
  }

  function updateSettings(field, value, message) {
    setSettingsDraft((previous) => ({ ...previous, [field]: value }))
    setSettingsStatus(message)
  }

  function openSecurityAction(field) {
    setSecurityAction(field)
    setSecurityError('')
    setSecurityForm((previous) => ({
      ...previous,
      email: previous.email || user?.email || '',
      password: '',
      passwordConfirm: '',
    }))
  }

  function updateSecurityForm(field, value) {
    setSecurityForm((previous) => ({ ...previous, [field]: value }))
    setSecurityError('')
  }

  function submitSecurityAction(event) {
    event.preventDefault()

    if (securityAction === 'phoneBound') {
      const digits = securityForm.phone.replace(/\D/g, '')
      if (digits.length < 7) {
        setSecurityError(t('Enter a valid phone number.'))
        return
      }
      setSecurityAction(null)
      updateSettings('phoneBound', true, t('Cell phone bound.'))
      return
    }

    if (securityAction === 'emailBound') {
      if (!validEmail(securityForm.email)) {
        setSecurityError(t('Enter a valid email address.'))
        return
      }
      setSecurityAction(null)
      updateSettings('emailBound', true, t('Email bound.'))
      return
    }

    if (securityAction === 'loginPasswordSet') {
      if (securityForm.password.length < 10) {
        setSecurityError(t('Use at least 10 characters for the password.'))
        return
      }
      if (securityForm.password !== securityForm.passwordConfirm) {
        setSecurityError(t('Passwords do not match.'))
        return
      }
      setSecurityAction(null)
      updateSettings('loginPasswordSet', true, t('Login password set.'))
      return
    }

  }

  function updateFeedback(field, value) {
    setFeedbackForm((previous) => ({ ...previous, [field]: value }))
    setFeedbackStatus('')
  }

  function resetFeedbackForm() {
    setFeedbackForm({
      category: feedbackCategories[0],
      type: feedbackTypes[0],
      description: '',
      contact: user?.email || '',
      attachment: null,
    })
  }

  function openFeedbackModal(defaults = {}) {
    setFeedbackStatus('')
    setFeedbackForm((previous) => ({
      ...previous,
      category: defaults.category || previous.category || feedbackCategories[0],
      type: defaults.type || previous.type || feedbackTypes[0],
      contact: previous.contact || user?.email || '',
    }))
    setShowFeedback(true)
  }

  function closeFeedbackModal() {
    if (submittingFeedback) return
    setShowFeedback(false)
    setFeedbackStatus('')
  }

  function selectHelpMode(nextMode) {
    setHelpMode(nextMode)
    if (nextMode === 'popular' && !activeHelp) setActiveHelp(popularHelp[0]?.id || '')
    if (nextMode === 'faq' && !activeFaq) setActiveFaq(faqTopics[0] || '')
  }

  function selectPopularHelp(helpId) {
    setHelpMode('popular')
    setActiveHelp(helpId)
  }

  function toggleFaqTopic(topic) {
    setHelpMode('faq')
    setActiveFaq((current) => current === topic ? '' : topic)
  }

  function handleFeedbackAttachment(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > maxFeedbackAttachmentSize) {
      event.target.value = ''
      setFeedbackStatus('Attachment must be 25 MB or smaller.')
      return
    }

    updateFeedback('attachment', file)
    setFeedbackStatus(`${file.name} attached.`)
  }

  function removeFeedbackAttachment() {
    setFeedbackForm((previous) => ({ ...previous, attachment: null }))
    setFeedbackStatus('Attachment removed.')
  }

  function saveFeedbackRecord(record) {
    setFeedbackRecords((previous) => {
      const next = [record, ...previous].slice(0, 20)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('rtc_feedback_records', JSON.stringify(next))
      }
      return next
    })
  }

  function updateRoomForm(field, value) {
    setRoomForm((previous) => {
      const next = { ...previous, [field]: value }
      if (field === 'room_type') {
        const maxSeats = maxSeatsForRoomType(value)
        if (Number(next.max_mic_count || 0) > maxSeats) next.max_mic_count = defaultSeatsForRoomType(value)
      }
      return next
    })
    setFormErrors((previous) => {
      if (!previous[field] && !previous.submit) return previous
      const next = { ...previous }
      delete next[field]
      delete next.submit
      return next
    })
  }

  function selectRoom(room) {
    setSelectedRoom(room)
    setRoomId(String(room.id))
    setJoinPassword('')
    setJoinRtcMode(defaultRtcModeForRoom(room))
    setStatus(room.privacy_type === 'password' ? `Room #${room.id} needs a password before joining.` : `Room #${room.id} selected.`)
  }

  function openSearchResult(item) {
    setShowSearchPanel(false)

    if (item.room) {
      setActiveSection('live')
      setPreviewCard(null)
      joinRoomFromCard(item.room)
      return
    } else if (item.card) {
      openCard(item.card)
    }
  }

  function runSearch() {
    setActiveSection('live')
    setShowSearchPanel(true)
    loadRooms({
      page: 1,
      searchValue: search,
      filterValue: filter,
      privacyValue: privacyFilter,
      sortValue: sort,
    })
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setShowSearchPanel(false)
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    if (roomSearchResults[0]) {
      openSearchResult(roomSearchResults[0])
      return
    }

    runSearch()
  }

  function clearSelectedRoomIfManual(value) {
    setRoomId(value)
    if (selectedRoom && value !== String(selectedRoom.id)) {
      setSelectedRoom(null)
      setJoinPassword('')
    }
  }

  function updateJoinRtcMode(value) {
    setJoinRtcMode(normalizeRtcMode(value, selectedRoom))
  }

  function openLiveSection() {
    setShowDownloadQr(false)
    pushSectionHistory('live')
    setActiveSection('live')
    setPreviewCard(null)
    setShowJoinPanel(false)
    setShowMobileRoomProfile(false)
    setShowMobileRoomTools(false)
    setShowMobileRoomLock(false)
    setShowMobileRoomSettings(false)
    setShowMobileMembers(false)
  }

  function switchFeed(nextFeed) {
    if (nextFeed === 'following' && !user) {
      requireAuth('Log in to see rooms from people you follow.', 'login')
      return
    }

    const tab = tabConfigForFeed(nextFeed)
    setActiveSection('live')
    setPreviewCard(null)
    setActiveFeed(nextFeed)
    if (nextFeed === 'following') setMobileRoomGroup('follow')
    else if (nextFeed === 'latest') setMobileRoomGroup('recently')
    else if (nextFeed === 'global') setMobileRoomGroup('group')
    setFilter(tab?.filter || 'all')
    setSort(tab?.sort || 'newest')
    setRoomMeta((previous) => ({ ...previous, page: 1 }))
  }

  function showAllLiveRooms() {
    setActiveSection('live')
    setPreviewCard(null)
    setActiveFeed('for_you')
    setFilter('all')
    setPrivacyFilter('all')
    setSort('active')
    setSearch('')
  }

  function switchMobileRoomGroup(nextGroup) {
    if (nextGroup === 'follow' && !user) {
      requireAuth('Log in to see rooms from people you follow.', 'login')
      return
    }

    setMobileRoomGroup(nextGroup)
    setActiveSection('live')
    setPreviewCard(null)

    if (nextGroup === 'recently') {
      switchFeed('latest')
      return
    }

    if (nextGroup === 'follow') {
      switchFeed('following')
      return
    }

    switchFeed('global')
  }

  async function loadRooms({
    page = roomMeta.page,
    searchValue = search,
    filterValue = filter,
    privacyValue = privacyFilter,
    sortValue = sort,
    feedValue = activeFeed,
    regionValue = settingsDraft.region || user?.current_residence || '',
    quiet = false,
    preserveStatus = false,
    throwOnError = false,
  } = {}) {
    setLoadingRooms(true)
    const path = buildRoomsPath({
      page,
      search: searchValue,
      filter: filterValue,
      privacy: privacyValue,
      sort: sortValue,
      feed: feedValue,
      region: regionValue,
    })

    function applyRoomData(data) {
      const meta = data.rooms?.meta || { page, per_page: 24, total: 0, total_pages: 1 }
      setRooms(data.rooms?.data || [])
      setRoomMeta(meta)
      if (!preserveStatus) {
        setStatus(meta.total === 1 ? 'Showing 1 room' : `Showing ${meta.total} rooms`)
      }
    }

    try {
      if (!quiet) setStatus('Loading rooms...')
      applyRoomData(await apiRequest(path))
      return true
    } catch (error) {
      if (error.status === 401) {
        try {
          applyRoomData(await apiRequest(path))
          return true
        } catch (retryError) {
          if (!preserveStatus) setStatus(retryError.message)
          if (throwOnError) throw retryError
          return false
        }
      }

      if (!preserveStatus) setStatus(error.message)
      if (throwOnError) throw error
      return false
    } finally {
      setLoadingRooms(false)
    }
  }

  async function createRoom(event) {
    event.preventDefault()
    if (!requireAuth('Log in or sign up to create a live room.', 'register')) return

    const submitRoomForm = {
      ...roomForm,
      name: roomForm.name.trim() || defaultLiveRoomName(displayName),
    }
    const nextErrors = validateRoomForm(submitRoomForm)
    setFormErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      setStatus('Please fix the highlighted room details.')
      return
    }

    if (submitRoomForm.name !== roomForm.name) {
      setRoomForm((previous) => ({ ...previous, name: submitRoomForm.name }))
    }

    const payload = roomFormPayload(submitRoomForm)
    const pendingDraft = {
      name: payload.name || 'New live room',
      room_type: payload.room_type || submitRoomForm.room_type,
      privacy_type: payload.privacy_type || submitRoomForm.privacy_type,
      max_mic_count: payload.max_mic_count || submitRoomForm.max_mic_count,
    }
    const createdRoomAlreadyListed = (room) => rooms.some((current) => Number(current.id) === Number(room.id))
    setCreating(true)
    setFormErrors({})
    setCreatedRoom(null)
    setPendingRoomDraft(pendingDraft)
    setRoomId('')
    setSelectedRoom(null)
    setJoinPassword('')
    setStatus(`Preparing ${pendingDraft.name}...`)
    try {
      const data = await apiRequest('/rooms', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const nextRoom = data.room
      if (!nextRoom?.id) throw new Error('Room was created, but the backend did not return a room ID.')

      const nextRoomId = String(nextRoom.id)
      setPendingRoomDraft(null)
      setRoomId(nextRoomId)
      setSelectedRoom(nextRoom)
      setJoinPassword(nextRoom.privacy_type === 'password' ? (payload.password || '') : '')
      setJoinRtcMode(defaultRtcModeForRoom(nextRoom))
      setCreatedRoom(nextRoom)
      setStatus(`Created room #${nextRoom.id}. Open it when ready.`)
      setActiveSection('live')
      setActiveFeed('latest')
      setSearch('')
      setFilter('all')
      setPrivacyFilter('all')
      setSort('newest')
      setRooms((previous) => upsertRoomById(previous, nextRoom))
      setRoomMeta((previous) => ({
        ...previous,
        page: 1,
        total: createdRoomAlreadyListed(nextRoom) ? Number(previous.total || 0) : Number(previous.total || 0) + 1,
        total_pages: Math.max(1, Number(previous.total_pages || 1)),
      }))
      updateRoomForm('password', '')
      try {
        await loadRooms({
          page: 1,
          searchValue: '',
          filterValue: 'all',
          privacyValue: 'all',
          sortValue: 'newest',
          feedValue: 'latest',
          quiet: true,
          preserveStatus: true,
          throwOnError: true,
        })
      } catch (refreshError) {
        setStatus(`Created room #${nextRoom.id}. Refresh failed: ${refreshError.message}`)
      }
      setRooms((previous) => upsertRoomById(previous, nextRoom))
    } catch (error) {
      const submitMessage = createRoomErrorMessage(error)
      setPendingRoomDraft(null)
      setFormErrors({ ...(error.errors || {}), submit: submitMessage })
      setStatus(submitMessage)
    } finally {
      setCreating(false)
    }
  }

  async function deleteOwnedRoom(room) {
    if (!room?.id) return
    if (!requireAuth('Log in to delete your room.', 'login')) return
    if (!userOwnsRoom(room)) {
      setStatus('Only the room owner can delete this room.')
      showMobileActionToast('Only the room owner can delete this room.')
      return
    }

    const roomName = room.name || `Room #${room.id}`
    const confirmed = typeof window === 'undefined' || window.confirm(`Delete ${roomName}? This removes the room from the database.`)
    if (!confirmed) return

    try {
      setDeletingRoomId(room.id)
      setStatus(`Deleting ${roomName}...`)
      await apiRequest(`/rooms/${room.id}`, { method: 'DELETE' })
      setRooms((previous) => previous.filter((current) => Number(current.id) !== Number(room.id)))
      setRoomMeta((previous) => ({
        ...previous,
        total: Math.max(0, Number(previous.total || 0) - 1),
      }))
      setRecentRoomIds((previous) => {
        const roomCardId = `room-${room.id}`
        const nextIds = previous.filter((id) => String(id) !== roomCardId)
        saveRecentRoomIds(nextIds)
        return nextIds
      })
      if (Number(createdRoom?.id) === Number(room.id)) setCreatedRoom(null)
      if (String(roomId) === String(room.id)) {
        setRoomId('')
        setSelectedRoom(null)
        setJoinPassword('')
      }
      setStatus(`Deleted ${roomName}.`)
      showMobileActionToast('Room deleted')
      await loadRooms({ page: 1, quiet: true, preserveStatus: true })
    } catch (error) {
      const message = error.message || 'Room could not be deleted.'
      setStatus(message)
      showMobileActionToast(message)
    } finally {
      setDeletingRoomId(null)
    }
  }

  async function joinSelectedRoom() {
    if (!roomId.trim()) return
    if (!requireAuth('Log in to open the RTC console.', 'login')) return
    if (selectedRoomNeedsPassword && !joinPassword.trim()) {
      setStatus('Enter the room password before joining.')
      return
    }

    try {
      setOpeningRoom(true)
      setStatus('Checking room access...')
      const roomData = selectedRoom && roomId.trim() === String(selectedRoom.id)
        ? { room: selectedRoom }
        : await apiRequest(`/rooms/${roomId.trim()}`)
      const targetRoom = roomData.room

      if (targetRoom?.privacy_type === 'password' && !joinPassword.trim()) {
        setSelectedRoom(targetRoom)
        setJoinRtcMode(defaultRtcModeForRoom(targetRoom))
        setStatus('Enter the room password before opening the RTC console.')
        return
      }

      onEnterRoom(roomId.trim(), {
        password: joinPassword.trim(),
        room: targetRoom,
        rtcMode: normalizeRtcMode(joinRtcMode, targetRoom),
        autoConnect: true,
      })
      setShowJoinPanel(false)
      setShowHostPanel(false)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setOpeningRoom(false)
    }
  }

  function joinRoomFromCard(room, options = {}) {
    if (!requireAuth('Log in to join live rooms.', 'login')) return

    if (room.privacy_type === 'password') {
      selectRoom(room)
      if (options.rtcMode) setJoinRtcMode(normalizeRtcMode(options.rtcMode, room))
      setShowHostPanel(false)
      setShowJoinPanel(true)
      return
    }

    setShowJoinPanel(false)
    onEnterRoom(String(room.id), {
      room,
      rtcMode: normalizeRtcMode(options.rtcMode || defaultRtcModeForRoom(room), room),
      autoConnect: true,
    })
  }

  function rememberRecentRoom(card) {
    if (!card || card.isOwnRoom) return

    setRecentRoomIds((previous) => {
      const cardId = String(card.id)
      const nextIds = [cardId, ...previous.filter((id) => id !== cardId)].slice(0, 24)
      saveRecentRoomIds(nextIds)
      return nextIds
    })
  }

  function openCard(card) {
    rememberRecentRoom(card)

    if (card.room) {
      joinRoomFromCard(card.room)
      return
    }

    pushSectionHistory('room', { previewCardId: card.id })
    setShowMobileRoomProfile(false)
    setShowMobileRoomTools(false)
    setShowMobileRoomLock(false)
    setShowMobileRoomSettings(false)
    setShowMobileMembers(false)
    setPreviewCard(card)
    setActiveSection('room')
  }

  function sendLiveRoomMessage(event) {
    event.preventDefault()
    const body = dmInput.trim()
    if (!body) return

    setLiveChatMessages((previous) => [
      ...previous,
      { id: `live-${Date.now()}`, body, author: displayName, badges: ['Lv.37'] },
    ].slice(-12))
    setDmInput('')
    showMobileActionToast('Comment sent')
  }

  async function sendDmMessage(event) {
    event.preventDefault()
    if (!requireAuth('Log in to send chat messages.', 'login')) return
    if (!activeThreadData?.peerId) {
      setDmStatus('No private conversation is selected.')
      return
    }
    if (sendingDm || dmRecording) return
    const threadId = activeThreadData.id
    const body = dmInput.trim()
    if (!body && !dmPhotoDraft && !dmAudioDraft) return

    try {
      setSendingDm(true)
      setDmStatus('')
      const messageType = dmAudioDraft ? 'voice' : dmPhotoDraft ? 'image' : 'text'
      const data = await apiRequest(`/direct-messages/${activeThreadData.peerId}`, {
        method: 'POST',
        body: JSON.stringify({
          message_body: dmAudioDraft ? (body || 'sent a voice message') : dmPhotoDraft ? (body || 'sent a photo') : body,
          message_type: messageType,
          ...(dmPhotoDraft ? { media_url: dmPhotoDraft.dataUrl } : {}),
          ...(dmAudioDraft ? { media_url: dmAudioDraft.dataUrl } : {}),
        }),
      })
      const nextMessage = normalizeDirectMessage(data.direct_message, user)
      if (nextMessage) {
        setDmMessages((previous) => ({
          ...previous,
          [threadId]: [
            ...(previous[threadId] || []).filter((message) => Number(message.id) !== Number(nextMessage.id)),
            nextMessage,
          ],
        }))
        upsertDirectMessageContact(data.direct_message, data.peer)
      }
      setDmInput('')
      clearDmMediaDrafts()
      setReadThreadIds((previous) => previous.includes(threadId) ? previous : [...previous, threadId])
      setDmStatus(`Sent to ${activeThreadData.name}.`)
    } catch (error) {
      setDmStatus(`Send failed: ${error.message}`)
    } finally {
      setSendingDm(false)
    }
  }

  function handleDmComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return
    event.preventDefault()
    sendDmMessage(event)
  }

  async function submitFeedback(event) {
    event.preventDefault()
    if (submittingFeedback) return

    if (feedbackForm.description.trim().length < 10) {
      setFeedbackStatus('Please add at least 10 characters so support can understand the issue.')
      return
    }

    try {
      setSubmittingFeedback(true)
      setFeedbackStatus(feedbackForm.attachment ? 'Preparing attachment...' : 'Sending feedback...')

      const attachmentMeta = feedbackForm.attachment ? {
        name: feedbackForm.attachment.name,
        type: feedbackForm.attachment.type,
        size: feedbackForm.attachment.size,
      } : null
      const attachment = attachmentMeta ? {
        ...attachmentMeta,
        data_url: await fileToDataUrl(feedbackForm.attachment),
      } : null

      setFeedbackStatus('Sending feedback...')
      await apiRequest('/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: feedbackForm.category,
          type: feedbackForm.type,
          description: feedbackForm.description.trim(),
          contact: feedbackForm.contact.trim(),
          attachment,
          page_url: typeof window !== 'undefined' ? window.location.href : '',
          user_agent: typeof window !== 'undefined' ? window.navigator.userAgent : '',
        }),
      })

      saveFeedbackRecord({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        category: feedbackForm.category,
        type: feedbackForm.type,
        description: feedbackForm.description.trim(),
        contact: feedbackForm.contact.trim(),
        attachment: attachmentMeta,
        created_at: new Date().toISOString(),
      })
      setHelpMode('records')
      setFeedbackStatus('Feedback sent to support.')
      window.setTimeout(() => {
        setShowFeedback(false)
        setFeedbackStatus('')
        resetFeedbackForm()
      }, 900)
    } catch (error) {
      setFeedbackStatus(error.message || 'Feedback could not be sent. Please try again.')
    } finally {
      setSubmittingFeedback(false)
    }
  }

  async function handleInstallApp() {
    if (installPrompt) {
      installPrompt.prompt()
      await installPrompt.userChoice.catch(() => null)
      setInstallPrompt(null)
      setShowInstall(false)
      return
    }

    setStatus('Use the browser install button when it appears for this app.')
    setShowInstall(false)
  }

  function openInstallAppModal() {
    setShowDownloadQr(false)
    setShowInstall(true)
  }

  function toggleDownloadQrPanel() {
    setShowInstall(false)
    setShowDownloadQr((current) => !current)
  }

  function renderLiveFeed() {
    const featuredMobileCard = activeFeed === 'following' ? visibleCards[0] : ownRoomCard
    const featuredMobileTitle = featuredMobileCard?.isOwnRoom && featuredMobileCard.title === displayName ? '☢️We 4 Humanity☢️' : featuredMobileCard?.title
    const featuredMobileRibbon = activeFeed === 'following' ? 'Follow' : 'Mine'
    const mobileRoomListCards = recentRoomCards.length ? recentRoomCards : visibleCards

    return (
      <section className="buzzcast-discover">
        <div className="mp4-mobile-home-shell" aria-label="Mobile room feed">
          <header className="mp4-mobile-home-hero">
            <img className="mp4-home-goat" src={assetImage2Assets.goat} alt="" loading="eager" decoding="async" fetchPriority="high" aria-hidden="true" />
            <button type="button" className="mp4-home-menu" onClick={openLiveSection} aria-label="Home">
              <img src={assetImage2Assets.homeIcon} alt="" loading="eager" decoding="async" fetchPriority="high" aria-hidden="true" />
            </button>
            <nav className="mp4-home-tabs" aria-label="Mobile feed tabs">
              <button type="button" className={activeFeed === 'following' ? 'active' : ''} onClick={() => switchFeed('following')}>Mine</button>
              <button type="button" className={activeFeed === 'for_you' ? 'active' : ''} onClick={() => switchFeed('for_you')}>Popular</button>
              <button type="button" className={activeFeed === 'explore' ? 'active' : ''} onClick={() => switchFeed('explore')}>Explore</button>
            </nav>
            <button type="button" className="mp4-home-search" onClick={() => setShowSearchPanel((current) => !current)} aria-label="Search">
              <img src={assetImage2Assets.searchIcon} alt="" loading="eager" decoding="async" fetchPriority="high" aria-hidden="true" />
            </button>
          </header>
          {showSearchPanel ? (
            <div className="mp4-mobile-search-panel">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search room or host"
                aria-label="Search room or host"
              />
              <button type="button" onClick={runSearch}>Search</button>
              <div>
                {roomSearchResults.length ? roomSearchResults.map((item, index) => (
                  <button key={`${item.type}-${item.id}`} type="button" onClick={() => openSearchResult(item)}>
                    <i className="image-avatar"><img src={avatarForIndex(item.avatarIndex ?? index)} alt="" loading="lazy" /></i>
                    <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                  </button>
                )) : <em>Type a room name, host, or category.</em>}
              </div>
            </div>
          ) : null}
          {featuredMobileCard ? (
            <button type="button" className="mp4-feature-room" onClick={() => openMobileRoomOrCreate(featuredMobileCard)}>
              <span className="mp4-feature-avatar">
                <img src={featuredMobileCard.avatarUrl || cardCover(featuredMobileCard)} alt="" loading="eager" decoding="async" fetchPriority="high" />
              </span>
              <span className="mp4-feature-copy">
                <strong>{featuredMobileTitle}</strong>
                <small>
                  <img className="mp4-feature-bars" src={assetImage2Assets.bars} alt="" loading="eager" decoding="async" fetchPriority="high" aria-hidden="true" />
                  <img className="mp4-feature-group" src={assetImage2Assets.groupIcon} alt="" loading="eager" decoding="async" fetchPriority="high" aria-hidden="true" />
                  <i>{compactNumber(featuredMobileCard.viewers || 0)}</i>
                  <img className="mp4-feature-lock" src={assetImage2Assets.lockIcon} alt="" loading="eager" decoding="async" fetchPriority="high" aria-hidden="true" />
                </small>
              </span>
              <span className="mp4-feature-ribbon"><span>{featuredMobileRibbon}</span></span>
            </button>
          ) : (
            <div className="mp4-feature-room mp4-feature-empty">
              <span className="mp4-feature-avatar">
                <img src={assetImage2Assets.creatorCard} alt="" loading="eager" decoding="async" fetchPriority="high" />
              </span>
              <span className="mp4-feature-copy">
                <strong>No followed rooms yet</strong>
                <small>Follow room hosts to see them here.</small>
              </span>
            </div>
          )}
          <nav className="mp4-room-tabs" aria-label="Mobile room groups">
            <button type="button" className={mobileRoomGroup === 'recently' ? 'active' : ''} onClick={() => switchMobileRoomGroup('recently')}>Recently</button>
            <button type="button" className={mobileRoomGroup === 'follow' ? 'active' : ''} onClick={() => switchMobileRoomGroup('follow')}>Follow</button>
            <button type="button" className={mobileRoomGroup === 'group' ? 'active' : ''} onClick={() => switchMobileRoomGroup('group')}>Group</button>
          </nav>
        </div>

        <nav className="buzzcast-feed-nav" aria-label="Room feed">
          {feedTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={activeFeed === tab.value ? 'active' : ''}
              onClick={() => switchFeed(tab.value)}
            >
              <span className="feed-label-full">{tab.label}</span>
              <span className="feed-label-mobile">{tab.mobileLabel || tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="buzzcast-match-banner">
          <button type="button" className="buzzcast-create-room-button" onClick={() => openHostPanel()} aria-label="Create room">
            <span className="buzzcast-create-room-plus" aria-hidden="true">+</span>
            <span className="buzzcast-create-room-label">Create room</span>
          </button>
        </div>

        <div className="buzzcast-feed-controls">
          <span>
            {roomMeta.total} rooms - {loadingRooms ? <LoadingMovie label="Refreshing rooms" inline /> : status}
          </span>
          <div>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Room type filter">
              {roomFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={privacyFilter} onChange={(event) => setPrivacyFilter(normalizeAccessFilter(event.target.value))} aria-label="Room privacy filter">
              {privacyFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Room sort">
              {roomSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        {loadingRooms && rooms.length === 0 ? (
          <LoadingMovie label="Loading rooms" className="buzzcast-loading-state" />
        ) : visibleCards.length === 0 ? (
          <div className="buzzcast-empty-state room-grid-empty">
            <img src={roomAssets.studioStage} alt="" loading="lazy" />
            <div className="room-grid-empty-copy">
              <strong>No matching rooms yet</strong>
              <span>Try a wider room list or start a room now.</span>
              <div className="room-grid-empty-actions">
                <button type="button" className="secondary-button" onClick={showAllLiveRooms}>Show all rooms</button>
                <button type="button" className="primary-button" onClick={() => openHostPanel()}>Create room</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className={`buzzcast-card-grid desktop-feed-grid ${activeFeed === 'party' ? 'party-grid' : ''}`}>
              {visibleCards.map((card, index) => (
                <FeedCard
                  key={card.id}
                  card={card}
                  featured={index === 0 && activeFeed !== 'party'}
                  onOpen={openCard}
                  onDelete={deleteOwnedRoom}
                  canDelete={userOwnsRoom(card.room)}
                  deleting={Number(deletingRoomId) === Number(card.room?.id)}
                />
              ))}
            </div>
            <div className={`buzzcast-card-grid mobile-recent-grid ${activeFeed === 'party' ? 'party-grid' : ''}`}>
              {mobileRoomListCards.map((card, index) => (
                <FeedCard
                  key={card.id}
                  card={card}
                  featured={index === 0 && activeFeed !== 'party'}
                  onOpen={openCard}
                />
              ))}
            </div>

            {roomMeta.total_pages > 1 ? (
              <div className="buzzcast-pagination">
                <button type="button" onClick={() => loadRooms({ page: Math.max(1, roomMeta.page - 1) })} disabled={loadingRooms || roomMeta.page <= 1}>Previous</button>
                <span>{roomMeta.total} total rooms</span>
                <button type="button" onClick={() => loadRooms({ page: Math.min(roomMeta.total_pages, roomMeta.page + 1) })} disabled={loadingRooms || roomMeta.page >= roomMeta.total_pages}>Next</button>
              </div>
            ) : null}
          </>
        )}
      </section>
    )
  }

  function renderProfile() {
    return <ProfilePanel user={user} language={settingsDraft.language || language} onSaved={onUserUpdated} onLogout={onLogout} />
  }

  function renderSettingsContent() {
    if (activeSettings === 'privacy') {
      return (
        <div className="buzzcast-settings-list">
          <label className="buzzcast-select-row">
            <span><strong>{t('Who can send me a message')}</strong><small>{t('Controls the personal inbox and room chat shortcuts.')}</small></span>
            <select
              value={settingsDraft.messagePrivacy}
              onChange={(event) => updateSettings('messagePrivacy', event.target.value, t('Message privacy updated.'))}
            >
              <option value="everyone">{t('Everyone')}</option>
              <option value="followers">{t('Followers only')}</option>
              <option value="nobody">{t('Nobody')}</option>
            </select>
          </label>
          <label className="buzzcast-switch-row">
            <span><strong>{t('Private live invitation')}</strong><small>{t('Allow hosts to invite you into private live rooms.')}</small></span>
            <input
              type="checkbox"
              checked={settingsDraft.privateInvite}
              onChange={(event) => updateSettings('privateInvite', event.target.checked, t('Private live invitation setting updated.'))}
            />
          </label>
          <button type="button" onClick={() => setSettingsStatus('Use Block in the chat panel to hide a user and remove their messages from your view.')}>
            <span><strong>{t('Blacklist')}</strong><small>{t('Blocked users are controlled from the chat user menu.')}</small></span>
            <b>&gt;</b>
          </button>
          <button type="button" onClick={() => updateSettings('hideSensitive', !settingsDraft.hideSensitive, t('Live preference updated.'))}>
            <span><strong>{t('Live broadcast you are not interested in')}</strong><small>{settingsDraft.hideSensitive ? t('Filtered from your feed.') : t('Visible in your feed.')}</small></span>
            <em>{settingsDraft.hideSensitive ? t('Filtered') : t('Show')}</em>
          </button>
        </div>
      )
    }

    if (activeSettings === 'content') {
      const modes = [
        { value: 'restricted', labelKey: 'Restricted Mode', helperKey: 'Hide potentially sensitive content.' },
        { value: 'warning', labelKey: 'Warning Mode', helperKey: 'Show a warning before sensitive rooms open.' },
        { value: 'all', labelKey: 'All Modes', helperKey: 'Show all room content that is available to your account.' },
      ]

      return (
        <div className="buzzcast-settings-list">
          {modes.map((item) => (
            <label key={item.value} className={settingsDraft.contentMode === item.value ? 'buzzcast-radio-row selected' : 'buzzcast-radio-row'}>
              <span><strong>{t(item.labelKey)}</strong><small>{t(item.helperKey)}</small></span>
              <input
                type="radio"
                name="content-mode"
                checked={settingsDraft.contentMode === item.value}
                onChange={() => updateSettings('contentMode', item.value, `${t(item.labelKey)} ${t('selected.')}`)}
              />
            </label>
          ))}
        </div>
      )
    }

    if (activeSettings === 'region') {
      const selectedRegion = settingsDraft.region || 'United States'
      const regionOptions = regions.includes(selectedRegion)
        ? regions
        : [selectedRegion, ...regions]

      return (
        <div className="buzzcast-region-panel">
          <label className="sr-only" htmlFor="buzzcast-region-select">Region</label>
          <select
            id="buzzcast-region-select"
            className="buzzcast-region-select"
            value={selectedRegion}
            onChange={(event) => {
              const nextRegion = event.target.value
              setSettingsDraft((previous) => ({ ...previous, region: nextRegion }))
              setSettingsStatus(t('Region changed to {region}.', { region: nextRegion }))
            }}
          >
            {regionOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <p className="buzzcast-region-current">{selectedRegion}</p>
        </div>
      )
    }

    if (activeSettings === 'language') {
      return (
        <div className="buzzcast-settings-list">
          <label className="buzzcast-select-row">
            <span><strong>{t('Current language')}</strong><small>{t('Choose the language used by mobile account screens.')}</small></span>
            <select
              value={settingsDraft.language || 'English'}
              onChange={(event) => {
                const nextLanguage = normalizeSettingsLanguage(event.target.value)
                updateSettings('language', nextLanguage, languageStatus(nextLanguage))
                onLanguageChange?.(nextLanguage)
              }}
            >
              {settingsLanguageOptions.map((item) => <option key={item} value={item}>{t(item)}</option>)}
            </select>
          </label>
        </div>
      )
    }

    if (activeSettings === 'terms') {
      const selectedPolicy = policyDocuments.find((item) => item.id === selectedPolicyId)

      if (selectedPolicy) {
        return (
          <article className="buzzcast-policy-detail">
            <button type="button" className="buzzcast-policy-back" onClick={() => {
              setSelectedPolicyId('')
              setSettingsStatus('')
            }}>
              &lt; Back
            </button>
            <h3>{t(selectedPolicy.title)}</h3>
            <p>{selectedPolicy.summary}</p>
            {selectedPolicy.sections.map(([title, body]) => (
              <section key={title}>
                <h4>{title}</h4>
                <p>{body}</p>
              </section>
            ))}
          </article>
        )
      }

      return (
        <div className="buzzcast-settings-list">
          {policyDocuments.map((item) => (
            <button type="button" key={item.id} onClick={() => {
              setSelectedPolicyId(item.id)
              setSettingsStatus(item.summary)
            }}>
              <span><strong>{t(item.title)}</strong><small>{item.summary}</small></span>
              <b>&gt;</b>
            </button>
          ))}
        </div>
      )
    }

    const accountRows = [
      {
        field: 'phoneBound',
        labelKey: 'Binding cell phone',
        helperKey: 'Recommended for account recovery and high-value account changes.',
        onKey: 'Bound',
        offKey: 'Bind cell phone',
      },
      {
        field: 'emailBound',
        labelKey: 'Binding email',
        helperKey: 'Used for login recovery and security notices.',
        onKey: 'Bound',
        offKey: 'Bind email',
      },
      {
        field: 'loginPasswordSet',
        labelKey: 'Set login password',
        helperKey: 'Protect this account when signing in on a new device.',
        onKey: 'Set',
        offKey: 'Set password',
      },
      {
        field: 'deviceAlerts',
        labelKey: 'Devices Logged In',
        helperKey: 'Show alerts when a new device logs in.',
        onKey: 'Alerts on',
        offKey: 'Alerts off',
      },
    ]

    return (
      <div className="buzzcast-security-panel">
        <div className="buzzcast-settings-list">
          {accountRows.map((item) => (
            <button
              type="button"
              key={item.field}
              onClick={() => {
                if (item.field === 'deviceAlerts') {
                  updateSettings(item.field, !settingsDraft[item.field], t('Device login alerts updated.'))
                  return
                }
                openSecurityAction(item.field)
              }}
            >
              <span><strong>{t(item.labelKey)}</strong><small>{t(item.helperKey)}</small></span>
              <em>{settingsDraft[item.field] ? t(item.onKey) : t(item.offKey)}</em>
            </button>
          ))}
        </div>
      </div>
    )
  }

  function renderSettings() {
    const activeSettingsItem = settingsNav.find((item) => item.value === activeSettings) || settingsNav[0]

    return (
      <section className="buzzcast-settings-shell">
        <aside className="buzzcast-settings-nav">
          {settingsNav.map((item) => (
            <button
              key={item.value}
              type="button"
              className={activeSettings === item.value ? 'active' : ''}
              onClick={() => {
                setActiveSettings(item.value)
                setSettingsStatus('')
                setSelectedPolicyId('')
              }}
            >
              <i>{item.icon}</i>
              <span>{t(item.labelKey)}</span>
              <b>&gt;</b>
            </button>
          ))}
        </aside>
        <div className="buzzcast-settings-content">
          <div className="buzzcast-settings-heading">
            <h2>{t(activeSettingsItem.labelKey)}</h2>
            <p>{settingsStatus || t('Changes are applied immediately for this session.')}</p>
          </div>
          {renderSettingsContent()}
        </div>
      </section>
    )
  }

  function renderSecurityActionModal() {
    if (!securityAction) return null

    const titleByAction = {
      phoneBound: 'Binding cell phone',
      emailBound: 'Binding email',
      loginPasswordSet: 'Set login password',
    }

    return (
      <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setSecurityAction(null)}>
        <form className="buzzcast-security-modal" onSubmit={submitSecurityAction} onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <h2>{t(titleByAction[securityAction])}</h2>
            <button type="button" onClick={() => setSecurityAction(null)}>x</button>
          </header>

          {securityAction === 'phoneBound' ? (
            <label>
              <span>{t('Cell phone number')}</span>
              <input
                value={securityForm.phone}
                onChange={(event) => updateSecurityForm('phone', event.target.value)}
                inputMode="tel"
                placeholder="+1 555 010 2020"
              />
            </label>
          ) : null}

          {securityAction === 'emailBound' ? (
            <label>
              <span>{t('Email address')}</span>
              <input
                type="email"
                value={securityForm.email}
                onChange={(event) => updateSecurityForm('email', event.target.value)}
                placeholder="name@example.com"
              />
            </label>
          ) : null}

          {securityAction === 'loginPasswordSet' ? (
            <>
              <label>
                <span>{t('New password')}</span>
                <input
                  type="password"
                  value={securityForm.password}
                  onChange={(event) => updateSecurityForm('password', event.target.value)}
                  placeholder="10+ characters"
                />
              </label>
              <label>
                <span>{t('Confirm password')}</span>
                <input
                  type="password"
                  value={securityForm.passwordConfirm}
                  onChange={(event) => updateSecurityForm('passwordConfirm', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {securityError ? <p className="buzzcast-security-error">{securityError}</p> : null}
          <div className="buzzcast-security-actions">
            <button type="button" onClick={() => setSecurityAction(null)}>{t('Cancel')}</button>
            <button type="submit" className="buzzcast-submit">{t('Save')}</button>
          </div>
        </form>
      </div>
    )
  }

  function renderHelp() {
    const helpTabs = [
      { value: 'popular', label: 'Help', detail: `${popularHelp.length} guides` },
      { value: 'faq', label: 'FAQ', detail: `${faqTopics.length} answers` },
      { value: 'records', label: 'Records', detail: `${feedbackRecords.length} saved` },
    ]
    const activeTab = helpTabs.find((item) => item.value === helpMode) || helpTabs[0]

    return (
      <section className="buzzcast-help-shell">
        <header className="buzzcast-help-hero">
          <div>
            <span className="buzzcast-help-eyebrow">Support center</span>
            <h1>Feedback and Help</h1>
            <p>Find room, chat, account, and safety answers, then send a report if something still needs attention.</p>
          </div>
          <div className="buzzcast-help-actions">
            <button type="button" className={helpMode === 'records' ? 'active' : ''} onClick={() => selectHelpMode('records')}>
              <span>Records</span>
              <small>{feedbackRecords.length}</small>
            </button>
            <button type="button" className="primary" onClick={() => openFeedbackModal()}>
              Submit feedback
            </button>
          </div>
        </header>

        <nav className="buzzcast-help-tabs" aria-label="Help sections">
          {helpTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={helpMode === tab.value ? 'active' : ''}
              onClick={() => selectHelpMode(tab.value)}
            >
              <span>{tab.label}</span>
              <small>{tab.detail}</small>
            </button>
          ))}
        </nav>

        <div className="buzzcast-help-layout">
          <aside className="buzzcast-help-menu" aria-label={`${activeTab.label} navigation`}>
            {helpMode === 'faq' ? faqTopics.slice(0, 8).map((item) => (
              <button key={item} type="button" className={activeFaq === item ? 'active soft' : ''} onClick={() => toggleFaqTopic(item)}>
                {item}
              </button>
            )) : helpMode === 'records' ? (
              <>
                <button type="button" className="active" onClick={() => selectHelpMode('records')}>Feedback record</button>
                <button type="button" onClick={() => openFeedbackModal()}>Submit new feedback</button>
                <button type="button" onClick={() => selectHelpMode('faq')}>Browse FAQ</button>
                <button type="button" onClick={() => selectHelpMode('popular')}>Popular help</button>
              </>
            ) : popularHelp.map((item) => (
              <button key={item.id} type="button" className={activeHelp === item.id ? 'active soft' : ''} onClick={() => selectPopularHelp(item.id)}>
                {item.title}
              </button>
            ))}
          </aside>

          <main className="buzzcast-help-content">
            {helpMode === 'records' ? (
              <section className="buzzcast-feedback-record-list" aria-label="Feedback records">
                <header className="buzzcast-help-section-head">
                  <div>
                    <span>Feedback history</span>
                    <h2>Your submitted records</h2>
                  </div>
                  <button type="button" onClick={() => openFeedbackModal()}>New feedback</button>
                </header>
                {feedbackRecords.length ? feedbackRecords.map((record) => (
                  <article key={record.id} className="buzzcast-feedback-record">
                    <div>
                      <strong>{record.category} - {record.type}</strong>
                      <time>{formatFeedbackRecordDate(record.created_at)}</time>
                    </div>
                    <p>{record.description}</p>
                    <small>
                      {record.contact || 'No contact provided'}
                      {record.attachment ? ` - ${record.attachment.name}` : ''}
                    </small>
                  </article>
                )) : (
                  <div className="buzzcast-feedback-empty">
                    <strong>No feedback records yet</strong>
                    <p>Submitted feedback will appear here after it is sent to support.</p>
                    <button type="button" onClick={() => openFeedbackModal()}>Submit feedback</button>
                  </div>
                )}
              </section>
            ) : helpMode === 'faq' ? (
              <section className="buzzcast-faq-list" aria-label="Frequently asked questions">
                <header className="buzzcast-help-section-head">
                  <div>
                    <span>FAQ</span>
                    <h2>Frequently asked questions</h2>
                  </div>
                  <button type="button" onClick={() => openFeedbackModal({ type: 'Access issue' })}>Still need help</button>
                </header>
                {faqTopics.map((item) => (
                  <article key={item} className={activeFaq === item ? 'buzzcast-faq-item open' : 'buzzcast-faq-item'}>
                    <button type="button" onClick={() => toggleFaqTopic(item)} aria-expanded={activeFaq === item}>
                      {item}
                      <span>{activeFaq === item ? '^' : 'v'}</span>
                    </button>
                    {activeFaq === item ? <p>{faqAnswers[item]}</p> : null}
                  </article>
                ))}
              </section>
            ) : (
              <article className="buzzcast-help-answer">
                <span>Popular guide</span>
                <h2>{activeHelpItem.title}</h2>
                <p>{activeHelpItem.body}</p>
                <footer>
                  <button type="button" onClick={() => selectHelpMode('faq')}>Browse FAQ</button>
                  <button type="button" className="primary" onClick={() => openFeedbackModal({ type: 'Access issue' })}>Report a problem</button>
                </footer>
              </article>
            )}
          </main>
        </div>
      </section>
    )
  }

  function renderRoomPreview() {
    const card = previewCard
    if (!card) return renderLiveFeed()

    const isWarning = card.sensitive && !acceptedWarnings[card.id]
    const previewCover = cardCover(card)
    const previewAvatar = avatarForIndex(cardAvatarIndex(card))
    const roomAvatar = card.avatarUrl || previewAvatar
    const commentAvatar = card.avatarUrl || avatarForIndex(cardAvatarIndex(card) + 2)
    const roomMeta = getRoomMeta(card.room?.room_type || card.roomType)
    const isVideoRoom = roomAllowsCamera(card.room?.room_type || card.roomType)
    const blockedCount = Math.max(0, Math.round(Number(card.viewers || 0) / 25))
    const roomIdLabel = card.room?.id || 50741761
    const memberCount = Math.max(1, Math.min(999, Math.round(Number(card.viewers || 0) / 18)))
    const mobileComments = liveChatMessages
    const mobileMembers = [
      { name: card.host || 'Room owner', detail: 'Owner', role: 'Owner' },
      { name: 'EYANA', detail: 'Contributed 1187775 Exp' },
      { name: 'Nila Rahaman', detail: 'Contributed 559000 Exp' },
      { name: '0056372496', detail: 'Contributed 487900 Exp' },
      { name: 'Saidul', detail: 'Contributed 340900 Exp' },
      { name: '_*__SARA=_', detail: 'Contributed 300600 Exp' },
      { name: 'RAJA', detail: 'Contributed 256900 Exp' },
      { name: 'Dr.Bluetooth Boy', detail: 'Contributed 215604 Exp' },
      { name: 'off line', detail: 'Contributed 181300 Exp' },
      { name: 'M.Rahman Bappi', detail: 'Contributed 143900 Exp' },
    ]
    const mobileSeats = Array.from({ length: isVideoRoom ? 12 : 8 }, (_, index) => index + 1)
    const mobileLockDigits = mobileRoomLockCode.padEnd(4, ' ').slice(0, 4).split('')

    return (
      <section className="buzzcast-room-preview">
        <section className={showMobileRoomSettings ? 'buzzcast-mobile-room-live-preview is-hidden' : 'buzzcast-mobile-room-live-preview'} aria-label={`${card.title} live room preview`}>
          <header className="buzzcast-mobile-live-head">
            <button type="button" className="buzzcast-avatar-back-button" onClick={openLiveSection} aria-label="Back to rooms">
              <img src={backAvatar} alt="" loading="lazy" />
            </button>
            <button type="button" className="buzzcast-mobile-profile-avatar-button" onClick={() => setShowMobileRoomProfile(true)} aria-label="Open room profile">
              <span className="image-avatar"><img src={roomAvatar} alt="" loading="lazy" /></span>
            </button>
            <button type="button" className="buzzcast-mobile-title-button" onClick={() => setShowMobileRoomProfile(true)} aria-label="Open room profile">
              <strong>{card.title}</strong>
              <small>ID:{roomIdLabel} - {memberCount}</small>
            </button>
            <button type="button" onClick={() => shareMobileRoom(card)} aria-label="Share">↗</button>
            <button type="button" onClick={() => setShowMobileRoomTools(true)} aria-label="More room tools">...</button>
            <button type="button" onClick={openLiveSection} aria-label="Leave room">⏻</button>
          </header>

          <div className="buzzcast-mobile-room-badges">
            <div>
              <span>Group 309</span>
              <span>NILOY</span>
            </div>
            <button type="button" className="buzzcast-mobile-member-strip" onClick={() => setShowMobileMembers(true)} aria-label="Open room members">
              {[0, 1, 2].map((index) => (
                <i key={index} className="image-avatar"><img src={index === 0 ? commentAvatar : avatarForIndex(index + 1)} alt="" loading="lazy" /></i>
              ))}
              <b>›</b>
            </button>
          </div>

          <div className="buzzcast-mobile-live-actions">
            <button type="button" onClick={refreshMobileRooms}>Refresh</button>
            <button type="button" onClick={() => handleMobileJoinCard(card, { rtcMode: 'audio' })}>Voice</button>
            <button type="button" onClick={() => showMobileActionToast('Playlist opens after joining the room.')}>Playlist</button>
            <button type="button" onClick={() => setShowMobileRoomTools(true)}>Tools</button>
          </div>

          <section className="buzzcast-mobile-stage-card" aria-label="Live room stage">
            <span className="buzzcast-mobile-stage-avatar image-avatar">
              <img src={roomAvatar} alt="" loading="lazy" />
            </span>
            <div>
              <small>{roomMeta.label} · {compactNumber(card.viewers || 0)} watching</small>
              <strong>{card.title}</strong>
              <em>{card.host} · Live topic</em>
            </div>
            <button type="button" onClick={() => handleMobileJoinCard(card)}>
              Join
            </button>
          </section>

          <div className="buzzcast-mobile-seat-grid">
            {mobileSeats.map((seat) => (
              <button
                key={seat}
                type="button"
                className={seat === 1 ? 'active' : ''}
                onClick={() => seat === 1 ? handleMobileJoinCard(card, { rtcMode: 'audio' }) : setShowMobileRoomLock(true)}
              >
                <span><img src={seat === 1 ? liveRoomAssets.seatMic : liveRoomAssets.seatLock} alt="" loading="lazy" /></span>
                <small>No.{seat}</small>
              </button>
            ))}
          </div>
          <div className="buzzcast-mobile-pk-badge">PK</div>

          <button type="button" className="buzzcast-mobile-mic-line" onClick={() => handleMobileJoinCard(card, { rtcMode: 'audio' })}>
            <img src={liveRoomAssets.seatMic} alt="" loading="lazy" />
            <span>Come on mic and chat together~</span>
          </button>

          <div className="buzzcast-mobile-live-comments">
            {mobileComments.map((message) => (
              <article key={message.id}>
                <span className="image-avatar"><img src={commentAvatar} alt="" loading="lazy" /></span>
                <div>
                  <strong><i>Owner</i> {card.host}</strong>
                  <small>{message.badges.map((badge) => <b key={badge}>{badge}</b>)}</small>
                  <p>{message.body}</p>
                </div>
              </article>
            ))}
          </div>

          <form className="buzzcast-mobile-live-composer" onSubmit={sendLiveRoomMessage}>
            <button type="button" onClick={() => showMobileActionToast('Voice message ready')} aria-label="Voice"><img src={liveRoomAssets.composerMic} alt="" loading="lazy" /></button>
            <input value={dmInput} onChange={(event) => setDmInput(event.target.value)} placeholder="Say hi..." />
            <button type="submit" aria-label="Send"><img src={liveRoomAssets.send} alt="" loading="lazy" /></button>
          </form>

          {mobileToast ? (
            <div className="buzzcast-mobile-toast" role="status">{mobileToast}</div>
          ) : null}

          {showMobileMembers ? (
            <section className="buzzcast-mobile-members-page" aria-label="Group members">
              <header>
                <button type="button" className="buzzcast-avatar-back-button" onClick={() => setShowMobileMembers(false)} aria-label="Back to room">
                  <img src={backAvatar} alt="" loading="lazy" />
                </button>
                <strong>Group Members<span>({memberCount} members)</span></strong>
                <span></span>
              </header>
              <div className="buzzcast-mobile-members-list">
                {mobileMembers.map((member, index) => (
                  <button key={`${member.name}-${index}`} type="button" onClick={() => showMobileActionToast(`${member.name} selected`)}>
                    <b>{index + 1}</b>
                    <i className="image-avatar"><img src={index === 0 ? roomAvatar : avatarForIndex(index + 2)} alt="" loading="lazy" /></i>
                    <span>
                      <strong>{member.name}{member.role ? <em>{member.role}</em> : null}</strong>
                      <small>{member.detail}</small>
                    </span>
                    <mark></mark>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {showMobileRoomProfile ? (
            <div className="buzzcast-mobile-room-profile-backdrop" role="dialog" aria-modal="true" aria-labelledby="buzzcast-mobile-room-profile-title">
              <section className="buzzcast-mobile-room-profile-sheet">
                <header>
                  <span></span>
                  <strong id="buzzcast-mobile-room-profile-title">Room Profile</strong>
                  <button type="button" onClick={() => setShowMobileRoomProfile(false)} aria-label="Close room profile">×</button>
                </header>
                <button
                  type="button"
                  className="buzzcast-mobile-room-profile-settings"
                  onClick={() => {
                    setShowMobileRoomProfile(false)
                    setShowMobileRoomSettings(true)
                  }}
                  aria-label="Room settings"
                >
                  <span></span>
                  <small>Settings</small>
                </button>
                <span className="buzzcast-mobile-room-profile-avatar image-avatar"><img src={roomAvatar} alt="" loading="lazy" /></span>
                <strong className="buzzcast-mobile-room-profile-name">{card.title}</strong>
                <span className="buzzcast-mobile-room-profile-id">ID:{roomIdLabel}</span>
                <div className="buzzcast-mobile-room-profile-stats" aria-label="Room stats">
                  <span><b>49.4M</b><small>Total Views</small></span>
                  <button type="button" onClick={() => { setShowMobileRoomProfile(false); setShowMobileMembers(true) }}><b>{memberCount}</b><small>Members</small></button>
                </div>
                <dl className="buzzcast-mobile-room-profile-details">
                  <div>
                    <dt>Language:</dt>
                    <dd>Bengali(বাংলা)</dd>
                  </div>
                  <div>
                    <dt>Country:</dt>
                    <dd>{card.country || 'গণপ্রজাতন্ত্রী বাংলাদেশ'}</dd>
                  </div>
                  <div>
                    <dt>Announcement:</dt>
                    <dd>{card.description || 'Please respect each other and chat in a friendly manner.'}</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : null}

          {showMobileRoomTools ? (
            <div className="buzzcast-mobile-room-tools-backdrop" role="dialog" aria-modal="true" aria-label="Room tools">
              <section className="buzzcast-mobile-room-tools-sheet">
                <button
                  type="button"
                  onClick={() => updateMobileRoomControls(card, { max_mic_count: mobileSeats.length }, `${mobileSeats.length} mic seats enabled.`)}
                >
                  <i className="mic"></i>
                  <span>Number of Mic</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateMobileRoomControls(card, { privacy_type: 'public' }, 'Room unlocked.')}
                >
                  <i className="unlock"></i>
                  <span>Unlock</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileRoomTools(false)
                    setShowMobileRoomLock(true)
                  }}
                >
                  <i className="password"></i>
                  <span>Password</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateMobileRoomControls(card, { theme: nextThemeValue(card.room?.theme || roomForm.theme) }, 'Room theme updated.')}
                >
                  <i className="theme"></i>
                  <span>Theme</span>
                </button>
                <button type="button" onClick={() => shareMobileRoom(card)}>
                  <i className="share"></i>
                  <span>Share</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileRoomTools(false)
                    setShowMobileRoomSettings(true)
                  }}
                >
                  <i className="admin"></i>
                  <span>Admin</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLiveChatMessages([])
                    setShowMobileRoomTools(false)
                    showMobileActionToast('Comments cleared on this device.')
                  }}
                >
                  <i className="clear"></i>
                  <span>Clear comments history</span>
                </button>
                <button type="button" onClick={() => { setShowMobileRoomTools(false); openRankings() }}>
                  <i className="action-avatar"><img src={rankingAvatar} alt="" loading="lazy" /></i>
                  <span>Gather</span>
                </button>
                <button type="button" className="cancel" onClick={() => setShowMobileRoomTools(false)}>Cancel</button>
              </section>
            </div>
          ) : null}

          {showMobileRoomLock ? (
            <div className="buzzcast-mobile-room-lock-backdrop" role="dialog" aria-modal="true" aria-labelledby="buzzcast-mobile-room-lock-title">
              <section className="buzzcast-mobile-room-lock-modal">
                <button type="button" className="close" onClick={() => setShowMobileRoomLock(false)} aria-label="Close room lock">×</button>
                <strong id="buzzcast-mobile-room-lock-title">Room lock</strong>
                <label>
                  <span>Room lock code</span>
                  <input
                    value={mobileRoomLockCode}
                    onChange={(event) => setMobileRoomLockCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    autoFocus
                    inputMode="numeric"
                    maxLength={4}
                    aria-label="Room lock code"
                  />
                </label>
                <div className="buzzcast-mobile-room-lock-digits" aria-hidden="true">
                  {mobileLockDigits.map((digit, index) => (
                    <span key={index}>{digit.trim()}</span>
                  ))}
                </div>
                <p>Please set 4 digits password</p>
                <button type="button" className="confirm" onClick={() => confirmMobileRoomLock(card)}>Confirm</button>
                <button type="button" className="cancel" onClick={() => setShowMobileRoomLock(false)}>Cancel</button>
              </section>
            </div>
          ) : null}
        </section>
        <section className={showMobileRoomSettings ? 'buzzcast-mobile-room-settings is-visible' : 'buzzcast-mobile-room-settings'} aria-label={`${card.title} room settings`}>
          <header>
            <button type="button" className="buzzcast-avatar-back-button" onClick={() => setShowMobileRoomSettings(false)} aria-label="Back to room">
              <img src={backAvatar} alt="" loading="lazy" />
            </button>
            <strong>Settings</strong>
            <span></span>
          </header>
          <div className="buzzcast-mobile-room-group">
            <button
              type="button"
              onClick={() => {
                setShowMobileRoomSettings(false)
                setShowMobileRoomProfile(true)
              }}
            >
              <span>Profile</span>
              <span className="buzzcast-mobile-room-value with-avatar">
                <i className="image-avatar"><img src={previewAvatar} alt="" loading="lazy" /></i>
                <b>›</b>
              </span>
            </button>
          </div>
          <div className="buzzcast-mobile-room-group">
            <button type="button" onClick={() => card.room ? showMobileActionToast('Room name is managed from the owner room settings.') : openHostPanel('Create a live room first to set the room name.')}>
              <span>Room Name</span>
              <span className="buzzcast-mobile-room-value"><em>{card.title}</em><b>›</b></span>
            </button>
            <button type="button" onClick={() => card.room ? showMobileActionToast('Announcement is visible in the room profile.') : openHostPanel('Create a live room first to add an announcement.')}>
              <span>Announcement</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
          </div>
          <div className="buzzcast-mobile-room-group">
            <button type="button" onClick={() => showMobileActionToast(`${roomMeta.label} selected.`)}>
              <span>Room Title</span>
              <span className="buzzcast-mobile-room-value"><em>{roomMeta.label}</em><b>›</b></span>
            </button>
            <button type="button" onClick={() => setSettingsStatus('Use Block in the chat panel to hide a user and remove their messages from your view.')}>
              <span>Blocked List</span>
              <span className="buzzcast-mobile-room-value"><em>{blockedCount}</em><b>›</b></span>
            </button>
            <button type="button" onClick={() => showMobileActionToast('Kick history appears after owner moderation actions.')}>
              <span>Kick History</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
            <button type="button" onClick={() => showMobileActionToast('Remove history appears after room cleanup actions.')}>
              <span>Remove History</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
            <button type="button" onClick={() => showMobileActionToast('Operate history appears after room owner changes.')}>
              <span>Operate History</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
          </div>
          <div className="buzzcast-mobile-room-group">
            <button type="button" onClick={openRankings}>
              <span>Live Record and Balance</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
            <button type="button" onClick={() => setActiveSection('help')}>
              <span>Live Guidance</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
          </div>
          <div className="buzzcast-mobile-room-live">
            <span className="image-avatar"><img src={previewAvatar} alt="" loading="lazy" /></span>
            <strong>LIVE</strong>
          </div>
          <div className="buzzcast-mobile-room-follow">
            <span></span>
            <div><strong>0 Follow</strong><small>On Live</small></div>
          </div>
        </section>
        <div className={`buzzcast-stage media-${card.tone || 'sensitive'}`}>
          <img className="buzzcast-stage-image" src={previewCover} alt="" />
          {isWarning ? (
            <div className="buzzcast-warning-panel">
              <strong>This live broadcast may contain sensitive content</strong>
              <button type="button" onClick={() => setAcceptedWarnings((previous) => ({ ...previous, [card.id]: true }))}>View</button>
              <button type="button" onClick={() => openSettingsSection('content')}>Content Preferences</button>
            </div>
          ) : (
            <>
              <div className="buzzcast-room-summary" aria-label="Room summary">
                <strong title={card.title}>{card.title}</strong>
                <span>Room ID: {card.room?.id || card.id}</span>
                <small>{compactNumber(card.viewers || 0)} user{Number(card.viewers || 0) === 1 ? '' : 's'}</small>
              </div>
            </>
          )}
        </div>
        <aside className="buzzcast-live-chat">
          <p>Be polite and respectful. Any vulgar, violent, or private transaction behavior is strictly prohibited in TalkEachOther. Please speak in a civilized manner.</p>
          <div className="buzzcast-chat-log">
            <span><b>18</b> joined</span>
            <span><b>2</b> joined</span>
          </div>
          <form onSubmit={sendLiveRoomMessage}>
            <input value={dmInput} onChange={(event) => setDmInput(event.target.value)} placeholder="Send a chat" />
          </form>
        </aside>
      </section>
    )
  }

  useEffect(() => {
    setSettingsDraft((previous) => ({
      ...previous,
      emailBound: previous.emailBound || Boolean(user?.email),
      region: user?.current_residence || previous.region || 'United States',
    }))
    setFeedbackForm((previous) => ({
      ...previous,
      contact: previous.contact || user?.email || '',
    }))
    setSecurityForm((previous) => ({
      ...previous,
      email: previous.email || user?.email || '',
    }))
  }, [user?.email, user?.current_residence])

  useEffect(() => {
    const normalizedLanguage = normalizeSettingsLanguage(language)
    setSettingsDraft((previous) => (
      previous.language === normalizedLanguage ? previous : { ...previous, language: normalizedLanguage }
    ))
  }, [language])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('rtc_room_settings', JSON.stringify({
        phoneBound: settingsDraft.phoneBound,
        emailBound: settingsDraft.emailBound,
        loginPasswordSet: settingsDraft.loginPasswordSet,
        deviceAlerts: settingsDraft.deviceAlerts,
        messagePrivacy: settingsDraft.messagePrivacy,
        privateInvite: settingsDraft.privateInvite,
        hideSensitive: settingsDraft.hideSensitive,
        contentMode: settingsDraft.contentMode,
        language: settingsDraft.language,
        region: settingsDraft.region,
      }))
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = settingsLanguageCodes[settingsDraft.language] || 'en'
    }
  }, [settingsDraft])

  useEffect(() => {
    if (!showMessages || !user) return
    loadDirectMessageContacts()
  }, [showMessages, user?.id])

  useEffect(() => {
    if (!showMessages || !activeThreadData?.peerId || !user) return
    setReadThreadIds((previous) => previous.includes(activeThreadData.id) ? previous : [...previous, activeThreadData.id])
    loadDirectMessageConversation(activeThreadData)
  }, [showMessages, activeThreadData?.peerId, activeThreadData?.id, user?.id])

  useEffect(() => {
    if (!messageThreads.length) {
      if (activeThread) setActiveThread('')
      return
    }

    if (!activeThread || !messageThreads.some((thread) => thread.id === activeThread)) {
      setActiveThread(messageThreads[0].id)
    }
  }, [activeThread, messageThreads])

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadRooms({
        page: 1,
        searchValue: search,
        filterValue: filter,
        privacyValue: privacyFilter,
        sortValue: sort,
        feedValue: activeFeed,
        regionValue: settingsDraft.region || user?.current_residence || '',
        quiet: true,
      })
    }, search.trim() ? 300 : 0)

    return () => clearTimeout(timeout)
  }, [activeFeed, search, filter, privacyFilter, sort, settingsDraft.region, user?.current_residence])

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      setInstallPrompt(event)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  }, [])

  useEffect(() => {
    function handlePopState(event) {
      applySectionFromHistory(event.state || {})
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (user) return
    if (activeSection === 'me' || activeSection === 'settings') setActiveSection('live')
    setShowMessages(false)
    setShowRankings(false)
    setShowHostPanel(false)
    setDmContacts([])
    setDmMessages({})
    setActiveThread('')
    setDmDeleteTarget(null)
    setDmDeleteForEveryone(false)
    setDmImagePreview(null)
    clearDmMediaDrafts()
  }, [activeSection, user])

  useEffect(() => {
    if (showMessages) return
    if (dmRecording) stopDmAudioRecording()
    clearDmMediaDrafts()
    setDmDeleteTarget(null)
    setDmDeleteForEveryone(false)
    setDmImagePreview(null)
    setDmInput('')
  }, [showMessages])

  useEffect(() => {
    if (!dmImagePreview) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') closeDmImagePreview()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dmImagePreview])

  useEffect(() => () => {
    cancelDmAudioRecording()
  }, [])

  return (
    <div className={`buzzcast-shell section-${activeSection}`}>
      <AppIconSprite />
      <header className="buzzcast-topbar">
        <BuzzLogo />
        <div className="buzzcast-search-wrap">
          <label className="sr-only" htmlFor="buzzcast-search">Search</label>
          <input
            id="buzzcast-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => setShowSearchPanel(true)}
            onBlur={() => window.setTimeout(() => setShowSearchPanel(false), 160)}
            placeholder="Search"
          />
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={runSearch} aria-label="Search rooms">
            <span className="buzzcast-search-icon" aria-hidden="true"></span>
          </button>
          {showSearchPanel ? (
            <div className="buzzcast-search-panel">
              <span>{loadingRooms ? <LoadingMovie label="Searching rooms" inline /> : searchPanelTitle}</span>
              {roomSearchResults.map((item, index) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openSearchResult(item)}
                >
                  <i className="image-avatar"><img src={avatarForIndex(item.avatarIndex ?? item.id ?? index)} alt="" loading="lazy" /></i>
                  <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                </button>
              ))}
              {!loadingRooms && roomSearchResults.length === 0 ? (
                <em>{search.trim() ? 'Try another room name, host, or room type.' : 'Type a room name, host, or category.'}</em>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="buzzcast-actions">
          {showAdminDashboard ? (
            <IconButton label="Admin dashboard" onClick={() => onView?.('admin')}>
              <SvgIcon id="icon-adminDashboardIcon" />
            </IconButton>
          ) : null}
          <IconButton label="Rankings" onClick={openRankings}>
            <SvgIcon id="icon-rankingIcon" />
          </IconButton>
          <IconButton label={showMessages ? 'Close messages' : 'Messages'} badge={unreadThreadCount ? String(unreadThreadCount) : ''} onClick={toggleMessagesDrawer}>
            <SvgIcon id="icon-messageTopbarIcon" />
          </IconButton>
          <button type="button" className="buzzcast-avatar-button" onClick={openProfileSection}>
            <span className="image-avatar">
              <img src={profileAvatar} alt={profileInitials} loading="lazy" />
            </span>
          </button>
        </div>
      </header>

      <aside className="buzzcast-left-rail">
        <button
          type="button"
          className={activeSection === 'live' || activeSection === 'room' ? 'active buzzcast-rail-tab buzzcast-rail-home' : 'buzzcast-rail-tab buzzcast-rail-home'}
          data-mobile-label="Live"
          onClick={openLiveSection}
          aria-label="Home"
        >
          <span className="buzzcast-rail-icon rail-live rail-symbol-icon" aria-hidden="true">
            <SvgIcon id="icon-homeLiveIcon" />
          </span>
          <b>Live</b>
        </button>
        <button
          type="button"
          className={activeSection === 'me' ? 'active buzzcast-rail-tab buzzcast-rail-profile' : 'buzzcast-rail-tab buzzcast-rail-profile'}
          data-mobile-label="Me"
          onClick={openProfileSection}
          aria-label="Me"
        >
          <span className="buzzcast-rail-icon rail-me rail-symbol-icon" aria-hidden="true">
            <SvgIcon id="icon-icon_share" />
          </span>
          <b>Me</b>
        </button>
        <div className="buzzcast-rail-spacer"></div>
        <button
          type="button"
          className={showInstall || showDownloadQr ? 'active buzzcast-rail-tab buzzcast-rail-app-download' : 'buzzcast-rail-tab buzzcast-rail-app-download'}
          data-mobile-label="App"
          onClick={openInstallAppModal}
          aria-label="Get the app"
        >
          <span className="buzzcast-rail-icon rail-app rail-symbol-icon" aria-hidden="true">
            <SvgIcon id="icon-getTheAppIcon" />
          </span>
          <b>Get the app</b>
        </button>
        <button
          type="button"
          className={activeSection === 'settings' ? 'active buzzcast-rail-tab buzzcast-rail-moments' : 'buzzcast-rail-tab buzzcast-rail-moments'}
          data-mobile-label="Settings"
          onClick={openMobileMomentsSection}
          aria-label="Settings"
        >
          <span className="buzzcast-rail-icon rail-settings rail-symbol-icon" aria-hidden="true">
            <SvgIcon id="icon-settingsIcon" />
          </span>
          <b>Settings</b>
        </button>
        <button
          type="button"
          className={activeSection === 'help' ? 'active buzzcast-rail-tab buzzcast-rail-message-tab' : 'buzzcast-rail-tab buzzcast-rail-message-tab'}
          data-mobile-label="Help"
          onClick={openHelpSection}
          aria-label="Feedback and Help"
        >
          <span className="buzzcast-rail-icon rail-help rail-symbol-icon" aria-hidden="true">
            <SvgIcon id="icon-feedbackAndHelpIcon" />
          </span>
          <b>Feedback and Help</b>
        </button>
        <button
          type="button"
          className={showMessages ? 'active buzzcast-rail-tab buzzcast-rail-install' : 'buzzcast-rail-tab buzzcast-rail-install'}
          data-mobile-label="Message"
          onClick={openMobileMessageSection}
          aria-label={showMessages ? 'Close messages' : 'Messages'}
        >
          <span className="buzzcast-rail-icon rail-app rail-symbol-icon" aria-hidden="true">
            <SvgIcon id="icon-messageTopbarIcon" />
          </span>
          <b>Messages</b>
        </button>
      </aside>

      {showDownloadQr ? (
        <section className="buzzcast-download-qr-panel" role="dialog" aria-label={`Scan to download ${appDownloadName} app`}>
          <button type="button" className="buzzcast-download-qr-close" onClick={() => setShowDownloadQr(false)} aria-label="Close download QR">×</button>
          <div className="buzzcast-download-qr-code">
            <img className="buzzcast-download-qr-image" src={appDownloadQrUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            <span className="buzzcast-download-qr-logo">
              <img src={brandAssets.appIconSmall} alt="" decoding="async" />
            </span>
          </div>
          <strong>Scan to download {appDownloadName} APP</strong>
          <small>{appDownloadUrl.replace(/^https?:\/\//, '')}</small>
          <div className="buzzcast-download-platforms" aria-label="Supported app platforms">
            <span className="android">Android</span>
            <span className="play">Play</span>
            <span className="ios">iOS</span>
            <span className="pwa">PWA</span>
          </div>
        </section>
      ) : null}

      <main className="buzzcast-main">
        {activeSection === 'live' && renderLiveFeed()}
        {activeSection === 'room' && renderRoomPreview()}
        {activeSection === 'me' && renderProfile()}
        {activeSection === 'settings' && renderSettings()}
        {activeSection === 'help' && renderHelp()}
      </main>

      {showMessages ? (
        <section className="buzzcast-messages-drawer">
          <aside>
            <input
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
              placeholder="Search followers"
              aria-label="Search followers"
            />
            {loadingDmContacts ? <div className="buzzcast-empty-state compact"><LoadingMovie label="Loading messages" inline /></div> : null}
            {messageThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={activeThread === thread.id ? 'active' : ''}
                onClick={() => {
                  setActiveThread(thread.id)
                  setReadThreadIds((previous) => previous.includes(thread.id) ? previous : [...previous, thread.id])
                  setDmStatus('')
                  setDmInput('')
                  setDmDeleteTarget(null)
                  setDmDeleteForEveryone(false)
                  setDmImagePreview(null)
                  clearDmMediaDrafts()
                  if (dmRecording) cancelDmAudioRecording()
                }}
              >
                <i className="image-avatar"><img src={thread.avatarUrl} alt={thread.name} loading="lazy" /></i>
                <span><strong>{thread.name}</strong><small>{thread.relationshipLabel} - {thread.previewText}</small></span>
                <time>{thread.time}</time>
                {thread.unread ? <em>{thread.unread}</em> : null}
              </button>
            ))}
            {!loadingDmContacts && !messageThreads.length ? (
              <div className="buzzcast-empty-state compact">No follower messages yet.</div>
            ) : null}
          </aside>
          <main>
            {activeThreadData ? (
              <>
                <header className="buzzcast-dm-header">
                  <button type="button" className="buzzcast-dm-back" onClick={() => {
                    setDmDeleteTarget(null)
                    setDmDeleteForEveryone(false)
                    setDmImagePreview(null)
                    setShowMessages(false)
                  }} aria-label="Back to rooms">
                    <img src={backAvatar} alt="" loading="lazy" />
                  </button>
                  <span className="buzzcast-dm-peer-avatar image-avatar">
                    <img src={activeThreadData.avatarUrl} alt={activeThreadData.name} loading="lazy" />
                  </span>
                  <strong>{activeThreadData.name}</strong>
                  <span className="buzzcast-dm-peer-id">( User ID: {activeThreadData.peerId})</span>
                  <button type="button" className="following" disabled>{activeThreadData.relationshipLabel || 'Following'}</button>
                  <button type="button" className="buzzcast-dm-more" onClick={() => setDmStatus('Private chat options are available after a conversation is active.')} aria-label="More options">...</button>
                </header>
                <p className="buzzcast-dm-intro">
                  Private messages with follower contacts appear here.
                </p>
                <div className={activeThreadFollowed ? 'buzzcast-dm-notice open' : 'buzzcast-dm-notice'}>
                  {dmStatus || dmNotice}
                </div>
                <div className="buzzcast-dm-body">
                  {loadingDmConversation ? <LoadingMovie label="Loading conversation" compact /> : null}
                  {!loadingDmConversation && activeThreadMessages.length === 0 ? (
                    <div className="buzzcast-empty-state compact">No messages with this user yet.</div>
                  ) : null}
                  {activeThreadMessages.map((message) => {
                    const imageMessage = message.message_type === 'image' && message.media_url
                    const voiceMessage = message.message_type === 'voice' && message.media_url
                    const senderName = message.mine ? 'You' : activeThreadData.name
                    const senderAvatar = message.mine ? profileAvatar : activeThreadData.avatarUrl
                    const body = String(message.body || '').trim()
                    const caption = imageMessage && !['sent a photo', 'Photo'].includes(body)
                      ? body
                      : ''
                    const deleting = Boolean(deletingDmMessageIds[directMessageActionKey(message)])
                    const bubbleClass = imageMessage
                      ? 'chat-bubble image-message'
                      : voiceMessage ? 'chat-bubble voice-message' : 'chat-bubble'

                    return (
                      <div key={message.id} className={message.mine ? 'chat-row mine buzzcast-dm-chat-row' : 'chat-row buzzcast-dm-chat-row'}>
                        <div className="chat-avatar image-avatar">
                          <img src={senderAvatar} alt={senderName} loading="lazy" />
                        </div>
                        <div className={bubbleClass}>
                          <div className="chat-meta">
                            <strong>{senderName}</strong>
                            <time>{formatChatTime(message.createdAt)}</time>
                          </div>
                          {imageMessage ? (
                            <div className="chat-image-message">
                              <button
                                type="button"
                                className="chat-photo-preview-button"
                                onClick={() => openDmImagePreview({
                                  src: message.media_url,
                                  alt: `${senderName} sent`,
                                  caption,
                                  downloadName: directMessageDownloadName(message),
                                })}
                                aria-label="Preview photo"
                              >
                                <img className="chat-photo" src={message.media_url} alt={`${senderName} sent`} loading="lazy" />
                              </button>
                              {caption ? <p>{caption}</p> : null}
                            </div>
                          ) : voiceMessage ? (
                            <div className="chat-voice-message">
                              <audio controls src={message.media_url}></audio>
                              <span>{body || 'Voice message'}</span>
                            </div>
                          ) : (
                            <p>{body}</p>
                          )}
                          <div className="chat-actions">
                            <button type="button" className="danger" onClick={() => requestDmDelete(message)} disabled={deleting}>
                              {deleting ? 'Deleting' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <form className="chat-form buzzcast-dm-composer" onSubmit={sendDmMessage}>
                  <input
                    ref={dmPhotoInputRef}
                    className="chat-photo-input buzzcast-dm-photo-input"
                    type="file"
                    accept="image/*"
                    onChange={stageDmPhotoDraft}
                    disabled={!activeThreadData?.peerId || sendingDm || dmRecording}
                  />
                  {dmPhotoDraft ? (
                    <div className="chat-photo-draft buzzcast-dm-draft photo">
                      <img src={dmPhotoDraft.dataUrl} alt="" />
                      <span><strong>Photo</strong><small>{dmPhotoDraft.name || 'Ready to send'}</small></span>
                      <button type="button" onClick={() => setDmPhotoDraft(null)} disabled={sendingDm} aria-label="Remove photo">x</button>
                    </div>
                  ) : null}
                  {dmAudioDraft ? (
                    <div className="chat-audio-draft buzzcast-dm-draft audio">
                      <audio controls src={dmAudioDraft.dataUrl}></audio>
                      <span>{formatDmDuration(dmAudioDraft.durationMs)} voice note</span>
                      <button type="button" onClick={() => setDmAudioDraft(null)} disabled={sendingDm} aria-label="Remove voice note">x</button>
                    </div>
                  ) : null}
                  {dmRecording ? (
                    <div className="chat-recording-line buzzcast-dm-recording">
                      <span>{formatDmDuration(dmRecordingMs)}</span>
                      <b>Recording voice message</b>
                    </div>
                  ) : null}
                  <textarea
                    value={dmInput}
                    onChange={(event) => setDmInput(event.target.value)}
                    onKeyDown={handleDmComposerKeyDown}
                    placeholder={(dmPhotoDraft || dmAudioDraft) ? 'Add a caption...' : 'Type a message...'}
                    maxLength={1200}
                    rows={2}
                    disabled={sendingDm || dmRecording}
                  />
                  <div className="chat-form-footer">
                    <span>{dmInput.length}/1200</span>
                    <div className="chat-form-actions">
                      <button
                        type="button"
                        className={dmRecording ? 'secondary-button chat-audio-button buzzcast-dm-composer-icon mic recording' : 'secondary-button chat-audio-button buzzcast-dm-composer-icon mic'}
                        onClick={toggleDmAudioRecording}
                        disabled={!activeThreadData?.peerId || sendingDm}
                        aria-label={dmRecording ? 'Stop recording voice message' : 'Record voice message'}
                        title={dmRecording ? 'Stop recording' : 'Record voice message'}
                      >
                        <img src={liveRoomAssets.composerMic} alt="" loading="lazy" />
                        <span>{dmRecording ? 'Stop' : 'Audio'}</span>
                      </button>
                      <button
                        type="button"
                        className="secondary-button chat-photo-button buzzcast-dm-composer-icon photo"
                        onClick={openDmPhotoPicker}
                        disabled={!activeThreadData?.peerId || sendingDm || dmRecording}
                        aria-label="Send photo"
                        title="Send photo"
                      >
                        <img src={liveRoomAssets.composerPhoto} alt="" loading="lazy" />
                        <span>Photo</span>
                      </button>
                      <button className="primary-button" type="submit" aria-label="Send message" disabled={!canSendDm}>{sendingDm ? 'Sending' : 'Send'}</button>
                    </div>
                  </div>
                </form>
                {dmDeleteTarget ? (
                  <div className="chat-delete-backdrop" onMouseDown={closeDmDeletePrompt}>
                    <section className="chat-delete-modal" role="dialog" aria-modal="true" aria-labelledby="buzzcast-dm-delete-title" onMouseDown={(event) => event.stopPropagation()}>
                      <h3 id="buzzcast-dm-delete-title">Delete message</h3>
                      <p>Are you sure you want to delete this message?</p>
                      <label className={canDeleteDmMessageForEveryone(dmDeleteTarget.message) ? 'chat-delete-option' : 'chat-delete-option disabled'}>
                        <input
                          type="checkbox"
                          checked={dmDeleteForEveryone && canDeleteDmMessageForEveryone(dmDeleteTarget.message)}
                          disabled={!canDeleteDmMessageForEveryone(dmDeleteTarget.message) || Boolean(deletingDmMessageIds[directMessageActionKey(dmDeleteTarget.message)])}
                          onChange={(event) => setDmDeleteForEveryone(event.target.checked)}
                        />
                        <span>{canDeleteDmMessageForEveryone(dmDeleteTarget.message) ? 'Delete for everyone in this chat' : 'Delete only for me'}</span>
                      </label>
                      {canDeleteDmMessageForEveryone(dmDeleteTarget.message) ? (
                        <small className="chat-delete-hint">
                          {dmDeleteForEveryone ? 'Everyone will lose this message.' : 'Only your inbox will hide this message.'}
                        </small>
                      ) : null}
                      <footer>
                        <button type="button" className="secondary-button" onClick={closeDmDeletePrompt} disabled={Boolean(deletingDmMessageIds[directMessageActionKey(dmDeleteTarget.message)])}>CANCEL</button>
                        <button type="button" className="danger-button" onClick={confirmDmDelete} disabled={Boolean(deletingDmMessageIds[directMessageActionKey(dmDeleteTarget.message)])}>
                          {deletingDmMessageIds[directMessageActionKey(dmDeleteTarget.message)] ? 'DELETING...' : 'DELETE'}
                        </button>
                      </footer>
                    </section>
                  </div>
                ) : null}
                {dmImagePreview ? (
                  <div className="chat-image-preview-backdrop" onMouseDown={closeDmImagePreview}>
                    <section className="chat-image-preview-modal" role="dialog" aria-modal="true" aria-label="Photo preview" onMouseDown={(event) => event.stopPropagation()}>
                      <header>
                        <strong>Photo</strong>
                        <button type="button" onClick={closeDmImagePreview} aria-label="Close photo preview">x</button>
                      </header>
                      <img src={dmImagePreview.src} alt={dmImagePreview.alt} />
                      {dmImagePreview.caption ? <p>{dmImagePreview.caption}</p> : null}
                      <footer>
                        <a className="chat-image-download-action" href={dmImagePreview.src} download={dmImagePreview.downloadName || 'direct-message-photo.jpg'}>Download</a>
                      </footer>
                    </section>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="buzzcast-empty-state visual">
                <img src={roomAssets.sidebarEmpty} alt="" loading="lazy" />
                <div>
                  <strong>No follower messages yet</strong>
                  <span>Conversations appear here after you follow a user or accept their follow.</span>
                </div>
              </div>
            )}
          </main>
        </section>
      ) : null}

      {showRankings ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowRankings(false)}>
          <section className="buzzcast-rankings-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2><img src={rankingAvatar} alt="" loading="lazy" />Rankings</h2>
                <p>Calculated from room viewers, active participants, and host activity.</p>
              </div>
              <button type="button" onClick={() => setShowRankings(false)}>x</button>
            </header>
            <nav>
              {[
                { value: 'rooms', label: 'Rooms' },
                { value: 'hosts', label: 'Hosts' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={activeRanking === item.value ? 'active' : ''}
                  onClick={() => setActiveRanking(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="buzzcast-ranking-list">
              {rankingRows.map((item, index) => (
                <article key={item.key}>
                  <b>{index + 1}</b>
                  <span className="image-avatar">
                    <img src={item.icon || avatarForIndex(item.avatarIndex || index)} alt="" loading="lazy" />
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <em>{compactNumber(item.score)}</em>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {showInstall ? (
        <div className="buzzcast-modal-backdrop">
          <section className="buzzcast-install-modal">
            <h2>Install app</h2>
            <div>
              <div className="buzzcast-logo-mark image-mark">
                <img src={brandAssets.appIconSmall} alt="" decoding="async" />
              </div>
              <span><strong>{appDownloadName}</strong><small>{appDownloadUrl.replace(/^https?:\/\//, '')}</small></span>
            </div>
            <footer>
              <button type="button" className="primary" onClick={handleInstallApp}>Install</button>
              <button type="button" onClick={() => setShowInstall(false)}>Cancel</button>
            </footer>
          </section>
        </div>
      ) : null}

      {showHostPanel ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowHostPanel(false)}>
          <section className="buzzcast-host-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Create Live Room</h2>
              <button type="button" onClick={() => setShowHostPanel(false)}>x</button>
            </header>
            <form onSubmit={createRoom} autoComplete="off">
              <label>Room Name</label>
              <input name="new-live-room-name" autoComplete="off" value={roomForm.name} onChange={(event) => updateRoomForm('name', event.target.value)} aria-invalid={Boolean(formErrors.name)} />
              {formErrors.name && <small className="form-error">{formErrors.name}</small>}
              <label>Description</label>
              <textarea value={roomForm.description} onChange={(event) => updateRoomForm('description', event.target.value)} rows={3} aria-invalid={Boolean(formErrors.description)} />
              {formErrors.description && <small className="form-error">{formErrors.description}</small>}
              <label>Room Type</label>
              <div className="buzzcast-choice-grid">
                {Object.entries(roomTypeLabels).map(([value, label]) => (
                  <button key={value} type="button" className={roomForm.room_type === value ? 'active' : ''} onClick={() => updateRoomForm('room_type', value)}>{label}</button>
                ))}
              </div>
              <label>Privacy</label>
              <div className="buzzcast-choice-grid">
                {roomPrivacyOptions.map((option) => (
                  <button key={option.value} type="button" className={roomForm.privacy_type === option.value ? 'active' : ''} onClick={() => updateRoomForm('privacy_type', option.value)}>{option.label}</button>
                ))}
              </div>
              {roomForm.privacy_type === 'password' ? (
                <>
                  <label>Password</label>
                  <input
                    {...roomAccessCodeInputProps}
                    name="new-room-access-code"
                    value={roomForm.password}
                    onChange={(event) => updateRoomForm('password', event.target.value)}
                    aria-invalid={Boolean(formErrors.password)}
                  />
                  {formErrors.password && <small className="form-error">{formErrors.password}</small>}
                </>
              ) : null}
              <div className="buzzcast-host-fields">
                <div>
                  <label>Stage Seats</label>
                  <input type="number" min="1" max={maxSeatsForRoomType(roomForm.room_type)} value={roomForm.max_mic_count} onChange={(event) => updateRoomForm('max_mic_count', event.target.value)} aria-invalid={Boolean(formErrors.max_mic_count)} />
                </div>
                <div>
                  <label>Theme</label>
                  <select value={roomForm.theme} onChange={(event) => updateRoomForm('theme', event.target.value)}>
                    {themeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="buzzcast-toggle-grid">
                {roomFeatureOptions.map((option) => (
                  <label key={option.field}>
                    <input type="checkbox" checked={Boolean(roomForm[option.field])} onChange={(event) => updateRoomForm(option.field, event.target.checked)} />
                    <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  </label>
                ))}
              </div>
              <button className="buzzcast-submit" disabled={creating} type="submit">
                {creating ? <LoadingMovie label="Creating room" inline /> : 'Create Live Room'}
              </button>
              {formErrors.submit ? <small className="form-error submit">{formErrors.submit}</small> : null}
            </form>

            <div className="buzzcast-quick-join">
              <h3>{roomLaunchTitle}</h3>
              {roomLaunchPreview ? (
                <div className={roomLaunchPending ? 'buzzcast-created-room-summary pending' : 'buzzcast-created-room-summary'} role="status" aria-live="polite">
                  <span>{roomLaunchPending ? 'Creating' : 'Ready to open'}</span>
                  <strong>{roomLaunchPreview.name || `Room #${roomLaunchPreview.id}`}</strong>
                  {roomLaunchPending ? (
                    <p className="buzzcast-created-room-note">The request is running. The room ID will appear here automatically.</p>
                  ) : null}
                  <dl>
                    <div>
                      <dt>Room ID</dt>
                      <dd>{createdRoom?.id || 'Creating...'}</dd>
                    </div>
                    <div>
                      <dt>Room Type</dt>
                      <dd>{getRoomMeta(roomLaunchPreview.room_type).label}</dd>
                    </div>
                    <div>
                      <dt>Privacy</dt>
                      <dd>{roomLaunchPreview.privacy_type}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}
              <label>RTC Mode</label>
              <div className="buzzcast-choice-grid">
                {rtcModeOptions.map((option) => {
                  const disabled = option.value === 'video' && !selectedRoomSupportsVideo
                  return (
                    <button key={option.value} type="button" className={joinRtcMode === option.value ? 'active' : ''} onClick={() => updateJoinRtcMode(option.value)} disabled={disabled || roomLaunchPending}>
                      {disabled ? 'Unavailable' : option.label}
                    </button>
                  )
                })}
              </div>
              {!roomLaunchPreview ? (
                <>
                  <label>Room ID</label>
                  <input
                    name="rtc-room-id"
                    inputMode="numeric"
                    autoComplete="off"
                    value={roomId}
                    onChange={(event) => clearSelectedRoomIfManual(event.target.value)}
                    placeholder="Select room or enter ID"
                  />
                  <label>Room Password</label>
                  <input
                    {...roomAccessCodeInputProps}
                    name="rtc-room-password"
                    value={joinPassword}
                    onChange={(event) => setJoinPassword(event.target.value)}
                    placeholder="Only needed for locked rooms"
                  />
                </>
              ) : null}
              <button className="buzzcast-submit secondary" type="button" onClick={joinSelectedRoom} disabled={!canJoinRoom || roomLaunchPending}>{roomLaunchButtonLabel}</button>
            </div>
          </section>
        </div>
      ) : null}

      {showJoinPanel && selectedRoom ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowJoinPanel(false)}>
          <section className="buzzcast-host-panel buzzcast-join-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Join Locked Room</h2>
                <small>{selectedRoom.name || `Room #${selectedRoom.id}`}</small>
              </div>
              <button type="button" onClick={() => setShowJoinPanel(false)}>x</button>
            </header>
            <form className="buzzcast-quick-join" onSubmit={(event) => {
              event.preventDefault()
              joinSelectedRoom()
            }}>
              <label>RTC Mode</label>
              <div className="buzzcast-choice-grid">
                {rtcModeOptions.map((option) => {
                  const disabled = option.value === 'video' && !selectedRoomSupportsVideo
                  return (
                    <button key={option.value} type="button" className={joinRtcMode === option.value ? 'active' : ''} onClick={() => updateJoinRtcMode(option.value)} disabled={disabled}>
                      {disabled ? 'Unavailable' : option.label}
                    </button>
                  )
                })}
              </div>
              <label>Room Password</label>
              <input
                {...roomAccessCodeInputProps}
                name="locked-room-access-code"
                value={joinPassword}
                onChange={(event) => setJoinPassword(event.target.value)}
                placeholder="Enter locked room password"
                autoFocus
              />
              <button className="buzzcast-submit secondary" type="submit" disabled={!canJoinRoom}>
                {openingRoom ? 'Opening...' : 'Open Room'}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {renderSecurityActionModal()}

      {showFeedback ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={closeFeedbackModal}>
          <form className="buzzcast-feedback-modal" onSubmit={submitFeedback} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>Support ticket</span>
                <h2>Submit feedback</h2>
                <p>Share what happened and add a screenshot or recording when it helps support review the issue.</p>
              </div>
              <button type="button" onClick={closeFeedbackModal} disabled={submittingFeedback} aria-label="Close feedback">x</button>
            </header>
            <div className="buzzcast-feedback-row">
              <label htmlFor="feedback-category">
                <span>Category</span>
                <select id="feedback-category" value={feedbackForm.category} onChange={(event) => updateFeedback('category', event.target.value)} disabled={submittingFeedback}>
                  {feedbackCategories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label htmlFor="feedback-type">
                <span>Type</span>
                <select id="feedback-type" value={feedbackForm.type} onChange={(event) => updateFeedback('type', event.target.value)} disabled={submittingFeedback}>
                  {feedbackTypes.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <label htmlFor="feedback-description" className="buzzcast-feedback-field">
              <span>Problem description</span>
              <textarea
                id="feedback-description"
                placeholder="What happened? Which room or action was affected?"
                maxLength={1000}
                value={feedbackForm.description}
                onChange={(event) => updateFeedback('description', event.target.value)}
                disabled={submittingFeedback}
              ></textarea>
              <small>{feedbackForm.description.length}/1000</small>
            </label>
            <span className="buzzcast-feedback-label">Problem screenshot / screen recording <small>(optional)</small></span>
            <div className={`buzzcast-upload-box ${feedbackForm.attachment ? 'has-file' : ''}`}>
              <input id="feedback-attachment" type="file" accept="image/*,video/*" onChange={handleFeedbackAttachment} disabled={submittingFeedback} />
              <label htmlFor="feedback-attachment">
                <strong>{feedbackForm.attachment ? feedbackForm.attachment.name : 'Add screenshot or screen recording'}</strong>
                <small>PNG, JPG, GIF, MP4, or WebM up to 25 MB</small>
              </label>
              {feedbackForm.attachment ? (
                <button type="button" onClick={removeFeedbackAttachment} disabled={submittingFeedback}>Remove</button>
              ) : null}
            </div>
            <label htmlFor="feedback-contact" className="buzzcast-feedback-field">
              <span>Contact information <small>(optional)</small></span>
              <input
                id="feedback-contact"
                placeholder="Email or phone"
                value={feedbackForm.contact}
                onChange={(event) => updateFeedback('contact', event.target.value)}
                disabled={submittingFeedback}
              />
            </label>
            {feedbackStatus ? <p className="buzzcast-feedback-status">{feedbackStatus}</p> : null}
            <footer>
              <button type="button" className="secondary-button" onClick={closeFeedbackModal} disabled={submittingFeedback}>Cancel</button>
              <button type="submit" className="buzzcast-submit" disabled={submittingFeedback}>
                {submittingFeedback ? 'Sending...' : 'Submit'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  )
}
