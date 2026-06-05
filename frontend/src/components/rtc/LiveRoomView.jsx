import { useEffect, useMemo, useRef, useState } from 'react'
import { avatarForIndex, avatarForUser, brandAssets, coverForRoomType } from '../../assets/rtc/catalog'
import { apiRequest, getRtcConfig } from '../../services/api'
import { createLocalMediaStream, requestLocalMediaTrack, stopMediaStream } from '../../services/media'
import { NativeRtcClient } from '../../services/rtcClient'
import { createSignalingSocket, emitMediaState, joinSignalingRoom, waitForSocketConnection } from '../../services/signaling'
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
const aiGuardKeywords = ['spam', 'scam', 'abuse', 'nude', 'violent', 'private transaction']

function compactNumber(value) {
  const number = Number(value || 0)
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`
  return String(number)
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

function mediaTrackCount(stream, kind) {
  const tracks = stream?.getTracks?.().filter((track) => track.kind === kind) || []
  const live = tracks.filter((track) => track.readyState === 'live').length

  return { live, total: tracks.length }
}

function formatTrackCount(count) {
  return `${count.live}/${count.total}`
}

function hasInboundVideoTrack(stream) {
  return stream?.getVideoTracks?.().some((track) => track.readyState !== 'ended') || false
}

function remoteVideoExpectedFromState(mediaState = {}) {
  if (mediaState.screenShared === true) return true
  return String(mediaState.rtcMode || 'video') !== 'audio' && mediaState.cameraOn === true
}

function aggregateRemoteTrackCounts(remoteStreams = {}, kind) {
  return Object.values(remoteStreams || {}).reduce((counts, stream) => {
    const next = mediaTrackCount(stream, kind)
    return {
      live: counts.live + next.live,
      total: counts.total + next.total,
    }
  }, { live: 0, total: 0 })
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

function buildRtcDiagnostics({ localStream, remoteStreams, peerStates, peerStats, peerMediaStates, peerVideoWatchdogStates }) {
  const statsList = Object.values(peerStats || {}).filter(Boolean)
  const socketIds = Array.from(new Set([
    ...Object.keys(peerStates || {}),
    ...Object.keys(peerStats || {}),
    ...Object.keys(peerMediaStates || {}),
    ...Object.keys(remoteStreams || {}),
  ]))

  return {
    localAudio: mediaTrackCount(localStream, 'audio'),
    localVideo: mediaTrackCount(localStream, 'video'),
    remoteAudio: aggregateRemoteTrackCounts(remoteStreams, 'audio'),
    remoteVideo: aggregateRemoteTrackCounts(remoteStreams, 'video'),
    inboundVideoKbps: sumMediaBitrate(statsList, 'inbound', 'video'),
    outboundVideoKbps: sumMediaBitrate(statsList, 'outbound', 'video'),
    peers: socketIds.map((socketId) => {
      const stats = peerStats?.[socketId] || {}
      const mediaState = peerMediaStates?.[socketId] || {}
      const watchdogState = peerVideoWatchdogStates?.[socketId] || {}
      const rawState = stats.connectionState || peerStates?.[socketId] || 'waiting'
      const state = watchdogState.status === 'failed' ? 'no-video' : rawState
      const iceState = stats.iceConnectionState || ''
      const watchdogLabel = watchdogState.status === 'failed'
        ? 'No video received'
        : watchdogState.message || ''

      return {
        socketId,
        label: mediaState.userName || `Peer ${String(socketId).slice(0, 6)}`,
        state,
        stateLabel: watchdogLabel || state,
        iceState,
        watchdogStatus: watchdogState.status || '',
        inboundVideoKbps: numericStat(stats.media?.inbound?.video?.bitrateKbps),
        outboundVideoKbps: numericStat(stats.media?.outbound?.video?.bitrateKbps),
      }
    }),
  }
}

export function LiveRoomView({ roomId, roomPassword = '', initialRoom = null, initialRtcMode = 'video', autoConnect = false, user, onBack, onProfile }) {
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
  const [roomPasswordInput, setRoomPasswordInput] = useState(roomPassword)
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false)
  const [rtcConfigState, setRtcConfigState] = useState(null)
  const [joinEffect, setJoinEffect] = useState(null)
  const [activeToolPanel, setActiveToolPanel] = useState(null)
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
  const autoConnectAttemptedRef = useRef(false)
  const socketRef = useRef(null)
  const rtcRef = useRef(null)
  const streamRef = useRef(null)
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
        setConnectionIssue(`${label} negotiation retry failed: ${error.message}`)
        setStatus(`${label} negotiation retry failed: ${error.message}`)
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
        if (typeof rtcClient?.restartIce === 'function') {
          await rtcClient.restartIce(socketId, 'remote-video-missing')
        } else if (typeof rtcClient?.createOffer === 'function') {
          await rtcClient.createOffer(socketId)
        }
      } catch (error) {
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
    await rtcRef.current?.replaceLocalTrack('video', null, nextStream, { renegotiate: false })

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
    const { track } = await requestLocalMediaTrack(kind)
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
      setConnectionIssue(`${label} negotiation failed: ${error.message}`)
      setStatus(`${label} negotiation failed: ${error.message}`)
      scheduleNegotiationRetry(remoteSocketId, rtcClient, label)
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
          setConnectionIssue(`Offer failed: ${error.message}`)
          setStatus(`Offer failed: ${error.message}`)
          scheduleNegotiationRetry(fromSocketId, rtcClient, 'Peer')
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
      socket.on('user-left', ({ socketId }) => {
        setSignalingPeerCount((count) => Math.max(0, count - 1))
        resetPeerVideoWatchdog(socketId)
        resetPeerNegotiationRetry(socketId)
        rtcClient.closePeer(socketId)
        setRemoteStreams((previous) => {
          const copy = { ...previous }
          delete copy[socketId]
          remoteStreamsRef.current = copy
          return copy
        })
        setPeerStates((previous) => {
          const copy = { ...previous }
          delete copy[socketId]
          peerStatesRef.current = copy
          return copy
        })
        setPeerStats((previous) => {
          const copy = { ...previous }
          delete copy[socketId]
          peerStatsRef.current = copy
          return copy
        })
        setPeerMediaStates((previous) => {
          const copy = { ...previous }
          delete copy[socketId]
          peerMediaStatesRef.current = copy
          return copy
        })
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
        console.debug('RTC quality report skipped:', error.message)
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
    ? 'Start microphone'
    : mediaUpdating.mic ? 'Saving microphone' : micOn ? 'Mute microphone' : 'Unmute microphone'
  const cameraButtonTitle = cameraCanRetry
    ? 'Start camera'
    : screenSharing ? 'Stop screen share before changing camera' : mediaUpdating.camera ? 'Saving camera' : cameraOn ? 'Turn camera off' : 'Turn camera on'
  const guardFindings = chatMessages
    .filter((message) => message.message_type === 'text')
    .map((message) => {
      const body = String(message.message_body || '')
      const matchedKeyword = aiGuardKeywords.find((keyword) => body.toLowerCase().includes(keyword))
      return matchedKeyword ? { message, matchedKeyword } : null
    })
    .filter(Boolean)
    .slice(-5)
  const viewerCount = Math.max(Number(room?.active_participants || 0), remotePeerCount, joined ? 1 : 0)
  const roomTitle = room?.name || `Room #${roomId}`
  const displayUserCount = compactNumber(viewerCount)
  const profileAvatar = avatarForUser(user, user?.id || 0)
  const rtcHealth = summarizeRtcHealth({ joined, remotePeerCount, peerStates, peerStats, rtcMode, cameraOn, screenSharing })
  const rtcDiagnostics = buildRtcDiagnostics({ localStream, remoteStreams, peerStates, peerStats, peerMediaStates, peerVideoWatchdogStates })
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
  const filterButtonDisabled = joining || mediaUpdating.filter || rtcMode === 'audio'
  const activeFollowRequest = followRelations.incoming.find((request) => Number(request.id) === Number(activeFollowRequestId))
    || followRelations.incoming[0]
    || null
  const rtcStageStatusText = connectionIssue || status || (joined ? 'Connected' : 'Ready to connect')
  const rtcStageStatusTone = connectionIssue || (connectAttempted && !joined && !joining)
    ? 'error'
    : joined ? 'online' : joining ? 'connecting' : 'idle'
  const rtcStageStatusLabel = joined
    ? 'RTC connected'
    : joining ? 'RTC connecting' : connectAttempted ? 'RTC issue' : 'RTC ready'
  latestRtcQualityRef.current = buildRtcQualityPayload({ rtcHealth, remotePeerCount, peerStates, peerStats })

  return (
    <div className="buzzcast-shell buzzcast-live-shell">
      <header className="buzzcast-topbar buzzcast-live-topbar">
        <button type="button" className="buzzcast-logo buzzcast-live-logo" onClick={handleBack} aria-label="Back to rooms">
          <div className="buzzcast-logo-mark image-mark">
            <img src={brandAssets.appIconSmall} alt="TalkEachOther" decoding="async" />
          </div>
          <div>
            <strong>TalkEachOther</strong>
            <span>Video and music rooms</span>
          </div>
        </button>
        <div className="buzzcast-search-wrap buzzcast-live-search">
          <input value={roomTitle} readOnly aria-label="Current room" />
          <button type="button" onClick={openChatTool} aria-label="Focus chat">
            <span className="buzzcast-search-icon" aria-hidden="true"></span>
          </button>
        </div>
        <div className="buzzcast-actions">
          <button type="button" className="buzzcast-avatar-button" onClick={onProfile} aria-label="Open profile" title="Open profile">
            <span className="image-avatar"><img src={profileAvatar} alt="" /></span>
          </button>
        </div>
      </header>

      <aside className="buzzcast-left-rail buzzcast-live-rail">
        <button type="button" className="active" onClick={handleBack}>
          <span className="buzzcast-rail-icon rail-live" aria-hidden="true"></span>
          <b>Live</b>
        </button>
        <button type="button" onClick={onProfile}>
          <span className="buzzcast-rail-icon rail-me" aria-hidden="true"></span>
          <b>Me</b>
        </button>
        <div className="buzzcast-rail-spacer"></div>
        <button type="button" onClick={handleBack}>
          <span className="buzzcast-rail-icon rail-help" aria-hidden="true"></span>
          <b>Back</b>
        </button>
      </aside>

      <main className="buzzcast-live-main">
        <section className="buzzcast-live-stage-panel">
          <div className="buzzcast-stage buzzcast-rtc-stage">
            <img className="buzzcast-stage-image" src={roomCover} alt="" />
          {joinEffect && (
            <div className="join-effect" key={joinEffect.key}>
              <span></span>
              <strong>{joinEffect.name} joined</strong>
            </div>
          )}
            <div className="buzzcast-room-summary" aria-label="Room summary">
              <strong title={roomTitle}>{roomTitle}</strong>
              <span>Room ID: {room?.id || roomId}</span>
              <small>{displayUserCount} user{viewerCount === 1 ? '' : 's'}</small>
            </div>
            <div className={`live-rtc-status-card ${rtcStageStatusTone}`} title={rtcStageStatusText}>
              <span className="live-rtc-status-dot" aria-hidden="true"></span>
              <strong>{rtcStageStatusLabel}</strong>
              <small>{rtcStageStatusText}</small>
            </div>

            {joined ? (
              <div className={`rtc-health-strip ${rtcHealth.quality}`} aria-label="RTC health">
                <span className="rtc-health-dot" aria-hidden="true"></span>
                <strong>{rtcHealth.label}</strong>
                <small>{rtcHealth.detail}</small>
                <span>In {rtcHealth.incoming}</span>
                <span>Out {rtcHealth.outgoing}</span>
                <span>Video Out {rtcHealth.videoOutgoing}</span>
                <span>RTT {rtcHealth.rtt}</span>
                <span>Loss {rtcHealth.loss}</span>
              </div>
            ) : null}

            {joined ? (
              <div className="rtc-diagnostics-panel" aria-label="RTC diagnostics">
                <div className="rtc-diagnostics-grid">
                  <span><b>Local A/V</b>{formatTrackCount(rtcDiagnostics.localAudio)} / {formatTrackCount(rtcDiagnostics.localVideo)}</span>
                  <span><b>Remote A/V</b>{formatTrackCount(rtcDiagnostics.remoteAudio)} / {formatTrackCount(rtcDiagnostics.remoteVideo)}</span>
                  <span><b>Video out</b>{formatRtcBitrate(rtcDiagnostics.outboundVideoKbps)}</span>
                  <span><b>Video in</b>{formatRtcBitrate(rtcDiagnostics.inboundVideoKbps)}</span>
                </div>

                <div className="rtc-peer-diagnostics" aria-label="Peer connection states">
                  {rtcDiagnostics.peers.length ? rtcDiagnostics.peers.map((peer) => (
                    <span key={peer.socketId} className={`rtc-peer-diagnostic ${peer.state || 'waiting'} ${peer.watchdogStatus || ''}`}>
                      <b>{peer.label}</b>
                      <em>{peer.stateLabel}{peer.iceState && peer.iceState !== peer.state ? ` / ${peer.iceState}` : ''}</em>
                      <small>V in {formatRtcBitrate(peer.inboundVideoKbps)} - out {formatRtcBitrate(peer.outboundVideoKbps)}</small>
                    </span>
                  )) : (
                    <span className="rtc-peer-diagnostic idle">
                      <b>No peers</b>
                      <em>waiting</em>
                      <small>V in 0 kb/s - out 0 kb/s</small>
                    </span>
                  )}
                </div>
              </div>
            ) : null}

            <div className="buzzcast-live-stage-streams">
              {localStream || remoteTiles.length ? (
                <>
                  <VideoTile
                    stream={localStream}
                    muted
                    label={user?.name || 'You'}
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
                    const screenShareOwner = mediaState.userName || 'remote user'
                    const peer = {
                      id: Number(mediaState.userId || 0),
                      name: mediaState.userName || 'Remote User',
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
                        expandLabel={`Open ${screenShareOwner} screen share full screen`}
                      />
                    )
                  })}
                </>
              ) : (
                <div className="buzzcast-waiting-card">
                  <img src={roomAvatar} alt="" />
                  <strong>{roomTitle}</strong>
                  <span>Press Connect RTC to start</span>
                  {connectAttempted || joining ? (
                    <small className={`waiting-rtc-status ${rtcStageStatusTone}`}>{rtcStageStatusText}</small>
                  ) : null}
                </div>
              )}
            </div>

            {showPasswordRecovery && (
              <div className="buzzcast-password-popover">
                <strong>Room password required</strong>
                <input
                  type="password"
                  value={roomPasswordInput}
                  onChange={(event) => setRoomPasswordInput(event.target.value)}
                  placeholder="Room password"
                  autoComplete="current-password"
                />
              </div>
            )}

            {activeToolPanel ? (
              <div className="live-tool-panel buzzcast-floating-tool">
                <header>
                  <strong>{activeToolPanel === 'screen' ? 'Screen share' : activeToolPanel === 'filters' ? 'Beauty & Background' : 'AI guard'}</strong>
                  <button type="button" onClick={() => setActiveToolPanel(null)} aria-label="Close tool panel">x</button>
                </header>
                {activeToolPanel === 'screen' ? (
                  <div className="tool-status-panel">
                    <p>{screenSharing ? 'Your screen is being sent to the room.' : 'Share a window or display while keeping the current room camera controls unchanged.'}</p>
                    <button type="button" className={screenSharing ? 'danger-button' : 'primary-button'} onClick={toggleScreenShare} disabled={mediaUpdating.screen}>
                      {mediaUpdating.screen ? 'Working...' : screenSharing ? 'Stop sharing' : 'Start screen share'}
                    </button>
                    <small>{room?.screen_share_enabled === false ? 'Screen share is turned off for this room.' : 'Presenter tools are available for this room.'}</small>
                  </div>
                ) : activeToolPanel === 'filters' ? (
                  <div className="tool-status-panel camera-filter-panel">
                    <p>{activeCameraFilter.label}: {activeCameraFilter.detail}{beautyActiveCount ? ` - ${beautyActiveCount} beauty setting${beautyActiveCount === 1 ? '' : 's'} active` : ''}{backgroundEffectActive ? ` - ${activeBackgroundEffect.label} background` : ''}</p>
                    <div className="camera-effect-summary" aria-label="Camera effect summary">
                      <span>
                        <strong>Face beauty</strong>
                        <small>{beautyActiveCount ? `${beautyActiveCount} active` : 'Ready'}</small>
                      </span>
                      <span>
                        <strong>Background filter</strong>
                        <small>{backgroundEffect === 'blur' ? `${backgroundBlurPercent}% blur` : 'Blur off'}</small>
                      </span>
                    </div>
                    <section className="camera-effect-section">
                      <header>
                        <strong>Background blur</strong>
                        <small>{backgroundEffect === 'blur' ? `${backgroundBlurPercent}% strength` : 'Off'}</small>
                      </header>
                      <button
                        type="button"
                        className={backgroundEffectActive ? 'background-blur-toggle active' : 'background-blur-toggle'}
                        onClick={toggleBackgroundBlur}
                        disabled={filterButtonDisabled}
                        aria-label={backgroundEffectActive ? 'Turn background blur off' : 'Turn background blur on'}
                        aria-pressed={backgroundEffectActive}
                        title={backgroundEffectActive ? `Background blur ${backgroundBlurPercent}%` : 'Background blur off'}
                      >
                        <span className="control-glyph background"></span>
                        <span>
                          <strong>BG</strong>
                          <small>{backgroundEffectActive ? 'Background blur on' : 'Background blur off'}</small>
                        </span>
                      </button>
                      <label className="beauty-slider-row background-blur-slider">
                        <span>
                          <strong>Blur amount</strong>
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
                        <strong>Face beauty</strong>
                        <small>{mirrorEnabled ? 'Mirror on' : 'Smooth, light, warmth'}</small>
                      </header>
                      <div className="camera-beauty-controls" aria-label="Face beauty controls">
                        <button
                          type="button"
                          className={mirrorEnabled ? 'beauty-mirror-button active' : 'beauty-mirror-button'}
                          onClick={toggleBeautyMirror}
                          disabled={filterButtonDisabled}
                          aria-pressed={mirrorEnabled}
                          title={mirrorEnabled ? 'Turn mirror camera off' : 'Turn mirror camera on'}
                        >
                          <span className="control-glyph mirror" aria-hidden="true"></span>
                          <span>
                            <strong>Mirror</strong>
                            <small>{mirrorEnabled ? 'Mirrored camera view' : 'Normal camera view'}</small>
                          </span>
                          <b>{mirrorEnabled ? 'On' : 'Off'}</b>
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
                        <strong>Filter presets</strong>
                        <small>Color and style</small>
                      </header>
                      <div className="camera-filter-grid" aria-label="Camera filter presets">
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
                      <small>{mediaUpdating.filter ? 'Applying filter...' : screenSharing ? 'Camera effects apply after screen share stops.' : `Outgoing camera effects - ${cameraFilterPerformance}`}</small>
                    </div>
                  </div>
                ) : (
                  <div className="tool-status-panel ai-guard-panel">
                    <p>Be polite and respectful. AI guard watches the current room text for risky phrases.</p>
                    <div className="guard-summary">
                      <span>{room?.ai_security_enabled ? 'Active' : 'Off'}</span>
                      <strong>{guardFindings.length}</strong>
                      <small>flagged message{guardFindings.length === 1 ? '' : 's'}</small>
                    </div>
                    {guardFindings.length ? (
                      <div className="guard-findings">
                        {guardFindings.map(({ message, matchedKeyword }) => (
                          <span key={message.id}>{matchedKeyword}: {message.message_body}</span>
                        ))}
                      </div>
                    ) : <small>No flagged chat messages in the visible room log.</small>}
                  </div>
                )}
              </div>
            ) : null}

            <div className="buzzcast-room-controls">
              {!joined ? (
                <button className="primary-button buzzcast-connect-button" onClick={joinRoom} disabled={joining}>
                  {joining ? 'Connecting...' : connectAttempted ? 'Rejoin' : 'Connect RTC'}
                </button>
              ) : (
                <button className="secondary-button buzzcast-connect-button" onClick={() => leaveRoom()}>
                  Leave
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
                className={activeToolPanel === 'filters' || cameraEffectsActive ? 'media-control-button effect-text-button utility active' : 'media-control-button effect-text-button utility'}
                onClick={() => toggleToolPanel('filters')}
                disabled={filterButtonDisabled}
                aria-label={activeToolPanel === 'filters' ? 'Close beauty and background controls' : 'Open beauty and background controls'}
                aria-pressed={activeToolPanel === 'filters'}
                title="Beauty and background"
              >
                <span className="control-glyph beauty"></span>
                <span>Beauty</span>
              </button>
              <button
                className={screenSharing ? 'media-control-button icon-only utility active' : 'media-control-button icon-only utility'}
                onClick={toggleScreenShare}
                disabled={joining || mediaUpdating.screen}
                aria-label={screenSharing ? 'Stop screen share' : 'Screen share'}
                aria-pressed={screenSharing}
                title={screenSharing ? 'Stop screen share' : 'Screen share'}
              >
                <span className="control-glyph screen"></span>
              </button>
              <button className={activeToolPanel === 'guard' ? 'media-control-button icon-only utility active' : 'media-control-button icon-only utility'} onClick={() => toggleToolPanel('guard')} aria-label="AI guard" title="AI guard">
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
            onMessagesChange={setChatMessages}
          />
        </aside>
      </main>
      {activeFollowRequest ? (
        <div className="follow-request-backdrop" role="dialog" aria-modal="true" aria-labelledby="follow-request-title">
          <section className="follow-request-modal">
            <button type="button" className="follow-request-close" onClick={() => setActiveFollowRequestId(null)} aria-label="Close follow request">x</button>
            <div className="follow-request-avatar image-avatar">
              <img src={avatarForUser(activeFollowRequest.requester, activeFollowRequest.requester_id)} alt="" loading="lazy" />
            </div>
            <span>Follow request</span>
            <h3 id="follow-request-title">{activeFollowRequest.requester?.name || 'A user'} wants to follow you</h3>
            <p>Accept this request to unlock private chat between both of you.</p>
            <div className="follow-request-actions">
              <button type="button" className="secondary-button" onClick={() => respondToFollowRequest(activeFollowRequest, 'reject')}>
                Decline
              </button>
              <button type="button" className="primary-button" onClick={() => respondToFollowRequest(activeFollowRequest, 'accept')}>
                Accept
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {expandedScreenShareTile ? (
        <div className="screen-share-viewer" role="dialog" aria-modal="true" aria-label="Remote screen share">
          <div className="screen-share-viewer-backdrop" onClick={() => setExpandedScreenShareId('')}></div>
          <section className="screen-share-viewer-panel">
            <header>
              <div>
                <strong>{expandedScreenShareTile.mediaState.userName || 'Screen share'}</strong>
                <span>Room ID: {room?.id || roomId}</span>
              </div>
              <button type="button" onClick={() => setExpandedScreenShareId('')} aria-label="Close screen share">x</button>
            </header>
            <VideoTile
              stream={expandedScreenShareTile.stream}
              label={`${expandedScreenShareTile.mediaState.userName || 'Remote user'} screen`}
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
