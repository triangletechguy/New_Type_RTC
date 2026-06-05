export const roomTypeLabels = {
  audio: 'Music Room',
  video: 'Video Room',
  group_audio: 'Group Music',
  group_video: 'Group Video',
  solo_live: 'Solo Live',
  pk_live: 'PK Live',
}

const roomTypeMeta = {
  audio: { label: 'Music Room', short: 'Music', tone: 'tone-music' },
  video: { label: 'Video Room', short: 'Video', tone: 'tone-video' },
  group_audio: { label: 'Group Music', short: 'Music', tone: 'tone-music' },
  group_video: { label: 'Group Video', short: 'Group', tone: 'tone-video' },
  solo_live: { label: 'Solo Live', short: 'Solo', tone: 'tone-live' },
  pk_live: { label: 'PK Live', short: 'PK', tone: 'tone-pk' },
}

export const roomFilterOptions = [
  { value: 'all', label: 'For You' },
  { value: 'live', label: 'Live' },
  { value: 'video', label: 'Video' },
  { value: 'music', label: 'Music' },
  { value: 'pk', label: 'PK' },
]

export const roomSortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'active', label: 'Most active' },
  { value: 'name', label: 'Name' },
  { value: 'oldest', label: 'Oldest' },
]

export const privacyFilterOptions = [
  { value: 'all', label: 'All access' },
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'password', label: 'Password' },
]

export const roomPrivacyOptions = privacyFilterOptions.slice(1)

export const themeOptions = [
  { value: 'neon', label: 'Neon' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'studio', label: 'Studio' },
  { value: 'mint', label: 'Mint' },
]

export const roomFeatureOptions = [
  { field: 'chat_enabled', label: 'Chat', detail: 'Live messages' },
  { field: 'screen_share_enabled', label: 'Screen share', detail: 'Presenter tools' },
  { field: 'ai_security_enabled', label: 'AI guard', detail: 'Moderation layer' },
]

export const rtcModeOptions = [
  { value: 'audio', label: 'Music', detail: 'Mic stage' },
  { value: 'video', label: 'Video', detail: 'Mic + camera' },
]

export const rtcConnectSteps = [
  { value: 'ready', label: 'Ready' },
  { value: 'backend', label: 'Room' },
  { value: 'media', label: 'Media' },
  { value: 'signaling', label: 'Signal' },
  { value: 'connected', label: 'Live' },
]

export const stageLayoutOptions = [
  { value: 'grid', label: 'Grid' },
  { value: 'focus', label: 'Focus' },
  { value: 'cinema', label: 'Cinema' },
  { value: 'side', label: 'Side' },
]

const defaultRoomTheme = 'neon'

export const MAX_ROOM_SEATS = 20

export const defaultRoomForm = {
  name: '',
  description: 'A hosted room for live video, music, chat, and creator collaboration.',
  room_type: 'video',
  privacy_type: 'public',
  password: '',
  max_mic_count: 8,
  theme: defaultRoomTheme,
  chat_enabled: true,
  screen_share_enabled: false,
  ai_security_enabled: false,
}

export function getRoomMeta(roomType) {
  return roomTypeMeta[roomType] || { label: roomType || 'Room', short: 'Live', tone: 'tone-live' }
}

export function getRoomTags(room) {
  const tags = []
  if (room.chat_enabled) tags.push('Chat')
  if (room.screen_share_enabled) tags.push('Share')
  if (room.ai_security_enabled) tags.push('AI Guard')
  return tags.length ? tags : ['Live']
}

export function roomMatchesFilter(room, filter) {
  if (filter === 'all') return true
  if (filter === 'live') return ['video', 'group_video', 'solo_live', 'pk_live'].includes(room.room_type)
  if (filter === 'video') return ['video', 'group_video', 'solo_live', 'pk_live'].includes(room.room_type)
  if (filter === 'music') return ['audio', 'group_audio'].includes(room.room_type)
  if (filter === 'pk') return room.room_type === 'pk_live'
  return true
}

export function roomSupportsVideo(roomType) {
  return ['video', 'group_video', 'solo_live', 'pk_live'].includes(roomType)
}

