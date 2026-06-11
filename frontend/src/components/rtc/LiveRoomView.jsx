import { useEffect, useMemo, useRef, useState } from 'react'
import { actionAvatarAssets, avatarForIndex, avatarForUser, brandAssets, coverForRoomType } from '../../assets/rtc/catalog'
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
  defaultRtcModeForRoom,
  getInitialMediaMode,
  isLocalBrowserHost,
  isPasswordJoinError,
  normalizeRtcMode,
  peerMediaFromSignal,
  peerMediaMapFromUsers,
} from '../../utils/roomConfig'
import { ChatPanel } from './ChatPanel'
import { VideoTile } from './VideoTile'
import { LoadingMovie } from '../common/LoadingMovie'
import { translateApp } from '../rooms/roomsStaticData'

const LOCAL_MEDIA_FAST_TIMEOUT_MS = 7000
const RTC_PRESENCE_INTERVAL_MS = 20000
const RTC_QUALITY_REPORT_INTERVAL_MS = 30000
const RTC_VIDEO_WATCHDOG_DELAY_MS = 7000
const RTC_VIDEO_WATCHDOG_FINAL_DELAY_MS = 7000
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
const roomAccessCodeInputProps = {
  type: 'text',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  className: 'room-access-code-input',
}
const aiGuardKeywords = ['spam', 'scam', 'abuse', 'nude', 'violent', 'private transaction']
const ROOM_ROLE_RANK = {
  end_user: 0,
  audience: 0,
  speaker: 0,
  moderator: 1,
  admin: 2,
  owner: 3,
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

function hasInboundVideoTrack(stream) {
  return stream?.getVideoTracks?.().some((track) => track.readyState !== 'ended') || false
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
  const videoWatchdogTimersRef = useRef({})
  const videoWatchdogAttemptsRef = useRef({})
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
      const peerStateLabel = watchdogState.status === 'failed' ? 'No video received' : peerState

      return {
        socketId,
        stream: remoteStreams[socketId],
        mediaState,
        peerState,
        label: `${mediaState.userName || `Remote ${socketId.slice(0, 6)}`} - ${peerStateLabel}`,
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
  const roomAvatar = avatarForIndex(roomVisualIndex)
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
        voiceEffect: voiceEffectRef.current,
      },
    }
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

  function peerNeedsInboundVideo(socketId) {
    if (!socketId || String(socketId) === String(localSocketIdRef.current || '')) return false

    const peerState = String(peerStatesRef.current?.[socketId] || '').toLowerCase()
    if (['closed', 'disconnected', 'failed'].includes(peerState)) return false

    return remoteVideoExpectedFromState(peerMediaStatesRef.current?.[socketId] || {})
  }

  function peerHasInboundVideo(socketId) {
    return hasInboundVideoTrack(remoteStreamsRef.current?.[socketId])
  }

  function peerReadyForVideoFailure(socketId) {
    const peerConnection = rtcRef.current?.peerConnections?.[socketId]
    const connectionState = peerConnection?.connectionState === 'new' && peerConnection?.iceConnectionState !== 'new'
      ? peerConnection.iceConnectionState
      : peerConnection?.connectionState
    const peerState = String(connectionState || peerStatesRef.current?.[socketId] || '').toLowerCase()
    return ['connected', 'completed'].includes(peerState)
      || ['connected', 'completed'].includes(String(peerConnection?.iceConnectionState || '').toLowerCase())
  }

  function setPeerStateValue(socketId, state) {
    if (!socketId) return

    setPeerStates((previous) => {
      const next = { ...previous, [socketId]: state }
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

  async function publishMediaState(nextMicOn, nextCameraOn, options = {}) {
    const currentRtcMode = rtcModeRef.current
    const allowedCameraOn = canSignalCameraEnabled(nextCameraOn, currentRtcMode)
    if (!joinedRef.current || !activeRoomIdRef.current) return { micOn: nextMicOn, cameraOn: allowedCameraOn }

    const includesScreenState = Object.prototype.hasOwnProperty.call(options, 'screenShared')
    const data = await apiRequest(`/rooms/${activeRoomIdRef.current}/media-state`, {
      method: 'POST',
      body: JSON.stringify({
        mic_enabled: nextMicOn,
        camera_enabled: allowedCameraOn,
        ...(includesScreenState ? { screen_shared: options.screenShared } : {}),
      }),
    })

    const serverMicOn = Boolean(data.rtc?.mic_enabled)
    const serverCameraOn = canSignalCameraEnabled(data.rtc?.camera_enabled, currentRtcMode)
    micOnRef.current = serverMicOn
    cameraOnRef.current = serverCameraOn
    applyLocalMediaState(serverMicOn, serverCameraOn)
    setMicOn(serverMicOn)
    setCameraOn(serverCameraOn)

    if (socketRef.current && signalingRoomRef.current) {
      await emitMediaState(socketRef.current, {
        roomId: signalingRoomRef.current,
        rtcMode: currentRtcMode,
        micEnabled: serverMicOn,
        cameraEnabled: serverCameraOn,
        ...(includesScreenState ? { screenShared: Boolean(data.rtc?.screen_shared) } : {}),
      }).catch((error) => setStatus(`Media state saved, signaling sync failed: ${error.message}`))
    }

    return { micOn: serverMicOn, cameraOn: serverCameraOn }
  }

  async function beginPeerNegotiation(remoteSocketId, rtcClient, label = 'peer') {
    if (!remoteSocketId || !rtcClient) return

    rtcClient.createPeerConnection(remoteSocketId)

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
    const allowedCameraEnabled = canSignalCameraEnabled(cameraEnabled, normalizedMode)

    return {
      roomId: payloadRoomId,
      databaseRoomId: activeRoomIdRef.current,
      userId: user?.id,
      userName: user?.name || 'User',
      userGender: user?.gender || '',
      userAvatarUrl: user?.avatar_url || '',
      rtcMode: normalizedMode,
      micEnabled: Boolean(micEnabled),
      cameraEnabled: allowedCameraEnabled,
      screenShared: Boolean(screenShared),
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

  async function loadRoomControls({ quiet = false } = {}) {
    const targetRoomId = activeRoomIdRef.current || Number(room?.id || roomId || 0)
    if (!targetRoomId || controlsLoading) return null

    try {
      setControlsLoading(true)
      if (!quiet) setStatus('Loading room controls...')
      const data = await apiRequest(`/rooms/${targetRoomId}/controls`)
      setRoomControls(data.controls || null)
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

  async function applyBeautySettings(nextSettings, successStatus = 'Beauty settings applied') {
    const normalizedSettings = normalizeBeautySettings(nextSettings)
    const effectActive = isCameraFilterEffectActive(cameraFilterRef.current, normalizedSettings, backgroundEffectRef.current)
    const pipeline = cameraFilterPipelineRef.current
    const sharingScreen = Boolean(screenShareTrackRef.current)

    setBeautySettings(normalizedSettings)
    beautySettingsRef.current = normalizedSettings

    if (rtcModeRef.current === 'audio') {
      setStatus('Beauty filters are available in video rooms.')
      return
    }

    if (!joinedRef.current) {
      setStatus('Beauty settings selected. They will apply when you connect RTC.')
      return
    }

    try {
      if (pipeline && isLiveTrack(filteredCameraTrackRef.current) && effectActive) {
        pipeline.setBeautySettings(normalizedSettings)
        setStatus(sharingScreen ? 'Beauty settings selected. They will apply when screen share stops.' : successStatus)
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
        setStatus('Beauty settings selected. Turn camera on to apply them.')
      } else if (screenShareTrackRef.current) {
        setStatus('Beauty settings selected. They will apply when screen share stops.')
      } else {
        setStatus(successStatus)
      }
    } catch (error) {
      setStatus(`Beauty filter failed: ${error.message}`)
    }
  }

  function changeBeautySetting(settingId, value) {
    const nextSettings = normalizeBeautySettings({
      ...beautySettingsRef.current,
      [settingId]: value,
    })

    applyBeautySettings(nextSettings).catch((error) => setStatus(`Beauty filter failed: ${error.message}`))
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
      setStatus(`Joining room #${roomId}...`)

      const selectedRtcMode = normalizeRtcMode(rtcMode, room)
      const requestedMicIntent = Boolean(micOnRef.current)
      const requestedCameraIntent = selectedRtcMode === 'video' && Boolean(cameraOnRef.current)
      desiredMicOnRef.current = requestedMicIntent
      desiredCameraOnRef.current = requestedCameraIntent
      const rtcConfigPromise = getRtcConfig().catch((error) => {
        setConnectionIssue(`Could not load TURN/ICE config: ${error.message}`)
        return { iceServers: [], iceTransportPolicy: 'all', turnConfigured: false }
      })
      const mediaPromise = createLocalMediaStream(
        mediaMode === 'real' ? 'real' : mediaMode === 'mock' ? 'mock' : 'auto',
        selectedRtcMode,
        {
          ...audioProcessingOptions(),
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
      ).then((mediaResult) => {
        if (startupCancelled && mediaResult?.stream && streamRef.current !== mediaResult.stream) {
          stopMediaStream(mediaResult.stream)
        }
        return mediaResult
      }).catch((error) => ({ error }))
      const socket = createSignalingSocket()
      socketRef.current = socket
      const socketReadyPromise = waitForSocketConnection(socket)
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error }))

      setMediaState('starting')
      setSignalingState('connecting')
      setStatus('Preparing media, TURN, and signaling...')

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
      setRoom(joinData.room)
      setSession(joinData.session)
      activeRoomIdRef.current = Number(roomId)
      signalingRoomRef.current = joinData.rtc.signaling_room
      setRtcMode(joinedRtcMode)
      rtcModeRef.current = joinedRtcMode
      micOnRef.current = Boolean(joinData.rtc.mic_enabled)
      cameraOnRef.current = joinedRtcMode === 'video' && Boolean(joinData.rtc.camera_enabled)
      desiredMicOnRef.current = micOnRef.current
      desiredCameraOnRef.current = cameraOnRef.current
      setMicOn(micOnRef.current)
      setCameraOn(cameraOnRef.current)

      setConnectStep('media')
      setStatus('Finishing fast media path...')
      const [mediaResult, rtcConfig] = await Promise.all([mediaPromise, rtcConfigPromise])
      if (mediaResult?.error) throw mediaResult.error
      const media = mediaResult
      if (joinedRtcMode === 'audio') {
        media.stream.getVideoTracks().forEach((track) => {
          media.stream.removeTrack(track)
          try { track.stop() } catch {}
        })
      }
      const localMediaStream = await prepareStreamWithCameraFilter(media.stream, joinedRtcMode)
      streamRef.current = localMediaStream
      setLocalStream(localMediaStream)
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
      const productionTurnWarning = 'TURN is not configured. Your local camera can start, but remote video may fail on some networks until TURN_URLS and TURN_SHARED_SECRET are set and PM2 is restarted.'
      if (missingProductionTurn) {
        setConnectionIssue(productionTurnWarning)
      }

      setConnectStep('signaling')
      setSignalingState('connecting')
      setStatus(rtcConfig.turnConfigured ? 'Connecting with TURN enabled...' : 'Connecting without TURN. Remote video may fail on strict networks.')

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
          if (state === 'failed') setConnectionIssue(`Peer ${remoteSocketId.slice(0, 6)} connection failed. A TURN server may be required for this network.`)
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
            setStatus(`Recovering peer ${remoteSocketId.slice(0, 6)}${detail ? `: ${detail}` : ''}`)
          }

          if (recoveryState === 'failed') {
            setConnectionIssue(`Peer ${remoteSocketId.slice(0, 6)} recovery failed${detail ? `: ${detail}` : ''}`)
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
              setConnectionIssue(`Signaling recovery failed: ${error.message}`)
              setStatus(`Signaling recovery failed: ${error.message}`)
            })
          } else {
            setSignalingState('connected')
            setConnectionIssue('')
          }
        }
      })
      socket.on('connect_error', (error) => {
        setSignalingState('error')
        setConnectionIssue(`Signaling error: ${error.message}`)
        setStatus(`Signaling error: ${error.message}`)
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
          setConnectionIssue(`Signaling reconnect failed: ${error.message}`)
        }
      })
      socket.io.on('reconnect_failed', () => {
        if (socketRef.current === socket) {
          setSignalingState('failed')
          setConnectionIssue('Signaling reconnect failed.')
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
        setStatus(`Peer joined: ${socketId.slice(0, 6)}`)
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
        setStatus(message || 'Peer signal target changed; refreshing room peers...')
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
      socket.on('disconnect', (reason) => {
        if (socketRef.current === socket) {
          setSignalingState(joinedRef.current ? 'reconnecting' : 'idle')
          if (joinedRef.current) {
            setStatus(`Signaling reconnecting; media stays active (${reason})`)
          } else {
            setStatus(`Signaling disconnected: ${reason}`)
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
      setStatus(media.warning || connectedMediaWarning || (missingProductionTurn ? `Connected without TURN to ${joinData.rtc.signaling_room}` : `Connected to ${joinData.rtc.signaling_room}`))
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

    const audioTrack = streamRef.current?.getAudioTracks?.().find((track) => track.readyState === 'live') || null
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

  function changeVoiceEffect(nextEffect) {
    const normalizedEffect = ['natural', 'clear', 'deep', 'bright'].includes(nextEffect) ? nextEffect : 'natural'
    voiceEffectRef.current = normalizedEffect
    setVoiceEffect(normalizedEffect)
    setStatus(normalizedEffect === 'natural'
      ? 'Voice changer disabled.'
      : `${normalizedEffect[0].toUpperCase()}${normalizedEffect.slice(1)} voice preset selected.`)
  }

  async function toggleCamera() {
    if (rtcMode === 'audio' || mediaUpdating.camera) return
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
  }, [roomControls])

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
  const micCanRetry = joined && !micOn && !localAudioAvailable
  const cameraCanRetry = joined && rtcMode === 'video' && !cameraOn && !localVideoAvailable
  const micButtonDisabled = joining || mediaUpdating.mic
  const cameraButtonDisabled = joining || mediaUpdating.camera || rtcMode === 'audio' || screenSharing
  const micButtonTitle = micCanRetry
    ? t('Start microphone')
    : mediaUpdating.mic ? t('Saving microphone') : micOn ? t('Mute microphone') : t('Unmute microphone')
  const cameraButtonTitle = cameraCanRetry
    ? t('Start camera')
    : screenSharing ? t('Stop screen share before changing camera') : mediaUpdating.camera ? t('Saving camera') : cameraOn ? t('Turn camera off') : t('Turn camera on')
  const guardFindings = chatMessages
    .filter((message) => message.message_type === 'text')
    .map((message) => {
      const body = String(message.message_body || '')
      const matchedKeyword = aiGuardKeywords.find((keyword) => body.toLowerCase().includes(keyword))
      return matchedKeyword ? { message, matchedKeyword } : null
    })
    .filter(Boolean)
    .slice(-5)
  const roomTitle = room?.name || `Room #${roomId}`
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
  const filterButtonDisabled = joining || mediaUpdating.filter || rtcMode === 'audio'
  const activeFollowRequest = followRelations.incoming.find((request) => Number(request.id) === Number(activeFollowRequestId))
    || followRelations.incoming[0]
    || null
  const roleTargetOptions = buildRoomRoleTargets(roomControls)
  const selectedRoleTarget = roleTargetOptions.find((target) => target.userId === String(roleForm.userId))
  const roleTargetUnavailable = roleTargetOptions.length === 0
  const roomOpsParticipants = Array.isArray(roomControls?.participants) ? roomControls.participants : []
  const currentUserId = Number(user?.id || 0)
  const roomOpsOnlySelf = roomOpsParticipants.length > 0
    && roomOpsParticipants.every((participant) => Number(participant.user_id || 0) === currentUserId)
  const activeToolTitle = {
    audio: t('Audio effects'),
    filters: t('Beauty & Background'),
    guard: t('AI guard'),
    manage: t('Room Ops'),
    screen: t('Screen share'),
  }[activeToolPanel] || t('Room tools')
  const visibleTileCount = (localStream || remoteTiles.length ? 1 : 0) + remoteTiles.length
  const stageTileHeight = stageTileHeightForFrame(stageFrameSize, visibleTileCount)
  const stageFrameStyle = stageFrameSize ? {
    '--live-stage-width': `${stageFrameSize.width}px`,
    '--live-stage-height': `${stageFrameSize.height}px`,
    '--live-stage-tile-min-height': `${stageTileHeight}px`,
    '--live-stage-feature-min-height': `${(stageTileHeight * 2) + STAGE_RESIZE_GAP_PX}px`,
  } : undefined
  const stageStreamsClassName = `buzzcast-live-stage-streams layout-grid ${stageTileCountClass(visibleTileCount)}${stageFrameSize ? ' is-resized' : ''}`
  latestRtcQualityRef.current = buildRtcQualityPayload({ rtcHealth, remotePeerCount, peerStates, peerStats })

  return (
    <div className="buzzcast-shell buzzcast-live-shell">
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
            <div className="buzzcast-room-summary" aria-label={t('Room summary')}>
              <strong title={roomTitle}>{roomTitle}</strong>
              <span>{t('Room ID: {id}', { id: room?.id || roomId })}</span>
            </div>

            <div ref={stageStreamsRef} className={stageStreamsClassName} style={stageFrameStyle} data-tile-count={visibleTileCount}>
              {localStream || remoteTiles.length ? (
                <>
                  <VideoTile
                    stream={localStream}
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
                  />
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
              ) : (
                <div className="buzzcast-waiting-card">
                  <img src={roomAvatar} alt="" />
                  <strong>{roomTitle}</strong>
                  <span>{t('Room ID: {id}', { id: room?.id || roomId })}</span>
                </div>
              )}
            </div>

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
              <div className="live-tool-panel buzzcast-floating-tool">
                <header>
                  <strong>{activeToolTitle}</strong>
                  <button type="button" onClick={() => setActiveToolPanel(null)} aria-label={t('Close tool panel')}>x</button>
                </header>
                {activeToolPanel === 'screen' ? (
                  <div className="tool-status-panel">
                    <p>{screenSharing ? t('Your screen is being sent to the room.') : t('Share a window or display while keeping the current room camera controls unchanged.')}</p>
                    <button type="button" className={screenSharing ? 'danger-button' : 'primary-button'} onClick={toggleScreenShare} disabled={mediaUpdating.screen}>
                      {mediaUpdating.screen ? t('Working...') : screenSharing ? t('Stop sharing') : t('Start screen share')}
                    </button>
                    <small>{room?.screen_share_enabled === false ? t('Screen share is turned off for this room.') : t('Presenter tools are available for this room.')}</small>
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
                        {['natural', 'clear', 'deep', 'bright'].map((effect) => (
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
                      <small>{t('Voice presets are sent through the SDK audio options for compatible processors.')}</small>
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
                        <strong>{t('Room controls')}</strong>
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
                        <div className="room-ops-list">
                          {roomOpsParticipants.map((participant) => {
                            const targetUserId = Number(participant.user_id || 0)
                            const isSelf = targetUserId === currentUserId
                            const busy = Boolean(moderatingUserIds[targetUserId])
                            const targetRole = participant.role_in_room || 'end_user'
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
                    <p>{t('Be polite and respectful. AI guard watches the current room text for risky phrases.')}</p>
                    <div className="guard-summary">
                      <span>{room?.ai_security_enabled ? t('Active') : t('Off')}</span>
                      <strong>{guardFindings.length}</strong>
                      <small>{t(guardFindings.length === 1 ? 'flagged message' : 'flagged messages')}</small>
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
                  {joining ? t('Connecting...') : connectAttempted ? t('Rejoin') : t('Connect RTC')}
                </button>
              ) : (
                <button className="secondary-button buzzcast-connect-button" onClick={() => leaveRoom()}>
                  {t('Leave')}
                </button>
              )}
              <button
                className={`media-control-button icon-only media-toggle-mic ${micOn ? 'active' : 'muted'}${mediaUpdating.mic ? ' syncing' : ''}`}
                onClick={toggleMic}
                disabled={micButtonDisabled}
                aria-label={micButtonTitle}
                aria-pressed={micOn}
                title={micButtonTitle}
              >
                <span className="control-glyph mic"></span>
              </button>
              <button
                className={`media-control-button icon-only media-toggle-camera ${cameraOn ? 'active' : 'muted'}${mediaUpdating.camera ? ' syncing' : ''}`}
                onClick={toggleCamera}
                disabled={cameraButtonDisabled}
                aria-label={cameraButtonTitle}
                aria-pressed={cameraOn}
                title={cameraButtonTitle}
              >
                <span className="control-glyph camera"></span>
              </button>
              <button
                className={activeToolPanel === 'audio' || audioEffectsActive ? 'media-control-button effect-text-button utility active' : 'media-control-button effect-text-button utility'}
                onClick={() => toggleToolPanel('audio')}
                aria-label={activeToolPanel === 'audio' ? t('Close audio effects') : t('Open audio effects')}
                aria-pressed={activeToolPanel === 'audio'}
                title={t('Audio effects')}
              >
                <span className="control-glyph mic"></span>
                <span>{t('Audio')}</span>
              </button>
              <button
                className={activeToolPanel === 'filters' || cameraEffectsActive ? 'media-control-button effect-text-button utility active' : 'media-control-button effect-text-button utility'}
                onClick={() => toggleToolPanel('filters')}
                disabled={filterButtonDisabled}
                aria-label={activeToolPanel === 'filters' ? t('Close beauty and background controls') : t('Open beauty and background controls')}
                aria-pressed={activeToolPanel === 'filters'}
                title={t('Beauty and background')}
              >
                <span className="control-glyph beauty"></span>
                <span>{t('Beauty')}</span>
              </button>
              <button
                className={screenSharing ? 'media-control-button icon-only utility active' : 'media-control-button icon-only utility'}
                onClick={toggleScreenShare}
                disabled={joining || mediaUpdating.screen}
                aria-label={screenSharing ? t('Stop screen share') : t('Screen share')}
                aria-pressed={screenSharing}
                title={screenSharing ? t('Stop screen share') : t('Screen share')}
              >
                <span className="control-glyph screen"></span>
              </button>
              <button className={activeToolPanel === 'guard' ? 'media-control-button icon-only utility active' : 'media-control-button icon-only utility'} onClick={() => toggleToolPanel('guard')} aria-label={t('AI guard')} title={t('AI guard')}>
                <span className="control-glyph guard"></span>
              </button>
              <button className={activeToolPanel === 'manage' ? 'media-control-button icon-only utility active' : 'media-control-button icon-only utility'} onClick={openManageTool} aria-label={t('Room operations')} title={t('Room operations')}>
                <span className="control-glyph guard"></span>
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
                <span>{t('Room ID: {id}', { id: room?.id || roomId })}</span>
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
            />
          </section>
        </div>
      ) : null}
    </div>
  )
}
