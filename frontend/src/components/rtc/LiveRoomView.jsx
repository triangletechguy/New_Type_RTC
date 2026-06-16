import { useEffect, useMemo, useRef, useState } from 'react'
import { actionAvatarAssets, avatarForUser, brandAssets, coverForRoomType, liveRoomAssets, roomAssets } from '../../assets/rtc/catalog'
import { apiRequest, getRtcConfig } from '../../services/api'
import { createLocalMediaStream, requestLocalMediaTrack, stopMediaStream } from '../../services/media'
import { NativeRtcClient } from '../../services/rtcClient'
import { createSignalingSocket, emitMediaState, joinSignalingRoom, requestSignalingPeers, waitForSocketConnection } from '../../services/signaling'
import {
  BEAUTY_CONTROLS,
  CameraFilterPipeline,
  DEFAULT_BACKGROUND_BLUR_AMOUNT,
  DEFAULT_BEAUTY_SETTINGS,
  VIDEO_FILTERS,
  getBackgroundEffect,
  getVideoFilter,
  isBackgroundEffectActive,
  isBeautySettingsActive,
  isCameraFilterEffectActive,
  isVideoFilterActive,
  normalizeBackgroundEffectId,
  normalizeBackgroundBlurAmount,
  normalizeBeautySettings,
  normalizeVideoFilterId,
  supportsCameraFilterPipeline,
} from '../../services/videoFilters'
import {
  defaultSeatsForRoomType,
  defaultRtcModeForRoom,
  getRoomMeta,
  getInitialMediaMode,
  isLocalBrowserHost,
  isPasswordJoinError,
  maxSeatsForRoomType,
  normalizeRtcMode,
  peerMediaFromSignal,
  peerMediaMapFromUsers,
} from '../../utils/roomConfig'
import { analyzeRoomTextForGuard, isAiGuardEnabled } from '../../utils/aiGuard'
import { ChatPanel } from './ChatPanel'
import { VideoTile } from './VideoTile'
import { LoadingMovie } from '../common/LoadingMovie'
import { translateApp } from '../rooms/roomsStaticData'

const LOCAL_MEDIA_FAST_TIMEOUT_MS = 7000
const RTC_PRESENCE_INTERVAL_MS = 20000
const RTC_QUALITY_REPORT_INTERVAL_MS = 30000
const RTC_VIDEO_WATCHDOG_DELAY_MS = 7000
const RTC_VIDEO_WATCHDOG_FINAL_DELAY_MS = 7000
const RTC_AUDIO_WATCHDOG_DELAY_MS = 4500
const RTC_AUDIO_WATCHDOG_FINAL_DELAY_MS = 5000
const RTC_AUDIO_WATCHDOG_MAX_ATTEMPTS = 2
const RTC_NEGOTIATION_RETRY_DELAY_MS = 2000
const RTC_NEGOTIATION_RETRY_MAX_ATTEMPTS = 3
const RTC_LOCAL_SENDER_WATCHDOG_DELAY_MS = 8000
const RTC_LOCAL_SENDER_WATCHDOG_INTERVAL_MS = 6000
const RTC_LOCAL_SENDER_WATCHDOG_MAX_ATTEMPTS = 2
const RTC_CAMERA_TARGET_KBPS = 300
const RTC_SCREEN_TARGET_KBPS = 600
const RTC_GROUP_CAMERA_TARGET_KBPS = 240
const RTC_LARGE_CAMERA_TARGET_KBPS = 180
const RTC_FULL_ROOM_CAMERA_TARGET_KBPS = 120
const RTC_LARGE_SCREEN_TARGET_KBPS = 450
const STAGE_RESIZE_GAP_PX = 14
const STAGE_RESIZE_DEFAULT_TILE_WIDTH = 220
const STAGE_RESIZE_MIN_TILE_HEIGHT = 150
const VOICE_EFFECT_IDS = ['natural', 'clear', 'deep', 'bright']
const roomAccessCodeInputProps = {
  type: 'text',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  className: 'room-access-code-input',
}
const ROOM_ROLE_RANK = {
  end_user: 0,
  audience: 0,
  speaker: 0,
  moderator: 1,
  admin: 2,
  owner: 3,
}
const STAGE_PUBLISH_ROLES = new Set(['owner', 'admin', 'moderator', 'speaker'])

function createReceiveOnlyStream() {
  return typeof MediaStream === 'function' ? new MediaStream() : null
}

function canPublishStageRole(role) {
  return STAGE_PUBLISH_ROLES.has(roomRoleName(role))
}

function stageAccessFromParticipant(participant = {}) {
  const role = roomRoleName(participant.role_in_room || participant.session_role_in_room || 'audience')
  const canPublish = participant.stage_access?.can_publish
    ?? participant.capabilities?.can_publish_media
    ?? canPublishStageRole(role)

  return {
    role,
    canPublish: Boolean(canPublish),
    requestsEnabled: participant.stage_access?.requests_enabled !== false,
    status: participant.stage_access?.status || (canPublish ? 'approved' : 'audience'),
  }
}

function stageAccessFromRtc(joinData = {}) {
  const access = joinData.rtc?.stage_access
  const role = roomRoleName(access?.role || joinData.participant?.role_in_room || 'audience')
  const canPublish = access?.can_publish
    ?? joinData.rtc?.role_capabilities?.can_publish_media
    ?? canPublishStageRole(role)

  return {
    role,
    canPublish: Boolean(canPublish),
    requestsEnabled: access?.requests_enabled !== false,
    status: access?.status || (canPublish ? 'approved' : 'audience'),
  }
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max)
}

function stageTileCountClass(count) {
  const tileCount = Number(count || 0)
  if (tileCount <= 0) return 'tile-count-empty'
  if (tileCount === 1) return 'tile-count-one'
  if (tileCount === 2) return 'tile-count-two'
  if (tileCount === 3) return 'tile-count-three'
  if (tileCount === 4) return 'tile-count-four'
  return 'tile-count-many'
}

function stageColumnCount(count, width) {
  const tileCount = Number(count || 0)
  if (tileCount <= 1) return 1
  if (tileCount <= 4) return 2
  const roughColumns = Math.floor((Number(width) + STAGE_RESIZE_GAP_PX) / (STAGE_RESIZE_DEFAULT_TILE_WIDTH + STAGE_RESIZE_GAP_PX))
  return clampNumber(roughColumns, 2, 4)
}

function stageRowCount(count, width) {
  const tileCount = Number(count || 0)
  if (tileCount <= 0) return 1
  if (tileCount === 3) return 2
  return Math.max(1, Math.ceil(tileCount / stageColumnCount(tileCount, width)))
}

function stageTileHeightForFrame(size, count) {
  if (!size) return null
  const rows = stageRowCount(count, size.width)
  const availableHeight = Number(size.height || 0) - ((rows - 1) * STAGE_RESIZE_GAP_PX)
  return Math.max(STAGE_RESIZE_MIN_TILE_HEIGHT, Math.floor(availableHeight / rows))
}

function LiveRailIcon() {
  return (
    <svg className="buzzcast-svg-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <path d="M5 7.5a2.5 2.5 0 0 1 2.5-2.5h8.7a2.5 2.5 0 0 1 2.5 2.5v1.82l3.2-2.02A1.35 1.35 0 0 1 24 8.44v11.12a1.35 1.35 0 0 1-2.1 1.14l-3.2-2.02v1.82a2.5 2.5 0 0 1-2.5 2.5H7.5A2.5 2.5 0 0 1 5 20.5v-13Zm2 0v13c0 .28.22.5.5.5h8.7a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5H7.5a.5.5 0 0 0-.5.5Zm11.7 4.18v4.64l3.3 2.08V9.6l-3.3 2.08Z" />
      <path d="M11.2 10.15a1 1 0 0 1 1.03.05l3.4 2.35a1 1 0 0 1 0 1.64l-3.4 2.36a1 1 0 0 1-1.57-.82V11a1 1 0 0 1 .54-.86Zm1.46 2.76v1.91l1.38-.95-1.38-.96Z" />
    </svg>
  )
}

function MeRailIcon() {
  return (
    <svg className="buzzcast-svg-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 2.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Zm0 1.7a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z" />
      <path d="M4.2 17.6a5.8 5.8 0 1 1 11.6 0 .85.85 0 0 1-1.7 0 4.1 4.1 0 0 0-8.2 0 .85.85 0 0 1-1.7 0Z" />
    </svg>
  )
}

function formatRtcBitrate(value) {
  const number = Number(value || 0)
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)} Mb/s`
  return `${Math.max(0, Math.round(number))} kb/s`
}

function rtcVideoTargetKbps({ expectedPeers, screenSharing }) {
  const peerCount = Number(expectedPeers || 0)
  if (screenSharing) return peerCount >= 12 ? RTC_LARGE_SCREEN_TARGET_KBPS : RTC_SCREEN_TARGET_KBPS
  if (peerCount >= 18) return RTC_FULL_ROOM_CAMERA_TARGET_KBPS
  if (peerCount >= 12) return RTC_LARGE_CAMERA_TARGET_KBPS
  if (peerCount >= 6) return RTC_GROUP_CAMERA_TARGET_KBPS
  return RTC_CAMERA_TARGET_KBPS
}

function formatRtcLatency(value) {
  const number = Number(value || 0)
  return number > 0 ? `${Math.round(number)} ms` : '--'
}

function formatRtcLoss(value) {
  const number = Number(value || 0)
  return `${number.toFixed(number > 0 && number < 10 ? 1 : 0)}%`
}

function formatCompactCount(value) {
  const number = Number(value || 0)
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`
  return String(Math.max(0, Math.trunc(number)))
}

function hasInboundVideoTrack(stream) {
  return stream?.getVideoTracks?.().some((track) => track.readyState !== 'ended') || false
}

function hasInboundAudioTrack(stream) {
  return stream?.getAudioTracks?.().some((track) => (
    track.readyState !== 'ended'
    && track.muted !== true
  )) || false
}

function remoteVideoExpectedFromState(mediaState = {}) {
  if (mediaState.screenShared === true) return true
  return String(mediaState.rtcMode || 'video') !== 'audio' && mediaState.cameraOn === true
}

function worstRtcQuality(statsList) {
  const order = ['failed', 'poor', 'degraded', 'fair', 'connecting', 'idle', 'unknown', 'good']
  return statsList.reduce((worst, stats) => {
    const quality = stats?.quality || 'unknown'
    return order.indexOf(quality) < order.indexOf(worst) ? quality : worst
  }, 'good')
}

function summarizeRtcHealth({ joined, remotePeerCount, peerStates, peerStats, rtcMode = 'video', cameraOn = false, screenSharing = false }) {
  if (!joined) {
    return {
      quality: 'idle',
      label: 'RTC ready',
      detail: 'Connect to start media diagnostics',
      incoming: '0 kb/s',
      outgoing: '0 kb/s',
      videoIncoming: '0 kb/s',
      videoOutgoing: '0 kb/s',
      rtt: '--',
      loss: '0%',
    }
  }

  const expectedPeers = Math.max(remotePeerCount || 0, Object.keys(peerStates || {}).length)
  if (!expectedPeers) {
    return {
      quality: 'good',
      label: 'RTC ready',
      detail: 'Waiting for another user',
      incoming: '0 kb/s',
      outgoing: '0 kb/s',
      videoIncoming: '0 kb/s',
      videoOutgoing: '0 kb/s',
      rtt: '--',
      loss: '0%',
    }
  }

  const statsList = Object.values(peerStats || {}).filter(Boolean)
  if (!statsList.length) {
    return {
      quality: 'connecting',
      label: 'Measuring RTC',
      detail: `${expectedPeers} peer${expectedPeers === 1 ? '' : 's'} negotiating`,
      incoming: '0 kb/s',
      outgoing: '0 kb/s',
      videoIncoming: '0 kb/s',
      videoOutgoing: '0 kb/s',
      rtt: '--',
      loss: '0%',
    }
  }

  const incomingKbps = statsList.reduce((total, stats) => total + Number(stats.incomingKbps || 0), 0)
  const outgoingKbps = statsList.reduce((total, stats) => total + Number(stats.outgoingKbps || 0), 0)
  const inboundVideoKbps = sumMediaBitrate(statsList, 'inbound', 'video')
  const outboundVideoKbps = sumMediaBitrate(statsList, 'outbound', 'video')
  const packetLossPct = Math.max(...statsList.map((stats) => Number(stats.packetLossPct || 0)))
  const latencySamples = statsList.map((stats) => Number(stats.rttMs || 0)).filter((value) => value > 0)
  const rttMs = latencySamples.length
    ? latencySamples.reduce((total, value) => total + value, 0) / latencySamples.length
    : 0
  const videoTargetKbps = rtcVideoTargetKbps({ expectedPeers, screenSharing })
  const expectsOutboundVideo = rtcMode === 'video' && (cameraOn || screenSharing)
  const videoBelowTarget = expectsOutboundVideo && outboundVideoKbps < videoTargetKbps
  const quality = videoBelowTarget ? 'fair' : worstRtcQuality(statsList)
  const qualityLabel = {
    failed: 'RTC failed',
    poor: 'RTC poor',
    degraded: 'RTC degraded',
    fair: videoBelowTarget ? 'RTC video low' : 'RTC fair',
    connecting: 'RTC connecting',
    idle: 'RTC idle',
    unknown: 'RTC measuring',
    good: 'RTC healthy',
  }[quality] || 'RTC measuring'

  return {
    quality,
    label: qualityLabel,
    detail: videoBelowTarget
      ? `Video out ${formatRtcBitrate(outboundVideoKbps)} / target ${formatRtcBitrate(videoTargetKbps)}`
      : `${statsList.length}/${expectedPeers} peer${expectedPeers === 1 ? '' : 's'} measured`,
    incoming: formatRtcBitrate(incomingKbps),
    outgoing: formatRtcBitrate(outgoingKbps),
    videoIncoming: formatRtcBitrate(inboundVideoKbps),
    videoOutgoing: formatRtcBitrate(outboundVideoKbps),
    rtt: formatRtcLatency(rttMs),
    loss: formatRtcLoss(packetLossPct),
  }
}

