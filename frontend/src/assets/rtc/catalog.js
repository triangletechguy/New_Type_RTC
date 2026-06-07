import appScreenshots from './brand/app-screenshots.png'

import assetImage2Bars from './asset-image2/smart-bars.png'
import assetImage2CreatorCard from './asset-image2/smart-creator-avatar.png'
import assetImage2Goat from './asset-image2/smart-goat-header.png'
import assetImage2GroupIcon from './asset-image2/smart-group-icon.png'
import assetImage2HomeIcon from './asset-image2/smart-home-icon.png'
import assetImage2LockIcon from './asset-image2/smart-lock-icon.png'
import assetImage2SearchIcon from './asset-image2/smart-search-icon.png'

import liveComposerMic from './live-ui/composer-mic.svg'
import liveComposerPhoto from './live-ui/photo.svg'
import liveSeatLock from './live-ui/seat-lock.svg'
import liveSeatMic from './live-ui/seat-mic.svg'
import liveSend from './live-ui/send.svg'

import avatar01 from './avatars/avatar-01.png'
import avatar02 from './avatars/avatar-02.png'
import avatar03 from './avatars/avatar-03.png'
import avatar04 from './avatars/avatar-04.png'
import avatar05 from './avatars/avatar-05.png'
import avatar06 from './avatars/avatar-06.png'
import avatar07 from './avatars/avatar-07.png'
import avatar08 from './avatars/avatar-08.png'

import sidebarEmpty from './admin/sidebar-empty.png'
import emptySessions from './admin/empty-sessions.png'
import loadingMovie from './loading.gif'

import audioDuet from './rooms/audio-duet.png'
import audioStage from './rooms/audio-stage.png'
import avatarGrid from './rooms/avatar-grid.png'
import cameraOff from './rooms/camera-off.png'
import musicRoom from './rooms/music-room.png'
import passwordRoom from './rooms/password-room.png'
import privateRoom from './rooms/private-room.png'
import soloLive from './rooms/solo-live.png'
import stageMoods from './rooms/stage-moods.png'
import studioStage from './rooms/studio-stage.png'
import videoRoom from './rooms/video-room.png'

export const brandAssets = {
  appIconSmall: assetImage2GroupIcon,
  appScreenshots,
}

export const assetImage2Assets = {
  bars: assetImage2Bars,
  creatorCard: assetImage2CreatorCard,
  goat: assetImage2Goat,
  groupIcon: assetImage2GroupIcon,
  homeIcon: assetImage2HomeIcon,
  lockIcon: assetImage2LockIcon,
  searchIcon: assetImage2SearchIcon,
}

export const liveRoomAssets = {
  composerMic: liveComposerMic,
  composerPhoto: liveComposerPhoto,
  seatLock: liveSeatLock,
  seatMic: liveSeatMic,
  send: liveSend,
}

export const avatarAssets = [
  avatar01,
  avatar02,
  avatar03,
  avatar04,
  avatar05,
  avatar06,
  avatar07,
  avatar08,
]

export const adminAssets = {
  emptySessions,
}

export const roomAssets = {
  audioDuet,
  audioStage,
  avatarGrid,
  cameraOff,
  musicRoom,
  passwordRoom,
  privateRoom,
  sidebarEmpty,
  soloLive,
  stageMoods,
  studioStage,
  videoRoom,
}

export const loadingAssets = {
  movie: loadingMovie,
}

const coverRotation = [
  videoRoom,
  musicRoom,
  soloLive,
  studioStage,
  audioStage,
  audioDuet,
  stageMoods,
  avatarGrid,
]

const toneCovers = {
  amber: musicRoom,
  aurora: videoRoom,
  cloud: avatarGrid,
  copper: audioDuet,
  earth: studioStage,
  ember: stageMoods,
  game: videoRoom,
  mid: audioStage,
  night: studioStage,
  ocean: videoRoom,
  olive: musicRoom,
  pink: soloLive,
  plum: audioDuet,
  rose: soloLive,
  sand: stageMoods,
  sensitive: privateRoom,
  silver: avatarGrid,
  sky: videoRoom,
  slate: audioStage,
  storm: stageMoods,
  sunset: soloLive,
  taupe: studioStage,
  violet: videoRoom,
  warm: musicRoom,
  wine: privateRoom,
}

function safeIndex(index, length) {
  const numericIndex = Number(index)
  if (!Number.isFinite(numericIndex) || length <= 0) return 0
  return Math.abs(Math.trunc(numericIndex)) % length
}

