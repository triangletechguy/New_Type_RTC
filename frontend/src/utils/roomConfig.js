export const roomTypeLabels = {
  audio: 'Music Room',
  youtube_audio: 'YouTube Audio',
  one_to_one_audio: '1:1 Voice',
  video: 'Video Room',
  one_to_one_video: '1:1 Video',
  group_audio: 'Group Music',
  group_video: 'Group Video',
  solo_live: 'Solo Live',
  pk_live: 'PK Live',
}

const roomTypeMeta = {
  audio: { label: 'Music Room', short: 'Music', tone: 'tone-music' },
  youtube_audio: { label: 'YouTube Audio Room', short: 'YouTube', tone: 'tone-music' },
  one_to_one_audio: { label: '1:1 Voice Call', short: 'Voice', tone: 'tone-music' },
  video: { label: 'Video Room', short: 'Video', tone: 'tone-video' },
  one_to_one_video: { label: '1:1 Video Call', short: 'Call', tone: 'tone-video' },
  group_audio: { label: 'Group Music', short: 'Music', tone: 'tone-music' },
  group_video: { label: 'Group Video', short: 'Group', tone: 'tone-video' },
  solo_live: { label: 'Solo Live', short: 'Solo', tone: 'tone-live' },
  pk_live: { label: 'PK Live', short: 'PK', tone: 'tone-pk' },
}

export const liveRoomTypes = ['solo_live', 'pk_live']
export const videoRoomTypes = ['video', 'one_to_one_video', 'group_video']
export const musicRoomTypes = ['audio', 'youtube_audio', 'one_to_one_audio', 'group_audio']
export const videoCapableRoomTypes = [...videoRoomTypes, ...liveRoomTypes]

export const roomFilterOptions = [
  { value: 'all', label: 'All types' },
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
  { field: 'gift_enabled', label: 'Gifts', detail: 'Room reactions' },
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
export const ONE_TO_ONE_ROOM_SEATS = 2

export const defaultRoomForm = {
  name: '',
  description: 'A hosted room for live video, music, chat, and creator collaboration.',
  room_type: 'video',
  privacy_type: 'public',
  password: '',
  max_mic_count: 8,
  theme: defaultRoomTheme,
  chat_enabled: true,
  gift_enabled: false,
  screen_share_enabled: false,
  ai_security_enabled: false,
}

export function getRoomMeta(roomType) {
  return roomTypeMeta[roomType] || { label: roomType || 'Room', short: 'Live', tone: 'tone-live' }
}

export function getRoomTags(room) {
  const tags = []
  if (room.chat_enabled) tags.push('Chat')
  if (room.gift_enabled) tags.push('Gifts')
  if (room.screen_share_enabled) tags.push('Share')
  if (room.ai_security_enabled) tags.push('AI Guard')
  return tags.length ? tags : ['Live']
}

export function roomMatchesFilter(room, filter) {
  if (filter === 'all') return true
  if (filter === 'live') return liveRoomTypes.includes(room.room_type)
  if (filter === 'video') return videoRoomTypes.includes(room.room_type)
  if (filter === 'music') return musicRoomTypes.includes(room.room_type)
  if (filter === 'pk') return room.room_type === 'pk_live'
  return true
}

export function roomSupportsVideo(roomType) {
  return videoCapableRoomTypes.includes(roomType)
}

export function isOneToOneRoom(roomType) {
  return ['one_to_one_audio', 'one_to_one_video'].includes(roomType)
}

export function maxSeatsForRoomType(roomType) {
  return isOneToOneRoom(roomType) ? ONE_TO_ONE_ROOM_SEATS : MAX_ROOM_SEATS
}

export function defaultSeatsForRoomType(roomType) {
  if (isOneToOneRoom(roomType)) return ONE_TO_ONE_ROOM_SEATS
  if (roomType === 'solo_live') return 1
  return 8
}

export function roomAllowsCamera(roomType) {
  return roomSupportsVideo(roomType)
}

export function defaultRtcModeForRoom(room) {
  return roomSupportsVideo(room?.room_type) ? 'video' : 'audio'
}

export function getRoomFlowLabel(roomType) {
  if (['audio', 'youtube_audio', 'group_audio'].includes(roomType)) return 'Music flow'
  if (roomType === 'one_to_one_audio') return '1:1 voice flow'
  if (roomType === 'one_to_one_video') return '1:1 video flow'
  if (roomType === 'pk_live') return 'PK video flow'
  if (roomType === 'solo_live') return 'Solo video flow'
  return 'Video flow'
}

export function getSeatLabel(roomType, count) {
  const seats = Number(count || 0)
  const label = isOneToOneRoom(roomType)
    ? 'call seat'
    : ['audio', 'youtube_audio', 'group_audio'].includes(roomType) ? 'music seat' : 'stage seat'
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
  const maxAllowedSeats = maxSeatsForRoomType(form.room_type)

  if (!name) errors.name = 'Room name is required.'
  if (name && name.length < 3) errors.name = 'Use at least 3 characters.'
  if (name.length > 150) errors.name = 'Keep the room name under 150 characters.'
  if (form.description.length > 700) errors.description = 'Keep the description under 700 characters.'
  if (!Number.isInteger(maxMicCount) || maxMicCount < 1 || maxMicCount > maxAllowedSeats) {
    errors.max_mic_count = isOneToOneRoom(form.room_type)
      ? 'Choose 1 or 2 call seats.'
      : `Choose 1 to ${MAX_ROOM_SEATS} mic seats.`
  }
  if (form.privacy_type === 'password' && password.length < 4) {
    errors.password = 'Use at least 4 characters.'
  }

  return errors
}

export function roomFormPayload(form) {
  const maxMicCount = Math.min(Number(form.max_mic_count), maxSeatsForRoomType(form.room_type))

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    room_type: form.room_type,
    privacy_type: form.privacy_type,
    password: form.privacy_type === 'password' ? form.password.trim() : undefined,
    max_mic_count: Number.isFinite(maxMicCount) ? maxMicCount : defaultSeatsForRoomType(form.room_type),
    theme: form.theme === defaultRoomTheme ? undefined : form.theme,
    chat_enabled: form.chat_enabled,
    gift_enabled: form.gift_enabled,
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