export function roomAllowsCamera(roomType) {
  return roomSupportsVideo(roomType)
}

export function defaultRtcModeForRoom(room) {
  return roomSupportsVideo(room?.room_type) ? 'video' : 'audio'
}

export function getRoomFlowLabel(roomType) {
  if (['audio', 'group_audio'].includes(roomType)) return 'Music flow'
  if (roomType === 'pk_live') return 'PK video flow'
  if (roomType === 'solo_live') return 'Solo video flow'
  return 'Video flow'
}

export function getSeatLabel(roomType, count) {
  const seats = Number(count || 0)
  const label = ['audio', 'group_audio'].includes(roomType) ? 'music seat' : 'stage seat'
  return `${seats} ${label}${seats === 1 ? '' : 's'}`
}

export function normalizeRtcMode(value, room) {
  const nextMode = value === 'audio' ? 'audio' : 'video'
  if (room && !roomSupportsVideo(room.room_type)) return 'audio'
  return nextMode
}

function normalizeMediaMode(value) {
  return ['real', 'auto', 'mock'].includes(value) ? value : 'real'
}

export function getInitialMediaMode() {
  const configuredMode = normalizeMediaMode(import.meta.env.VITE_MEDIA_MODE)
  if (import.meta.env.VITE_MEDIA_MODE) return configuredMode
  return 'real'
}

export function isLocalBrowserHost() {
  if (typeof window === 'undefined') return true
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
}

export function formatRoomDate(value) {
  if (!value) return 'New'

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return 'New'
  }
}

export function buildRoomsPath({ page, search, filter, privacy, sort, feed, region }) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: '24',
    type: filter,
    privacy,
    sort,
  })

  const searchTerm = search.trim()
  if (searchTerm) params.set('q', searchTerm)
  if (feed) params.set('feed', feed)
  if (region) params.set('region', region)

  return `/rooms?${params.toString()}`
}

export function validateRoomForm(form) {
  const errors = {}
  const name = form.name.trim()
  const password = form.password.trim()
  const maxMicCount = Number(form.max_mic_count)

  if (!name) errors.name = 'Room name is required.'
  if (name && name.length < 3) errors.name = 'Use at least 3 characters.'
  if (name.length > 150) errors.name = 'Keep the room name under 150 characters.'
  if (form.description.length > 700) errors.description = 'Keep the description under 700 characters.'
  if (!Number.isInteger(maxMicCount) || maxMicCount < 1 || maxMicCount > MAX_ROOM_SEATS) {
    errors.max_mic_count = `Choose 1 to ${MAX_ROOM_SEATS} mic seats.`
  }
  if (form.privacy_type === 'password' && password.length < 4) {
    errors.password = 'Use at least 4 characters.'
  }

  return errors
}

export function roomFormPayload(form) {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    room_type: form.room_type,
    privacy_type: form.privacy_type,
    password: form.privacy_type === 'password' ? form.password.trim() : undefined,
    max_mic_count: Number(form.max_mic_count),
    theme: form.theme === defaultRoomTheme ? undefined : form.theme,
    chat_enabled: form.chat_enabled,
    screen_share_enabled: form.screen_share_enabled,
    ai_security_enabled: form.ai_security_enabled,
  }
}

export function isPasswordJoinError(error) {
  return error?.status === 403 && String(error.message || '').toLowerCase().includes('password')
}

function signalBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

export function peerMediaFromSignal(user) {
  const rtcMode = user?.rtcMode === 'audio' ? 'audio' : 'video'
  return {
    userId: user?.userId || null,
    userName: user?.userName || 'Remote User',
    gender: user?.userGender || user?.gender || '',
    avatarUrl: user?.userAvatarUrl || user?.avatarUrl || user?.avatar_url || '',
    rtcMode,
    micOn: signalBoolean(user?.micEnabled, true),
    cameraOn: rtcMode === 'video' && signalBoolean(user?.cameraEnabled, false),
    screenShared: signalBoolean(user?.screenShared, false),
  }
}

export function peerMediaMapFromUsers(users = []) {
  return users.reduce((next, user) => {
    if (user?.socketId) next[user.socketId] = peerMediaFromSignal(user)
    return next
  }, {})
}