const initialAvatarThemes = [
  ['#9259fe', '#6365ff'],
  ['#f97316', '#ef4444'],
  ['#06b6d4', '#2563eb'],
  ['#22c55e', '#0f766e'],
  ['#ec4899', '#8b5cf6'],
  ['#f59e0b', '#dc2626'],
  ['#14b8a6', '#7c3aed'],
  ['#64748b', '#111827'],
]

function hashString(value) {
  return Array.from(String(value || 'User')).reduce((hash, character) => {
    return ((hash << 5) - hash + character.charCodeAt(0)) | 0
  }, 0)
}

function escapeSvgText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function avatarLabelForProfile(profile = {}) {
  return profile.full_name
    || profile.fullName
    || profile.name
    || profile.user_name
    || profile.sender_name
    || profile.peer_name
    || profile.display_name
    || profile.displayName
    || profile.nick_name
    || profile.nickname
    || profile.email
    || profile.sender_email
    || profile.peer_email
    || 'User'
}

export function avatarInitialFromName(name) {
  const value = String(name || 'User').trim()
  const label = (value.includes('@') ? value.split('@')[0] : value).replace(/^[@#]+/, '').trim()
  return Array.from(label)[0]?.toLocaleUpperCase() || 'U'
}

export function initialAvatarForName(name = 'User', fallbackIndex = 0) {
  const label = String(name || 'User').trim() || 'User'
  const initial = escapeSvgText(avatarInitialFromName(label))
  const colorIndex = safeIndex(hashString(`${label}-${fallbackIndex}`), initialAvatarThemes.length)
  const [startColor, endColor] = initialAvatarThemes[colorIndex]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="${initial} avatar"><defs><linearGradient id="bg" x1="24" y1="18" x2="176" y2="182" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${startColor}"/><stop offset="1" stop-color="${endColor}"/></linearGradient></defs><rect width="200" height="200" rx="100" fill="url(#bg)"/><circle cx="100" cy="100" r="86" fill="rgba(255,255,255,.1)"/><circle cx="142" cy="54" r="28" fill="rgba(255,255,255,.16)"/><text x="100" y="108" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="Inter, Arial, sans-serif" font-size="92" font-weight="800">${initial}</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export function initialAvatarForUser(user = {}, fallbackIndex = 0) {
  const profile = user || {}
  const seed = profile.id
    || profile.user_id
    || profile.userId
    || profile.sender_id
    || profile.peer_id
    || fallbackIndex

  return initialAvatarForName(avatarLabelForProfile(profile), seed)
}

export function avatarForIndex(index = 0) {
  return avatarAssets[safeIndex(index, avatarAssets.length)]
}

export function avatarForGender(gender, fallbackIndex = 0) {
  return initialAvatarForName('User', fallbackIndex)
}

function avatarRoleNames(user = {}) {
  return (Array.isArray(user.roles) ? user.roles : [])
    .map((role) => (typeof role === 'string' ? role : role?.name || role?.role || ''))
    .filter(Boolean)
}

export function avatarForUser(user = {}, fallbackIndex = 0) {
  const profile = user || {}
  const avatar = [
    profile.avatar_url,
    profile.avatarUrl,
    profile.sender_avatar_url,
    profile.peer_avatar_url,
    profile.user_avatar_url,
  ].map((value) => String(value || '').trim()).find(Boolean) || ''
  if (avatar) return avatar

  const roles = avatarRoleNames(profile)
  const adminUser = roles.some((role) => ['super_admin', 'client_admin', 'admin'].includes(role))
    || profile.is_super_admin === true
    || profile.isSuperAdmin === true

  if (adminUser) return initialAvatarForUser(profile, fallbackIndex)

  return initialAvatarForUser(profile, fallbackIndex)
}

export function coverForDemoTone(tone, index = 0) {
  return toneCovers[tone] || coverRotation[safeIndex(index, coverRotation.length)]
}

export function coverForRoomType(roomType, privacyType, index = 0) {
  if (privacyType === 'password') return passwordRoom
  if (privacyType === 'private') return privateRoom

  if (roomType === 'audio') return musicRoom
  if (roomType === 'youtube_audio') return musicRoom
  if (roomType === 'one_to_one_audio') return audioDuet
  if (roomType === 'group_audio') return audioDuet
  if (roomType === 'group_video') return videoRoom
  if (roomType === 'solo_live') return soloLive
  if (roomType === 'pk_live') return studioStage
  if (roomType === 'one_to_one_video') return videoRoom
  if (roomType === 'video') return videoRoom

  return coverRotation[safeIndex(index, coverRotation.length)]
}
