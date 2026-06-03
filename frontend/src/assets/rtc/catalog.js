import appIcon from './brand/app-icon.png'
import appScreenshots from './brand/app-screenshots.png'
import brandGuide from './brand/brand-guide.png'
import logoWordmark from './brand/logo-wordmark.png'

import assetImage2Bars from './asset-image2/smart-bars.png'
import assetImage2CreatorCard from './asset-image2/smart-creator-avatar.png'
import assetImage2Goat from './asset-image2/smart-goat-header.png'
import assetImage2GroupIcon from './asset-image2/smart-group-icon.png'
import assetImage2HomeIcon from './asset-image2/smart-home-icon.png'
import assetImage2LockIcon from './asset-image2/smart-lock-icon.png'
import assetImage2SearchIcon from './asset-image2/smart-search-icon.png'

import liveComposerMic from './live-ui/composer-mic.svg'
import liveComposerPhoto from './live-ui/photo.svg'
import liveRailLive from './live-ui/rail-live.svg'
import liveRailMoments from './live-ui/rail-moments.svg'
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
import controlGrid from './admin/control-grid.png'
import statusColors from './admin/status-colors.png'
import emptySessions from './admin/empty-sessions.png'

import mobileChat from './chat/mobile-chat.png'
import messageStates from './chat/message-states.png'
import reactions from './chat/reactions.png'

import audioDuet from './rooms/audio-duet.png'
import audioStage from './rooms/audio-stage.png'
import avatarGrid from './rooms/avatar-grid.png'
import cameraOff from './rooms/camera-off.png'
import connectionStatus from './rooms/connection-status.png'
import mediaStates from './rooms/media-states.png'
import musicRoom from './rooms/music-room.png'
import passwordRoom from './rooms/password-room.png'
import privateRoom from './rooms/private-room.png'
import soloLive from './rooms/solo-live.png'
import stageMoods from './rooms/stage-moods.png'
import studioStage from './rooms/studio-stage.png'
import videoRoom from './rooms/video-room.png'

export const brandAssets = {
  appIcon,
  appScreenshots,
  brandGuide,
  logoWordmark,
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
  railLive: liveRailLive,
  railMoments: liveRailMoments,
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
  controlGrid,
  emptySessions,
  sidebarEmpty,
  statusColors,
}

export const chatAssets = {
  messageStates,
  mobileChat,
  reactions,
}

export const roomAssets = {
  audioDuet,
  audioStage,
  avatarGrid,
  cameraOff,
  connectionStatus,
  mediaStates,
  musicRoom,
  passwordRoom,
  privateRoom,
  soloLive,
  stageMoods,
  studioStage,
  videoRoom,
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
  mono: connectionStatus,
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

export function avatarForIndex(index = 0) {
  return avatarAssets[safeIndex(index, avatarAssets.length)]
}

export function avatarForGender(gender, fallbackIndex = 0) {
  const normalizedGender = String(gender || '').trim().toLowerCase()
  if (normalizedGender === 'male') return avatarAssets[0]
  if (normalizedGender === 'female') return avatarAssets[1]
  return avatarForIndex(fallbackIndex)
}

export function coverForDemoTone(tone, index = 0) {
  return toneCovers[tone] || coverRotation[safeIndex(index, coverRotation.length)]
}

export function coverForRoomType(roomType, privacyType, index = 0) {
  if (privacyType === 'password') return passwordRoom
  if (privacyType === 'private') return privateRoom

  if (roomType === 'audio') return musicRoom
  if (roomType === 'group_audio') return audioDuet
  if (roomType === 'group_video') return videoRoom
  if (roomType === 'solo_live') return soloLive
  if (roomType === 'pk_live') return studioStage
  if (roomType === 'video') return videoRoom

  return coverRotation[safeIndex(index, coverRotation.length)]
}