function numericStat(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function roundedStat(value, precision = 2) {
  const factor = 10 ** precision
  return Math.round(Math.max(0, numericStat(value)) * factor) / factor
}

function compactPeerStates(peerStates = {}) {
  return Object.values(peerStates || {}).reduce((counts, state) => {
    const key = String(state || 'unknown').slice(0, 32)
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}

function uniqueStatValues(statsList, key) {
  return Array.from(new Set(
    statsList
      .map((stats) => String(stats?.[key] || '').trim())
      .filter(Boolean)
      .slice(0, 8)
  ))
}

function roomRoleName(value) {
  const text = String(value || '').trim()
  return text || 'User'
}

function roomRoleRankValue(value) {
  return ROOM_ROLE_RANK[String(value || 'end_user').trim().toLowerCase()] ?? 0
}

function canModerateRoomRole(actorRole, targetRole) {
  return roomRoleRankValue(actorRole) > roomRoleRankValue(targetRole)
}

function roomRoleOptionLabel(target) {
  if (!target) return 'Select user'
  return target.email ? `${target.name} (${target.email})` : target.name
}

function buildRoomRoleTargets(roomControls) {
  const ownerId = Number(roomControls?.room?.owner_id || 0)
  const targets = new Map()

  function upsert({ userId, name, email = '', active = false, currentRole = '' }) {
    const normalizedUserId = Number(userId || 0)
    if (!normalizedUserId || normalizedUserId === ownerId) return

    const key = String(normalizedUserId)
    const fallbackName = `User #${normalizedUserId}`
    const previous = targets.get(key) || {
      userId: key,
      name: fallbackName,
      email: '',
      active: false,
      currentRole: '',
    }
    const nextName = roomRoleName(name || previous.name || fallbackName)

    targets.set(key, {
      ...previous,
      name: previous.name === fallbackName ? nextName : previous.name,
      email: previous.email || email || '',
      active: previous.active || active,
      currentRole: currentRole || previous.currentRole,
    })
  }

  for (const assignableUser of roomControls?.assignable_users || []) {
    upsert({
      userId: assignableUser.id,
      name: assignableUser.name,
      email: assignableUser.email,
    })
  }

  for (const participant of roomControls?.participants || []) {
    upsert({
      userId: participant.user_id,
      name: participant.user_name,
      email: participant.user_email,
      active: true,
    })
  }

  for (const role of roomControls?.roles || []) {
    if (!['admin', 'moderator'].includes(role.role)) continue
    upsert({
      userId: role.user_id,
      name: role.user_name,
      email: role.user_email,
      currentRole: role.role,
    })
  }

  return Array.from(targets.values()).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function sumMediaBitrate(statsList, direction, kind) {
  return statsList.reduce((total, stats) => total + numericStat(stats?.media?.[direction]?.[kind]?.bitrateKbps), 0)
}

function buildRtcQualityPayload({ rtcHealth, remotePeerCount, peerStates, peerStats }) {
  const statsList = Object.values(peerStats || {}).filter(Boolean)
  const peerStateCount = Object.keys(peerStates || {}).length
  const expectedPeerCount = Math.max(remotePeerCount || 0, peerStateCount, statsList.length)
  const latencySamples = statsList.map((stats) => numericStat(stats.rttMs)).filter((value) => value > 0)
  const availableOutgoingSamples = statsList
    .map((stats) => numericStat(stats.availableOutgoingKbps))
    .filter((value) => value > 0)

  return {
    quality: rtcHealth?.quality || 'unknown',
    peer_count: expectedPeerCount,
    measured_peer_count: statsList.length,
    incoming_kbps: roundedStat(statsList.reduce((total, stats) => total + numericStat(stats.incomingKbps), 0)),
    outgoing_kbps: roundedStat(statsList.reduce((total, stats) => total + numericStat(stats.outgoingKbps), 0)),
    rtt_ms: roundedStat(latencySamples.length
      ? latencySamples.reduce((total, value) => total + value, 0) / latencySamples.length
      : 0),
    packet_loss_pct: roundedStat(Math.max(0, ...statsList.map((stats) => numericStat(stats.packetLossPct)))),
    available_outgoing_kbps: roundedStat(availableOutgoingSamples.length ? Math.min(...availableOutgoingSamples) : 0),
    local_candidate_types: uniqueStatValues(statsList, 'localCandidateType'),
    remote_candidate_types: uniqueStatValues(statsList, 'remoteCandidateType'),
    peer_states: compactPeerStates(peerStates),
    media: {
      inbound_audio_kbps: roundedStat(sumMediaBitrate(statsList, 'inbound', 'audio')),
      inbound_video_kbps: roundedStat(sumMediaBitrate(statsList, 'inbound', 'video')),
      outbound_audio_kbps: roundedStat(sumMediaBitrate(statsList, 'outbound', 'audio')),
      outbound_video_kbps: roundedStat(sumMediaBitrate(statsList, 'outbound', 'video')),
    },
  }
}

export function LiveRoomView({ roomId, roomPassword = '', initialRoom = null, initialRtcMode = 'video', autoConnect = false, user, language = 'English', onBack, onProfile }) {
  const [status, setStatus] = useState(autoConnect ? 'Connecting RTC...' : 'Ready to connect')
  const [joining, setJoining] = useState(false)
  const [joined, setJoinedState] = useState(false)
  const [connectAttempted, setConnectAttempted] = useState(false)
  const [connectStep, setConnectStep] = useState(autoConnect ? 'backend' : 'ready')
  const [connectionIssue, setConnectionIssue] = useState('')
  const [room, setRoom] = useState(initialRoom)
  const [session, setSession] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState({})
  const [peerStates, setPeerStates] = useState({})
  const [peerStats, setPeerStats] = useState({})
  const [peerMediaStates, setPeerMediaStates] = useState({})
  const [peerVideoWatchdogStates, setPeerVideoWatchdogStates] = useState({})
  const [signalingPeerCount, setSignalingPeerCount] = useState(0)
  const [signalingState, setSignalingState] = useState(autoConnect ? 'connecting' : 'idle')
  const [mediaState, setMediaState] = useState('idle')
  const [mediaUpdating, setMediaUpdating] = useState({ mic: false, camera: false })
  const [mediaMode, setMediaMode] = useState(getInitialMediaMode)
  const [rtcMode, setRtcMode] = useState(normalizeRtcMode(initialRtcMode || defaultRtcModeForRoom(initialRoom), initialRoom))
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(normalizeRtcMode(initialRtcMode || defaultRtcModeForRoom(initialRoom), initialRoom) === 'video')
  const [noiseCancellation, setNoiseCancellation] = useState(true)
  const [voiceEffect, setVoiceEffect] = useState('natural')
  const [roomPasswordInput, setRoomPasswordInput] = useState(roomPassword)
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false)
  const [rtcConfigState, setRtcConfigState] = useState(null)
  const [joinEffect, setJoinEffect] = useState(null)
  const [activeToolPanel, setActiveToolPanel] = useState(null)
  const [stageFrameSize, setStageFrameSize] = useState(null)
  const [chatFocusRequest, setChatFocusRequest] = useState(0)
  const [externalChatMessage, setExternalChatMessage] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [inboxPeerRequest, setInboxPeerRequest] = useState(null)
  const [followRefreshKey, setFollowRefreshKey] = useState(0)
  const [followRelations, setFollowRelations] = useState({ followingIds: [], outgoingIds: [], incoming: [] })
  const [activeFollowRequestId, setActiveFollowRequestId] = useState(null)
  const [followActionIds, setFollowActionIds] = useState({})
  const [screenSharing, setScreenSharing] = useState(false)
  const [expandedScreenShareId, setExpandedScreenShareId] = useState('')
  const [cameraFilter, setCameraFilter] = useState('normal')
  const [beautySettings, setBeautySettings] = useState(DEFAULT_BEAUTY_SETTINGS)
  const [backgroundEffect, setBackgroundEffect] = useState('none')
  const [backgroundBlurAmount, setBackgroundBlurAmount] = useState(DEFAULT_BACKGROUND_BLUR_AMOUNT)
  const [cameraFilterPerformance, setCameraFilterPerformance] = useState('720p / 24fps')
  const [roomControls, setRoomControls] = useState(null)
  const [controlsLoading, setControlsLoading] = useState(false)
  const [moderatingUserIds, setModeratingUserIds] = useState({})
  const [revokingBanIds, setRevokingBanIds] = useState({})
  const [stageAccess, setStageAccess] = useState({ role: 'audience', canPublish: false, requestsEnabled: true, status: 'audience' })
  const [stageRequests, setStageRequests] = useState([])
  const [ownStageRequest, setOwnStageRequest] = useState(null)
  const [stageRequestSending, setStageRequestSending] = useState(false)
  const [stageRequestStatus, setStageRequestStatus] = useState('')
  const [stageRequestActionIds, setStageRequestActionIds] = useState({})
  const [roleForm, setRoleForm] = useState({ userId: '', role: 'moderator' })
  const [roleSaving, setRoleSaving] = useState(false)
  const [roleSavingAction, setRoleSavingAction] = useState('')
  const [roleFeedback, setRoleFeedback] = useState({ type: '', text: '' })
  const t = (key, replacements = {}) => translateApp(language, key, replacements)
  const autoConnectAttemptedRef = useRef(false)
  const socketRef = useRef(null)
  const rtcRef = useRef(null)
  const streamRef = useRef(null)
  const stagePanelRef = useRef(null)
  const stageStreamsRef = useRef(null)
  const stageResizeRef = useRef(null)
  const screenShareTrackRef = useRef(null)
  const audioSourceTrackRef = useRef(null)
  const audioEffectPipelineRef = useRef(null)
  const processedAudioTrackRef = useRef(null)
  const cameraSourceTrackRef = useRef(null)
  const cameraFilterPipelineRef = useRef(null)
  const filteredCameraTrackRef = useRef(null)
  const activeRoomIdRef = useRef(null)
  const signalingRoomRef = useRef(null)
  const localSocketIdRef = useRef(null)
  const joinedRef = useRef(false)
  const micOnRef = useRef(micOn)
  const cameraOnRef = useRef(cameraOn)
  const desiredMicOnRef = useRef(micOn)
  const desiredCameraOnRef = useRef(cameraOn)
  const noiseCancellationRef = useRef(noiseCancellation)
  const voiceEffectRef = useRef(voiceEffect)
  const rtcModeRef = useRef(rtcMode)
  const cameraFilterRef = useRef(cameraFilter)
  const beautySettingsRef = useRef(beautySettings)
  const backgroundEffectRef = useRef(backgroundEffect)
  const backgroundBlurAmountRef = useRef(backgroundBlurAmount)
  const negotiatedPeersRef = useRef(new Set())
  const pendingLocalTracksRef = useRef([])
  const joinEffectTimerRef = useRef(null)
  const rejoiningSignalingRef = useRef(false)
  const latestRtcQualityRef = useRef(null)
  const remoteStreamsRef = useRef(remoteStreams)
  const peerStatesRef = useRef(peerStates)
  const peerStatsRef = useRef(peerStats)
  const peerMediaStatesRef = useRef(peerMediaStates)
  const peerVideoWatchdogStatesRef = useRef(peerVideoWatchdogStates)
  const roomControlsRef = useRef(roomControls)
  const stageAccessRef = useRef(stageAccess)
  const pendingStageIntentRef = useRef(null)
  const videoWatchdogTimersRef = useRef({})
  const videoWatchdogAttemptsRef = useRef({})
  const audioWatchdogTimersRef = useRef({})
  const audioWatchdogAttemptsRef = useRef({})
  const negotiationRetryTimersRef = useRef({})
  const negotiationRetryAttemptsRef = useRef({})
  const localSenderWatchdogAttemptsRef = useRef({ audio: 0, video: 0 })
  const localSenderRepairingRef = useRef({})
  const localTrackCleanupRef = useRef(new Map())
  const cameraUnavailablePublishRef = useRef(false)

  function updateJoined(nextJoined) {
    joinedRef.current = Boolean(nextJoined)
    setJoinedState(Boolean(nextJoined))
  }

  const remoteTiles = useMemo(() => {
    const socketIds = new Set([
      ...Object.keys(peerMediaStates),
      ...Object.keys(peerStates),
      ...Object.keys(remoteStreams),
    ])

    return Array.from(socketIds).map((socketId) => {
      const mediaState = peerMediaStates[socketId] || {}
      const watchdogState = peerVideoWatchdogStates[socketId] || {}
      const rawPeerState = peerStates[socketId] || (remoteStreams[socketId] ? 'connected' : 'waiting')
      const peerState = watchdogState.status === 'failed'
        ? 'no-video'
        : ['restarting', 'verifying'].includes(watchdogState.status)
          ? 'reconnecting'
          : rawPeerState
      const peerStateLabel = watchdogState.status === 'failed' ? t('No video received') : t(peerState)
      const peerName = mediaState.userName || t('Remote {id}', { id: socketId.slice(0, 6) })

      return {
        socketId,
        stream: remoteStreams[socketId],
        mediaState,
        peerState,
        label: t('{name} - {state}', { name: peerName, state: peerStateLabel }),
        badge: mediaState.screenShared ? 'screen' : '',
      }
    })
  }, [peerMediaStates, peerStates, peerVideoWatchdogStates, remoteStreams])
  const expandedScreenShareTile = useMemo(() => {
    if (!expandedScreenShareId) return null

    return remoteTiles.find(({ socketId, stream, mediaState }) => (
      socketId === expandedScreenShareId
      && stream
      && mediaState?.screenShared
    )) || null
  }, [expandedScreenShareId, remoteTiles])
  const remotePeerCount = Math.max(signalingPeerCount, remoteTiles.length)
  const roomVisualIndex = Number(room?.id || roomId || 0)
  const roomCover = coverForRoomType(room?.room_type, room?.privacy_type, roomVisualIndex)

  function isLiveTrack(track) {
    return Boolean(track && track.readyState === 'live')
  }

  function isPublishableCameraTrack(track) {
    return Boolean(
      track
      && track !== screenShareTrackRef.current
      && track.readyState === 'live'
    )
  }

  function hasLiveLocalCameraTrack() {
    const sourceTrack = cameraSourceTrackRef.current
    if (sourceTrack && sourceTrack !== screenShareTrackRef.current) {
      if (sourceTrack.readyState === 'live') return isPublishableCameraTrack(sourceTrack)
    }

    const filteredTrack = filteredCameraTrackRef.current
    if (isPublishableCameraTrack(filteredTrack)) return true

    return streamRef.current?.getVideoTracks?.().some((track) => isPublishableCameraTrack(track)) || false
  }

  function canSignalCameraEnabled(cameraEnabled = cameraOnRef.current, rtcModeValue = rtcModeRef.current) {
    return normalizeRtcMode(rtcModeValue, room) === 'video'
      && Boolean(cameraEnabled)
      && hasLiveLocalCameraTrack()
  }

  function cleanupLocalTrackMonitor(track) {
    const cleanup = localTrackCleanupRef.current.get(track)
    if (!cleanup) return
    cleanup()
    localTrackCleanupRef.current.delete(track)
  }

  function cleanupAllLocalTrackMonitors() {
    localTrackCleanupRef.current.forEach((cleanup) => cleanup())
    localTrackCleanupRef.current.clear()
  }

  function isCurrentLocalCameraTrack(track) {
    if (!track || track === screenShareTrackRef.current) return false
    if (track === cameraSourceTrackRef.current || track === filteredCameraTrackRef.current) return true
    return streamRef.current?.getVideoTracks?.().includes(track) || false
  }

  function monitorLocalVideoTrack(track) {
    if (!track || track === screenShareTrackRef.current || localTrackCleanupRef.current.has(track)) return
    if (typeof track.addEventListener !== 'function') return

    const handleEnded = () => {
      handleLocalCameraTrackUnavailable(track, 'ended').catch((error) => {
        setStatus(`Camera ended; sync warning: ${error.message}`)
      })
    }
    track.addEventListener('ended', handleEnded)
    localTrackCleanupRef.current.set(track, () => {
      track.removeEventListener('ended', handleEnded)
    })
  }

  function audioProcessingOptions() {
    return {
      audioProcessing: {
        echoCancellation: true,
        noiseSuppression: noiseCancellationRef.current,
        autoGainControl: true,
      },
    }
  }

  function normalizeVoiceEffectId(value) {
    return VOICE_EFFECT_IDS.includes(value) ? value : 'natural'
  }

  function isVoiceEffectActive(value = voiceEffectRef.current) {
    return normalizeVoiceEffectId(value) !== 'natural'
  }

  function stopAudioEffectPipeline({ stopSource = false } = {}) {
    const pipeline = audioEffectPipelineRef.current
    audioEffectPipelineRef.current = null

    if (pipeline) {
      pipeline.stop({ stopSource })
    }

    processedAudioTrackRef.current = null

    if (stopSource && audioSourceTrackRef.current?.readyState !== 'ended') {
      try { audioSourceTrackRef.current.stop() } catch {}
    }

    if (stopSource) audioSourceTrackRef.current = null
  }

  function rememberAudioSourceFromStream(stream = streamRef.current) {
    if (isLiveTrack(audioSourceTrackRef.current)) return audioSourceTrackRef.current

    const sourceTrack = stream?.getAudioTracks?.().find((track) => (
      isLiveTrack(track)
      && track !== processedAudioTrackRef.current
    )) || null

    audioSourceTrackRef.current = sourceTrack
    return sourceTrack
  }

  async function createVoiceEffectOutputTrack(sourceTrack, effectId) {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextConstructor) throw new Error('This browser does not support live audio effects.')

    const audioContext = new AudioContextConstructor()
    const sourceStream = new MediaStream([sourceTrack])
    const sourceNode = audioContext.createMediaStreamSource(sourceStream)
    const destination = audioContext.createMediaStreamDestination()
    const nodes = []

    function addBiquad(type, frequency, gain = 0, q = 0.9) {
      const node = audioContext.createBiquadFilter()
      node.type = type
      node.frequency.value = frequency
      node.gain.value = gain
      node.Q.value = q
      nodes.push(node)
      return node
    }

    if (effectId === 'clear') {
      addBiquad('highpass', 120, 0, 0.7)
      addBiquad('peaking', 2600, 4.5, 0.85)
    } else if (effectId === 'deep') {
      addBiquad('lowshelf', 170, 5.5, 0.8)
      addBiquad('peaking', 750, -2.5, 0.9)
      addBiquad('lowpass', 4200, 0, 0.7)
    } else if (effectId === 'bright') {
      addBiquad('highpass', 170, 0, 0.7)
      addBiquad('highshelf', 3600, 6, 0.8)
    }

    const gainNode = audioContext.createGain()
    gainNode.gain.value = effectId === 'deep' ? 1.02 : effectId === 'bright' ? 1.04 : 1
    nodes.push(gainNode)

    let previousNode = sourceNode
    nodes.forEach((node) => {
      previousNode.connect(node)
      previousNode = node
    })
    previousNode.connect(destination)

    if (audioContext.state === 'suspended') await audioContext.resume()

    const [outputTrack] = destination.stream.getAudioTracks()
    if (!outputTrack) {
      await audioContext.close().catch(() => {})
      throw new Error('Audio effects could not create an output track.')
    }

    outputTrack.enabled = sourceTrack.enabled
    outputTrack.contentHint = 'speech'

    return {
      sourceTrack,
      outputTrack,
      effectId,
      stop({ stopSource = false } = {}) {
        try { sourceNode.disconnect() } catch {}
        nodes.forEach((node) => {
          try { node.disconnect() } catch {}
        })
        try { destination.disconnect() } catch {}
        if (outputTrack.readyState !== 'ended') {
          try { outputTrack.stop() } catch {}
        }
        if (stopSource && sourceTrack.readyState !== 'ended') {
          try { sourceTrack.stop() } catch {}
        }
        audioContext.close().catch(() => {})
      },
    }
  }

  async function processedAudioOutputTrack(sourceTrack, effectId = voiceEffectRef.current) {
    const normalizedEffect = normalizeVoiceEffectId(effectId)

    if (!isVoiceEffectActive(normalizedEffect)) {
      stopAudioEffectPipeline({ stopSource: false })
      return sourceTrack
    }

    stopAudioEffectPipeline({ stopSource: false })
    const pipeline = await createVoiceEffectOutputTrack(sourceTrack, normalizedEffect)
    audioEffectPipelineRef.current = pipeline
    processedAudioTrackRef.current = pipeline.outputTrack
    return pipeline.outputTrack
  }

  function monitorLocalCameraTracks(stream = streamRef.current) {
    monitorLocalVideoTrack(cameraSourceTrackRef.current)
    monitorLocalVideoTrack(filteredCameraTrackRef.current)
    stream?.getVideoTracks?.().forEach((track) => monitorLocalVideoTrack(track))
  }

  async function handleLocalCameraTrackUnavailable(track, reason) {
    if (!isCurrentLocalCameraTrack(track)) return
    if (track?.readyState === 'live') return
    if (cameraUnavailablePublishRef.current) return

    cameraUnavailablePublishRef.current = true

    try {
      setCameraOn(false)
      cameraOnRef.current = false
      desiredCameraOnRef.current = false
      applyLocalMediaState(micOnRef.current, false)

      if (track?.readyState === 'ended') {
        streamRef.current?.removeTrack?.(track)
        if (track === cameraSourceTrackRef.current) cameraSourceTrackRef.current = null
        if (track === filteredCameraTrackRef.current) filteredCameraTrackRef.current = null
      }

      if (!screenShareTrackRef.current) {
        await rtcRef.current?.replaceLocalTrack('video', null, streamRef.current)
      }

      if (joinedRef.current) {
        await publishMediaState(micOnRef.current, false)
      }

      setStatus(reason === 'ended'
        ? 'Camera track ended; camera state synced off.'
        : 'Camera stopped; camera state synced off.')
    } finally {
      cameraUnavailablePublishRef.current = false
    }
  }

  function stopCameraFilterPipeline({ stopSource = false } = {}) {
    const pipeline = cameraFilterPipelineRef.current
    cameraFilterPipelineRef.current = null

    if (pipeline) {
      pipeline.stop({ stopSource })
    }

    const filteredTrack = filteredCameraTrackRef.current
    filteredCameraTrackRef.current = null

    if (filteredTrack && filteredTrack.readyState !== 'ended') {
      cleanupLocalTrackMonitor(filteredTrack)
      try { filteredTrack.stop() } catch {}
    }

    if (stopSource && cameraSourceTrackRef.current?.readyState !== 'ended') {
      cleanupLocalTrackMonitor(cameraSourceTrackRef.current)
      try { cameraSourceTrackRef.current.stop() } catch {}
    }

    if (stopSource) cameraSourceTrackRef.current = null
  }

  function rememberCameraSourceFromStream(stream = streamRef.current) {
    if (isLiveTrack(cameraSourceTrackRef.current)) return cameraSourceTrackRef.current

    const sourceTrack = stream?.getVideoTracks?.().find((track) => (
      isLiveTrack(track)
      && track !== screenShareTrackRef.current
      && track !== filteredCameraTrackRef.current
    )) || null

    cameraSourceTrackRef.current = sourceTrack
    return sourceTrack
  }

  function replaceCameraTrackInLocalStream(cameraTrack) {
    const previousStream = streamRef.current
    const previousTracks = previousStream?.getTracks?.() || []
    const keptTracks = previousTracks.filter((track) => (
      track.kind !== 'video' || track === screenShareTrackRef.current
    ))
    const nextTracks = cameraTrack ? [...keptTracks, cameraTrack] : keptTracks
    const nextStream = new MediaStream(nextTracks)

    if (typeof previousStream?.__cleanup === 'function') {
      nextStream.__cleanup = previousStream.__cleanup
    }

    streamRef.current = nextStream
    setLocalStream(nextStream)
    monitorLocalVideoTrack(cameraTrack)
    return nextStream
  }

  function replaceAudioTrackInLocalStream(audioTrack) {
    const previousStream = streamRef.current
    const previousTracks = previousStream?.getTracks?.() || []
    const keptTracks = previousTracks.filter((track) => track.kind !== 'audio')
    const nextTracks = audioTrack ? [...keptTracks, audioTrack] : keptTracks
    const nextStream = new MediaStream(nextTracks)

    if (typeof previousStream?.__cleanup === 'function') {
      nextStream.__cleanup = previousStream.__cleanup
    }

    streamRef.current = nextStream
    setLocalStream(nextStream)
    return nextStream
  }

  async function syncAudioEffectTrack({ effectId = voiceEffectRef.current, replaceOutgoing = true } = {}) {
    const normalizedEffect = normalizeVoiceEffectId(effectId)
    const sourceTrack = rememberAudioSourceFromStream()

    if (!isLiveTrack(sourceTrack)) return null

    const currentOutgoingTrack = streamRef.current?.getAudioTracks?.()[0] || null
    const outputTrack = await processedAudioOutputTrack(sourceTrack, normalizedEffect)
    outputTrack.enabled = micOnRef.current
    sourceTrack.enabled = micOnRef.current

    const nextStream = currentOutgoingTrack === outputTrack
      ? streamRef.current
      : replaceAudioTrackInLocalStream(outputTrack)

    if (replaceOutgoing && currentOutgoingTrack !== outputTrack) {
      await rtcRef.current?.replaceLocalTrack('audio', outputTrack, nextStream)
    }

    return outputTrack
  }

  function handleCameraFilterPerformanceChange(event) {
    if (event?.type === 'reduced-resolution') {
      setCameraFilterPerformance('480p adaptive')
      setStatus('Camera effects reduced to 480p to keep RTC smooth.')
      return
    }

    if (event?.type === 'disabled-background') {
      setBackgroundEffect('none')
      backgroundEffectRef.current = 'none'
      setCameraFilterPerformance('480p light')
      setStatus('Background blur was turned off to keep RTC smooth.')
    }
  }

  async function filteredCameraOutputTrack(
    sourceTrack,
    filterId = cameraFilterRef.current,
    beautySettingsValue = beautySettingsRef.current,
    backgroundEffectValue = backgroundEffectRef.current,
    backgroundBlurAmountValue = backgroundBlurAmountRef.current,
  ) {
    const normalizedFilterId = normalizeVideoFilterId(filterId)
    const normalizedBeautySettings = normalizeBeautySettings(beautySettingsValue)
    const normalizedBackgroundEffect = normalizeBackgroundEffectId(backgroundEffectValue)
    const normalizedBackgroundBlurAmount = normalizeBackgroundBlurAmount(backgroundBlurAmountValue)

    if (!isCameraFilterEffectActive(normalizedFilterId, normalizedBeautySettings, normalizedBackgroundEffect)) {
      stopCameraFilterPipeline({ stopSource: false })
      return sourceTrack
    }

    if (!supportsCameraFilterPipeline()) {
      throw new Error('This browser does not support camera filters.')
    }

    let pipeline = cameraFilterPipelineRef.current
    const pipelineReusable = pipeline
      && !pipeline.stopped
      && pipeline.sourceTrack === sourceTrack
      && isLiveTrack(pipeline.outputTrack)

    if (!pipelineReusable) {
      stopCameraFilterPipeline({ stopSource: false })
      pipeline = new CameraFilterPipeline(sourceTrack, normalizedFilterId, {
        beautySettings: normalizedBeautySettings,
        backgroundEffect: normalizedBackgroundEffect,
        backgroundBlurAmount: normalizedBackgroundBlurAmount,
        frameRate: 24,
        maxWidth: 1280,
        maxHeight: 720,
        onPerformanceChange: handleCameraFilterPerformanceChange,
      })
      cameraFilterPipelineRef.current = pipeline
      filteredCameraTrackRef.current = await pipeline.start()
    } else {
      pipeline.setFilter(normalizedFilterId)
      pipeline.setBeautySettings(normalizedBeautySettings)
      pipeline.setBackgroundEffect(normalizedBackgroundEffect)
      pipeline.setBackgroundBlurAmount(normalizedBackgroundBlurAmount)
      filteredCameraTrackRef.current = pipeline.outputTrack
    }

    monitorLocalVideoTrack(sourceTrack)
    monitorLocalVideoTrack(filteredCameraTrackRef.current)
    return filteredCameraTrackRef.current
  }

  async function syncCameraFilterTrack({
    filterId = cameraFilterRef.current,
    beautySettingsValue = beautySettingsRef.current,
    backgroundEffectValue = backgroundEffectRef.current,
    backgroundBlurAmountValue = backgroundBlurAmountRef.current,
    replaceOutgoing = true,
  } = {}) {
    if (rtcModeRef.current === 'audio') return null

    const normalizedFilterId = normalizeVideoFilterId(filterId)
    const normalizedBeautySettings = normalizeBeautySettings(beautySettingsValue)
    const normalizedBackgroundEffect = normalizeBackgroundEffectId(backgroundEffectValue)
    const normalizedBackgroundBlurAmount = normalizeBackgroundBlurAmount(backgroundBlurAmountValue)
    const sourceTrack = rememberCameraSourceFromStream()

    if (!isLiveTrack(sourceTrack)) return null

    const currentOutgoingTrack = streamRef.current?.getVideoTracks?.().find((track) => track !== screenShareTrackRef.current) || null
    const outputTrack = await filteredCameraOutputTrack(sourceTrack, normalizedFilterId, normalizedBeautySettings, normalizedBackgroundEffect, normalizedBackgroundBlurAmount)
    monitorLocalVideoTrack(sourceTrack)
    monitorLocalVideoTrack(outputTrack)
    outputTrack.enabled = cameraOnRef.current
    sourceTrack.enabled = cameraOnRef.current

    const nextStream = currentOutgoingTrack === outputTrack
      ? streamRef.current
      : replaceCameraTrackInLocalStream(outputTrack)

    if (replaceOutgoing && !screenShareTrackRef.current && currentOutgoingTrack !== outputTrack) {
      await rtcRef.current?.replaceLocalTrack('video', outputTrack, nextStream)
    }

    return outputTrack
  }

  async function prepareStreamWithCameraFilter(stream, rtcModeValue) {
    if (rtcModeValue === 'audio') return stream

    const sourceTrack = stream?.getVideoTracks?.().find((track) => isLiveTrack(track)) || null
    cameraSourceTrackRef.current = sourceTrack

    monitorLocalVideoTrack(sourceTrack)

    if (!sourceTrack || !isCameraFilterEffectActive(cameraFilterRef.current, beautySettingsRef.current, backgroundEffectRef.current)) {
      return stream
    }

    let outputTrack = null
    try {
      outputTrack = await filteredCameraOutputTrack(
        sourceTrack,
        cameraFilterRef.current,
        beautySettingsRef.current,
        backgroundEffectRef.current,
        backgroundBlurAmountRef.current,
      )
    } catch (error) {
      setCameraFilter('normal')
      cameraFilterRef.current = 'normal'
      setBackgroundEffect('none')
      backgroundEffectRef.current = 'none'
      stopCameraFilterPipeline({ stopSource: false })
      setStatus(`Camera filter unavailable; joining with normal camera: ${error.message}`)
      return stream
    }

    outputTrack.enabled = sourceTrack.enabled
    monitorLocalVideoTrack(outputTrack)

    const nextStream = new MediaStream([
      ...stream.getAudioTracks(),
      outputTrack,
    ])

    if (typeof stream?.__cleanup === 'function') {
      nextStream.__cleanup = stream.__cleanup
    }

    return nextStream
  }

  async function prepareStreamWithAudioEffect(stream) {
    const sourceTrack = stream?.getAudioTracks?.().find((track) => isLiveTrack(track)) || null
    audioSourceTrackRef.current = sourceTrack

    if (!sourceTrack || !isVoiceEffectActive(voiceEffectRef.current)) {
      return stream
    }

    let outputTrack = null
    try {
      outputTrack = await processedAudioOutputTrack(sourceTrack, voiceEffectRef.current)
    } catch (error) {
      voiceEffectRef.current = 'natural'
      setVoiceEffect('natural')
      stopAudioEffectPipeline({ stopSource: false })
      setStatus(`Voice effects unavailable; joining with normal microphone: ${error.message}`)
      return stream
    }

    outputTrack.enabled = sourceTrack.enabled
    const nextStream = new MediaStream([
      outputTrack,
      ...stream.getVideoTracks(),
    ])

    if (typeof stream?.__cleanup === 'function') {
      nextStream.__cleanup = stream.__cleanup
    }

    return nextStream
  }

  function clearVideoWatchdogTimer(socketId) {
    const timer = videoWatchdogTimersRef.current[socketId]
    if (timer) window.clearTimeout(timer)
    delete videoWatchdogTimersRef.current[socketId]
  }

  function setPeerVideoWatchdog(socketId, nextState) {
    setPeerVideoWatchdogStates((previous) => {
      const next = {
        ...previous,
        [socketId]: {
          ...(previous[socketId] || {}),
          ...nextState,
          updatedAt: Date.now(),
        },
      }
      peerVideoWatchdogStatesRef.current = next
      return next
    })
  }

  function resetPeerVideoWatchdog(socketId, { clearState = true } = {}) {
    clearVideoWatchdogTimer(socketId)
    delete videoWatchdogAttemptsRef.current[socketId]

    if (!clearState) {
      const next = { ...peerVideoWatchdogStatesRef.current }
      delete next[socketId]
      peerVideoWatchdogStatesRef.current = next
      return
    }

    setPeerVideoWatchdogStates((previous) => {
      if (!previous[socketId]) {
        peerVideoWatchdogStatesRef.current = previous
        return previous
      }

      const next = { ...previous }
      delete next[socketId]
      peerVideoWatchdogStatesRef.current = next
      return next
    })
  }

  function clearAllVideoWatchdogs({ clearState = true } = {}) {
    Object.keys(videoWatchdogTimersRef.current).forEach((socketId) => clearVideoWatchdogTimer(socketId))
    videoWatchdogAttemptsRef.current = {}

    if (clearState) {
      peerVideoWatchdogStatesRef.current = {}
      setPeerVideoWatchdogStates({})
    } else {
      peerVideoWatchdogStatesRef.current = {}
    }
  }

  function clearAudioWatchdogTimer(socketId) {
    const timer = audioWatchdogTimersRef.current[socketId]
    if (timer) window.clearTimeout(timer)
    delete audioWatchdogTimersRef.current[socketId]
  }

  function resetPeerAudioWatchdog(socketId) {
    clearAudioWatchdogTimer(socketId)
    delete audioWatchdogAttemptsRef.current[socketId]
  }

  function clearAllAudioWatchdogs() {
    Object.keys(audioWatchdogTimersRef.current).forEach((socketId) => clearAudioWatchdogTimer(socketId))
    audioWatchdogAttemptsRef.current = {}
  }

  function clearNegotiationRetryTimer(socketId) {
    const timer = negotiationRetryTimersRef.current[socketId]
    if (timer) window.clearTimeout(timer)
    delete negotiationRetryTimersRef.current[socketId]
  }

  function resetPeerNegotiationRetry(socketId) {
    clearNegotiationRetryTimer(socketId)
    delete negotiationRetryAttemptsRef.current[socketId]
  }

  function clearAllNegotiationRetries() {
    Object.keys(negotiationRetryTimersRef.current).forEach((socketId) => clearNegotiationRetryTimer(socketId))
    negotiationRetryAttemptsRef.current = {}
  }

  function peerNeedsNegotiationRetry(socketId, rtcClient = rtcRef.current) {
    if (!joinedRef.current || !socketId || !rtcClient) return false
    if (String(socketId) === String(localSocketIdRef.current || '')) return false

    const peerConnection = rtcClient.peerConnections?.[socketId]
    if (!peerConnection || peerConnection.signalingState === 'closed') return false

    const connectionState = peerConnection.connectionState === 'new' && peerConnection.iceConnectionState !== 'new'
      ? peerConnection.iceConnectionState
      : peerConnection.connectionState

    if (['connected', 'completed'].includes(connectionState)) return false
    if (['connected', 'completed'].includes(peerConnection.iceConnectionState)) return false

    return (
      !peerConnection.localDescription
      || !peerConnection.remoteDescription
      || ['new', 'connecting', 'checking', 'disconnected', 'failed'].includes(connectionState)
    )
  }

  function scheduleNegotiationRetry(socketId, rtcClient, label = 'peer') {
    if (!socketId || !rtcClient || negotiationRetryTimersRef.current[socketId]) return

    const attempt = Number(negotiationRetryAttemptsRef.current[socketId] || 0)
    if (attempt >= RTC_NEGOTIATION_RETRY_MAX_ATTEMPTS) return

    const delayMs = RTC_NEGOTIATION_RETRY_DELAY_MS + (attempt * 1000)
    negotiationRetryTimersRef.current[socketId] = window.setTimeout(async () => {
      delete negotiationRetryTimersRef.current[socketId]

      if (rtcRef.current !== rtcClient || !peerNeedsNegotiationRetry(socketId, rtcClient)) {
        delete negotiationRetryAttemptsRef.current[socketId]
        return
      }

      negotiationRetryAttemptsRef.current[socketId] = attempt + 1
      negotiatedPeersRef.current.delete(socketId)

      setPeerStates((previous) => {
        const next = { ...previous, [socketId]: 'negotiating' }
        peerStatesRef.current = next
        return next
      })

      try {
        const offerSent = await rtcClient.createOffer(socketId)
        if (offerSent === false) {
          setPeerStates((previous) => {
            const next = { ...previous, [socketId]: 'waiting' }
            peerStatesRef.current = next
            return next
          })
        } else {
          negotiatedPeersRef.current.add(socketId)
        }
      } catch (error) {
        if (isStalePeerSignalError(error)) {
          forgetRemotePeer(socketId, rtcClient)
          refreshSignalingPeers(rtcClient, 'stale peer').catch((refreshError) => {
            setStatus(`Peer refresh failed: ${refreshError.message}`)
          })
        } else {
          setConnectionIssue(`${label} negotiation retry failed: ${error.message}`)
          setStatus(`${label} negotiation retry failed: ${error.message}`)
        }
      }

      if (peerNeedsNegotiationRetry(socketId, rtcClient)) {
        scheduleNegotiationRetry(socketId, rtcClient, label)
      } else {
        delete negotiationRetryAttemptsRef.current[socketId]
      }
    }, delayMs)
  }

  function peerLabelForVideoWatchdog(socketId) {
    return peerMediaStatesRef.current?.[socketId]?.userName || `peer ${String(socketId).slice(0, 6)}`
  }

  function peerLabelForAudioWatchdog(socketId) {
    return peerMediaStatesRef.current?.[socketId]?.userName || `peer ${String(socketId).slice(0, 6)}`
  }

  function peerNeedsInboundVideo(socketId) {
    if (!socketId || String(socketId) === String(localSocketIdRef.current || '')) return false

    const peerState = String(peerStatesRef.current?.[socketId] || '').toLowerCase()
    if (['closed', 'disconnected', 'failed'].includes(peerState)) return false

    return remoteVideoExpectedFromState(peerMediaStatesRef.current?.[socketId] || {})
  }

  function peerNeedsInboundAudio(socketId) {
    if (!socketId || String(socketId) === String(localSocketIdRef.current || '')) return false

    const peerState = String(peerStatesRef.current?.[socketId] || '').toLowerCase()
    if (['closed', 'disconnected', 'failed'].includes(peerState)) return false

    const mediaState = peerMediaStatesRef.current?.[socketId] || {}
    return mediaState.micOn !== false
  }

  function peerHasInboundVideo(socketId) {
    return hasInboundVideoTrack(remoteStreamsRef.current?.[socketId])
  }

  function peerHasInboundAudio(socketId) {
    if (rtcRef.current?.hasLiveInboundTrack?.(socketId, 'audio')) return true
    return hasInboundAudioTrack(remoteStreamsRef.current?.[socketId])
  }

  function peerReadyForMediaRepair(socketId) {
    const peerConnection = rtcRef.current?.peerConnections?.[socketId]
    const connectionState = peerConnection?.connectionState === 'new' && peerConnection?.iceConnectionState !== 'new'
      ? peerConnection.iceConnectionState
      : peerConnection?.connectionState
    const peerState = String(connectionState || peerStatesRef.current?.[socketId] || '').toLowerCase()
    return ['connected', 'completed'].includes(peerState)
      || ['connected', 'completed'].includes(String(peerConnection?.iceConnectionState || '').toLowerCase())
  }

  function peerReadyForVideoFailure(socketId) {
    return peerReadyForMediaRepair(socketId)
  }

  function setPeerStateValue(socketId, state) {
    if (!socketId) return

    setPeerStates((previous) => {
      const next = { ...previous, [socketId]: state }
      peerStatesRef.current = next
      return next
    })
  }

  function clearReconnectingPeerState(socketId) {
    if (!socketId) return

    setPeerStates((previous) => {
      const currentState = String(previous[socketId] || '').toLowerCase()
      if (currentState !== 'reconnecting') {
        peerStatesRef.current = previous
        return previous
      }

      const next = {
        ...previous,
        [socketId]: remoteStreamsRef.current?.[socketId] ? 'connected' : 'waiting',
      }
      peerStatesRef.current = next
      return next
    })
  }

  function clearNoVideoPeerState(socketId) {
    if (!socketId) return

    setPeerStates((previous) => {
      const currentState = String(previous[socketId] || '').toLowerCase()
      if (currentState !== 'no-video') {
        peerStatesRef.current = previous
        return previous
      }

      const next = {
        ...previous,
        [socketId]: remoteStreamsRef.current?.[socketId] ? 'connected' : 'waiting',
      }
      peerStatesRef.current = next
      return next
    })
  }

  function scheduleAudioWatchdog(socketId, delayMs = RTC_AUDIO_WATCHDOG_DELAY_MS) {
    clearAudioWatchdogTimer(socketId)
    audioWatchdogTimersRef.current[socketId] = window.setTimeout(() => {
      runAudioWatchdog(socketId)
    }, delayMs)
  }

  async function runAudioWatchdog(socketId) {
    clearAudioWatchdogTimer(socketId)

    if (!joinedRef.current || !peerNeedsInboundAudio(socketId)) {
      resetPeerAudioWatchdog(socketId)
      return
    }

    if (peerHasInboundAudio(socketId)) {
      resetPeerAudioWatchdog(socketId)
      clearReconnectingPeerState(socketId)
      return
    }

    if (!peerReadyForMediaRepair(socketId)) {
      scheduleNegotiationRetry(socketId, rtcRef.current, 'Peer')
      scheduleAudioWatchdog(socketId, RTC_AUDIO_WATCHDOG_DELAY_MS)
      return
    }

    const attempt = Number(audioWatchdogAttemptsRef.current[socketId] || 0)
    const peerLabel = peerLabelForAudioWatchdog(socketId)

    if (attempt >= RTC_AUDIO_WATCHDOG_MAX_ATTEMPTS) {
      clearReconnectingPeerState(socketId)
      setStatus(`No audio received from ${peerLabel}. Ask them to toggle mic if it does not recover.`)
      return
    }

    audioWatchdogAttemptsRef.current[socketId] = attempt + 1
    setPeerStateValue(socketId, 'reconnecting')
    setStatus(`No audio from ${peerLabel}; refreshing RTC audio...`)

    try {
      const rtcClient = rtcRef.current
      await refreshSignalingPeers(rtcClient, 'missing audio').catch(() => {})

      if (!joinedRef.current || !peerNeedsInboundAudio(socketId)) {
        resetPeerAudioWatchdog(socketId)
        return
      }

      if (peerHasInboundAudio(socketId)) {
        resetPeerAudioWatchdog(socketId)
        clearReconnectingPeerState(socketId)
        return
      }

      const repairSent = typeof rtcClient?.repairMissingInboundAudio === 'function'
        ? await rtcClient.repairMissingInboundAudio(socketId, { iceRestart: attempt > 0 })
        : attempt > 0 && typeof rtcClient?.restartIce === 'function'
          ? await rtcClient.restartIce(socketId, 'remote-audio-missing')
          : await rtcClient?.createOffer?.(socketId)

      if (repairSent === false) {
        scheduleNegotiationRetry(socketId, rtcClient, 'Peer')
      }
    } catch (error) {
      if (isStalePeerSignalError(error)) {
        forgetRemotePeer(socketId, rtcRef.current)
        refreshSignalingPeers(rtcRef.current, 'stale peer').catch(() => {})
        return
      }

      setStatus(`Audio recovery failed: ${error.message}`)
    }

    scheduleAudioWatchdog(socketId, RTC_AUDIO_WATCHDOG_FINAL_DELAY_MS)
  }

  function reconcileAudioWatchdog(socketId) {
    if (!joinedRef.current || !peerNeedsInboundAudio(socketId)) {
      resetPeerAudioWatchdog(socketId)
      return
    }

    if (peerHasInboundAudio(socketId)) {
      resetPeerAudioWatchdog(socketId)
      clearReconnectingPeerState(socketId)
      return
    }

    if (audioWatchdogTimersRef.current[socketId]) return
    scheduleAudioWatchdog(socketId, RTC_AUDIO_WATCHDOG_DELAY_MS)
  }

  function scheduleVideoWatchdog(socketId, delayMs) {
    clearVideoWatchdogTimer(socketId)
    videoWatchdogTimersRef.current[socketId] = window.setTimeout(() => {
      runVideoWatchdog(socketId)
    }, delayMs)
  }

  async function runVideoWatchdog(socketId) {
    clearVideoWatchdogTimer(socketId)

    if (!joinedRef.current || !peerNeedsInboundVideo(socketId)) {
      resetPeerVideoWatchdog(socketId)
      return
    }

    if (peerHasInboundVideo(socketId)) {
      resetPeerVideoWatchdog(socketId)
      clearNoVideoPeerState(socketId)
      return
    }

    if (!peerReadyForVideoFailure(socketId)) {
      setPeerVideoWatchdog(socketId, {
        status: 'waiting',
        message: 'Waiting for peer connection',
      })
      scheduleNegotiationRetry(socketId, rtcRef.current, 'Peer')
      scheduleVideoWatchdog(socketId, RTC_VIDEO_WATCHDOG_DELAY_MS)
      return
    }

    const attempt = Number(videoWatchdogAttemptsRef.current[socketId] || 0)
    const peerLabel = peerLabelForVideoWatchdog(socketId)

    if (attempt < 1) {
      videoWatchdogAttemptsRef.current[socketId] = attempt + 1
      setPeerVideoWatchdog(socketId, {
        status: 'restarting',
        message: 'Restarting ICE for missing video',
      })
      setPeerStateValue(socketId, 'reconnecting')
      setStatus(`No video from ${peerLabel}; restarting RTC video...`)

      try {
        const rtcClient = rtcRef.current
        await refreshSignalingPeers(rtcClient, 'missing video').catch(() => {})

        if (!joinedRef.current || !peerNeedsInboundVideo(socketId)) {
          resetPeerVideoWatchdog(socketId)
          return
        }

        if (peerHasInboundVideo(socketId)) {
          resetPeerVideoWatchdog(socketId)
          clearNoVideoPeerState(socketId)
          return
        }

        if (typeof rtcClient?.restartIce === 'function') {
          await rtcClient.restartIce(socketId, 'remote-video-missing')
        } else if (typeof rtcClient?.createOffer === 'function') {
          await rtcClient.createOffer(socketId)
        }
      } catch (error) {
        if (isStalePeerSignalError(error)) {
          forgetRemotePeer(socketId, rtcRef.current)
          refreshSignalingPeers(rtcRef.current, 'stale peer').catch(() => {})
          return
        }

        setPeerVideoWatchdog(socketId, {
          status: 'verifying',
          message: `Video restart failed: ${error.message}`,
        })
      }

      if (!joinedRef.current || !peerNeedsInboundVideo(socketId)) {
        resetPeerVideoWatchdog(socketId)
        return
      }

      if (peerHasInboundVideo(socketId)) {
        resetPeerVideoWatchdog(socketId)
        clearNoVideoPeerState(socketId)
        return
      }

      setPeerVideoWatchdog(socketId, {
        status: 'verifying',
        message: 'Checking video after ICE restart',
      })
      scheduleVideoWatchdog(socketId, RTC_VIDEO_WATCHDOG_FINAL_DELAY_MS)
      return
    }

    if (!peerReadyForVideoFailure(socketId)) {
      setPeerVideoWatchdog(socketId, {
        status: 'waiting',
        message: 'Waiting for peer connection',
      })
      scheduleNegotiationRetry(socketId, rtcRef.current, 'Peer')
      scheduleVideoWatchdog(socketId, RTC_VIDEO_WATCHDOG_DELAY_MS)
      return
    }

    setPeerVideoWatchdog(socketId, {
      status: 'failed',
      message: 'No video received',
    })
    setPeerStateValue(socketId, 'no-video')
    setStatus(`No video received from ${peerLabel}`)
  }

  function reconcileVideoWatchdog(socketId) {
    if (!joinedRef.current || !peerNeedsInboundVideo(socketId)) {
      resetPeerVideoWatchdog(socketId)
      return
    }

    if (peerHasInboundVideo(socketId)) {
      resetPeerVideoWatchdog(socketId)
      clearNoVideoPeerState(socketId)
      return
    }

    const watchdogState = peerVideoWatchdogStatesRef.current?.[socketId]
    if (watchdogState?.status === 'failed' || videoWatchdogTimersRef.current[socketId]) return

    const attempt = Number(videoWatchdogAttemptsRef.current[socketId] || 0)
    setPeerVideoWatchdog(socketId, attempt > 0
      ? { status: 'verifying', message: 'Checking video after ICE restart' }
      : { status: 'waiting', message: 'Waiting for inbound video track' })
    scheduleVideoWatchdog(
      socketId,
      attempt > 0 ? RTC_VIDEO_WATCHDOG_FINAL_DELAY_MS : RTC_VIDEO_WATCHDOG_DELAY_MS
    )
  }

  function resetRtcState({ clearState = true } = {}) {
    joinedRef.current = false
    clearAllVideoWatchdogs({ clearState })
    clearAllAudioWatchdogs()
    cleanupAllLocalTrackMonitors()
    if (socketRef.current) {
      const socket = socketRef.current
      socketRef.current = null
      socket.emit('leave-room')
      socket.disconnect()
    }
    if (rtcRef.current) {
      rtcRef.current.closeAll()
      rtcRef.current = null
    }
    clearAllNegotiationRetries()
    stopAudioEffectPipeline({ stopSource: true })
    stopCameraFilterPipeline({ stopSource: true })
    stopMediaStream(streamRef.current)
    if (screenShareTrackRef.current) {
      try { screenShareTrackRef.current.stop() } catch {}
      screenShareTrackRef.current = null
    }
    pendingLocalTracksRef.current.forEach(({ track }) => {
      try { track.stop() } catch {}
    })
    pendingLocalTracksRef.current = []
    streamRef.current = null
    signalingRoomRef.current = null
    localSocketIdRef.current = null
    rejoiningSignalingRef.current = false
    latestRtcQualityRef.current = null
    negotiatedPeersRef.current.clear()
    remoteStreamsRef.current = {}
    peerStatesRef.current = {}
    peerStatsRef.current = {}
    peerMediaStatesRef.current = {}
    localSenderWatchdogAttemptsRef.current = { audio: 0, video: 0 }
    localSenderRepairingRef.current = {}
    pendingStageIntentRef.current = null
    if (clearState) {
      setLocalStream(null)
      setRemoteStreams({})
      setPeerStates({})
      setPeerStats({})
      setPeerMediaStates({})
      setSession(null)
      setSignalingPeerCount(0)
      setSignalingState('idle')
      setMediaState('idle')
      setConnectStep('ready')
      setScreenSharing(false)
      setExpandedScreenShareId('')
      setActiveToolPanel(null)
      setRoomControls(null)
      setStageAccess({ role: 'audience', canPublish: false, requestsEnabled: true, status: 'audience' })
      setStageRequests([])
      setOwnStageRequest(null)
      setStageRequestStatus('')
      setStageRequestSending(false)
    }
  }

  function hasLiveTrack(stream, kind) {
    return stream?.getTracks?.().some((track) => track.kind === kind && track.readyState === 'live')
  }

  function hasLiveLocalTrack(kind) {
    return hasLiveTrack(streamRef.current, kind)
  }

  async function publishCurrentCameraTrack() {
    if (rtcModeRef.current === 'audio' || screenShareTrackRef.current) return null

    const track = currentCameraTrack()
    if (!isPublishableCameraTrack(track)) return null

    const nextStream = replaceCameraTrackInLocalStream(track)
    await rtcRef.current?.replaceLocalTrack('video', track, nextStream)
    return track
  }

  async function unpublishCameraTrack() {
    if (rtcModeRef.current === 'audio' || screenShareTrackRef.current) return
    const outgoingTrack = currentCameraTrack()
    const sourceTrack = cameraSourceTrackRef.current
    const filteredTrack = filteredCameraTrackRef.current

    const nextStream = replaceCameraTrackInLocalStream(null)
    await rtcRef.current?.replaceLocalTrack('video', null, nextStream)

    stopCameraFilterPipeline({ stopSource: true })

    const stoppedCameraTracks = [outgoingTrack, sourceTrack, filteredTrack]
    stoppedCameraTracks.forEach((track) => {
      if (!track || track.readyState === 'ended') return
      cleanupLocalTrackMonitor(track)
      try { track.stop() } catch {}
    })
  }

  function localTrackForSender(kind) {
    if (kind === 'audio') {
      return streamRef.current?.getAudioTracks?.().find((track) => isLiveTrack(track)) || null
    }

    return currentCameraTrack()
  }

  function hasActivePeerConnection() {
    const peerConnections = rtcRef.current?.peerConnections || {}
    if (Object.values(peerConnections).some((peerConnection) => peerConnection?.signalingState !== 'closed')) return true

    const statsCount = Object.keys(peerStatsRef.current || {}).length
    if (statsCount > 0) return true

    return Object.values(peerStatesRef.current || {}).some((state) => {
      const normalizedState = String(state || '').toLowerCase()
      return normalizedState && !['closed', 'failed', 'no-video'].includes(normalizedState)
    })
  }

  function localOutboundKbps(kind) {
    const statsList = Object.values(peerStatsRef.current || {}).filter(Boolean)
    return sumMediaBitrate(statsList, 'outbound', kind)
  }

  function resetLocalSenderWatchdog() {
    localSenderWatchdogAttemptsRef.current = { audio: 0, video: 0 }
    localSenderRepairingRef.current = {}
  }

  function shouldRepairLocalSender(kind) {
    if (!joinedRef.current || !hasActivePeerConnection()) return false

    if (kind === 'audio') {
      return Boolean(micOnRef.current && hasLiveLocalTrack('audio'))
    }

    return Boolean(
      rtcModeRef.current === 'video'
      && cameraOnRef.current
      && !screenShareTrackRef.current
      && hasLiveLocalCameraTrack()
    )
  }

  async function repairLocalSender(kind) {
    if (localSenderRepairingRef.current[kind]) return

    const attempts = Number(localSenderWatchdogAttemptsRef.current[kind] || 0)
    if (attempts >= RTC_LOCAL_SENDER_WATCHDOG_MAX_ATTEMPTS) return

    const track = localTrackForSender(kind)
    if (!isLiveTrack(track)) return

    localSenderRepairingRef.current[kind] = true
    localSenderWatchdogAttemptsRef.current[kind] = attempts + 1

    try {
      applyLocalMediaState(micOnRef.current, cameraOnRef.current)
      setStatus(kind === 'video' ? 'Republishing camera track...' : 'Republishing microphone track...')
      await rtcRef.current?.replaceLocalTrack(kind, track, streamRef.current)

      if (joinedRef.current) {
        await publishMediaState(micOnRef.current, cameraOnRef.current).catch((error) => {
          setStatus(`${kind === 'video' ? 'Camera' : 'Microphone'} republished; state sync warning: ${error.message}`)
        })
      }

      setStatus(kind === 'video' ? 'Camera republished to RTC.' : 'Microphone republished to RTC.')
    } catch (error) {
      setStatus(`${kind === 'video' ? 'Camera' : 'Microphone'} republish failed: ${error.message}`)
    } finally {
      delete localSenderRepairingRef.current[kind]
    }
  }

  function applyLocalMediaState(nextMicOn, nextCameraOn) {
    rtcRef.current?.setAudioEnabled(nextMicOn)
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = nextMicOn })
    if (audioSourceTrackRef.current) audioSourceTrackRef.current.enabled = nextMicOn
    if (processedAudioTrackRef.current) processedAudioTrackRef.current.enabled = nextMicOn
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = track === screenShareTrackRef.current ? true : nextCameraOn
    })
    if (cameraSourceTrackRef.current && cameraSourceTrackRef.current !== screenShareTrackRef.current) {
      cameraSourceTrackRef.current.enabled = nextCameraOn
    }
    if (filteredCameraTrackRef.current) {
      filteredCameraTrackRef.current.enabled = nextCameraOn
    }
  }

  async function attachCapturedLocalTrack(kind, track, { publish = true, enabled } = {}) {
    if (!track || track.readyState === 'ended') return null

    const mediaKind = kind === 'audio' ? 'audio' : 'video'

    if (mediaKind === 'video' && rtcModeRef.current === 'audio') {
      try { track.stop() } catch {}
      return null
    }

    if (!rtcRef.current) {
      pendingLocalTracksRef.current.push({ kind: mediaKind, track, enabled })
      return track
    }

    const previousStream = streamRef.current
    const previousTracks = previousStream?.getTracks?.() || []
    let outgoingTrack = track

    if (mediaKind === 'audio') {
      stopAudioEffectPipeline({ stopSource: true })
      audioSourceTrackRef.current = track
      if (isVoiceEffectActive(voiceEffectRef.current)) {
        try {
          outgoingTrack = await processedAudioOutputTrack(track, voiceEffectRef.current)
        } catch (error) {
          voiceEffectRef.current = 'natural'
          setVoiceEffect('natural')
          setStatus(`Voice effects unavailable; using normal microphone: ${error.message}`)
          outgoingTrack = track
        }
      }
    }

    if (mediaKind === 'video') {
      stopCameraFilterPipeline({ stopSource: true })
      cameraSourceTrackRef.current = track
      outgoingTrack = await filteredCameraOutputTrack(
        track,
        cameraFilterRef.current,
        beautySettingsRef.current,
        backgroundEffectRef.current,
        backgroundBlurAmountRef.current,
      )
    }

    const keptTracks = previousTracks.filter((item) => item !== track && item.kind !== mediaKind && item.readyState !== 'ended')

    previousTracks
      .filter((item) => item !== track && item.kind === mediaKind)
      .forEach((item) => {
        cleanupLocalTrackMonitor(item)
        try { item.stop() } catch {}
      })

    const desiredEnabled = enabled === undefined ? (
      mediaKind === 'audio' ? desiredMicOnRef.current : desiredCameraOnRef.current
    ) : Boolean(enabled)
    track.enabled = desiredEnabled
    outgoingTrack.enabled = desiredEnabled

    const nextStream = new MediaStream([...keptTracks, outgoingTrack])
    if (typeof previousStream?.__cleanup === 'function') {
      nextStream.__cleanup = previousStream.__cleanup
    }

    streamRef.current = nextStream
    setLocalStream(nextStream)
    if (mediaKind === 'video') {
      monitorLocalVideoTrack(track)
      monitorLocalVideoTrack(outgoingTrack)
    }
    await rtcRef.current.addLocalTrack(outgoingTrack, nextStream)

    const nextMicOn = mediaKind === 'audio' ? desiredEnabled : micOnRef.current
    const nextCameraOn = mediaKind === 'video' ? desiredEnabled : cameraOnRef.current
    micOnRef.current = nextMicOn
    cameraOnRef.current = nextCameraOn
    setMicOn(nextMicOn)
    setCameraOn(nextCameraOn)
    applyLocalMediaState(nextMicOn, nextCameraOn)

    if (publish && joinedRef.current) {
      try {
        const synced = await publishMediaState(nextMicOn, nextCameraOn)
        setMicOn(synced.micOn)
        setCameraOn(synced.cameraOn)
        applyLocalMediaState(synced.micOn, synced.cameraOn)
        setStatus(mediaKind === 'video'
          ? (synced.cameraOn ? 'Camera is live' : 'Camera paused')
          : (synced.micOn ? 'Microphone is live' : 'Microphone muted'))
      } catch (error) {
        setStatus(`${mediaKind === 'video' ? 'Camera' : 'Microphone'} is live, media state sync warning: ${error.message}`)
      }
    }

    return outgoingTrack
  }

  async function flushPendingLocalTracks(options = {}) {
    const pendingTracks = pendingLocalTracksRef.current
    pendingLocalTracksRef.current = []

    for (const pendingTrack of pendingTracks) {
      await attachCapturedLocalTrack(pendingTrack.kind, pendingTrack.track, {
        ...options,
        enabled: pendingTrack.enabled,
      })
    }
  }

  async function attachNewLocalTrack(kind, options = {}) {
    const { track } = await requestLocalMediaTrack(kind, kind === 'audio' ? audioProcessingOptions() : {})
    return attachCapturedLocalTrack(kind, track, options)
  }

  async function createApprovedInitialMediaStream(mediaModeValue, rtcModeValue, options = {}) {
    const wantsMic = options.mic === true
    const wantsCamera = rtcModeValue === 'video' && options.camera === true

    if (!wantsMic && !wantsCamera) {
      return {
        stream: createReceiveOnlyStream(),
        mode: 'receive-only',
        warning: null,
      }
    }

    if (wantsMic && wantsCamera) {
      return createLocalMediaStream(
        mediaModeValue,
        rtcModeValue,
        {
          ...audioProcessingOptions(),
          timeoutMs: options.timeoutMs,
          requiredAudio: true,
          requiredVideo: true,
          onLateTrack: options.onLateTrack,
        }
      )
    }

    const stream = createReceiveOnlyStream()
    if (!stream) throw new Error('This browser cannot create a receive-only media stream.')

    if (wantsMic) {
      const { track } = await requestLocalMediaTrack('audio', audioProcessingOptions())
      stream.addTrack(track)
    }

    if (wantsCamera) {
      const { track } = await requestLocalMediaTrack('video')
      stream.addTrack(track)
    }

    return {
      stream,
      mode: 'real',
      warning: null,
    }
  }

  async function publishMediaState(nextMicOn, nextCameraOn, options = {}) {
    const currentRtcMode = rtcModeRef.current
    const canPublishCurrentStage = Boolean(stageAccessRef.current?.canPublish)
    const allowedMicOn = canPublishCurrentStage && Boolean(nextMicOn)
    const allowedCameraOn = canPublishCurrentStage && canSignalCameraEnabled(nextCameraOn, currentRtcMode)
    if (!joinedRef.current || !activeRoomIdRef.current) return { micOn: allowedMicOn, cameraOn: allowedCameraOn }

    const includesScreenState = Object.prototype.hasOwnProperty.call(options, 'screenShared')
    const data = await apiRequest(`/rooms/${activeRoomIdRef.current}/media-state`, {
      method: 'POST',
      body: JSON.stringify({
        mic_enabled: allowedMicOn,
        camera_enabled: allowedCameraOn,
        ...(includesScreenState ? { screen_shared: canPublishCurrentStage && Boolean(options.screenShared) } : {}),
      }),
    })

    const nextStageAccess = data.rtc?.stage_access ? stageAccessFromRtc(data) : stageAccessRef.current
    const serverCanPublish = Boolean(nextStageAccess?.canPublish)
    const serverMicOn = serverCanPublish && Boolean(data.rtc?.mic_enabled)
    const serverCameraOn = serverCanPublish && canSignalCameraEnabled(data.rtc?.camera_enabled, currentRtcMode)
    micOnRef.current = serverMicOn
    cameraOnRef.current = serverCameraOn
    applyLocalMediaState(serverMicOn, serverCameraOn)
    setMicOn(serverMicOn)
    setCameraOn(serverCameraOn)
    if (nextStageAccess) {
      stageAccessRef.current = nextStageAccess
      setStageAccess(nextStageAccess)
    }

    if (socketRef.current && signalingRoomRef.current) {
      await emitMediaState(socketRef.current, {
        roomId: signalingRoomRef.current,
        stageRole: stageAccessRef.current?.role || 'audience',
        canPublish: Boolean(stageAccessRef.current?.canPublish),
        rtcMode: currentRtcMode,
        micEnabled: serverMicOn,
        cameraEnabled: serverCameraOn,
        ...(includesScreenState ? { screenShared: serverCanPublish && Boolean(data.rtc?.screen_shared) } : {}),
      }).catch((error) => setStatus(`Media state saved, signaling sync failed: ${error.message}`))
    }

    return { micOn: serverMicOn, cameraOn: serverCameraOn }
  }

  async function beginPeerNegotiation(remoteSocketId, rtcClient, label = 'peer') {
    if (!remoteSocketId || !rtcClient) return

    rtcClient.createPeerConnection(remoteSocketId)
    reconcileAudioWatchdog(remoteSocketId)
    reconcileVideoWatchdog(remoteSocketId)

    if (negotiatedPeersRef.current.has(remoteSocketId)) return

    negotiatedPeersRef.current.add(remoteSocketId)
    setPeerStates((previous) => {
      const next = { ...previous, [remoteSocketId]: previous[remoteSocketId] || 'negotiating' }
      peerStatesRef.current = next
      return next
    })

    try {
      const offerSent = await rtcClient.createOffer(remoteSocketId)
      if (offerSent === false) {
        negotiatedPeersRef.current.delete(remoteSocketId)
        setPeerStates((previous) => {
          const next = { ...previous, [remoteSocketId]: 'waiting' }
          peerStatesRef.current = next
          return next
        })
      }
      scheduleNegotiationRetry(remoteSocketId, rtcClient, label)
    } catch (error) {
      negotiatedPeersRef.current.delete(remoteSocketId)
      if (isStalePeerSignalError(error)) {
        forgetRemotePeer(remoteSocketId, rtcClient)
        refreshSignalingPeers(rtcClient, 'stale peer').catch((refreshError) => {
          setStatus(`Peer refresh failed: ${refreshError.message}`)
        })
      } else {
        setConnectionIssue(`${label} negotiation failed: ${error.message}`)
        setStatus(`${label} negotiation failed: ${error.message}`)
        scheduleNegotiationRetry(remoteSocketId, rtcClient, label)
      }
    }
  }

  function clearPeerConnectionState(rtcClient = rtcRef.current) {
    rtcClient?.closeAll?.()
    negotiatedPeersRef.current.clear()
    clearAllVideoWatchdogs()
    clearAllAudioWatchdogs()
    clearAllNegotiationRetries()
    remoteStreamsRef.current = {}
    peerStatesRef.current = {}
    peerStatsRef.current = {}
    peerMediaStatesRef.current = {}
    setRemoteStreams({})
    setPeerStates({})
    setPeerStats({})
    setPeerMediaStates({})
    setSignalingPeerCount(0)
  }

  function isStalePeerSignalError(error) {
    return /target peer|no longer connected|not in this signaling room/i.test(String(error?.message || ''))
  }

  function forgetRemotePeer(socketId, rtcClient = rtcRef.current) {
    if (!socketId) return

    resetPeerVideoWatchdog(socketId)
    resetPeerAudioWatchdog(socketId)
    resetPeerNegotiationRetry(socketId)
    rtcClient?.closePeer?.(socketId)
    negotiatedPeersRef.current.delete(socketId)

    setRemoteStreams((previous) => {
      if (!previous[socketId]) {
        remoteStreamsRef.current = previous
        return previous
      }

      const copy = { ...previous }
      delete copy[socketId]
      remoteStreamsRef.current = copy
      return copy
    })
    setPeerStates((previous) => {
      if (!previous[socketId]) {
        peerStatesRef.current = previous
        return previous
      }

      const copy = { ...previous }
      delete copy[socketId]
      peerStatesRef.current = copy
      return copy
    })
    setPeerStats((previous) => {
      if (!previous[socketId]) {
        peerStatsRef.current = previous
        return previous
      }

      const copy = { ...previous }
      delete copy[socketId]
      peerStatsRef.current = copy
      return copy
    })
    setPeerMediaStates((previous) => {
      if (!previous[socketId]) {
        peerMediaStatesRef.current = previous
        return previous
      }

      const copy = { ...previous }
      delete copy[socketId]
      peerMediaStatesRef.current = copy
      return copy
    })
  }

  async function refreshSignalingPeers(rtcClient = rtcRef.current, reason = 'peer refresh') {
    const socket = socketRef.current
    if (!socket?.connected || !joinedRef.current || !signalingRoomRef.current || !rtcClient) return []

    const response = await requestSignalingPeers(socket, { roomId: signalingRoomRef.current })
    if (response.socketId) localSocketIdRef.current = response.socketId

    const peers = Array.isArray(response.users) ? response.users : []
    const activePeerIds = new Set(peers.map((peer) => peer?.socketId).filter(Boolean))
    const knownPeerIds = new Set([
      ...Object.keys(rtcClient.peerConnections || {}),
      ...Object.keys(remoteStreamsRef.current || {}),
      ...Object.keys(peerStatesRef.current || {}),
      ...Object.keys(peerMediaStatesRef.current || {}),
    ])

    knownPeerIds.forEach((socketId) => {
      if (socketId && !activePeerIds.has(socketId)) forgetRemotePeer(socketId, rtcClient)
    })

    setSignalingPeerCount(peers.length)

    if (peers.length) {
      await negotiateExistingUsers(peers, rtcClient)
    } else {
      setPeerMediaStates({})
      peerMediaStatesRef.current = {}
    }

    setStatus(peers.length
      ? `Refreshed ${peers.length} peer${peers.length === 1 ? '' : 's'} after ${reason}`
      : `No active peers after ${reason}`)

    return peers
  }

  function signalingJoinPayload({
    roomId: payloadRoomId = signalingRoomRef.current,
    rtcMode: payloadRtcMode = rtcModeRef.current,
    micEnabled = micOnRef.current,
    cameraEnabled = cameraOnRef.current,
    screenShared = screenShareTrackRef.current?.readyState === 'live',
  } = {}) {
    const normalizedMode = normalizeRtcMode(payloadRtcMode, room)
    const canPublishCurrentStage = Boolean(stageAccessRef.current?.canPublish)
    const allowedMicEnabled = canPublishCurrentStage && Boolean(micEnabled)
    const allowedCameraEnabled = canPublishCurrentStage && canSignalCameraEnabled(cameraEnabled, normalizedMode)

    return {
      roomId: payloadRoomId,
      databaseRoomId: activeRoomIdRef.current,
      userId: user?.id,
      userName: user?.name || 'User',
      userGender: user?.gender || '',
      userAvatarUrl: user?.avatar_url || '',
      stageRole: stageAccessRef.current?.role || 'audience',
      canPublish: canPublishCurrentStage,
      rtcMode: normalizedMode,
      micEnabled: allowedMicEnabled,
      cameraEnabled: allowedCameraEnabled,
      screenShared: canPublishCurrentStage && Boolean(screenShared),
    }
  }

  async function rejoinSignalingRoom(socket, rtcClient) {
    if (!socket || socketRef.current !== socket || !rtcClient || !joinedRef.current || !signalingRoomRef.current) return
    if (rejoiningSignalingRef.current) return

    rejoiningSignalingRef.current = true

    try {
      setSignalingState('reconnecting')
      setStatus('Restoring signaling room without dropping media...')

      const response = await joinSignalingRoom(socket, signalingJoinPayload())
      localSocketIdRef.current = response.socketId || socket.id
      setSignalingState('connected')
      setConnectionIssue('')

      const peers = Array.isArray(response.users) ? response.users : []
      if (peers.length) {
        await negotiateExistingUsers(peers, rtcClient)
      } else {
        setSignalingPeerCount(0)
      }

      setStatus(peers.length
        ? `Recovered signaling with ${peers.length} peer${peers.length === 1 ? '' : 's'}`
        : 'Signaling recovered')
    } catch (error) {
      setSignalingState('error')
      setConnectionIssue(`Signaling recovery failed: ${error.message}`)
      setStatus(`Signaling recovery failed: ${error.message}`)
    } finally {
      rejoiningSignalingRef.current = false
    }
  }

  function playJoinSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return

      const audioContext = new AudioContextClass()
      const gain = audioContext.createGain()
      const oscillator = audioContext.createOscillator()
      const startSound = () => {
        const startTime = audioContext.currentTime + 0.01

        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(660, startTime)
        oscillator.frequency.exponentialRampToValueAtTime(990, startTime + 0.12)
        gain.gain.setValueAtTime(0.0001, startTime)
        gain.gain.exponentialRampToValueAtTime(0.12, startTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.22)
        oscillator.connect(gain)
        gain.connect(audioContext.destination)
        oscillator.start(startTime)
        oscillator.stop(startTime + 0.24)
        window.setTimeout(() => audioContext.close().catch(() => {}), 360)
      }

      const resumePromise = audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve()
      resumePromise.then(startSound).catch(() => audioContext.close().catch(() => {}))
    } catch {}
  }

  function triggerJoinEffect(name) {
    playJoinSound()
    window.clearTimeout(joinEffectTimerRef.current)
    setJoinEffect({ name: name || 'Guest', key: Date.now() })
    joinEffectTimerRef.current = window.setTimeout(() => setJoinEffect(null), 1800)
  }

  function emitSavedChatMessage(message) {
    if (!message?.id) return

    setExternalChatMessage({ ...message, local_event_key: Date.now() })

    if (socketRef.current && signalingRoomRef.current) {
      socketRef.current.timeout(8000).emit(
        'chat-message',
        {
          roomId: signalingRoomRef.current,
          message: { id: message.id },
        },
        (error, response) => {
          if (error || !response?.ok) setStatus('Message saved. Realtime delivery will resume when signaling reconnects.')
        }
      )
    }
  }

  function openChatTool() {
    setActiveToolPanel(null)
    setChatFocusRequest((request) => request + 1)
    setStatus(room?.chat_enabled === false ? 'Chat is disabled for this room.' : 'Chat composer is ready')
  }

  async function refreshLiveRoomChrome() {
    setStatus('Refreshing room...')
    const jobs = [loadRoomControls({ quiet: true })]
    if (joinedRef.current) jobs.push(refreshSignalingPeers(rtcRef.current, 'manual refresh'))
    await Promise.allSettled(jobs)
  }

  async function loadRoomControls({ quiet = false } = {}) {
    const targetRoomId = activeRoomIdRef.current || Number(room?.id || roomId || 0)
    if (!targetRoomId || controlsLoading) return null

    try {
      setControlsLoading(true)
      if (!quiet) setStatus('Loading room controls...')
      const data = await apiRequest(`/rooms/${targetRoomId}/controls`)
      setRoomControls(data.controls || null)
      if (Array.isArray(data.controls?.stage_requests)) {
        setStageRequests(data.controls.stage_requests.map(normalizeStageRequest))
      }
      if (!quiet) setStatus('Room controls loaded.')
      return data.controls || null
    } catch (error) {
      if (error.status === 403) {
        setRoomControls(null)
        if (!quiet) setStatus('Room controls are available to the owner, admins, and moderators.')
      } else if (!quiet) {
        setStatus(`Room controls failed: ${error.message}`)
      }
      return null
    } finally {
      setControlsLoading(false)
    }
  }

  function openManageTool() {
    setActiveToolPanel((current) => (current === 'manage' ? null : 'manage'))
    loadRoomControls({ quiet: true })
  }

  function normalizeStageRequest(request = {}) {
    const userId = Number(request.userId || request.user_id || 0)
    const socketId = request.socketId || request.socket_id || ''
    const requestId = request.id || request.requestId || request.request_id || `${userId || socketId}:${request.requestedAt || request.requested_at || Date.now()}`
    const requestedMicValue = request.requestedMic ?? request.requested_mic
    const requestedCameraValue = request.requestedCamera ?? request.requested_camera
    const requestedMic = requestedMicValue === undefined || requestedMicValue === null
      ? true
      : requestedMicValue === true || requestedMicValue === 1 || String(requestedMicValue).toLowerCase() === 'true'
    const requestedCamera = requestedCameraValue === true || requestedCameraValue === 1 || String(requestedCameraValue).toLowerCase() === 'true'

    return {
      id: requestId,
      userId,
      socketId,
      userName: request.userName || request.user_name || (userId ? `User #${userId}` : 'Guest'),
      userGender: request.userGender || request.user_gender || '',
      userAvatarUrl: request.userAvatarUrl || request.user_avatar_url || '',
      requestedMic,
      requestedCamera,
      requestedRtcMode: (request.requestedRtcMode || request.requested_rtc_mode) === 'audio' ? 'audio' : 'video',
      status: request.status || 'pending',
      requestedAt: request.requestedAt || request.requested_at || new Date().toISOString(),
    }
  }

  function upsertStageRequest(request) {
    const normalized = normalizeStageRequest(request)
    if (!normalized.userId && !normalized.socketId) return

    setStageRequests((previous) => [
      normalized,
      ...previous.filter((item) => (
        item.id !== normalized.id
        && (!normalized.userId || Number(item.userId) !== normalized.userId)
        && (!normalized.socketId || item.socketId !== normalized.socketId)
      )),
    ].slice(0, 20))
  }

  function removeStageRequest(match = {}) {
    const requestId = match.id || match.requestId || match.request_id || ''
    const userId = Number(match.userId || match.user_id || match.targetUserId || match.target_user_id || 0)
    const socketId = match.socketId || match.socket_id || ''

    setStageRequests((previous) => previous.filter((request) => (
      (requestId && request.id === requestId)
        ? false
        : (userId && Number(request.userId) === userId)
          ? false
          : (socketId && request.socketId === socketId)
            ? false
            : true
    )))
  }

  async function requestStageJoin() {
    if (!joinedRef.current) {
      setStatus('Enter the room before requesting to join the stage.')
      return
    }

    if (stageAccessRef.current?.canPublish) {
      setStatus('You already have permission to join the stage.')
      return
    }

    if (stageAccessRef.current?.requestsEnabled === false || room?.stage_requests_enabled === false) {
      setStatus('Stage requests are closed for this room.')
      return
    }

    const targetRoomId = activeRoomIdRef.current || Number(room?.id || roomId || 0)
    if (!targetRoomId) {
      setStatus('Room is still loading. Try the stage request again in a moment.')
      return
    }

    const requestedCamera = rtcModeRef.current === 'video'
    pendingStageIntentRef.current = { mic: true, camera: requestedCamera }
    setStageRequestSending(true)
    setStageRequestStatus('pending')
    setStatus('Sending request to the room owner...')

    try {
      const response = await apiRequest(`/rooms/${targetRoomId}/stage-requests`, {
        method: 'POST',
        body: JSON.stringify({
          requested_mic: true,
          requested_camera: requestedCamera,
          requested_rtc_mode: rtcModeRef.current,
        }),
      })
      const request = normalizeStageRequest(response.request)

      setOwnStageRequest(request)
      setStageRequestStatus('pending')
      setStatus('Request sent. Waiting for owner approval.')
    } catch (error) {
      pendingStageIntentRef.current = null
      setStageRequestStatus('')
      setOwnStageRequest(null)
      setStatus(`Stage request failed: ${error.message}`)
    } finally {
      setStageRequestSending(false)
    }
  }

  async function cancelStageJoinRequest() {
    const requestId = Number(ownStageRequest?.id || 0)
    const targetRoomId = activeRoomIdRef.current || Number(room?.id || roomId || 0)

    if (!targetRoomId || !requestId || stageRequestSending) return

    setStageRequestSending(true)
    setStatus('Cancelling stage request...')

    try {
      await apiRequest(`/rooms/${targetRoomId}/stage-requests/${requestId}/cancel`, { method: 'POST' })
      pendingStageIntentRef.current = null
      setOwnStageRequest(null)
      setStageRequestStatus('')
      setStatus('Stage request cancelled.')
    } catch (error) {
      setStatus(`Cancel request failed: ${error.message}`)
    } finally {
      setStageRequestSending(false)
    }
  }

  async function activateApprovedStageMedia(intent = pendingStageIntentRef.current) {
    if (!joinedRef.current || !stageAccessRef.current?.canPublish) return

    const targetMic = intent?.mic !== false
    const targetCamera = rtcModeRef.current === 'video' && intent?.camera !== false

    setMediaUpdating((state) => ({ ...state, mic: targetMic, camera: targetCamera }))
    setStatus('Owner approved. Starting your stage media...')

    try {
      if (targetMic && !hasLiveLocalTrack('audio')) {
        await attachNewLocalTrack('audio', { publish: false, enabled: true })
      }

      if (targetCamera && !hasLiveLocalCameraTrack()) {
        await attachNewLocalTrack('video', { publish: false, enabled: true })
      }

      const nextMicOn = targetMic && hasLiveLocalTrack('audio')
      const nextCameraOn = targetCamera && hasLiveLocalCameraTrack()
      micOnRef.current = nextMicOn
      cameraOnRef.current = nextCameraOn
      desiredMicOnRef.current = nextMicOn
      desiredCameraOnRef.current = nextCameraOn
      setMicOn(nextMicOn)
      setCameraOn(nextCameraOn)
      applyLocalMediaState(nextMicOn, nextCameraOn)
      await publishMediaState(nextMicOn, nextCameraOn)
      setStageRequestStatus('')
      setOwnStageRequest(null)
      pendingStageIntentRef.current = null
      setStatus(nextMicOn || nextCameraOn ? 'You are now on stage.' : 'You are now on stage. Turn on mic or camera when ready.')
    } catch (error) {
      setStatus(`Owner approved, but media could not start: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, mic: false, camera: false }))
    }
  }

  async function applyStagePermission(request, action) {
    const targetUserId = Number(request?.userId || request?.user_id || 0)
    const requestId = Number(request?.id || request?.requestId || request?.request_id || 0)
    const actionKey = requestId || targetUserId
    const targetRoomId = activeRoomIdRef.current || Number(room?.id || roomId || 0)
    if (!targetRoomId || !targetUserId || stageRequestActionIds[actionKey]) return

    setStageRequestActionIds((previous) => ({ ...previous, [actionKey]: action }))
    setStatus(action === 'approve' ? 'Approving stage request...' : 'Declining stage request...')

    try {
      const requestPath = requestId && ['approve', 'reject'].includes(action)
        ? `/rooms/${targetRoomId}/stage-requests/${requestId}/${action}`
        : `/rooms/${targetRoomId}/participants/${targetUserId}/stage`
      const data = await apiRequest(requestPath, {
        method: 'POST',
        body: requestId && ['approve', 'reject'].includes(action) ? undefined : JSON.stringify({ action }),
      })
      if (data.controls) setRoomControls(data.controls)
      removeStageRequest({ id: requestId, userId: targetUserId })
      setStatus(action === 'approve'
        ? `${request.userName || `User #${targetUserId}`} can join the stage.`
        : `${request.userName || `User #${targetUserId}`} remains audience.`)
    } catch (error) {
      setStatus(`Stage permission failed: ${error.message}`)
    } finally {
      setStageRequestActionIds((previous) => {
        const next = { ...previous }
        delete next[actionKey]
        return next
      })
    }
  }

  async function applyParticipantModeration(participant, action) {
    const targetUserId = Number(participant?.user_id || 0)
    const targetRoomId = activeRoomIdRef.current || Number(room?.id || roomId || 0)
    if (!targetRoomId || !targetUserId || moderatingUserIds[targetUserId]) return

    setModeratingUserIds((previous) => ({ ...previous, [targetUserId]: true }))
    setStatus('')

    try {
      const pathAction = action === 'disable_camera' ? 'moderation' : action === 'mute_mic' ? 'mute' : action
      const data = await apiRequest(`/rooms/${targetRoomId}/participants/${targetUserId}/${pathAction}`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          ...(action === 'ban' ? { ban_type: 'temporary', duration_minutes: 60, reason: 'Room moderation' } : {}),
        }),
      })
      if (data.controls) setRoomControls(data.controls)
      setStatus(`${participant.user_name || `User #${targetUserId}`} ${action === 'mute_mic' ? 'muted' : action === 'disable_camera' ? 'camera paused' : action === 'kick' ? 'removed' : 'banned'}.`)
    } catch (error) {
      setStatus(`Moderation failed: ${error.message}`)
    } finally {
      setModeratingUserIds((previous) => {
        const next = { ...previous }
        delete next[targetUserId]
        return next
      })
    }
  }

  async function revokeRoomBan(ban) {
    const targetRoomId = activeRoomIdRef.current || Number(room?.id || roomId || 0)
    const banId = Number(ban?.id || 0)
    if (!targetRoomId || !banId || revokingBanIds[banId]) return

    setRevokingBanIds((previous) => ({ ...previous, [banId]: true }))
    setStatus('')

    try {
      const data = await apiRequest(`/rooms/${targetRoomId}/bans/${banId}`, {
        method: 'DELETE',
      })
      if (data.controls) setRoomControls(data.controls)
      setStatus(`${ban.user_name || `User #${ban.banned_user_id}`} can enter this room again.`)
    } catch (error) {
      setStatus(`Unban failed: ${error.message}`)
    } finally {
      setRevokingBanIds((previous) => {
        const next = { ...previous }
        delete next[banId]
        return next
      })
    }
  }

  async function saveRoomRole(removeRole = false) {
    const targetRoomId = activeRoomIdRef.current || Number(room?.id || roomId || 0)
    const targetUserId = Number(roleForm.userId || 0)
    const roleTargets = buildRoomRoleTargets(roomControls)
    const targetUser = roleTargets.find((target) => Number(target.userId) === targetUserId)
    const targetName = targetUser?.name || `User #${targetUserId}`

    if (!targetRoomId) {
      setRoleFeedback({ type: 'error', text: 'Room is not ready yet.' })
      return
    }
    if (!targetUserId) {
      setRoleFeedback({ type: 'error', text: 'Choose a user first.' })
      return
    }
    if (roleSaving) return

    setRoleSaving(true)
    setRoleSavingAction(removeRole ? 'remove' : 'assign')
    setRoleFeedback({ type: 'pending', text: `${removeRole ? 'Removing role for' : `Assigning ${roleForm.role} to`} ${targetName}...` })
    setStatus('')

    try {
      const data = await apiRequest(removeRole
        ? `/rooms/${targetRoomId}/roles/${targetUserId}`
        : `/rooms/${targetRoomId}/roles`, {
        method: removeRole ? 'DELETE' : 'POST',
        body: removeRole ? undefined : JSON.stringify({ user_id: targetUserId, role: roleForm.role }),
      })
      if (data.controls) setRoomControls(data.controls)
      const message = data.message || (removeRole ? 'Room role removed.' : 'Room role assigned.')
      setRoleFeedback({ type: 'success', text: `${targetName}: ${message}` })
      setStatus(message)
    } catch (error) {
      const message = `Role update failed: ${error.message}`
      setRoleFeedback({ type: 'error', text: `${targetName}: ${message}` })
      setStatus(message)
    } finally {
      setRoleSaving(false)
      setRoleSavingAction('')
    }
  }

  function uniqueIds(values = []) {
    return Array.from(new Set(values.map((value) => Number(value || 0)).filter(Boolean)))
  }

  function upsertFollowRequest(requests = [], request) {
    if (!request?.id) return requests
    const requestId = Number(request.id)
    return [request, ...requests.filter((item) => Number(item.id) !== requestId)]
  }

  function removeFollowRequest(requests = [], requestId) {
    const normalizedId = Number(requestId || 0)
    return requests.filter((request) => Number(request.id) !== normalizedId)
  }

  function peerFromFollowRequest(request, side = 'requester') {
    const peer = side === 'recipient' ? request?.recipient : request?.requester
    const fallbackId = side === 'recipient' ? request?.recipient_id : request?.requester_id

    return {
      id: Number(peer?.id || fallbackId || 0),
      name: peer?.name || `User #${fallbackId}`,
      avatar_url: peer?.avatar_url || '',
      gender: peer?.gender || '',
    }
  }

  async function loadFollowRelations({ quiet = false } = {}) {
    if (!user?.id) return

    try {
      const data = await apiRequest('/follow-requests')
      const incoming = Array.isArray(data.incoming) ? data.incoming : []
      const outgoing = Array.isArray(data.outgoing) ? data.outgoing : []
      setFollowRelations({
        followingIds: uniqueIds(data.following_user_ids || []),
        outgoingIds: uniqueIds(outgoing.map((request) => request.recipient_id)),
        incoming,
      })
      if (!quiet && incoming.length) setActiveFollowRequestId(Number(incoming[0].id))
    } catch (error) {
      if (!quiet) setStatus(`Follow state failed: ${error.message}`)
    }
  }

  function followStatusForPeer(peerId) {
    const normalizedId = Number(peerId || 0)
    if (!normalizedId || normalizedId === Number(user?.id || 0)) return ''
    if (followActionIds[normalizedId]) return 'loading'
    if (followRelations.followingIds.some((id) => Number(id) === normalizedId)) return 'following'
    if (followRelations.outgoingIds.some((id) => Number(id) === normalizedId)) return 'requested'
    if (followRelations.incoming.some((request) => Number(request.requester_id) === normalizedId)) return 'incoming'
    return ''
  }

  function openPeerInbox(peer) {
    if (!peer?.id) return
    setInboxPeerRequest({ ...peer, key: Date.now() })
    setActiveToolPanel(null)
    setChatFocusRequest((request) => request + 1)
  }

  async function requestPeerFollow(peer) {
    const peerId = Number(peer?.id || 0)
    if (!peerId || peerId === Number(user?.id || 0) || followActionIds[peerId]) return

    setFollowActionIds((previous) => ({ ...previous, [peerId]: true }))
    setStatus('')

    try {
      const data = await apiRequest(`/users/${peerId}/follow-requests`, { method: 'POST' })
      if (data.following) {
        setFollowRelations((previous) => ({
          ...previous,
          followingIds: uniqueIds([...previous.followingIds, peerId]),
          outgoingIds: previous.outgoingIds.filter((id) => Number(id) !== peerId),
        }))
        setFollowRefreshKey((key) => key + 1)
        openPeerInbox(peer)
      } else {
        setFollowRelations((previous) => ({
          ...previous,
          outgoingIds: uniqueIds([...previous.outgoingIds, peerId]),
        }))
        setStatus(`Follow request sent to ${peer.name || `User #${peerId}`}.`)
      }
    } catch (error) {
      setStatus(`Follow request failed: ${error.message}`)
    } finally {
      setFollowActionIds((previous) => {
        const next = { ...previous }
        delete next[peerId]
        return next
      })
    }
  }

  function handlePeerFollowAction(peer) {
    const peerId = Number(peer?.id || 0)
    const status = followStatusForPeer(peerId)

    if (status === 'following') {
      openPeerInbox(peer)
      return
    }

    if (status === 'incoming') {
      const request = followRelations.incoming.find((item) => Number(item.requester_id) === peerId)
      if (request?.id) setActiveFollowRequestId(Number(request.id))
      return
    }

    if (status === 'requested' || status === 'loading') return
    requestPeerFollow(peer)
  }

  async function respondToFollowRequest(request, action) {
    if (!request?.id || !['accept', 'reject'].includes(action)) return

    const peer = peerFromFollowRequest(request, 'requester')
    const peerId = Number(peer.id || 0)
    setFollowActionIds((previous) => ({ ...previous, [peerId]: true }))
    setStatus('')

    try {
      const data = await apiRequest(`/follow-requests/${request.id}/${action}`, { method: 'POST' })
      setFollowRelations((previous) => ({
        ...previous,
        incoming: removeFollowRequest(previous.incoming, request.id),
        followingIds: action === 'accept' ? uniqueIds([...previous.followingIds, peerId]) : previous.followingIds,
      }))
      setActiveFollowRequestId(null)

      if (action === 'accept') {
        setFollowRefreshKey((key) => key + 1)
        setStatus(`You accepted ${peer.name || 'this user'}. Private chat is open.`)
        openPeerInbox(peer)
      } else {
        setStatus(`Follow request from ${peer.name || 'this user'} was declined.`)
      }

      if (data.request?.id) loadFollowRelations({ quiet: true })
    } catch (error) {
      setStatus(`Follow response failed: ${error.message}`)
    } finally {
      setFollowActionIds((previous) => {
        const next = { ...previous }
        delete next[peerId]
        return next
      })
    }
  }

  function toggleToolPanel(panel) {
    if (panel === 'chat') {
      openChatTool()
      return
    }

    setActiveToolPanel((current) => (current === panel ? null : panel))
  }

  function stageResizeBounds() {
    const panelRect = stagePanelRef.current?.getBoundingClientRect?.()
    const frameRect = stageStreamsRef.current?.getBoundingClientRect?.()
    const fallbackWidth = frameRect?.width || 640
    const fallbackHeight = frameRect?.height || 360
    const maxWidth = Math.max(320, (panelRect?.width || fallbackWidth + 72) - 72)
    const maxHeight = Math.max(220, (panelRect?.height || fallbackHeight + 190) - 190)
    const minWidth = Math.min(maxWidth, visibleResizeMinWidth())
    const minHeight = Math.min(maxHeight, visibleResizeMinHeight())

    return { maxWidth, maxHeight, minWidth, minHeight }
  }

  function visibleResizeMinWidth() {
    const tileCount = Number(stageResizeRef.current?.tileCount || 0)
    if (tileCount <= 1) return 320
    if (tileCount === 2) return 460
    return 520
  }

  function visibleResizeMinHeight() {
    const tileCount = Number(stageResizeRef.current?.tileCount || 0)
    return tileCount <= 1 ? 220 : 180
  }

  function stopStageResize() {
    const resize = stageResizeRef.current
    if (!resize) return

    window.removeEventListener('pointermove', resize.handleMove)
    window.removeEventListener('pointerup', resize.handleEnd)
    window.removeEventListener('pointercancel', resize.handleEnd)
    document.body.classList.remove('buzzcast-stage-resizing')
    stageResizeRef.current = null
  }

  function startStageResize(event, axis) {
    if (event.button !== undefined && event.button !== 0) return
    const frame = stageStreamsRef.current
    if (!frame) return

    event.preventDefault()
    event.stopPropagation()

    const rect = frame.getBoundingClientRect()
    const tileCount = Number(frame.dataset.tileCount || 1)
    stageResizeRef.current = {
      axis,
      centerX: rect.left + (rect.width / 2),
      centerY: rect.top + (rect.height / 2),
      width: rect.width,
      height: rect.height,
      tileCount,
      handleMove: null,
      handleEnd: null,
    }
    const bounds = stageResizeBounds()

    function handleMove(moveEvent) {
      const active = stageResizeRef.current
      if (!active) return

      const nextWidth = axis.includes('x')
        ? Math.abs(moveEvent.clientX - active.centerX) * 2
        : active.width
      const nextHeight = axis.includes('y')
        ? Math.abs(moveEvent.clientY - active.centerY) * 2
        : active.height

      setStageFrameSize({
        width: Math.round(clampNumber(nextWidth, bounds.minWidth, bounds.maxWidth)),
        height: Math.round(clampNumber(nextHeight, bounds.minHeight, bounds.maxHeight)),
      })
    }

    function handleEnd() {
      stopStageResize()
    }

    stageResizeRef.current.handleMove = handleMove
    stageResizeRef.current.handleEnd = handleEnd
    document.body.classList.add('buzzcast-stage-resizing')
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleEnd)
    window.addEventListener('pointercancel', handleEnd)
  }

  function currentCameraTrack(excludeTrack = null) {
    if (isLiveTrack(filteredCameraTrackRef.current) && filteredCameraTrackRef.current !== excludeTrack) {
      return filteredCameraTrackRef.current
    }

    if (isLiveTrack(cameraSourceTrackRef.current) && cameraSourceTrackRef.current !== excludeTrack) {
      return cameraSourceTrackRef.current
    }

    return streamRef.current?.getVideoTracks?.().find((track) => (
      track !== excludeTrack && track.readyState === 'live' && track !== screenShareTrackRef.current
    )) || null
  }

  async function syncScreenShareState(nextScreenSharing) {
    if (!joinedRef.current || !activeRoomIdRef.current) return
    await publishMediaState(micOnRef.current, cameraOnRef.current, { screenShared: nextScreenSharing })
  }

  async function stopScreenShare({ fromTrackEnded = false } = {}) {
    const track = screenShareTrackRef.current
    if (!track && !screenSharing) return

    screenShareTrackRef.current = null
    setMediaUpdating((state) => ({ ...state, screen: true }))

    try {
      if (track) {
        track.onended = null
        streamRef.current?.removeTrack?.(track)
        if (!fromTrackEnded && track.readyState !== 'ended') {
          try { track.stop() } catch {}
        }
      }

      const cameraTrack = currentCameraTrack(track)

      if (cameraOnRef.current && cameraTrack) {
        await rtcRef.current?.replaceLocalTrack('video', cameraTrack, streamRef.current)
      } else if (cameraOnRef.current && joinedRef.current && rtcModeRef.current === 'video') {
        const restoredTrack = await attachNewLocalTrack('video', { publish: false })
        await rtcRef.current?.replaceLocalTrack('video', restoredTrack, streamRef.current)
      } else {
        await rtcRef.current?.replaceLocalTrack('video', null, streamRef.current)
      }

      setScreenSharing(false)
      await syncScreenShareState(false)
      setStatus('Screen share stopped')
    } catch (error) {
      setStatus(`Screen share stop failed: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, screen: false }))
    }
  }

  async function startScreenShare() {
    if (!joined) {
      setStatus('Connect RTC before starting screen share.')
      setActiveToolPanel('screen')
      return
    }

    if (!stageAccessRef.current?.canPublish) {
      setStatus('Ask the room owner before sharing your screen.')
      setActiveToolPanel('screen')
      return
    }

    if (room?.screen_share_enabled === false) {
      setStatus('Screen share is disabled for this room.')
      setActiveToolPanel('screen')
      return
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus('This browser does not support screen sharing.')
      setActiveToolPanel('screen')
      return
    }

    try {
      setMediaUpdating((state) => ({ ...state, screen: true }))
      setStatus('Choose a screen or window to share...')
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 15, max: 20 },
        },
        audio: false,
      })
      const [track] = displayStream.getVideoTracks()
      if (!track) throw new Error('No screen video track was selected.')

      if (screenShareTrackRef.current) {
        await stopScreenShare()
      }

      screenShareTrackRef.current = track
      track.contentHint = 'detail'
      track.onended = () => {
        stopScreenShare({ fromTrackEnded: true }).catch((error) => setStatus(`Screen share stopped with warning: ${error.message}`))
      }

      const targetStream = new MediaStream([
        track,
        ...((streamRef.current || displayStream).getTracks?.().filter((item) => item !== track) || []),
      ])
      if (typeof streamRef.current?.__cleanup === 'function') {
        targetStream.__cleanup = streamRef.current.__cleanup
      }
      streamRef.current = targetStream
      setLocalStream(targetStream)

      await rtcRef.current?.replaceLocalTrack('video', track, targetStream)
      setScreenSharing(true)
      setActiveToolPanel('screen')
      await syncScreenShareState(true)
      setStatus('Screen share is live')
    } catch (error) {
      if (screenShareTrackRef.current) {
        await stopScreenShare().catch(() => {})
      }
      setStatus(error.name === 'NotAllowedError' ? 'Screen share was cancelled.' : `Screen share failed: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, screen: false }))
    }
  }

  async function toggleScreenShare() {
    if (mediaUpdating.screen) return
    if (screenSharing) return stopScreenShare()
    return startScreenShare()
  }

  async function changeCameraFilter(filterId) {
    if (mediaUpdating.filter) return

    const normalizedFilterId = normalizeVideoFilterId(filterId)
    const filter = getVideoFilter(normalizedFilterId)

    setCameraFilter(normalizedFilterId)
    cameraFilterRef.current = normalizedFilterId

    if (rtcModeRef.current === 'audio') {
      setStatus('Camera filters are available in video rooms.')
      return
    }

    if (!joinedRef.current) {
      setStatus(`${filter.label} filter selected. It will apply when you connect RTC.`)
      return
    }

    setMediaUpdating((state) => ({ ...state, filter: true }))

    try {
      let sourceTrack = rememberCameraSourceFromStream()

      if (!sourceTrack && cameraOnRef.current && !screenShareTrackRef.current) {
        setStatus('Requesting camera for filter...')
        const { track } = await requestLocalMediaTrack('video')
        cameraSourceTrackRef.current = track
        sourceTrack = track
      }

      if (sourceTrack) {
        await syncCameraFilterTrack({
          filterId: normalizedFilterId,
          backgroundEffectValue: backgroundEffectRef.current,
          backgroundBlurAmountValue: backgroundBlurAmountRef.current,
          replaceOutgoing: !screenShareTrackRef.current,
        })
      }

      if (!sourceTrack && normalizedFilterId !== 'normal') {
        setStatus(`${filter.label} filter selected. Turn camera on to apply it.`)
      } else if (screenShareTrackRef.current) {
        setStatus(`${filter.label} filter selected. It will apply when screen share stops.`)
      } else {
        setStatus(normalizedFilterId === 'normal' ? 'Camera filter removed' : `${filter.label} camera filter applied`)
      }
    } catch (error) {
      setCameraFilter('normal')
      cameraFilterRef.current = 'normal'
      stopCameraFilterPipeline({ stopSource: false })
      await syncCameraFilterTrack({
        filterId: 'normal',
        backgroundEffectValue: backgroundEffectRef.current,
        backgroundBlurAmountValue: backgroundBlurAmountRef.current,
        replaceOutgoing: !screenShareTrackRef.current,
      }).catch(() => {})
      setStatus(`Camera filter failed: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, filter: false }))
    }
  }

  async function applyBeautySettings(nextSettings, successStatus = 'Filter settings applied') {
    const normalizedSettings = normalizeBeautySettings(nextSettings)
    const effectActive = isCameraFilterEffectActive(cameraFilterRef.current, normalizedSettings, backgroundEffectRef.current)
    const pipeline = cameraFilterPipelineRef.current
    const sharingScreen = Boolean(screenShareTrackRef.current)

    setBeautySettings(normalizedSettings)
    beautySettingsRef.current = normalizedSettings

    if (rtcModeRef.current === 'audio') {
      setStatus('Filters are available in video rooms.')
      return
    }

    if (!joinedRef.current) {
      setStatus('Filter settings selected. They will apply when you enter the room.')
      return
    }

    try {
      if (pipeline && isLiveTrack(filteredCameraTrackRef.current) && effectActive) {
        pipeline.setBeautySettings(normalizedSettings)
        setStatus(sharingScreen ? 'Filter settings selected. They will apply when screen share stops.' : successStatus)
        return
      }

      let sourceTrack = rememberCameraSourceFromStream()

      if (!sourceTrack && cameraOnRef.current && !screenShareTrackRef.current) {
        const { track } = await requestLocalMediaTrack('video')
        cameraSourceTrackRef.current = track
        sourceTrack = track
      }

      if (sourceTrack) {
        await syncCameraFilterTrack({
          beautySettingsValue: normalizedSettings,
          backgroundEffectValue: backgroundEffectRef.current,
          backgroundBlurAmountValue: backgroundBlurAmountRef.current,
          replaceOutgoing: !screenShareTrackRef.current,
        })
      }

      if (!sourceTrack && effectActive) {
        setStatus('Filter settings selected. Turn camera on to apply them.')
      } else if (screenShareTrackRef.current) {
        setStatus('Filter settings selected. They will apply when screen share stops.')
      } else {
        setStatus(successStatus)
      }
    } catch (error) {
      setStatus(`Filter failed: ${error.message}`)
    }
  }

  function changeBeautySetting(settingId, value) {
    const nextSettings = normalizeBeautySettings({
      ...beautySettingsRef.current,
      [settingId]: value,
    })

    applyBeautySettings(nextSettings).catch((error) => setStatus(`Filter failed: ${error.message}`))
  }

  function toggleBeautyMirror() {
    const mirrorEnabled = !Boolean(beautySettingsRef.current?.mirror)
    const nextSettings = normalizeBeautySettings({
      ...beautySettingsRef.current,
      mirror: mirrorEnabled,
    })

    applyBeautySettings(nextSettings, mirrorEnabled ? 'Mirror camera applied' : 'Mirror camera removed')
      .catch((error) => setStatus(`Mirror failed: ${error.message}`))
  }

  function toggleBackgroundBlur() {
    const nextEffect = backgroundEffectRef.current === 'blur' ? 'none' : 'blur'
    changeBackgroundEffect(nextEffect).catch((error) => setStatus(`Background blur failed: ${error.message}`))
  }

  function changeBackgroundBlurAmount(value) {
    const normalizedAmount = normalizeBackgroundBlurAmount(value)

    setBackgroundBlurAmount(normalizedAmount)
    backgroundBlurAmountRef.current = normalizedAmount

    const pipeline = cameraFilterPipelineRef.current
    if (pipeline && isLiveTrack(filteredCameraTrackRef.current)) {
      pipeline.setBackgroundBlurAmount(normalizedAmount)
    }

    setStatus(
      backgroundEffectRef.current === 'blur'
        ? `Background blur amount set to ${normalizedAmount}%.`
        : `Background blur amount set to ${normalizedAmount}%. Press BG to turn blur on.`
    )
  }

  async function changeBackgroundEffect(effectId) {
    if (mediaUpdating.filter) return

    const normalizedEffectId = normalizeBackgroundEffectId(effectId)
    const effect = getBackgroundEffect(normalizedEffectId)

    setBackgroundEffect(normalizedEffectId)
    backgroundEffectRef.current = normalizedEffectId

    if (rtcModeRef.current === 'audio') {
      setStatus('Background effects are available in video rooms.')
      return
    }

    if (!joinedRef.current) {
      setStatus(`${effect.label} background selected. It will apply when you connect RTC.`)
      return
    }

    setMediaUpdating((state) => ({ ...state, filter: true }))

    try {
      let sourceTrack = rememberCameraSourceFromStream()

      if (!sourceTrack && cameraOnRef.current && !screenShareTrackRef.current) {
        setStatus('Requesting camera for background effect...')
        const { track } = await requestLocalMediaTrack('video')
        cameraSourceTrackRef.current = track
        sourceTrack = track
      }

      if (sourceTrack) {
        await syncCameraFilterTrack({
          backgroundEffectValue: normalizedEffectId,
          backgroundBlurAmountValue: backgroundBlurAmountRef.current,
          replaceOutgoing: !screenShareTrackRef.current,
        })
      }

      if (!sourceTrack && normalizedEffectId !== 'none') {
        setStatus(`${effect.label} background selected. Turn camera on to apply it.`)
      } else if (screenShareTrackRef.current) {
        setStatus(`${effect.label} background selected. It will apply when screen share stops.`)
      } else {
        setStatus(normalizedEffectId === 'none' ? 'Background effect removed' : `${effect.label} background applied`)
      }
    } catch (error) {
      setBackgroundEffect('none')
      backgroundEffectRef.current = 'none'
      stopCameraFilterPipeline({ stopSource: false })
      await syncCameraFilterTrack({
        backgroundEffectValue: 'none',
        backgroundBlurAmountValue: backgroundBlurAmountRef.current,
        replaceOutgoing: !screenShareTrackRef.current,
      }).catch(() => {})
      setStatus(`Background effect failed: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, filter: false }))
    }
  }

  async function resetCameraEffects() {
    if (mediaUpdating.filter) return

    setCameraFilter('normal')
    cameraFilterRef.current = 'normal'
    setBeautySettings(DEFAULT_BEAUTY_SETTINGS)
    beautySettingsRef.current = DEFAULT_BEAUTY_SETTINGS
    setBackgroundEffect('none')
    backgroundEffectRef.current = 'none'
    setBackgroundBlurAmount(DEFAULT_BACKGROUND_BLUR_AMOUNT)
    backgroundBlurAmountRef.current = DEFAULT_BACKGROUND_BLUR_AMOUNT
    setCameraFilterPerformance('720p / 24fps')

    if (rtcModeRef.current === 'audio') {
      setStatus('Camera effects reset. They are available in video rooms.')
      return
    }

    if (!joinedRef.current) {
      stopCameraFilterPipeline({ stopSource: false })
      setStatus('Camera effects reset. They will stay normal when you connect RTC.')
      return
    }

    setMediaUpdating((state) => ({ ...state, filter: true }))

    try {
      const sourceTrack = rememberCameraSourceFromStream()
      if (sourceTrack) {
        await syncCameraFilterTrack({
          filterId: 'normal',
          beautySettingsValue: DEFAULT_BEAUTY_SETTINGS,
          backgroundEffectValue: 'none',
          backgroundBlurAmountValue: DEFAULT_BACKGROUND_BLUR_AMOUNT,
          replaceOutgoing: !screenShareTrackRef.current,
        })
      } else {
        stopCameraFilterPipeline({ stopSource: false })
      }

      setStatus(screenShareTrackRef.current ? 'Camera effects reset. Screen share stays unchanged.' : 'Camera effects reset')
    } catch (error) {
      setStatus(`Camera effects reset failed: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, filter: false }))
    }
  }

  function isPolitePeer(remoteSocketId) {
    const localSocketId = localSocketIdRef.current
    if (!localSocketId || !remoteSocketId) return true
    return String(localSocketId) > String(remoteSocketId)
  }

  function handleRemoteStream(remoteSocketId, remoteStream) {
    resetPeerNegotiationRetry(remoteSocketId)
    setRemoteStreams((previous) => {
      const next = { ...previous, [remoteSocketId]: remoteStream }
      remoteStreamsRef.current = next
      return next
    })

    if (hasInboundAudioTrack(remoteStream)) {
      resetPeerAudioWatchdog(remoteSocketId)
      clearReconnectingPeerState(remoteSocketId)
    } else {
      reconcileAudioWatchdog(remoteSocketId)
    }

    const hasVideoTrack = hasInboundVideoTrack(remoteStream)
    if (hasVideoTrack) {
      resetPeerVideoWatchdog(remoteSocketId)
      setPeerStateValue(remoteSocketId, 'connected')
      setPeerMediaStates((previous) => {
        const current = previous[remoteSocketId] || {}
        const cameraWasExplicitlyOff = current.cameraOn === false && current.screenShared !== true
        const next = {
          ...previous,
          [remoteSocketId]: {
            ...current,
            cameraOn: cameraWasExplicitlyOff ? false : true,
            rtcMode: cameraWasExplicitlyOff ? (current.rtcMode || 'video') : 'video',
          },
        }
        peerMediaStatesRef.current = next
        return next
      })
    } else {
      setPeerStates((previous) => {
        const next = { ...previous, [remoteSocketId]: previous[remoteSocketId] || 'connected' }
        peerStatesRef.current = next
        return next
      })
    }
  }

  async function negotiateExistingUsers(existingUsers, rtcClient) {
    const peers = Array.isArray(existingUsers) ? existingUsers : []
    setSignalingPeerCount(peers.length)
    setPeerMediaStates((previous) => {
      const next = { ...previous, ...peerMediaMapFromUsers(peers) }
      peerMediaStatesRef.current = next
      return next
    })
    if (!peers.length) return

    setStatus(`Found ${peers.length} peer connection${peers.length === 1 ? '' : 's'}...`)

    for (const remoteUser of peers) {
      await beginPeerNegotiation(remoteUser?.socketId, rtcClient, 'Peer')
    }
  }

  async function joinRoom() {
    let backendJoined = false
    let startupCancelled = false

    try {
      if (joinedRef.current || joining) return
      setJoining(true)
      updateJoined(false)
      setConnectAttempted(true)
      setConnectionIssue('')
      setRtcConfigState(null)
      setSignalingState('idle')
      setMediaState('idle')
      setShowPasswordRecovery(false)
      resetRtcState()
      setConnectStep('backend')
      setStatus('Entering room...')

      const selectedRtcMode = normalizeRtcMode(rtcMode, room)
      const requestedMicIntent = Boolean(micOnRef.current)
      const requestedCameraIntent = selectedRtcMode === 'video' && Boolean(cameraOnRef.current)
      desiredMicOnRef.current = requestedMicIntent
      desiredCameraOnRef.current = requestedCameraIntent
      const rtcConfigPromise = getRtcConfig().catch((error) => {
        setConnectionIssue(`Connection setup warning: ${error.message}`)
        return { iceServers: [], iceTransportPolicy: 'all', turnConfigured: false }
      })
      const socket = createSignalingSocket()
      socketRef.current = socket
      const socketReadyPromise = waitForSocketConnection(socket)
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error }))

      setMediaState('idle')
      setSignalingState('connecting')
      setStatus('Preparing live room...')

      const joinData = await apiRequest(`/rooms/${roomId}/join`, {
        method: 'POST',
        body: JSON.stringify({
          ...(roomPasswordInput ? { password: roomPasswordInput } : {}),
          rtc_mode: selectedRtcMode,
          mic_enabled: requestedMicIntent,
          camera_enabled: requestedCameraIntent,
        }),
      })

      backendJoined = true
      const joinedRtcMode = joinData.rtc.rtc_mode || (joinData.rtc.camera_enabled ? 'video' : 'audio')
      const joinedStageAccess = stageAccessFromRtc(joinData)
      const joinedStageRequest = joinData.rtc.stage_request ? normalizeStageRequest(joinData.rtc.stage_request) : null
      stageAccessRef.current = joinedStageAccess
      setStageAccess(joinedStageAccess)
      setOwnStageRequest(joinedStageRequest)
      setStageRequestStatus(joinedStageAccess.canPublish ? '' : joinedStageRequest ? 'pending' : '')
      setRoom(joinData.room)
      setSession(joinData.session)
      activeRoomIdRef.current = Number(roomId)
      signalingRoomRef.current = joinData.rtc.signaling_room
      setRtcMode(joinedRtcMode)
      rtcModeRef.current = joinedRtcMode
      micOnRef.current = joinedStageAccess.canPublish && Boolean(joinData.rtc.mic_enabled)
      cameraOnRef.current = joinedStageAccess.canPublish && joinedRtcMode === 'video' && Boolean(joinData.rtc.camera_enabled)
      desiredMicOnRef.current = micOnRef.current
      desiredCameraOnRef.current = cameraOnRef.current
      setMicOn(micOnRef.current)
      setCameraOn(cameraOnRef.current)

      setConnectStep('media')
      setMediaState('starting')
      setStatus(joinedStageAccess.canPublish ? 'Starting approved stage media...' : 'Entering as audience...')
      const mediaResult = await createApprovedInitialMediaStream(
        mediaMode === 'real' ? 'real' : mediaMode === 'mock' ? 'mock' : 'auto',
        joinedRtcMode,
        {
          mic: micOnRef.current,
          camera: cameraOnRef.current,
          timeoutMs: LOCAL_MEDIA_FAST_TIMEOUT_MS,
          onLateTrack: ({ kind, track }) => {
            if (startupCancelled) {
              try { track.stop() } catch {}
              return
            }

            attachCapturedLocalTrack(kind, track, {
              enabled: kind === 'audio' ? desiredMicOnRef.current : desiredCameraOnRef.current,
            }).catch((error) => {
              try { track.stop() } catch {}
              setStatus(`${kind === 'video' ? 'Camera' : 'Microphone'} started late but could not attach: ${error.message}`)
            })
          },
        }
      ).catch((error) => ({ error }))
      const rtcConfig = await rtcConfigPromise
      if (mediaResult?.error) throw mediaResult.error
      const media = mediaResult
      if (joinedRtcMode === 'audio') {
        media.stream.getVideoTracks().forEach((track) => {
          media.stream.removeTrack(track)
          try { track.stop() } catch {}
        })
      }
      const cameraReadyStream = await prepareStreamWithCameraFilter(media.stream, joinedRtcMode)
      const localMediaStream = await prepareStreamWithAudioEffect(cameraReadyStream)
      streamRef.current = localMediaStream
      setLocalStream(localMediaStream)
      setMediaMode(media.mode || 'real')
      monitorLocalCameraTracks(localMediaStream)
      setMediaState(media.warning ? 'warning' : 'ready')

      const requestedMicOn = Boolean(joinData.rtc.mic_enabled)
      const requestedCameraOn = joinedRtcMode === 'video' && Boolean(joinData.rtc.camera_enabled)
      let actualMicOn = requestedMicOn && hasLiveTrack(localMediaStream, 'audio')
      let actualCameraOn = requestedCameraOn && hasLiveLocalCameraTrack()

      micOnRef.current = actualMicOn
      cameraOnRef.current = actualCameraOn
      setMicOn(actualMicOn)
      setCameraOn(actualCameraOn)
      localMediaStream.getAudioTracks().forEach((track) => { track.enabled = actualMicOn })
      if (audioSourceTrackRef.current) audioSourceTrackRef.current.enabled = actualMicOn
      if (processedAudioTrackRef.current) processedAudioTrackRef.current.enabled = actualMicOn
      localMediaStream.getVideoTracks().forEach((track) => { track.enabled = actualCameraOn })
      if (cameraSourceTrackRef.current) cameraSourceTrackRef.current.enabled = actualCameraOn

      async function syncBackendMediaState(nextMicOn, nextCameraOn) {
        await apiRequest(`/rooms/${roomId}/media-state`, {
          method: 'POST',
          body: JSON.stringify({
            mic_enabled: nextMicOn,
            camera_enabled: canSignalCameraEnabled(nextCameraOn, joinedRtcMode),
          }),
        }).catch((error) => setStatus(`Local media limited; state sync warning: ${error.message}`))
      }

      if (actualMicOn !== requestedMicOn || actualCameraOn !== requestedCameraOn) {
        await syncBackendMediaState(actualMicOn, actualCameraOn)
      }

      setRtcConfigState(rtcConfig)

      const missingProductionTurn = joinedRtcMode === 'video' && !isLocalBrowserHost() && !rtcConfig.turnConfigured
      const productionTurnWarning = 'Video relay is not fully configured. Some viewers on strict networks may have trouble seeing video.'
      if (missingProductionTurn) {
        setConnectionIssue(productionTurnWarning)
      }

      setConnectStep('signaling')
      setSignalingState('connecting')
      setStatus('Connecting to the live room...')

      const rtcClient = new NativeRtcClient({
        socket,
        localStream: localMediaStream,
        rtcMode: joinedRtcMode,
        iceServers: rtcConfig.iceServers,
        iceTransportPolicy: rtcConfig.iceTransportPolicy,
        onRemoteStream: handleRemoteStream,
        onPeerState: (remoteSocketId, state) => {
          setPeerStates((previous) => {
            const next = { ...previous, [remoteSocketId]: state }
            peerStatesRef.current = next
            return next
          })
          if (['connected', 'completed'].includes(String(state || '').toLowerCase())) {
            resetPeerNegotiationRetry(remoteSocketId)
          }
          if (state === 'failed') setConnectionIssue('A viewer connection failed. Video relay may need attention.')
        },
        onPeerStats: (remoteSocketId, stats) => {
          setPeerStats((previous) => {
            const next = { ...previous, [remoteSocketId]: stats }
            peerStatsRef.current = next
            return next
          })
        },
        onPeerRecovery: (remoteSocketId, recoveryState, detail) => {
          if (['scheduled', 'waiting', 'restarting'].includes(recoveryState)) {
            setPeerStates((previous) => {
              const next = { ...previous, [remoteSocketId]: 'reconnecting' }
              peerStatesRef.current = next
              return next
            })
            setStatus('Restoring a viewer connection...')
          }

          if (recoveryState === 'failed') {
            setConnectionIssue('A viewer connection could not be restored.')
          }
        },
      })
      rtcRef.current = rtcClient
      await flushPendingLocalTracks({ publish: false })

      const latestMicOn = requestedMicOn && hasLiveLocalTrack('audio')
      const latestCameraOn = requestedCameraOn && hasLiveLocalCameraTrack()

      if (latestMicOn !== actualMicOn || latestCameraOn !== actualCameraOn) {
        actualMicOn = latestMicOn
        actualCameraOn = latestCameraOn
        micOnRef.current = actualMicOn
        cameraOnRef.current = actualCameraOn
        setMicOn(actualMicOn)
        setCameraOn(actualCameraOn)
        applyLocalMediaState(actualMicOn, actualCameraOn)
        await syncBackendMediaState(actualMicOn, actualCameraOn)
      }

      socket.on('connect', () => {
        if (socketRef.current === socket) {
          localSocketIdRef.current = socket.id
          if (joinedRef.current && signalingRoomRef.current) {
            rejoinSignalingRoom(socket, rtcClient).catch((error) => {
              setSignalingState('error')
              setConnectionIssue(`Live connection recovery failed: ${error.message}`)
              setStatus(`Live connection recovery failed: ${error.message}`)
            })
          } else {
            setSignalingState('connected')
            setConnectionIssue('')
          }
        }
      })
      socket.on('connect_error', (error) => {
        setSignalingState('error')
        setConnectionIssue(`Live connection error: ${error.message}`)
        setStatus(`Live connection error: ${error.message}`)
      })
      socket.io.on('reconnect_attempt', () => {
        if (socketRef.current === socket) {
          setSignalingState('reconnecting')
        }
      })
      socket.io.on('reconnect', () => {
        if (socketRef.current === socket) {
          localSocketIdRef.current = socket.id
        }
      })
      socket.io.on('reconnect_error', (error) => {
        if (socketRef.current === socket) {
          setSignalingState('error')
          setConnectionIssue(`Live reconnect failed: ${error.message}`)
        }
      })
      socket.io.on('reconnect_failed', () => {
        if (socketRef.current === socket) {
          setSignalingState('failed')
          setConnectionIssue('Live reconnect failed.')
        }
      })

      socket.on('existing-users', async ({ socketId, users }) => {
        if (socketId) localSocketIdRef.current = socketId
        await negotiateExistingUsers(users, rtcClient)
      })

      socket.on('user-joined', async (payload) => {
        const { socketId } = payload
        setSignalingPeerCount((count) => count + 1)
        setPeerMediaStates((previous) => {
          const next = { ...previous, [socketId]: peerMediaFromSignal(payload) }
          peerMediaStatesRef.current = next
          return next
        })
        setPeerStates((previous) => {
          const next = { ...previous, [socketId]: previous[socketId] || 'waiting' }
          peerStatesRef.current = next
          return next
        })
        setStatus(`${payload.userName || 'Someone'} joined.`)
        triggerJoinEffect(payload.userName)
        await beginPeerNegotiation(socketId, rtcClient, 'Peer')
      })
      socket.on('webrtc-offer', async ({ fromSocketId, offer }) => {
        try {
          negotiatedPeersRef.current.add(fromSocketId)
          const accepted = await rtcClient.handleOffer(fromSocketId, offer, { polite: isPolitePeer(fromSocketId) })
          if (accepted === false) {
            setPeerStates((previous) => {
              const next = { ...previous, [fromSocketId]: 'glare' }
              peerStatesRef.current = next
              return next
            })
          }
          scheduleNegotiationRetry(fromSocketId, rtcClient, 'Peer')
        } catch (error) {
          if (isStalePeerSignalError(error)) {
            forgetRemotePeer(fromSocketId, rtcClient)
            refreshSignalingPeers(rtcClient, 'stale peer').catch((refreshError) => {
              setStatus(`Peer refresh failed: ${refreshError.message}`)
            })
          } else {
            setConnectionIssue(`Offer failed: ${error.message}`)
            setStatus(`Offer failed: ${error.message}`)
            scheduleNegotiationRetry(fromSocketId, rtcClient, 'Peer')
          }
        }
      })
      socket.on('webrtc-answer', async ({ fromSocketId, answer }) => {
        try {
          await rtcClient.handleAnswer(fromSocketId, answer)
          if (peerNeedsNegotiationRetry(fromSocketId, rtcClient)) {
            scheduleNegotiationRetry(fromSocketId, rtcClient, 'Peer')
          } else {
            resetPeerNegotiationRetry(fromSocketId)
          }
        } catch (error) {
          setConnectionIssue(`Answer failed: ${error.message}`)
          setStatus(`Answer failed: ${error.message}`)
          scheduleNegotiationRetry(fromSocketId, rtcClient, 'Peer')
        }
      })
      socket.on('webrtc-ice-candidate', async ({ fromSocketId, candidate }) => {
        try {
          await rtcClient.handleIceCandidate(fromSocketId, candidate)
        } catch (error) {
          setConnectionIssue(`ICE failed: ${error.message}`)
          setStatus(`ICE failed: ${error.message}`)
        }
      })
      socket.on('peer-signal-error', ({ targetSocketId, message }) => {
        if (!targetSocketId) return
        forgetRemotePeer(targetSocketId, rtcClient)
          setStatus(message || 'Refreshing room viewers...')
        refreshSignalingPeers(rtcClient, 'signal target change').catch((error) => {
          setStatus(`Peer refresh failed: ${error.message}`)
        })
      })
      socket.on('user-left', ({ socketId }) => {
        setSignalingPeerCount((count) => Math.max(0, count - 1))
        forgetRemotePeer(socketId, rtcClient)
      })
      socket.on('media-state-change', (payload) => {
        if (!payload?.socketId) return
        const nextMediaState = peerMediaFromSignal(payload)
        setPeerMediaStates((previous) => {
          const next = { ...previous, [payload.socketId]: nextMediaState }
          peerMediaStatesRef.current = next
          return next
        })
        if (!remoteVideoExpectedFromState(nextMediaState)) {
          resetPeerVideoWatchdog(payload.socketId)
          clearNoVideoPeerState(payload.socketId)
        } else {
          scheduleNegotiationRetry(payload.socketId, rtcClient, 'Peer')
          reconcileVideoWatchdog(payload.socketId)
        }

        if (nextMediaState.micOn === false) {
          resetPeerAudioWatchdog(payload.socketId)
        } else {
          scheduleNegotiationRetry(payload.socketId, rtcClient, 'Peer')
          reconcileAudioWatchdog(payload.socketId)
        }
      })
      socket.on('room-session-replaced', () => {
        if (socketRef.current !== socket) return

        activeRoomIdRef.current = null
        resetRtcState()
        updateJoined(false)
        setConnectStep('ready')
        setConnectionIssue('')
        setStatus('This room session moved to another tab or device.')
      })
      socket.on('follow-request-received', ({ request } = {}) => {
        if (!request?.id) return
        setFollowRelations((previous) => ({
          ...previous,
          incoming: upsertFollowRequest(previous.incoming, request),
        }))
        setActiveFollowRequestId(Number(request.id))
        setStatus(`${request.requester?.name || 'A user'} sent a follow request.`)
      })
      socket.on('follow-request-accepted', ({ request } = {}) => {
        if (!request?.recipient_id) return
        const peer = peerFromFollowRequest(request, 'recipient')
        const peerId = Number(peer.id || request.recipient_id || 0)
        setFollowRelations((previous) => ({
          ...previous,
          followingIds: uniqueIds([...previous.followingIds, peerId]),
          outgoingIds: previous.outgoingIds.filter((id) => Number(id) !== peerId),
        }))
        setFollowRefreshKey((key) => key + 1)
        setStatus(`${peer.name || 'Your follow request'} accepted. Private chat is open.`)
        openPeerInbox(peer)
      })
      socket.on('follow-request-rejected', ({ request } = {}) => {
        if (!request?.recipient_id) return
        const peerId = Number(request.recipient_id)
        setFollowRelations((previous) => ({
          ...previous,
          outgoingIds: previous.outgoingIds.filter((id) => Number(id) !== peerId),
        }))
        setStatus(`${request.recipient?.name || 'The user'} declined your follow request.`)
      })
      socket.on('stage-join-request-received', ({ request } = {}) => {
        if (!request) return
        if (Number(request.userId || 0) === Number(user?.id || 0)) return

        const currentControls = roomControlsRef.current
        const isRoomOwner = Number(joinData.room?.owner_id || 0) === Number(user?.id || 0)
          || currentControls?.role === 'owner'
        if (!isRoomOwner) return

        upsertStageRequest(request)
        setActiveToolPanel('manage')
        loadRoomControls({ quiet: true })
        setStatus(`${request.userName || 'A viewer'} wants to join the stage.`)
      })
      socket.on('stage-join-request-cancelled', (payload = {}) => {
        removeStageRequest(payload)
      })
      socket.on('stage-permission-updated', (payload = {}) => {
        const targetUserId = Number(payload.targetUserId || payload.target_user_id || 0)
        const requestId = Number(payload.requestId || payload.request_id || payload.request?.id || 0)
        if (!targetUserId) return

        removeStageRequest({ id: requestId, userId: targetUserId })

        if (payload.controls) {
          if (Number(payload.ownerUserId || 0) === Number(user?.id || 0)) {
            setRoomControls(payload.controls)
          } else if (roomControlsRef.current) {
            loadRoomControls({ quiet: true })
          }
        }

        if (targetUserId === Number(user?.id || 0)) {
          const nextAccess = stageAccessFromParticipant(payload.participant)
          stageAccessRef.current = nextAccess
          setStageAccess(nextAccess)

          if (payload.approved) {
            setStageRequestStatus('approved')
            setOwnStageRequest(null)
            setStatus('Room owner approved your request.')
            activateApprovedStageMedia().catch((error) => setStatus(`Stage start failed: ${error.message}`))
          } else {
            pendingStageIntentRef.current = null
            setOwnStageRequest(null)
            setStageRequestStatus('')
            micOnRef.current = false
            cameraOnRef.current = false
            desiredMicOnRef.current = false
            desiredCameraOnRef.current = false
            setMicOn(false)
            setCameraOn(false)
            applyLocalMediaState(false, false)
            publishMediaState(false, false).catch(() => {})
            setStatus(payload.action === 'remove'
              ? 'Room owner moved you back to audience.'
              : 'Request declined.')
          }
        }
      })
      socket.on('moderation-action', (payload) => {
        if (!payload?.targetUserId) return
        if (payload.controls) {
          if (Number(payload.moderatorUserId || 0) === Number(user?.id || 0)) {
            setRoomControls(payload.controls)
          } else if (roomControlsRef.current) {
            loadRoomControls({ quiet: true })
          }
        }

        if (payload.targetUserId === user?.id) {
          if (payload.action === 'mute_mic') {
            streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false })
            rtcRef.current?.setAudioEnabled(false)
            micOnRef.current = false
            desiredMicOnRef.current = false
            setMicOn(false)
            setStatus('A moderator muted your microphone')
          }

          if (payload.action === 'disable_camera') {
            streamRef.current?.getVideoTracks().forEach((track) => {
              if (track !== screenShareTrackRef.current) track.enabled = false
            })
            cameraOnRef.current = false
            desiredCameraOnRef.current = false
            setCameraOn(false)
            setStatus('A moderator paused your camera')
          }

          if (payload.action === 'kick' || payload.action === 'ban') {
            resetRtcState()
            activeRoomIdRef.current = null
            updateJoined(false)
            setConnectStep('ready')
            setStatus(payload.action === 'ban' ? 'You were banned from the room by a moderator' : 'You were removed from the room by a moderator')
          }

          return
        }

        if (payload.action === 'mute_mic' || payload.action === 'disable_camera') {
          setPeerMediaStates((previous) => {
            const next = Object.fromEntries(Object.entries(previous).map(([socketId, mediaState]) => {
              if (mediaState.userId !== payload.targetUserId) return [socketId, mediaState]

              return [socketId, {
                ...mediaState,
                micOn: payload.action === 'mute_mic' ? false : mediaState.micOn,
                cameraOn: payload.action === 'disable_camera' ? false : mediaState.cameraOn,
              }]
            }))
            peerMediaStatesRef.current = next
            return next
          })
        }
      })
      socket.on('room-controls-updated', (payload) => {
        if (payload?.controls?.room) setRoom(payload.controls.room)
        if (payload?.controls) {
          if (Number(payload.updatedByUserId || 0) === Number(user?.id || 0)) {
            setRoomControls(payload.controls)
          } else if (roomControlsRef.current) {
            loadRoomControls({ quiet: true })
          }
        }
      })
      socket.on('room-roles-updated', (payload) => {
        if (Number(payload?.targetUserId || 0) === Number(user?.id || 0) || roomControlsRef.current) {
          loadRoomControls({ quiet: true })
        }
      })
      socket.on('room-ban-revoked', (payload) => {
        if (payload?.controls) {
          if (Number(payload.moderatorUserId || 0) === Number(user?.id || 0)) {
            setRoomControls(payload.controls)
          } else if (roomControlsRef.current) {
            loadRoomControls({ quiet: true })
          }
        } else if (roomControlsRef.current) {
          loadRoomControls({ quiet: true })
        }
      })
      socket.on('disconnect', (reason) => {
        if (socketRef.current === socket) {
          setSignalingState(joinedRef.current ? 'reconnecting' : 'idle')
          if (joinedRef.current) {
            setStatus('Reconnecting live room. Media stays active.')
          } else {
            setStatus('Live room disconnected.')
          }
        }
      })
      const socketReady = await socketReadyPromise
      if (!socketReady.ok) throw socketReady.error
      if (socket.id) localSocketIdRef.current = socket.id
      const signalingMicOn = requestedMicOn && hasLiveLocalTrack('audio')
      const signalingCameraOn = requestedCameraOn && hasLiveLocalCameraTrack()

      if (signalingMicOn !== actualMicOn || signalingCameraOn !== actualCameraOn) {
        actualMicOn = signalingMicOn
        actualCameraOn = signalingCameraOn
        micOnRef.current = actualMicOn
        cameraOnRef.current = actualCameraOn
        setMicOn(actualMicOn)
        setCameraOn(actualCameraOn)
        applyLocalMediaState(actualMicOn, actualCameraOn)
        await syncBackendMediaState(actualMicOn, actualCameraOn)
      }

      const signalingJoin = await joinSignalingRoom(socket, signalingJoinPayload({
        roomId: joinData.rtc.signaling_room,
        rtcMode: joinedRtcMode,
        micEnabled: actualMicOn,
        cameraEnabled: actualCameraOn,
        screenShared: false,
      }))

      localSocketIdRef.current = signalingJoin.socketId || socket.id
      const peerCount = Array.isArray(signalingJoin.users) ? signalingJoin.users.length : 0
      if (peerCount) await negotiateExistingUsers(signalingJoin.users, rtcClient)
      else {
        setSignalingPeerCount(0)
        setPeerMediaStates({})
      }
      setConnectStep('connected')
      updateJoined(true)

      let connectedMediaWarning = ''
      const connectedMicOn = requestedMicOn && hasLiveLocalTrack('audio')
      const connectedCameraOn = requestedCameraOn && hasLiveLocalCameraTrack()
      if (connectedMicOn !== actualMicOn || connectedCameraOn !== actualCameraOn) {
        actualMicOn = connectedMicOn
        actualCameraOn = connectedCameraOn
        micOnRef.current = actualMicOn
        cameraOnRef.current = actualCameraOn
        await publishMediaState(actualMicOn, actualCameraOn).catch((error) => {
          connectedMediaWarning = `Connected, media state sync warning: ${error.message}`
        })
      }

      setSignalingState('connected')
      setConnectionIssue(missingProductionTurn ? productionTurnWarning : '')
      const connectedStatus = joinedStageAccess.canPublish
        ? (missingProductionTurn ? 'You are on stage. Video relay needs attention.' : 'You are on stage.')
        : 'Entered as audience. You can watch and listen until the room owner approves you to join.'
      setStatus(media.warning || connectedMediaWarning || connectedStatus)
    } catch (error) {
      console.error(error)
      startupCancelled = true
      setMediaState((state) => state === 'starting' ? 'failed' : state)
      setSignalingState((state) => state === 'connecting' ? 'error' : state)
      resetRtcState()
      if (backendJoined && activeRoomIdRef.current) {
        await apiRequest(`/rooms/${activeRoomIdRef.current}/leave`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {})
        activeRoomIdRef.current = null
      }
      if (isPasswordJoinError(error)) setShowPasswordRecovery(true)
      updateJoined(false)
      setConnectStep('ready')
      setConnectionIssue(error.message)
      setStatus(`Join failed: ${error.message}`)
    } finally {
      setJoining(false)
    }
  }

  async function leaveRoom({ navigateAfterLeave = true } = {}) {
    try {
      setStatus('Leaving room...')
      resetRtcState()
      let leaveResult = null
      if (activeRoomIdRef.current) {
        leaveResult = await apiRequest(`/rooms/${activeRoomIdRef.current}/leave`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        activeRoomIdRef.current = null
      }
      updateJoined(false)
      setConnectStep('ready')
      setConnectionIssue('')
      setSignalingState('idle')
      setMediaState('idle')
      setStatus('Left room. Usage logged.')
      if (navigateAfterLeave) onBack?.()
      return leaveResult
    } catch (error) {
      setStatus(error.message)
      updateJoined(false)
      setConnectStep('ready')
      setConnectionIssue('')
      if (navigateAfterLeave) onBack?.()
      return null
    }
  }

  async function toggleMic() {
    if (mediaUpdating.mic) return
    if (!joinedRef.current) return
    if (!stageAccessRef.current?.canPublish) {
      requestStageJoin()
      return
    }

    const next = !micOn
    const previous = micOn
    const currentlyJoined = joinedRef.current

    micOnRef.current = next
    desiredMicOnRef.current = next
    setMicOn(next)
    applyLocalMediaState(next, cameraOn)
    setMediaUpdating((state) => ({ ...state, mic: true }))
    setStatus(next ? 'Starting microphone...' : 'Microphone muted')

    try {
      if (currentlyJoined && next && !hasLiveLocalTrack('audio')) {
        setStatus('Requesting microphone permission...')
        await attachNewLocalTrack('audio', { publish: false })
        applyLocalMediaState(next, cameraOn)
      }

      if (currentlyJoined && next && isVoiceEffectActive(voiceEffectRef.current)) {
        await syncAudioEffectTrack({ effectId: voiceEffectRef.current })
        applyLocalMediaState(next, cameraOn)
      }

      if (!currentlyJoined) return

      const synced = await publishMediaState(next, cameraOn)
      micOnRef.current = synced.micOn
      cameraOnRef.current = synced.cameraOn
      setMicOn(synced.micOn)
      setCameraOn(synced.cameraOn)
      applyLocalMediaState(synced.micOn, synced.cameraOn)
      setStatus(synced.micOn ? 'Microphone is live' : 'Microphone muted')
    } catch (error) {
      micOnRef.current = previous
      desiredMicOnRef.current = previous
      setMicOn(previous)
      applyLocalMediaState(previous, cameraOn)
      setStatus(`Mic update failed: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, mic: false }))
    }
  }

  async function toggleNoiseCancellation() {
    const next = !noiseCancellationRef.current
    noiseCancellationRef.current = next
    setNoiseCancellation(next)

    const audioTrack = isLiveTrack(audioSourceTrackRef.current)
      ? audioSourceTrackRef.current
      : streamRef.current?.getAudioTracks?.().find((track) => track.readyState === 'live') || null
    if (!audioTrack || typeof audioTrack.applyConstraints !== 'function') {
      setStatus(next ? 'Noise cancellation will apply to the next microphone track.' : 'Noise cancellation disabled for the next microphone track.')
      return
    }

    try {
      await audioTrack.applyConstraints({
        echoCancellation: true,
        noiseSuppression: next,
        autoGainControl: true,
      })
      setStatus(next ? 'Noise cancellation enabled.' : 'Noise cancellation disabled.')
    } catch (error) {
      setStatus(`Noise cancellation setting saved; browser could not update live mic: ${error.message}`)
    }
  }

  async function changeVoiceEffect(nextEffect) {
    const normalizedEffect = normalizeVoiceEffectId(nextEffect)
    voiceEffectRef.current = normalizedEffect
    setVoiceEffect(normalizedEffect)

    if (!micOnRef.current || !joinedRef.current) {
      setStatus(normalizedEffect === 'natural'
        ? 'Voice changer disabled.'
        : `${normalizedEffect[0].toUpperCase()}${normalizedEffect.slice(1)} voice preset will apply when microphone is live.`)
      return
    }

    try {
      await syncAudioEffectTrack({ effectId: normalizedEffect })
      applyLocalMediaState(micOnRef.current, cameraOnRef.current)
      setStatus(normalizedEffect === 'natural'
        ? 'Voice changer disabled.'
        : `${normalizedEffect[0].toUpperCase()}${normalizedEffect.slice(1)} voice preset applied to your microphone.`)
    } catch (error) {
      voiceEffectRef.current = 'natural'
      setVoiceEffect('natural')
      await syncAudioEffectTrack({ effectId: 'natural' }).catch(() => {})
      applyLocalMediaState(micOnRef.current, cameraOnRef.current)
      setStatus(`Voice preset could not be applied: ${error.message}`)
    }
  }

  async function toggleCamera() {
    if (rtcMode === 'audio' || mediaUpdating.camera) return
    if (!joinedRef.current) return
    if (!stageAccessRef.current?.canPublish) {
      requestStageJoin()
      return
    }

    const next = !cameraOn
    const previous = cameraOn
    const currentlyJoined = joinedRef.current
    let attachedFreshTrack = false

    cameraOnRef.current = next
    desiredCameraOnRef.current = next
    setCameraOn(next)
    applyLocalMediaState(micOn, next)
    setMediaUpdating((state) => ({ ...state, camera: true }))
    setStatus(next ? 'Starting camera...' : 'Camera paused')

    try {
      if (currentlyJoined && next && !hasLiveLocalCameraTrack()) {
        setStatus('Requesting camera permission...')
        await attachNewLocalTrack('video', { publish: false })
        attachedFreshTrack = true
        applyLocalMediaState(micOn, next)
      }

      if (!currentlyJoined) return

      if (next) {
        if (!attachedFreshTrack) await publishCurrentCameraTrack()
        if (!hasLiveLocalCameraTrack()) throw new Error('No live camera track is available.')
      } else {
        await unpublishCameraTrack()
      }

      const synced = await publishMediaState(micOn, next)
      micOnRef.current = synced.micOn
      cameraOnRef.current = synced.cameraOn
      setMicOn(synced.micOn)
      setCameraOn(synced.cameraOn)
      applyLocalMediaState(synced.micOn, synced.cameraOn)
      setStatus(synced.cameraOn ? 'Camera is live' : 'Camera paused')
    } catch (error) {
      if (currentlyJoined && previous && !screenShareTrackRef.current) {
        await publishCurrentCameraTrack().catch(() => {
          const track = currentCameraTrack()
          if (isPublishableCameraTrack(track)) replaceCameraTrackInLocalStream(track)
        })
      } else if (currentlyJoined && !previous && !screenShareTrackRef.current) {
        await unpublishCameraTrack().catch(() => {
          replaceCameraTrackInLocalStream(null)
        })
      }

      cameraOnRef.current = previous
      desiredCameraOnRef.current = previous
      setCameraOn(previous)
      applyLocalMediaState(micOn, previous)
      setStatus(`Camera update failed: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, camera: false }))
    }
  }

  async function handleBack() {
    if (joined || activeRoomIdRef.current) {
      await leaveRoom({ navigateAfterLeave: false })
    }
    onBack()
  }

  useEffect(() => {
    joinedRef.current = joined
  }, [joined])

  useEffect(() => {
    micOnRef.current = micOn
  }, [micOn])

  useEffect(() => {
    cameraOnRef.current = cameraOn
  }, [cameraOn])

  useEffect(() => {
    roomControlsRef.current = roomControls
    if (Array.isArray(roomControls?.stage_requests)) {
      setStageRequests(roomControls.stage_requests.map(normalizeStageRequest))
    }
  }, [roomControls])

  useEffect(() => {
    stageAccessRef.current = stageAccess
  }, [stageAccess])

  useEffect(() => {
    noiseCancellationRef.current = noiseCancellation
  }, [noiseCancellation])

  useEffect(() => {
    voiceEffectRef.current = voiceEffect
  }, [voiceEffect])

  useEffect(() => {
    rtcModeRef.current = rtcMode
  }, [rtcMode])

  useEffect(() => {
    remoteStreamsRef.current = remoteStreams
  }, [remoteStreams])

  useEffect(() => {
    peerStatesRef.current = peerStates
  }, [peerStates])

  useEffect(() => {
    peerStatsRef.current = peerStats
  }, [peerStats])

  useEffect(() => {
    peerMediaStatesRef.current = peerMediaStates
  }, [peerMediaStates])

  useEffect(() => {
    peerVideoWatchdogStatesRef.current = peerVideoWatchdogStates
  }, [peerVideoWatchdogStates])

  useEffect(() => {
    if (!joined) return undefined

    const socketIds = new Set([
      ...Object.keys(peerMediaStates),
      ...Object.keys(peerStates),
      ...Object.keys(remoteStreams),
    ])

    socketIds.forEach((socketId) => reconcileAudioWatchdog(socketId))
    return undefined
  }, [joined, peerMediaStates, peerStates, remoteStreams])

  useEffect(() => {
    cameraFilterRef.current = normalizeVideoFilterId(cameraFilter)
  }, [cameraFilter])

  useEffect(() => {
    beautySettingsRef.current = normalizeBeautySettings(beautySettings)
  }, [beautySettings])

  useEffect(() => {
    backgroundEffectRef.current = normalizeBackgroundEffectId(backgroundEffect)
  }, [backgroundEffect])

  useEffect(() => {
    backgroundBlurAmountRef.current = normalizeBackgroundBlurAmount(backgroundBlurAmount)
  }, [backgroundBlurAmount])

  useEffect(() => {
    if (!joined || rtcMode !== 'video') return undefined
    if (!desiredCameraOnRef.current || cameraOnRef.current) return undefined
    if (!hasLiveLocalCameraTrack()) return undefined

    cameraOnRef.current = true
    setCameraOn(true)
    applyLocalMediaState(micOnRef.current, true)
    publishMediaState(micOnRef.current, true).catch((error) => {
      setStatus(`Camera is live, media state sync warning: ${error.message}`)
    })

    return undefined
  }, [joined, rtcMode, cameraOn, localStream])

  useEffect(() => {
    if (!joined) return undefined

    function sendPresence() {
      const socket = socketRef.current
      if (!socket?.connected || !signalingRoomRef.current) return

      socket.timeout(3000).emit(
        'rtc-presence',
        signalingJoinPayload(),
        () => {}
      )
    }

    sendPresence()
    const timer = window.setInterval(sendPresence, RTC_PRESENCE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [joined, user?.id])

  useEffect(() => {
    if (!joined) return undefined
    loadRoomControls({ quiet: true })
    return undefined
  }, [joined, room?.id, user?.id])

  useEffect(() => {
    if (!joined) return undefined

    let cancelled = false

    async function reportRtcQuality() {
      const activeRoomId = activeRoomIdRef.current
      const payload = latestRtcQualityRef.current
      if (cancelled || !activeRoomId || !payload) return
      if (!payload.peer_count && !payload.measured_peer_count) return

      try {
        await apiRequest(`/rooms/${activeRoomId}/quality`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      } catch (error) {
        console.debug('RTC stats report skipped:', error.message)
      }
    }

    const firstReport = window.setTimeout(reportRtcQuality, 5000)
    const timer = window.setInterval(reportRtcQuality, RTC_QUALITY_REPORT_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearTimeout(firstReport)
      window.clearInterval(timer)
    }
  }, [joined])

  useEffect(() => {
    if (!joined) {
      clearAllVideoWatchdogs()
      clearAllNegotiationRetries()
      resetLocalSenderWatchdog()
      return undefined
    }

    const socketIds = new Set([
      ...Object.keys(peerMediaStates || {}),
      ...Object.keys(peerStates || {}),
      ...Object.keys(remoteStreams || {}),
    ])

    socketIds.forEach((socketId) => reconcileVideoWatchdog(socketId))

    Object.keys(videoWatchdogTimersRef.current).forEach((socketId) => {
      if (!socketIds.has(socketId)) resetPeerVideoWatchdog(socketId)
    })

    return undefined
  }, [joined, peerMediaStates, peerStates, remoteStreams])

  useEffect(() => {
    if (!joined) {
      resetLocalSenderWatchdog()
      return undefined
    }

    let cancelled = false

    function checkLocalSender(kind) {
      if (cancelled || !shouldRepairLocalSender(kind)) {
        localSenderWatchdogAttemptsRef.current[kind] = 0
        return
      }

      if (localOutboundKbps(kind) > 0) {
        localSenderWatchdogAttemptsRef.current[kind] = 0
        return
      }

      repairLocalSender(kind)
    }

    const check = () => {
      checkLocalSender('audio')
      checkLocalSender('video')
    }

    const firstCheck = window.setTimeout(check, RTC_LOCAL_SENDER_WATCHDOG_DELAY_MS)
    const timer = window.setInterval(check, RTC_LOCAL_SENDER_WATCHDOG_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearTimeout(firstCheck)
      window.clearInterval(timer)
    }
  }, [joined, remotePeerCount, micOn, cameraOn, rtcMode, screenSharing])

  useEffect(() => () => {
    stopStageResize()
    window.clearTimeout(joinEffectTimerRef.current)
    if (activeRoomIdRef.current) {
      const roomToLeave = activeRoomIdRef.current
      activeRoomIdRef.current = null
      apiRequest(`/rooms/${roomToLeave}/leave`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {})
    }
    resetRtcState({ clearState: false })
  }, [])

  useEffect(() => {
    if (!autoConnect || autoConnectAttemptedRef.current) return
    autoConnectAttemptedRef.current = true
    joinRoom()
  }, [])

  useEffect(() => {
    if (!expandedScreenShareId) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') setExpandedScreenShareId('')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandedScreenShareId])

  useEffect(() => {
    if (expandedScreenShareId && !expandedScreenShareTile) {
      setExpandedScreenShareId('')
    }
  }, [expandedScreenShareId, expandedScreenShareTile])

  useEffect(() => {
    loadFollowRelations({ quiet: true })
  }, [user?.id])

  const localAudioAvailable = hasLiveTrack(localStream, 'audio')
  const localVideoAvailable = hasLiveTrack(localStream, 'video')
  const canPublishStageMedia = Boolean(stageAccess.canPublish)
  const audienceMode = joined && !canPublishStageMedia
  const stageRequestsEnabled = stageAccess.requestsEnabled !== false && room?.stage_requests_enabled !== false
  const stageRequestPending = stageRequestStatus === 'pending'
  const canCancelStageRequest = stageRequestPending && Number(ownStageRequest?.id || 0) > 0
  const localStageStream = localStream && (canPublishStageMedia || localAudioAvailable || localVideoAvailable) ? localStream : null
  const micCanRetry = joined && canPublishStageMedia && !micOn && !localAudioAvailable
  const cameraCanRetry = joined && canPublishStageMedia && rtcMode === 'video' && !cameraOn && !localVideoAvailable
  const micControlActive = joined && canPublishStageMedia && micOn
  const cameraControlActive = joined && canPublishStageMedia && cameraOn
  const audienceStageBlocked = audienceMode && (stageRequestPending || !stageRequestsEnabled)
  const micButtonDisabled = !joined || joining || mediaUpdating.mic || stageRequestSending || audienceStageBlocked
  const cameraButtonDisabled = !joined || joining || mediaUpdating.camera || stageRequestSending || audienceStageBlocked || rtcMode === 'audio' || screenSharing
  const micButtonTitle = micCanRetry
    ? t('Start microphone')
    : audienceMode ? (stageRequestPending ? t('Waiting for room owner approval') : !stageRequestsEnabled ? t('Stage requests are closed') : t('Request mic access')) : mediaUpdating.mic ? t('Saving microphone') : micOn ? t('Mute microphone') : t('Unmute microphone')
  const cameraButtonTitle = cameraCanRetry
    ? t('Start camera')
    : audienceMode ? (stageRequestPending ? t('Waiting for room owner approval') : !stageRequestsEnabled ? t('Stage requests are closed') : t('Request camera access')) : screenSharing ? t('Stop screen share before changing camera') : mediaUpdating.camera ? t('Saving camera') : cameraOn ? t('Turn camera off') : t('Turn camera on')
  const guardFindings = chatMessages
    .filter((message) => message.message_type === 'text')
    .map((message) => {
      const analysis = analyzeRoomTextForGuard(message.message_body)
      return analysis ? { message, matchedKeyword: analysis.matchedKeyword } : null
    })
    .filter(Boolean)
    .slice(-5)
  const aiGuardActive = isAiGuardEnabled(room)
  const roomTitle = room?.name || `Room #${roomId}`
  const roomMeta = getRoomMeta(room?.room_type)
  const roomOwnerId = room?.owner_id || user?.id || 0
  const roomOwnerName = room?.owner_name || user?.name || roomTitle
  const roomOwnerAvatar = avatarForUser({
    id: roomOwnerId,
    user_id: roomOwnerId,
    name: roomOwnerName,
    full_name: roomOwnerName,
    avatar_url: (Number(roomOwnerId) === Number(user?.id) ? user?.avatar_url : '') || room?.owner_avatar_url || '',
  }, roomOwnerId || room?.id || roomId)
  const profileAvatar = avatarForUser(user, user?.id || 0)
  const backAvatar = actionAvatarAssets.back
  const rtcHealth = summarizeRtcHealth({ joined, remotePeerCount, peerStates, peerStats, rtcMode, cameraOn, screenSharing })
  const activeCameraFilter = getVideoFilter(cameraFilter)
  const activeBackgroundEffect = getBackgroundEffect(backgroundEffect)
  const normalizedBeautySettings = normalizeBeautySettings(beautySettings)
  const cameraFilterActive = isVideoFilterActive(cameraFilter)
  const beautySettingsActive = isBeautySettingsActive(normalizedBeautySettings)
  const backgroundEffectActive = isBackgroundEffectActive(backgroundEffect)
  const backgroundBlurPercent = normalizeBackgroundBlurAmount(backgroundBlurAmount)
  const mirrorEnabled = normalizedBeautySettings.mirror
  const beautyActiveCount = BEAUTY_CONTROLS.filter((control) => Number(normalizedBeautySettings[control.id] || 0) > 0).length + (mirrorEnabled ? 1 : 0)
  const cameraEffectsActive = cameraFilterActive || beautySettingsActive || backgroundEffectActive
  const audioEffectsActive = noiseCancellation || voiceEffect !== 'natural'
  const filterButtonDisabled = joining || mediaUpdating.filter || rtcMode === 'audio' || audienceMode
  const activeFollowRequest = followRelations.incoming.find((request) => Number(request.id) === Number(activeFollowRequestId))
    || followRelations.incoming[0]
    || null
  const roleTargetOptions = buildRoomRoleTargets(roomControls)
  const selectedRoleTarget = roleTargetOptions.find((target) => target.userId === String(roleForm.userId))
  const roleTargetUnavailable = roleTargetOptions.length === 0
  const roomOpsParticipants = Array.isArray(roomControls?.participants) ? roomControls.participants : []
  const activeRoomBans = Array.isArray(roomControls?.active_bans) ? roomControls.active_bans : []
  const ownerCanApproveStage = Boolean(roomControls?.can_approve_stage ?? roomControls?.capabilities?.can_approve_stage ?? roomControls?.role === 'owner')
  const currentUserId = Number(user?.id || 0)
  const visibleStageRequests = stageRequests.filter((request) => Number(request.userId || 0) !== currentUserId)
  const roomOpsOnlySelf = roomOpsParticipants.length > 0
    && roomOpsParticipants.every((participant) => Number(participant.user_id || 0) === currentUserId)
  const activeToolTitle = {
    audio: t('Voice effects'),
    filters: t('Filters'),
    guard: t('Safety'),
    manage: t('Host Controls'),
    screen: t('Screen share'),
  }[activeToolPanel] || t('Room menu')
  const stageStateLabel = !joined
    ? (joining ? t('Entering room') : t('Audience-first entry'))
    : audienceMode
      ? stageRequestPending ? t('Stage request pending') : t('Audience - watching and listening')
      : rtcMode === 'video'
        ? `${micOn ? t('Mic on') : t('Mic off')} - ${cameraOn ? t('Camera on') : t('Camera off')}`
        : micOn ? t('Mic on') : t('Mic off')
  const visibleTileCount = (localStageStream || remoteTiles.length ? 1 : 0) + remoteTiles.length
  const hasVisibleStageTiles = visibleTileCount > 0
  const stageTileHeight = stageTileHeightForFrame(stageFrameSize, visibleTileCount)
  const stageFrameStyle = stageFrameSize ? {
    '--live-stage-width': `${stageFrameSize.width}px`,
    '--live-stage-height': `${stageFrameSize.height}px`,
    '--live-stage-tile-min-height': `${stageTileHeight}px`,
    '--live-stage-feature-min-height': `${(stageTileHeight * 2) + STAGE_RESIZE_GAP_PX}px`,
  } : undefined
  const stageStreamsClassName = `buzzcast-live-stage-streams layout-grid ${stageTileCountClass(visibleTileCount)}${stageFrameSize ? ' is-resized' : ''}${hasVisibleStageTiles ? '' : ' is-empty'}`
  const roomSummaryClassName = hasVisibleStageTiles ? 'buzzcast-room-summary' : 'buzzcast-room-summary is-stage-empty'
  const configuredSeatCount = Number(room?.max_mic_count ?? room?.maxMicCount ?? 0)
  const defaultSeatCount = defaultSeatsForRoomType(room?.room_type)
  const liveStageSeatCount = Math.trunc(clampNumber(
    Number.isFinite(configuredSeatCount) && configuredSeatCount > 0 ? configuredSeatCount : defaultSeatCount,
    Math.min(4, maxSeatsForRoomType(room?.room_type)),
    Math.min(8, maxSeatsForRoomType(room?.room_type))
  ))
  const roomMemberCount = Math.max(
    remotePeerCount + (joined ? 1 : 0),
    Number(room?.active_participants || room?.activeParticipants || room?.participant_count || room?.participantCount || 0),
    1
  )
  const stageSeatOccupants = [
    ...(joined && canPublishStageMedia ? [{
      id: `local-${user?.id || 'user'}`,
      name: user?.name || t('You'),
      avatarUrl: user?.avatar_url || '',
      muted: !micOn,
    }] : []),
    ...remoteTiles
      .filter(({ mediaState }) => mediaState?.canPublish !== false)
      .map(({ socketId, mediaState }) => ({
        id: socketId,
        name: mediaState.userName || t('Remote User'),
        avatarUrl: mediaState.avatarUrl || '',
        muted: mediaState.micOn === false,
      })),
  ]

  if (!stageSeatOccupants.length) {
    stageSeatOccupants.push({
      id: `host-${roomOwnerId || roomId}`,
      name: roomOwnerName,
      avatarUrl: roomOwnerAvatar,
      muted: false,
    })
  }

  const liveStageSeats = Array.from({ length: liveStageSeatCount }, (_, index) => ({
    number: index + 1,
    occupant: stageSeatOccupants[index] || null,
  }))
  const stagePrimaryAction = !joined
    ? joinRoom
    : audienceMode
      ? canCancelStageRequest ? cancelStageJoinRequest : stageRequestPending ? null : stageRequestsEnabled ? requestStageJoin : null
      : toggleMic
  const stagePrimaryDisabled = joining || stageRequestSending || (audienceMode && !stageRequestsEnabled && !canCancelStageRequest)
  const stagePrimaryLabel = !joined
    ? t('Come on mic and chat together~')
    : audienceMode
      ? stageRequestPending ? (canCancelStageRequest ? t('Cancel stage request') : t('Waiting for owner approval')) : stageRequestsEnabled ? t('Request mic access') : t('Stage closed')
      : micOn ? t('Mic is live') : t('Come on mic and chat together~')
  const voiceAction = !joined
    ? joinRoom
    : audienceMode
      ? canCancelStageRequest ? cancelStageJoinRequest : stageRequestPending ? null : stageRequestsEnabled ? requestStageJoin : null
      : () => toggleToolPanel('audio')
  const voiceActionDisabled = joining || stageRequestSending || !voiceAction || (audienceMode && !stageRequestsEnabled && !canCancelStageRequest)
  const voiceActionLabel = audienceMode
    ? stageRequestPending ? (canCancelStageRequest ? t('Cancel') : t('Waiting')) : stageRequestsEnabled ? t('Request') : t('Closed')
    : t('Voice')
  const roomGuideText = room?.description?.trim()
    || t('Please respect each other and chat in friendly manner. Abuse, sexual and violent contents are not allowed. All violators will be banned.')
  const joinerLayoutActive = audienceMode
  const chatPresentation = joinerLayoutActive ? 'joiner' : 'default'
  const liveShellClassName = `buzzcast-shell buzzcast-live-shell ${joinerLayoutActive ? 'buzzcast-live-joiner-shell' : 'buzzcast-live-owner-shell'}`
  const ownerRemoteTile = remoteTiles.find(({ mediaState }) => Number(mediaState?.userId || 0) === Number(roomOwnerId || 0))
    || remoteTiles.find(({ mediaState }) => String(mediaState?.stageRole || '').toLowerCase() === 'owner')
    || remoteTiles.find(({ mediaState }) => mediaState?.canPublish !== false)
    || remoteTiles[0]
    || null
  const ownerVideoMediaState = ownerRemoteTile?.mediaState || {}
  const ownerVideoRtcMode = ownerVideoMediaState.rtcMode || defaultRtcModeForRoom(room) || 'video'
  const ownerVideoCameraOn = ownerVideoMediaState.screenShared === true
    || ownerVideoMediaState.cameraOn === true
    || (!ownerRemoteTile ? false : ownerVideoRtcMode !== 'audio' && ownerVideoMediaState.cameraOn !== false)
  const joinerChatParticipantMap = new Map()
  const addJoinerChatParticipant = (participant) => {
    const id = String(participant.id || participant.name || joinerChatParticipantMap.size)
    if (!participant.name && !participant.avatarUrl) return
    if (!joinerChatParticipantMap.has(id)) joinerChatParticipantMap.set(id, participant)
  }

  addJoinerChatParticipant({
    id: roomOwnerId || 'owner',
    name: roomOwnerName,
    avatarUrl: roomOwnerAvatar,
    gender: room?.owner_gender || '',
    followStatus: followStatusForPeer(roomOwnerId),
    isSelf: Number(roomOwnerId || 0) === Number(user?.id || 0),
  })
  remoteTiles.forEach(({ socketId, mediaState }) => {
    const peerId = Number(mediaState?.userId || 0)
    addJoinerChatParticipant({
      id: mediaState?.userId || socketId,
      name: mediaState?.userName || t('Remote User'),
      avatarUrl: mediaState?.avatarUrl || avatarForUser({
        id: mediaState?.userId,
        name: mediaState?.userName || t('Remote User'),
        gender: mediaState?.gender || '',
      }, mediaState?.userId || socketId.length),
      gender: mediaState?.gender || '',
      followStatus: followStatusForPeer(peerId),
      isSelf: peerId > 0 && peerId === Number(user?.id || 0),
    })
  })
  if (joined) {
    addJoinerChatParticipant({
      id: user?.id || 'me',
      name: user?.name || t('You'),
      avatarUrl: profileAvatar,
      gender: user?.gender || '',
      followStatus: '',
      isSelf: true,
    })
  }
  const joinerChatParticipants = Array.from(joinerChatParticipantMap.values())
  latestRtcQualityRef.current = buildRtcQualityPayload({ rtcHealth, remotePeerCount, peerStates, peerStats })

  return (
    <div className={liveShellClassName}>
      <header className="buzzcast-topbar buzzcast-live-topbar">
        <button type="button" className="buzzcast-logo buzzcast-live-logo" onClick={handleBack} aria-label={t('Back to rooms')}>
          <div className="buzzcast-logo-mark image-mark">
            <img src={brandAssets.appIconSmall} alt="TalkEachOther" decoding="async" />
          </div>
          <div>
            <strong>TalkEachOther</strong>
            <span>{t('Video and music rooms')}</span>
          </div>
        </button>
        <div className="buzzcast-actions">
          <button type="button" className="buzzcast-avatar-button" onClick={onProfile} aria-label={t('Open profile')} title={t('Open profile')}>
            <span className="image-avatar"><img src={profileAvatar} alt="" /></span>
          </button>
        </div>
      </header>

      <aside className="buzzcast-left-rail buzzcast-live-rail">
        <button type="button" className="active buzzcast-rail-tab buzzcast-rail-home" data-mobile-label={t('Live')} onClick={handleBack}>
          <span className="buzzcast-rail-icon rail-live rail-symbol-icon" aria-hidden="true">
            <LiveRailIcon />
          </span>
          <b>{t('Live')}</b>
        </button>
        <button type="button" className="buzzcast-rail-tab buzzcast-rail-profile" data-mobile-label={t('Me')} onClick={onProfile}>
          <span className="buzzcast-rail-icon rail-me rail-symbol-icon" aria-hidden="true">
            <MeRailIcon />
          </span>
          <b>{t('Me')}</b>
        </button>
        <div className="buzzcast-rail-spacer"></div>
        <button type="button" className="buzzcast-rail-tab buzzcast-rail-back" data-mobile-label={t('Back')} onClick={handleBack}>
          <span className="buzzcast-rail-icon rail-back-avatar image-avatar" aria-hidden="true">
            <img src={backAvatar} alt="" loading="lazy" />
          </span>
          <b>{t('Back')}</b>
        </button>
      </aside>

      <main className="buzzcast-live-main">
        <section ref={stagePanelRef} className="buzzcast-live-stage-panel">
          <div className="buzzcast-stage buzzcast-rtc-stage">
            <img className="buzzcast-stage-image" src={roomCover} alt="" />
          {joinEffect && (
            <div className="join-effect" key={joinEffect.key}>
              <span></span>
              <strong>{joinEffect.name} joined</strong>
            </div>
          )}
            <section className="buzzcast-web-room-chrome" aria-label={t('Live room overview')}>
              <header className="buzzcast-web-live-head">
                <span className="buzzcast-web-room-avatar image-avatar">
                  <img src={roomOwnerAvatar} alt="" loading="lazy" />
                </span>
                <span className="buzzcast-web-room-title">
                  <strong title={roomTitle}>{roomTitle}</strong>
                  <small>ID:{room?.id || roomId} - {formatCompactCount(roomMemberCount)}</small>
                </span>
                <span className={joined ? 'buzzcast-web-room-live is-live' : 'buzzcast-web-room-live'}>
                  {joined ? t('LIVE') : joining ? t('ENTERING') : t('READY')}
                </span>
              </header>

              <div className="buzzcast-web-room-badges" aria-label={t('Room labels')}>
                <span>{roomMeta.short}</span>
                <span>{roomOwnerName}</span>
                <span className={audienceMode ? 'buzzcast-web-stage-state audience' : 'buzzcast-web-stage-state'}>{stageStateLabel}</span>
              </div>

              <div className="buzzcast-web-live-actions" aria-label={t('Room actions')}>
                <button type="button" className="room-action-refresh" onClick={refreshLiveRoomChrome} disabled={controlsLoading}>
                  <span className="buzzcast-web-action-icon refresh" aria-hidden="true"></span>
                  <span>{t('Refresh')}</span>
                </button>
                <button type="button" className="room-action-voice" onClick={voiceAction || undefined} disabled={voiceActionDisabled}>
                  <span className="buzzcast-web-action-icon voice" aria-hidden="true"></span>
                  <span>{voiceActionLabel}</span>
                </button>
                <button type="button" className="room-action-chat" onClick={openChatTool}>
                  <span className="buzzcast-web-action-icon chat" aria-hidden="true"></span>
                  <span>{t('Chat')}</span>
                </button>
                <button type="button" className="room-action-leave" onClick={joined ? () => leaveRoom() : handleBack}>
                  <span className="buzzcast-web-action-icon power" aria-hidden="true"></span>
                  <span>{joined ? t('Leave') : t('Back')}</span>
                </button>
              </div>
            </section>

            {joinerLayoutActive ? (
              <section className="buzzcast-joiner-owner-stage" aria-label={t('Owner live video')}>
                <header>
                  <span className="image-avatar">
                    <img src={roomOwnerAvatar} alt="" loading="lazy" />
                  </span>
                  <div>
                    <strong>{roomOwnerName}</strong>
                    <small>{ownerRemoteTile ? t('Owner live video') : t('Waiting for owner video')}</small>
                  </div>
                </header>
                <div className="buzzcast-joiner-owner-video-frame">
                  <VideoTile
                    stream={ownerRemoteTile?.stream || null}
                    label={ownerRemoteTile?.label || roomOwnerName}
                    userId={ownerVideoMediaState.userId || roomOwnerId}
                    gender={ownerVideoMediaState.gender || ''}
                    avatarUrl={ownerVideoMediaState.avatarUrl || roomOwnerAvatar}
                    badge={ownerVideoMediaState.screenShared ? 'screen' : 'owner'}
                    micOn={ownerVideoMediaState.micOn !== false}
                    cameraOn={ownerVideoCameraOn}
                    rtcMode={ownerVideoRtcMode}
                    connectionState={ownerRemoteTile?.peerState || (joined ? 'waiting' : 'idle')}
                    showMediaState
                    followStatus={followStatusForPeer(ownerVideoMediaState.userId || roomOwnerId)}
                    onFollowAction={Number(ownerVideoMediaState.userId || roomOwnerId || 0) && Number(ownerVideoMediaState.userId || roomOwnerId || 0) !== Number(user?.id || 0)
                      ? () => handlePeerFollowAction({
                        id: Number(ownerVideoMediaState.userId || roomOwnerId),
                        name: ownerVideoMediaState.userName || roomOwnerName,
                        avatar_url: ownerVideoMediaState.avatarUrl || roomOwnerAvatar,
                        gender: ownerVideoMediaState.gender || '',
                      })
                      : undefined}
                    language={language}
                  />
                </div>
              </section>
            ) : null}

            <div className={roomSummaryClassName} aria-label={t('Room summary')}>
              <span className="buzzcast-room-summary-avatar image-avatar">
                <img src={roomOwnerAvatar} alt="" loading="lazy" />
              </span>
              <strong title={roomTitle}>{roomTitle}</strong>
              <span>{room?.owner_name || t('Live room')}</span>
            </div>

            <div ref={stageStreamsRef} className={stageStreamsClassName} style={stageFrameStyle} data-tile-count={visibleTileCount}>
              {hasVisibleStageTiles ? (
                <>
                  {localStageStream ? (
                    <VideoTile
                      stream={localStageStream}
                      muted
                      label={user?.name || t('You')}
                      userId={user?.id}
                      gender={user?.gender}
                      avatarUrl={user?.avatar_url}
                      badge={screenSharing ? 'screen' : mediaMode}
                      micOn={micOn}
                      cameraOn={cameraOn}
                      rtcMode={rtcMode}
                      showMediaState
                      language={language}
                    />
                  ) : null}
                  {remoteTiles.map(({ socketId, stream, mediaState, peerState, label, badge }) => {
                    const canExpandScreenShare = Boolean(stream && mediaState?.screenShared)
                    const screenShareOwner = mediaState.userName || t('remote user')
                    const peer = {
                      id: Number(mediaState.userId || 0),
                      name: mediaState.userName || t('Remote User'),
                      avatar_url: mediaState.avatarUrl || '',
                      gender: mediaState.gender || '',
                    }

                    return (
                      <VideoTile
                        key={socketId}
                        stream={stream}
                        label={label}
                        userId={mediaState.userId}
                        gender={mediaState.gender}
                        avatarUrl={mediaState.avatarUrl}
                        badge={badge}
                        micOn={mediaState.micOn !== false}
                        cameraOn={mediaState.cameraOn === true || mediaState.screenShared === true}
                        rtcMode={mediaState.rtcMode || 'video'}
                        connectionState={peerState}
                        showMediaState
                        followStatus={followStatusForPeer(peer.id)}
                        onFollowAction={peer.id ? () => handlePeerFollowAction(peer) : undefined}
                        onExpand={canExpandScreenShare ? () => setExpandedScreenShareId(socketId) : undefined}
                        expandLabel={t('Open {name} screen share full screen', { name: screenShareOwner })}
                        language={language}
                      />
                    )
                  })}
                  <button
                    type="button"
                    className="live-stage-resize-edge resize-right"
                    aria-label={t('Resize camera stage width')}
                    title={t('Drag to resize camera stage width')}
                    onPointerDown={(event) => startStageResize(event, 'x')}
                    onDoubleClick={() => setStageFrameSize(null)}
                  ></button>
                  <button
                    type="button"
                    className="live-stage-resize-edge resize-bottom"
                    aria-label={t('Resize camera stage height')}
                    title={t('Drag to resize camera stage height')}
                    onPointerDown={(event) => startStageResize(event, 'y')}
                    onDoubleClick={() => setStageFrameSize(null)}
                  ></button>
                  <button
                    type="button"
                    className="live-stage-resize-edge resize-corner"
                    aria-label={t('Resize camera stage')}
                    title={t('Drag to resize camera stage')}
                    onPointerDown={(event) => startStageResize(event, 'xy')}
                    onDoubleClick={() => setStageFrameSize(null)}
                  ></button>
                </>
              ) : null}
            </div>

            <div className="buzzcast-web-seat-grid" aria-label={t('Mic seats')}>
              {liveStageSeats.map(({ number, occupant }) => (
                <button
                  key={number}
                  type="button"
                  className={occupant ? (occupant.muted ? 'occupied muted' : 'occupied') : 'locked'}
                  onClick={stagePrimaryAction || undefined}
                  disabled={stagePrimaryDisabled || !stagePrimaryAction}
                  aria-label={occupant ? `${occupant.name} ${t('mic seat')} ${number}` : `${t('Locked mic seat')} ${number}`}
                >
                  <span>
                    <img
                      className={occupant ? 'buzzcast-seat-mic-icon' : 'buzzcast-seat-lock-art'}
                      src={occupant ? liveRoomAssets.seatMic : liveRoomAssets.seatLock}
                      alt=""
                      loading="lazy"
                    />
                    <small>{number}</small>
                  </span>
                  <b>{occupant?.name || t('Locked')}</b>
                </button>
              ))}
            </div>

            <div className="buzzcast-web-stage-guide-row">
              <p>{roomGuideText}</p>
              <button type="button" onClick={() => toggleToolPanel('manage')} aria-label={t('Room event')}>
                <img src={roomAssets.stageMoods} alt="" loading="lazy" />
                <span aria-hidden="true"><i></i><i></i><i></i></span>
              </button>
            </div>

            <button type="button" className="buzzcast-web-mic-line" onClick={stagePrimaryAction || undefined} disabled={stagePrimaryDisabled || !stagePrimaryAction}>
              <span>{stagePrimaryLabel}</span>
              <img src={liveRoomAssets.seatMic} alt="" loading="lazy" />
            </button>

            {showPasswordRecovery && (
              <div className="buzzcast-password-popover">
                <strong>{t('Room password required')}</strong>
                <input
                  {...roomAccessCodeInputProps}
                  name="live-room-access-code"
                  value={roomPasswordInput}
                  onChange={(event) => setRoomPasswordInput(event.target.value)}
                  placeholder={t('Room password')}
                />
              </div>
            )}

            {activeToolPanel ? (
              <div className={activeToolPanel === 'manage' ? 'live-tool-panel buzzcast-floating-tool room-ops-tool' : 'live-tool-panel buzzcast-floating-tool'}>
                <header>
                  <strong>{activeToolTitle}</strong>
                  <button type="button" onClick={() => setActiveToolPanel(null)} aria-label={t('Close tool panel')}>x</button>
                </header>
                {activeToolPanel === 'screen' ? (
                  <div className="tool-status-panel">
                    <p>{screenSharing ? t('Your screen is being sent to the room.') : t('Share a window or display while keeping the current room camera controls unchanged.')}</p>
                    <button type="button" className={screenSharing ? 'danger-button' : 'primary-button'} onClick={toggleScreenShare} disabled={mediaUpdating.screen || !canPublishStageMedia}>
                      {mediaUpdating.screen ? t('Working...') : screenSharing ? t('Stop sharing') : t('Start screen share')}
                    </button>
                    <small>{audienceMode ? t('Owner approval required') : room?.screen_share_enabled === false ? t('Screen share is turned off for this room.') : t('Share your screen with the room.')}</small>
                  </div>
                ) : activeToolPanel === 'audio' ? (
                  <div className="tool-status-panel camera-filter-panel">
                    <p>{noiseCancellation ? t('Noise cancellation is enabled for microphone capture.') : t('Noise cancellation is off for microphone capture.')}</p>
                    <section className="camera-effect-section">
                      <header>
                        <strong>{t('Noise cancellation')}</strong>
                        <small>{noiseCancellation ? t('On') : t('Off')}</small>
                      </header>
                      <button
                        type="button"
                        className={noiseCancellation ? 'beauty-mirror-button active' : 'beauty-mirror-button'}
                        onClick={toggleNoiseCancellation}
                        aria-pressed={noiseCancellation}
                        title={noiseCancellation ? t('Turn noise cancellation off') : t('Turn noise cancellation on')}
                      >
                        <span className="control-glyph mic" aria-hidden="true"></span>
                        <span>
                          <strong>NC</strong>
                          <small>{noiseCancellation ? t('Browser noise suppression on') : t('Browser noise suppression off')}</small>
                        </span>
                        <b>{noiseCancellation ? t('On') : t('Off')}</b>
                      </button>
                    </section>
                    <section className="camera-effect-section">
                      <header>
                        <strong>{t('Voice changer')}</strong>
                        <small>{voiceEffect}</small>
                      </header>
                      <div className="camera-filter-grid" aria-label={t('Voice changer presets')}>
                        {VOICE_EFFECT_IDS.map((effect) => (
                          <button
                            key={effect}
                            type="button"
                            className={voiceEffect === effect ? 'active' : ''}
                            onClick={() => changeVoiceEffect(effect)}
                            aria-pressed={voiceEffect === effect}
                          >
                            <span className="filter-swatch bright" aria-hidden="true"></span>
                            <strong>{t(effect)}</strong>
                          </button>
                        ))}
                      </div>
                    </section>
                    <div className="camera-filter-footer">
                      <small>{t('Choose how your voice sounds on stage.')}</small>
                    </div>
                  </div>
                ) : activeToolPanel === 'filters' ? (
                  <div className="tool-status-panel camera-filter-panel">
                    <p>{activeCameraFilter.label}: {activeCameraFilter.detail}{beautyActiveCount ? ` - ${beautyActiveCount} ${t(beautyActiveCount === 1 ? 'beauty setting active' : 'beauty settings active')}` : ''}{backgroundEffectActive ? ` - ${activeBackgroundEffect.label} ${t('background')}` : ''}</p>
                    <div className="camera-effect-summary" aria-label={t('Camera effect summary')}>
                      <span>
                        <strong>{t('Face beauty')}</strong>
                        <small>{beautyActiveCount ? `${beautyActiveCount} ${t('active')}` : t('Ready')}</small>
                      </span>
                      <span>
                        <strong>{t('Background filter')}</strong>
                        <small>{backgroundEffect === 'blur' ? `${backgroundBlurPercent}% ${t('blur')}` : t('Blur off')}</small>
                      </span>
                    </div>
                    <section className="camera-effect-section">
                      <header>
                        <strong>{t('Background blur')}</strong>
                        <small>{backgroundEffect === 'blur' ? `${backgroundBlurPercent}% ${t('strength')}` : t('Off')}</small>
                      </header>
                      <button
                        type="button"
                        className={backgroundEffectActive ? 'background-blur-toggle active' : 'background-blur-toggle'}
                        onClick={toggleBackgroundBlur}
                        disabled={filterButtonDisabled}
                        aria-label={backgroundEffectActive ? t('Turn background blur off') : t('Turn background blur on')}
                        aria-pressed={backgroundEffectActive}
                        title={backgroundEffectActive ? t('Background blur {percent}%', { percent: backgroundBlurPercent }) : t('Background blur off')}
                      >
                        <span className="control-glyph background"></span>
                        <span>
                          <strong>BG</strong>
                          <small>{backgroundEffectActive ? t('Background blur on') : t('Background blur off')}</small>
                        </span>
                      </button>
                      <label className="beauty-slider-row background-blur-slider">
                        <span>
                          <strong>{t('Blur amount')}</strong>
                          <b>{backgroundBlurPercent}%</b>
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={backgroundBlurPercent}
                          onChange={(event) => changeBackgroundBlurAmount(event.target.value)}
                          disabled={rtcMode === 'audio'}
                        />
                      </label>
                    </section>
                    <section className="camera-effect-section">
                      <header>
                        <strong>{t('Face beauty')}</strong>
                        <small>{mirrorEnabled ? t('Mirror on') : t('Smooth, light, warmth')}</small>
                      </header>
                      <div className="camera-beauty-controls" aria-label={t('Face beauty controls')}>
                        <button
                          type="button"
                          className={mirrorEnabled ? 'beauty-mirror-button active' : 'beauty-mirror-button'}
                          onClick={toggleBeautyMirror}
                          disabled={filterButtonDisabled}
                          aria-pressed={mirrorEnabled}
                          title={mirrorEnabled ? t('Turn mirror camera off') : t('Turn mirror camera on')}
                        >
                          <span className="control-glyph mirror" aria-hidden="true"></span>
                          <span>
                            <strong>{t('Mirror')}</strong>
                            <small>{mirrorEnabled ? t('Mirrored camera view') : t('Normal camera view')}</small>
                          </span>
                          <b>{mirrorEnabled ? t('On') : t('Off')}</b>
                        </button>
                        {BEAUTY_CONTROLS.map((control) => (
                          <label key={control.id} className="beauty-slider-row">
                            <span>
                              <strong>{control.label}</strong>
                              <b>{beautySettings[control.id] || 0}</b>
                            </span>
                            <input
                              type="range"
                              min={control.min}
                              max={control.max}
                              step={control.step}
                              value={beautySettings[control.id] || 0}
                              onChange={(event) => changeBeautySetting(control.id, event.target.value)}
                              disabled={rtcMode === 'audio'}
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                    <section className="camera-effect-section">
                      <header>
                        <strong>{t('Filter presets')}</strong>
                        <small>{t('Color and style')}</small>
                      </header>
                      <div className="camera-filter-grid" aria-label={t('Camera filter presets')}>
                        {VIDEO_FILTERS.map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            className={cameraFilter === filter.id ? 'active' : ''}
                            onClick={() => changeCameraFilter(filter.id)}
                            disabled={mediaUpdating.filter || rtcMode === 'audio'}
                            aria-pressed={cameraFilter === filter.id}
                          >
                            <span className={`filter-swatch ${filter.id}`} aria-hidden="true"></span>
                            <strong>{filter.label}</strong>
                          </button>
                        ))}
                      </div>
                    </section>
                    <div className="camera-filter-footer">
                      <small>{mediaUpdating.filter ? t('Applying filter...') : screenSharing ? t('Camera effects apply after screen share stops.') : t('Outgoing camera effects - {performance}', { performance: cameraFilterPerformance })}</small>
                    </div>
                  </div>
                ) : activeToolPanel === 'manage' ? (
                  <div className="tool-status-panel room-ops-panel">
                    {controlsLoading ? <LoadingMovie label={t('Loading controls')} compact /> : null}
                    {!roomControls ? (
                      <div className="empty-chat">
                        <strong>{t('Host Controls')}</strong>
                        <span>{t('Available to the room owner, admins, and moderators.')}</span>
                        <button type="button" className="secondary-button" onClick={() => loadRoomControls()} disabled={controlsLoading}>{t('Refresh')}</button>
                      </div>
                    ) : (
                      <>
                        <div className="guard-summary">
                          <span>{roomControls.role}</span>
                          <strong>{roomOpsParticipants.length}</strong>
                          <small>{t(roomOpsParticipants.length === 1 ? 'active participant' : 'active participants')}</small>
                        </div>
                        {ownerCanApproveStage ? (
                          <div className="room-stage-requests">
                            <header>
                              <strong>{t('Stage requests')}</strong>
                              <small>{visibleStageRequests.length ? t('Waiting for owner approval') : t('No pending requests')}</small>
                            </header>
                            {visibleStageRequests.map((request) => {
                              const busy = stageRequestActionIds[Number(request.id || 0) || request.userId]
                              return (
                                <article key={request.id} className="room-ops-row stage-request-row">
                                  <span>
                                    <strong>{request.userName}</strong>
                                    <small>{request.requestedMic ? 'mic' : 'listen'} · {request.requestedCamera ? 'camera' : 'watch only'}</small>
                                  </span>
                                  <div className="chat-actions">
                                    <button type="button" className="neutral" onClick={() => applyStagePermission(request, 'approve')} disabled={Boolean(busy)}>
                                      {busy === 'approve' ? t('Approving...') : t('Approve')}
                                    </button>
                                    <button type="button" className="danger" onClick={() => applyStagePermission(request, 'reject')} disabled={Boolean(busy)}>
                                      {busy === 'reject' ? t('Declining...') : t('Decline')}
                                    </button>
                                  </div>
                                </article>
                              )
                            })}
                          </div>
                        ) : null}
                        <div className="room-ops-list">
                          {roomOpsParticipants.map((participant) => {
                            const targetUserId = Number(participant.user_id || 0)
                            const isSelf = targetUserId === currentUserId
                            const busy = Boolean(moderatingUserIds[targetUserId])
                            const stageBusy = stageRequestActionIds[targetUserId]
                            const targetRole = participant.role_in_room || 'end_user'
                            const canApproveParticipantStage = ownerCanApproveStage && !isSelf && ['audience', 'end_user'].includes(targetRole)
                            const canModerateParticipant = participant.can_moderate ?? (!isSelf && canModerateRoomRole(roomControls.role, targetRole))
                            const moderationDisabledReason = isSelf
                              ? t('You cannot moderate your own session.')
                              : canModerateParticipant
                                ? ''
                                : `Your ${roomControls.role} role cannot moderate ${targetRole}.`
                            const moderationDisabled = busy || Boolean(moderationDisabledReason)
                            const moderationTitle = busy ? t('Moderation in progress') : moderationDisabledReason || undefined
                            return (
                              <article key={`${participant.session_id}-${targetUserId}`} className="room-ops-row">
                                <span>
                                  <strong>{participant.user_name || `User #${targetUserId}`}</strong>
                                  <small>{targetRole}{isSelf ? ' (you)' : ''} · {participant.mic_enabled ? 'mic on' : 'mic off'} · {participant.camera_enabled ? 'cam on' : 'cam off'}</small>
                                </span>
                                <div className="chat-actions">
                                  {canApproveParticipantStage ? (
                                    <button type="button" className="neutral" onClick={() => applyStagePermission(participant, 'approve')} disabled={Boolean(stageBusy)} title={t('Allow this viewer to join')}>
                                      {stageBusy === 'approve' ? t('Approving...') : t('Allow')}
                                    </button>
                                  ) : null}
                                  <button type="button" className="neutral" onClick={() => applyParticipantModeration(participant, 'mute_mic')} disabled={moderationDisabled} title={moderationTitle}>{t('Mute')}</button>
                                  <button type="button" className="neutral" onClick={() => applyParticipantModeration(participant, 'disable_camera')} disabled={moderationDisabled} title={moderationTitle}>{t('Camera')}</button>
                                  <button type="button" className="danger" onClick={() => applyParticipantModeration(participant, 'kick')} disabled={moderationDisabled} title={moderationTitle}>{t('Kick')}</button>
                                  <button type="button" className="danger" onClick={() => applyParticipantModeration(participant, 'ban')} disabled={moderationDisabled} title={moderationTitle}>{t('Ban')}</button>
                                </div>
                              </article>
                            )
                          })}
                          {!roomOpsParticipants.length ? <small>{t('No active participants yet.')}</small> : null}
                          {roomOpsOnlySelf ? <small>{t('No other active participants.')}</small> : null}
                        </div>
                        <div className="room-stage-requests room-ban-list">
                          <header>
                            <strong>{t('Active bans')}</strong>
                            <small>{activeRoomBans.length ? t('Users blocked from this room') : t('No active bans')}</small>
                          </header>
                          {activeRoomBans.map((ban) => {
                            const busy = Boolean(revokingBanIds[Number(ban.id || 0)])
                            const banUntil = ban.ends_at ? new Date(ban.ends_at).toLocaleString() : t('Permanent')
                            return (
                              <article key={ban.id} className="room-ops-row">
                                <span>
                                  <strong>{ban.user_name || `User #${ban.banned_user_id}`}</strong>
                                  <small>{t(ban.ban_type === 'temporary' ? 'Temporary ban' : 'Permanent ban')} · {banUntil}</small>
                                </span>
                                <div className="chat-actions">
                                  <button type="button" className="neutral" onClick={() => revokeRoomBan(ban)} disabled={busy}>
                                    {busy ? t('Unbanning...') : t('Unban')}
                                  </button>
                                </div>
                              </article>
                            )
                          })}
                        </div>
                        {roomControls.can_assign_roles ? (
                          <form className="chat-edit-form room-role-form" onSubmit={(event) => {
                            event.preventDefault()
                            saveRoomRole(false)
                          }}>
                            <select
                              className="room-role-user-select"
                              value={roleForm.userId}
                              onChange={(event) => {
                                setRoleForm((current) => ({ ...current, userId: event.target.value }))
                                setRoleFeedback({ type: '', text: '' })
                              }}
                              disabled={roleSaving || roleTargetUnavailable}
                              aria-label={t('Room member')}
                            >
                              <option value="">{roleTargetUnavailable ? t('No users available') : t('Select user')}</option>
                              {roleTargetOptions.map((target) => (
                                <option key={target.userId} value={target.userId}>
                                  {roomRoleOptionLabel(target)}
                                </option>
                              ))}
                            </select>
                            <select value={roleForm.role} onChange={(event) => setRoleForm((current) => ({ ...current, role: event.target.value }))} disabled={roleSaving} aria-label={t('Room role')}>
                              <option value="moderator">{t('Moderator')}</option>
                              <option value="admin">{t('Admin')}</option>
                            </select>
                            <button type="submit" disabled={roleSaving || !roleForm.userId}>
                              {roleSavingAction === 'assign' ? t('Assigning...') : t('Assign')}
                            </button>
                            <button type="button" className="secondary" onClick={() => saveRoomRole(true)} disabled={roleSaving || !roleForm.userId || !selectedRoleTarget?.currentRole}>
                              {roleSavingAction === 'remove' ? t('Removing...') : t('Remove')}
                            </button>
                            {selectedRoleTarget ? (
                              <small className="room-role-selected">
                                {selectedRoleTarget.name}{selectedRoleTarget.currentRole ? ` - ${selectedRoleTarget.currentRole}` : selectedRoleTarget.active ? ` - ${t('active')}` : ''}
                              </small>
                            ) : null}
                            {roleFeedback.text ? (
                              <small className={`room-role-feedback ${roleFeedback.type}`} role="status">
                                {roleFeedback.text}
                              </small>
                            ) : null}
                          </form>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="tool-status-panel ai-guard-panel">
                    <p>{aiGuardActive ? t('Safety is active. It checks room text before sending and blocks risky phrases.') : t('Safety tools are off for this room.')}</p>
                    <div className="guard-summary">
                      <span>{aiGuardActive ? t('Active') : t('Off')}</span>
                      <strong>{guardFindings.length}</strong>
                      <small>{t(guardFindings.length === 1 ? 'flagged message' : 'flagged messages')}</small>
                    </div>
                    <div className="guard-function-grid" aria-label={t('Safety function')}>
                      <span>
                        <strong>{t('Checks text')}</strong>
                        <small>{t('Scans room chat before send')}</small>
                      </span>
                      <span>
                        <strong>{t('Blocks risky phrases')}</strong>
                        <small>{t('Stops unsafe messages from posting')}</small>
                      </span>
                    </div>
                    {guardFindings.length ? (
                      <div className="guard-findings">
                        {guardFindings.map(({ message, matchedKeyword }) => (
                          <span key={message.id}>{matchedKeyword}: {message.message_body}</span>
                        ))}
                      </div>
                    ) : <small>{t('No flagged chat messages in the visible room log.')}</small>}
                  </div>
                )}
              </div>
            ) : null}

            <div className="buzzcast-room-controls">
              {!joined ? (
                <button className="primary-button buzzcast-connect-button" onClick={joinRoom} disabled={joining}>
                  {joining ? t('Entering...') : connectAttempted ? t('Re-enter') : t('Enter Room')}
                </button>
              ) : (
                <>
                  <button className="secondary-button buzzcast-connect-button" onClick={() => leaveRoom()}>
                    {t('Leave')}
                  </button>
                  {audienceMode ? (
                    <button
                      className="primary-button buzzcast-connect-button stage-request-button"
                      onClick={canCancelStageRequest ? cancelStageJoinRequest : requestStageJoin}
                      disabled={(!stageRequestsEnabled && !canCancelStageRequest) || stageRequestSending || (stageRequestPending && !canCancelStageRequest)}
                      title={!stageRequestsEnabled && !stageRequestPending ? t('Stage requests are closed') : stageRequestPending ? t('Waiting for room owner approval') : t('Ask room owner to join')}
                    >
                      {stageRequestSending
                        ? t('Sending...')
                        : stageRequestPending
                        ? t('Cancel Request')
                        : !stageRequestsEnabled
                        ? t('Stage Closed')
                        : t('Join')}
                    </button>
                  ) : null}
                </>
              )}
              <button
                className={`media-control-button icon-only media-toggle-mic ${micControlActive ? 'active' : 'muted'}${audienceMode ? ' locked' : ''}${mediaUpdating.mic ? ' syncing' : ''}`}
                onClick={toggleMic}
                disabled={micButtonDisabled}
                aria-label={micButtonTitle}
                aria-pressed={micControlActive}
                title={micButtonTitle}
              >
                <span className="control-glyph mic"></span>
              </button>
              <button
                className={`media-control-button icon-only media-toggle-camera ${cameraControlActive ? 'active' : 'muted'}${audienceMode ? ' locked' : ''}${mediaUpdating.camera ? ' syncing' : ''}`}
                onClick={toggleCamera}
                disabled={cameraButtonDisabled}
                aria-label={cameraButtonTitle}
                aria-pressed={cameraControlActive}
                title={cameraButtonTitle}
              >
                <span className="control-glyph camera"></span>
              </button>
              <button
                className={`media-control-button effect-text-button utility audio-effects-button${activeToolPanel === 'audio' ? ' active' : ''}${audioEffectsActive ? ' has-effect' : ''}`}
                onClick={() => toggleToolPanel('audio')}
                aria-label={activeToolPanel === 'audio' ? t('Close voice effects') : t('Open voice effects')}
                aria-pressed={activeToolPanel === 'audio'}
                title={t('Voice effects')}
              >
                <span className="control-glyph effects"></span>
                <span>{t('Voice')}</span>
              </button>
              <button
                className={activeToolPanel === 'filters' || cameraEffectsActive ? 'media-control-button effect-text-button utility active' : 'media-control-button effect-text-button utility'}
                onClick={() => toggleToolPanel('filters')}
                disabled={filterButtonDisabled}
                aria-label={activeToolPanel === 'filters' ? t('Close filters') : t('Open filters')}
                aria-pressed={activeToolPanel === 'filters'}
                title={t('Filters')}
              >
                <span className="control-glyph beauty"></span>
                <span>{t('Filter')}</span>
              </button>
              <button
                className={screenSharing ? 'media-control-button icon-only utility active' : 'media-control-button icon-only utility'}
                onClick={toggleScreenShare}
                disabled={!joined || joining || mediaUpdating.screen || !canPublishStageMedia}
                aria-label={screenSharing ? t('Stop screen share') : t('Screen share')}
                aria-pressed={screenSharing}
                title={audienceMode ? t('Owner approval required') : screenSharing ? t('Stop screen share') : t('Screen share')}
              >
                <span className="control-glyph screen"></span>
              </button>
              <button className={activeToolPanel === 'guard' ? 'media-control-button icon-only utility active' : 'media-control-button icon-only utility'} onClick={() => toggleToolPanel('guard')} aria-label={t('Safety')} title={t('Safety')}>
                <span className="control-glyph guard"></span>
              </button>
              <button className={activeToolPanel === 'manage' ? 'media-control-button icon-only utility active' : 'media-control-button icon-only utility'} onClick={openManageTool} aria-label={t('Host Controls')} title={t('Host Controls')}>
                <span className="control-glyph ops"></span>
              </button>
            </div>

          </div>
        </section>

        <aside className="buzzcast-live-side">
          <ChatPanel
            roomId={roomId}
            signalingRoom={signalingRoomRef.current}
            socket={socketRef.current}
            user={user}
            room={room}
            localStream={localStream}
            focusRequest={chatFocusRequest}
            externalMessage={externalChatMessage}
            inboxPeerRequest={inboxPeerRequest}
            followRefreshKey={followRefreshKey}
            language={language}
            presentation={chatPresentation}
            participantPreview={joinerChatParticipants}
            guideText={roomGuideText}
            onParticipantAction={handlePeerFollowAction}
            onMessagesChange={setChatMessages}
          />
        </aside>
      </main>
      {activeFollowRequest ? (
        <div className="follow-request-backdrop" role="dialog" aria-modal="true" aria-labelledby="follow-request-title">
          <section className="follow-request-modal">
            <button type="button" className="follow-request-close" onClick={() => setActiveFollowRequestId(null)} aria-label={t('Close follow request')}>x</button>
            <div className="follow-request-avatar image-avatar">
              <img src={avatarForUser(activeFollowRequest.requester, activeFollowRequest.requester_id)} alt="" loading="lazy" />
            </div>
            <span>{t('Follow request')}</span>
            <h3 id="follow-request-title">{t('{name} wants to follow you', { name: activeFollowRequest.requester?.name || t('A user') })}</h3>
            <p>{t('Accept this request to unlock private chat between both of you.')}</p>
            <div className="follow-request-actions">
              <button type="button" className="secondary-button" onClick={() => respondToFollowRequest(activeFollowRequest, 'reject')}>
                {t('Decline')}
              </button>
              <button type="button" className="primary-button" onClick={() => respondToFollowRequest(activeFollowRequest, 'accept')}>
                {t('Accept')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {expandedScreenShareTile ? (
        <div className="screen-share-viewer" role="dialog" aria-modal="true" aria-label={t('Remote screen share')}>
          <div className="screen-share-viewer-backdrop" onClick={() => setExpandedScreenShareId('')}></div>
          <section className="screen-share-viewer-panel">
            <header>
              <div>
                <strong>{expandedScreenShareTile.mediaState.userName || t('Screen share')}</strong>
                <span>{room?.name || t('Live room')}</span>
              </div>
              <button type="button" onClick={() => setExpandedScreenShareId('')} aria-label={t('Close screen share')}>x</button>
            </header>
            <VideoTile
              stream={expandedScreenShareTile.stream}
              label={`${expandedScreenShareTile.mediaState.userName || t('Remote User')} ${t('screen')}`}
              userId={expandedScreenShareTile.mediaState.userId}
              gender={expandedScreenShareTile.mediaState.gender}
              avatarUrl={expandedScreenShareTile.mediaState.avatarUrl}
              badge="screen"
              micOn={expandedScreenShareTile.mediaState.micOn !== false}
              cameraOn
              rtcMode="video"
              language={language}
            />
          </section>
        </div>
      ) : null}
    </div>
  )
}
