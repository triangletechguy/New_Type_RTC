import { useEffect, useMemo, useRef, useState } from 'react'
import { avatarForIndex, brandAssets, coverForRoomType } from '../../assets/rtc/catalog'
import { apiRequest, getRtcConfig } from '../../services/api'
import { createLocalMediaStream, requestLocalMediaTrack, stopMediaStream } from '../../services/media'
import { NativeRtcClient } from '../../services/rtcClient'
import { createSignalingSocket, emitMediaState, joinSignalingRoom, waitForSocketConnection } from '../../services/signaling'
import {
  defaultRtcModeForRoom,
  getInitialMediaMode,
  isLocalBrowserHost,
  isPasswordJoinError,
  normalizeRtcMode,
  peerMediaFromSignal,
  peerMediaMapFromUsers,
  roomSupportsVideo,
} from '../../utils/roomConfig'
import { giftCatalog } from '../../utils/gifts'
import { ChatPanel } from './ChatPanel'
import { OwnerControlsPanel } from './OwnerControlsPanel'
import { VideoTile } from './VideoTile'

const LOCAL_MEDIA_FAST_TIMEOUT_MS = 1200
const aiGuardKeywords = ['spam', 'scam', 'abuse', 'nude', 'violent', 'private transaction']

function compactNumber(value) {
  const number = Number(value || 0)
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`
  return String(number)
}

export function LiveRoomView({ roomId, roomPassword = '', initialRoom = null, initialRtcMode = 'video', autoConnect = false, user, onBack, onProfile }) {
  const [status, setStatus] = useState(autoConnect ? 'Connecting RTC...' : 'Ready to connect')
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)
  const [connectAttempted, setConnectAttempted] = useState(false)
  const [connectStep, setConnectStep] = useState(autoConnect ? 'backend' : 'ready')
  const [connectionIssue, setConnectionIssue] = useState('')
  const [room, setRoom] = useState(initialRoom)
  const [session, setSession] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState({})
  const [peerStates, setPeerStates] = useState({})
  const [peerMediaStates, setPeerMediaStates] = useState({})
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
  const [sendingGiftId, setSendingGiftId] = useState('')
  const [giftToast, setGiftToast] = useState(null)
  const [screenSharing, setScreenSharing] = useState(false)
  const autoConnectAttemptedRef = useRef(false)
  const socketRef = useRef(null)
  const rtcRef = useRef(null)
  const streamRef = useRef(null)
  const screenShareTrackRef = useRef(null)
  const activeRoomIdRef = useRef(null)
  const signalingRoomRef = useRef(null)
  const localSocketIdRef = useRef(null)
  const joinedRef = useRef(false)
  const micOnRef = useRef(micOn)
  const cameraOnRef = useRef(cameraOn)
  const rtcModeRef = useRef(rtcMode)
  const negotiatedPeersRef = useRef(new Set())
  const pendingLocalTracksRef = useRef([])
  const joinEffectTimerRef = useRef(null)
  const giftToastTimerRef = useRef(null)

  const remoteTiles = useMemo(() => {
    const socketIds = new Set([
      ...Object.keys(peerMediaStates),
      ...Object.keys(peerStates),
      ...Object.keys(remoteStreams),
    ])

    return Array.from(socketIds).map((socketId) => {
      const mediaState = peerMediaStates[socketId] || {}
      const peerState = peerStates[socketId] || (remoteStreams[socketId] ? 'connected' : 'waiting')

      return {
        socketId,
        stream: remoteStreams[socketId],
        mediaState,
        peerState,
        label: `${mediaState.userName || `Remote ${socketId.slice(0, 6)}`} - ${peerState}`,
        badge: mediaState.screenShared ? 'screen' : '',
      }
    })
  }, [peerMediaStates, peerStates, remoteStreams])
  const remotePeerCount = Math.max(signalingPeerCount, remoteTiles.length)
  const roomVisualIndex = Number(room?.id || roomId || 0)
  const roomAvatar = avatarForIndex(roomVisualIndex)
  const roomCover = coverForRoomType(room?.room_type, room?.privacy_type, roomVisualIndex)
  const isRoomOwner = Number(room?.owner_id || initialRoom?.owner_id) === Number(user?.id)
  const ownerCanEndVideoRoom = isRoomOwner && roomSupportsVideo(room?.room_type || initialRoom?.room_type)

  function resetRtcState({ clearState = true } = {}) {
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
    negotiatedPeersRef.current.clear()
    if (clearState) {
      setLocalStream(null)
      setRemoteStreams({})
      setPeerStates({})
      setPeerMediaStates({})
      setSession(null)
      setSignalingPeerCount(0)
      setSignalingState('idle')
      setMediaState('idle')
      setConnectStep('ready')
      setScreenSharing(false)
      setActiveToolPanel(null)
    }
  }

  function hasLiveTrack(stream, kind) {
    return stream?.getTracks?.().some((track) => track.kind === kind && track.readyState === 'live')
  }

  function hasLiveLocalTrack(kind) {
    return hasLiveTrack(streamRef.current, kind)
  }

  function applyLocalMediaState(nextMicOn, nextCameraOn) {
    rtcRef.current?.setAudioEnabled(nextMicOn)
    rtcRef.current?.setVideoEnabled(nextCameraOn)
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = nextMicOn })
    streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = nextCameraOn })
  }

  async function attachCapturedLocalTrack(kind, track, { publish = true } = {}) {
    if (!track || track.readyState === 'ended') return null

    if (!rtcRef.current) {
      pendingLocalTracksRef.current.push({ kind, track })
      return track
    }

    const previousStream = streamRef.current
    const previousTracks = previousStream?.getTracks?.() || []
    const keptTracks = previousTracks.filter((item) => item !== track && item.kind !== kind && item.readyState !== 'ended')

    previousTracks
      .filter((item) => item !== track && item.kind === kind)
      .forEach((item) => {
        try { item.stop() } catch {}
      })

    track.enabled = true

    const nextStream = new MediaStream([...keptTracks, track])
    if (typeof previousStream?.__cleanup === 'function') {
      nextStream.__cleanup = previousStream.__cleanup
    }

    streamRef.current = nextStream
    setLocalStream(nextStream)
    await rtcRef.current.addLocalTrack(track, nextStream)

    const nextMicOn = kind === 'audio' ? true : micOnRef.current
    const nextCameraOn = kind === 'video' ? true : cameraOnRef.current
    setMicOn(nextMicOn)
    setCameraOn(nextCameraOn)
    applyLocalMediaState(nextMicOn, nextCameraOn)

    if (publish && joinedRef.current) {
      await publishMediaState(nextMicOn, nextCameraOn)
      setStatus(kind === 'video' ? 'Camera is live' : 'Microphone is live')
    }

    return track
  }

  async function flushPendingLocalTracks(options = {}) {
    const pendingTracks = pendingLocalTracksRef.current
    pendingLocalTracksRef.current = []

    for (const pendingTrack of pendingTracks) {
      await attachCapturedLocalTrack(pendingTrack.kind, pendingTrack.track, options)
    }
  }

  async function attachNewLocalTrack(kind, options = {}) {
    const { track } = await requestLocalMediaTrack(kind)
    return attachCapturedLocalTrack(kind, track, options)
  }

  async function publishMediaState(nextMicOn, nextCameraOn, options = {}) {
    if (!joined || !activeRoomIdRef.current) return { micOn: nextMicOn, cameraOn: nextCameraOn }

    const currentRtcMode = rtcModeRef.current
    const allowedCameraOn = currentRtcMode === 'video' && nextCameraOn
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
    const serverCameraOn = currentRtcMode === 'video' && Boolean(data.rtc?.camera_enabled)
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

    if (!shouldInitiateOffer(remoteSocketId)) {
      setPeerStates((previous) => ({ ...previous, [remoteSocketId]: previous[remoteSocketId] || 'waiting' }))
      return
    }

    if (negotiatedPeersRef.current.has(remoteSocketId)) return

    negotiatedPeersRef.current.add(remoteSocketId)
    setPeerStates((previous) => ({ ...previous, [remoteSocketId]: previous[remoteSocketId] || 'negotiating' }))

    try {
      const offerSent = await rtcClient.createOffer(remoteSocketId)
      if (offerSent === false) {
        negotiatedPeersRef.current.delete(remoteSocketId)
        setPeerStates((previous) => ({ ...previous, [remoteSocketId]: 'waiting' }))
      }
    } catch (error) {
      negotiatedPeersRef.current.delete(remoteSocketId)
      setConnectionIssue(`${label} negotiation failed: ${error.message}`)
      setStatus(`${label} negotiation failed: ${error.message}`)
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

  function showGiftToast(gift) {
    window.clearTimeout(giftToastTimerRef.current)
    setGiftToast({ ...gift, key: Date.now() })
    giftToastTimerRef.current = window.setTimeout(() => setGiftToast(null), 2200)
  }

  function emitSavedChatMessage(message) {
    if (!message?.id) return

    setExternalChatMessage({ ...message, local_event_key: Date.now() })

    if (socketRef.current && signalingRoomRef.current) {
      socketRef.current.timeout(3000).emit(
        'chat-message',
        {
          roomId: signalingRoomRef.current,
          message,
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
    setStatus(room?.chat_enabled === false ? 'Chat is disabled by owner controls.' : 'Chat composer is ready')
  }

  function toggleToolPanel(panel) {
    if (panel === 'chat') {
      openChatTool()
      return
    }

    setActiveToolPanel((current) => (current === panel ? null : panel))
  }

  async function sendGift(gift) {
    if (!joined) {
      setStatus('Connect RTC before sending gifts.')
      setActiveToolPanel('gifts')
      return
    }

    if (room?.gift_enabled === false) {
      setStatus('Gifts are disabled by owner controls.')
      setActiveToolPanel('gifts')
      return
    }

    try {
      setSendingGiftId(gift.id)
      setStatus(`Sending ${gift.label}...`)
      const data = await apiRequest(`/rooms/${roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          message_type: 'gift',
          message_body: `sent ${gift.label}`,
          media_url: gift.id,
        }),
      })
      emitSavedChatMessage(data.chat_message)
      showGiftToast(gift)
      setStatus(`${gift.label} sent`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSendingGiftId('')
    }
  }

  function currentCameraTrack(excludeTrack = null) {
    return streamRef.current?.getVideoTracks?.().find((track) => (
      track !== excludeTrack && track.readyState === 'live' && track !== screenShareTrackRef.current
    )) || null
  }

  async function syncScreenShareState(nextScreenSharing) {
    if (!joined || !activeRoomIdRef.current) return
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
      setStatus('Screen share is disabled by owner controls.')
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
        video: { cursor: 'always' },
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

      const targetStream = streamRef.current || displayStream
      if (targetStream && !targetStream.getTracks().includes(track)) targetStream.addTrack(track)
      if (!streamRef.current) {
        streamRef.current = targetStream
        setLocalStream(targetStream)
      }

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

  function shouldInitiateOffer(remoteSocketId) {
    const localSocketId = localSocketIdRef.current
    if (!localSocketId || !remoteSocketId) return false
    return String(localSocketId) < String(remoteSocketId)
  }

  function isPolitePeer(remoteSocketId) {
    const localSocketId = localSocketIdRef.current
    if (!localSocketId || !remoteSocketId) return true
    return String(localSocketId) > String(remoteSocketId)
  }

  function handleRemoteStream(remoteSocketId, remoteStream) {
    setRemoteStreams((previous) => ({ ...previous, [remoteSocketId]: remoteStream }))
    setPeerStates((previous) => ({ ...previous, [remoteSocketId]: previous[remoteSocketId] || 'connected' }))

    const hasVideoTrack = remoteStream?.getVideoTracks?.().some((track) => track.readyState !== 'ended')
    if (hasVideoTrack) {
      setPeerMediaStates((previous) => ({
        ...previous,
        [remoteSocketId]: {
          ...(previous[remoteSocketId] || {}),
          cameraOn: true,
          rtcMode: 'video',
        },
      }))
    }
  }

  async function negotiateExistingUsers(existingUsers, rtcClient) {
    const peers = Array.isArray(existingUsers) ? existingUsers : []
    setSignalingPeerCount(peers.length)
    setPeerMediaStates((previous) => ({ ...previous, ...peerMediaMapFromUsers(peers) }))
    if (!peers.length) return

    setStatus(`Found ${peers.length} peer connection${peers.length === 1 ? '' : 's'}...`)

    for (const remoteUser of peers) {
      await beginPeerNegotiation(remoteUser?.socketId, rtcClient, 'Peer')
    }
  }

  async function joinRoom() {
    let backendJoined = false

    try {
      if (joined || joining) return
      setJoining(true)
      setJoined(false)
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
      const joinData = await apiRequest(`/rooms/${roomId}/join`, {
        method: 'POST',
        body: JSON.stringify({
          ...(roomPasswordInput ? { password: roomPasswordInput } : {}),
          rtc_mode: selectedRtcMode,
          mic_enabled: micOn,
          camera_enabled: selectedRtcMode === 'video' && cameraOn,
        }),
      })

      backendJoined = true
      const joinedRtcMode = joinData.rtc.rtc_mode || (joinData.rtc.camera_enabled ? 'video' : 'audio')
      setRoom(joinData.room)
      setSession(joinData.session)
      activeRoomIdRef.current = Number(roomId)
      signalingRoomRef.current = joinData.rtc.signaling_room
      setRtcMode(joinedRtcMode)
      setMicOn(Boolean(joinData.rtc.mic_enabled))
      setCameraOn(joinedRtcMode === 'video' && Boolean(joinData.rtc.camera_enabled))

      setConnectStep('media')
      setMediaState('starting')
      setStatus('Starting fast media path...')
      const rtcConfigPromise = getRtcConfig().catch((error) => {
        setConnectionIssue(`Could not load TURN/ICE config: ${error.message}`)
        return { iceServers: [], iceTransportPolicy: 'all', turnConfigured: false }
      })
      const media = await createLocalMediaStream(
        mediaMode === 'real' ? 'real' : mediaMode === 'mock' ? 'mock' : 'auto',
        joinedRtcMode,
        {
          timeoutMs: LOCAL_MEDIA_FAST_TIMEOUT_MS,
          onLateTrack: ({ kind, track }) => {
            if (!activeRoomIdRef.current) {
              try { track.stop() } catch {}
              return
            }

            attachCapturedLocalTrack(kind, track).catch((error) => {
              try { track.stop() } catch {}
              setStatus(`${kind === 'video' ? 'Camera' : 'Microphone'} started late but could not attach: ${error.message}`)
            })
          },
        }
      )
      streamRef.current = media.stream
      setLocalStream(media.stream)
      setMediaState(media.warning ? 'warning' : 'ready')

      const requestedMicOn = Boolean(joinData.rtc.mic_enabled)
      const requestedCameraOn = joinedRtcMode === 'video' && Boolean(joinData.rtc.camera_enabled)
      let actualMicOn = requestedMicOn && hasLiveTrack(media.stream, 'audio')
      let actualCameraOn = requestedCameraOn && hasLiveTrack(media.stream, 'video')

      setMicOn(actualMicOn)
      setCameraOn(actualCameraOn)
      media.stream.getAudioTracks().forEach((track) => { track.enabled = actualMicOn })
      media.stream.getVideoTracks().forEach((track) => { track.enabled = actualCameraOn })

      async function syncBackendMediaState(nextMicOn, nextCameraOn) {
        await apiRequest(`/rooms/${roomId}/media-state`, {
          method: 'POST',
          body: JSON.stringify({
            mic_enabled: nextMicOn,
            camera_enabled: nextCameraOn,
          }),
        }).catch((error) => setStatus(`Local media limited; state sync warning: ${error.message}`))
      }

      if (actualMicOn !== requestedMicOn || actualCameraOn !== requestedCameraOn) {
        await syncBackendMediaState(actualMicOn, actualCameraOn)
      }

      setStatus('Loading TURN/ICE configuration...')
      const rtcConfig = await rtcConfigPromise
      setRtcConfigState(rtcConfig)

      if (joinedRtcMode === 'video' && !isLocalBrowserHost() && !rtcConfig.turnConfigured) {
        throw new Error('TURN is not configured on the backend. Remote camera cannot work reliably on this deployed server until TURN_URLS, TURN_USERNAME, and TURN_CREDENTIAL are set and PM2 is restarted.')
      }

      setConnectStep('signaling')
      setSignalingState('connecting')
      setStatus(rtcConfig.turnConfigured ? 'Connecting with TURN enabled...' : 'Connecting without TURN. Remote video may fail on strict networks.')
      const socket = createSignalingSocket()
      socketRef.current = socket

      const rtcClient = new NativeRtcClient({
        socket,
        localStream: media.stream,
        rtcMode: joinedRtcMode,
        iceServers: rtcConfig.iceServers,
        iceTransportPolicy: rtcConfig.iceTransportPolicy,
        onRemoteStream: handleRemoteStream,
        onPeerState: (remoteSocketId, state) => {
          setPeerStates((previous) => ({ ...previous, [remoteSocketId]: state }))
          if (state === 'failed') setConnectionIssue(`Peer ${remoteSocketId.slice(0, 6)} connection failed. A TURN server may be required for this network.`)
        },
      })
      rtcRef.current = rtcClient
      await flushPendingLocalTracks({ publish: false })

      const latestMicOn = requestedMicOn && hasLiveLocalTrack('audio')
      const latestCameraOn = requestedCameraOn && hasLiveLocalTrack('video')

      if (latestMicOn !== actualMicOn || latestCameraOn !== actualCameraOn) {
        actualMicOn = latestMicOn
        actualCameraOn = latestCameraOn
        setMicOn(actualMicOn)
        setCameraOn(actualCameraOn)
        applyLocalMediaState(actualMicOn, actualCameraOn)
        await syncBackendMediaState(actualMicOn, actualCameraOn)
      }

      socket.on('connect', () => {
        if (socketRef.current === socket) {
          localSocketIdRef.current = socket.id
          setSignalingState('connected')
          setConnectionIssue('')
        }
      })
      socket.on('connect_error', (error) => {
        setSignalingState('error')
        setConnectionIssue(`Signaling error: ${error.message}`)
        setStatus(`Signaling error: ${error.message}`)
      })
      socket.io.on('reconnect_attempt', () => {
        if (socketRef.current === socket) setSignalingState('reconnecting')
      })
      socket.io.on('reconnect', () => {
        if (socketRef.current === socket) {
          setSignalingState('connected')
          setConnectionIssue('')
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
        setPeerMediaStates((previous) => ({ ...previous, [socketId]: peerMediaFromSignal(payload) }))
        setPeerStates((previous) => ({ ...previous, [socketId]: previous[socketId] || 'waiting' }))
        setStatus(`Peer joined: ${socketId.slice(0, 6)}`)
        triggerJoinEffect(payload.userName)
        await beginPeerNegotiation(socketId, rtcClient, 'Peer')
      })
      socket.on('webrtc-offer', async ({ fromSocketId, offer }) => {
        try {
          negotiatedPeersRef.current.add(fromSocketId)
          const accepted = await rtcClient.handleOffer(fromSocketId, offer, { polite: isPolitePeer(fromSocketId) })
          if (accepted === false) setPeerStates((previous) => ({ ...previous, [fromSocketId]: 'glare' }))
        } catch (error) {
          setConnectionIssue(`Offer failed: ${error.message}`)
          setStatus(`Offer failed: ${error.message}`)
        }
      })
      socket.on('webrtc-answer', async ({ fromSocketId, answer }) => {
        try {
          await rtcClient.handleAnswer(fromSocketId, answer)
        } catch (error) {
          setConnectionIssue(`Answer failed: ${error.message}`)
          setStatus(`Answer failed: ${error.message}`)
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
        rtcClient.closePeer(socketId)
        setRemoteStreams((previous) => {
          const copy = { ...previous }
          delete copy[socketId]
          return copy
        })
        setPeerStates((previous) => {
          const copy = { ...previous }
          delete copy[socketId]
          return copy
        })
        setPeerMediaStates((previous) => {
          const copy = { ...previous }
          delete copy[socketId]
          return copy
        })
      })
      socket.on('media-state-change', (payload) => {
        if (!payload?.socketId) return
        setPeerMediaStates((previous) => ({ ...previous, [payload.socketId]: peerMediaFromSignal(payload) }))
      })
      socket.on('moderation-action', (payload) => {
        if (!payload?.targetUserId) return

        if (payload.targetUserId === user?.id) {
          if (payload.action === 'mute_mic') {
            streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false })
            rtcRef.current?.setAudioEnabled(false)
            setMicOn(false)
            setStatus('A moderator muted your microphone')
          }

          if (payload.action === 'disable_camera') {
            streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = false })
            rtcRef.current?.setVideoEnabled(false)
            setCameraOn(false)
            setStatus('A moderator paused your camera')
          }

          if (payload.action === 'kick' || payload.action === 'ban') {
            resetRtcState()
            activeRoomIdRef.current = null
            setJoined(false)
            setConnectStep('ready')
            setStatus(payload.action === 'ban' ? 'You were banned from the room by a moderator' : 'You were removed from the room by a moderator')
          }

          return
        }

        if (payload.action === 'mute_mic' || payload.action === 'disable_camera') {
          setPeerMediaStates((previous) => Object.fromEntries(Object.entries(previous).map(([socketId, mediaState]) => {
            if (mediaState.userId !== payload.targetUserId) return [socketId, mediaState]

            return [socketId, {
              ...mediaState,
              micOn: payload.action === 'mute_mic' ? false : mediaState.micOn,
              cameraOn: payload.action === 'disable_camera' ? false : mediaState.cameraOn,
            }]
          })))
        }
      })
      socket.on('disconnect', (reason) => {
        if (socketRef.current === socket) {
          setSignalingState(joinedRef.current ? 'disconnected' : 'idle')
          if (joinedRef.current) setConnectionIssue(`Signaling disconnected: ${reason}`)
          setStatus(`Signaling disconnected: ${reason}`)
        }
      })

      await waitForSocketConnection(socket)
      const signalingMicOn = requestedMicOn && hasLiveLocalTrack('audio')
      const signalingCameraOn = requestedCameraOn && hasLiveLocalTrack('video')

      if (signalingMicOn !== actualMicOn || signalingCameraOn !== actualCameraOn) {
        actualMicOn = signalingMicOn
        actualCameraOn = signalingCameraOn
        setMicOn(actualMicOn)
        setCameraOn(actualCameraOn)
        applyLocalMediaState(actualMicOn, actualCameraOn)
        await syncBackendMediaState(actualMicOn, actualCameraOn)
      }

      const signalingJoin = await joinSignalingRoom(socket, {
        roomId: joinData.rtc.signaling_room,
        userId: user?.id,
        userName: user?.name || 'User',
        rtcMode: joinedRtcMode,
        micEnabled: actualMicOn,
        cameraEnabled: actualCameraOn,
        screenShared: false,
      })

      localSocketIdRef.current = signalingJoin.socketId || socket.id
      const peerCount = Array.isArray(signalingJoin.users) ? signalingJoin.users.length : 0
      if (peerCount) await negotiateExistingUsers(signalingJoin.users, rtcClient)
      else {
        setSignalingPeerCount(0)
        setPeerMediaStates({})
      }
      setConnectStep('connected')
      setJoined(true)
      setSignalingState('connected')
      setConnectionIssue('')
      setStatus(media.warning || `Connected to ${joinData.rtc.signaling_room}`)
    } catch (error) {
      console.error(error)
      setMediaState((state) => state === 'starting' ? 'failed' : state)
      setSignalingState((state) => state === 'connecting' ? 'error' : state)
      resetRtcState()
      if (backendJoined && activeRoomIdRef.current) {
        await apiRequest(`/rooms/${activeRoomIdRef.current}/leave`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {})
        activeRoomIdRef.current = null
      }
      if (isPasswordJoinError(error)) setShowPasswordRecovery(true)
      setJoined(false)
      setConnectStep('ready')
      setConnectionIssue(error.message)
      setStatus(`Join failed: ${error.message}`)
    } finally {
      setJoining(false)
    }
  }

  async function leaveRoom({ navigateAfterEnd = true } = {}) {
    try {
      const shouldEndRoom = ownerCanEndVideoRoom
      setStatus(shouldEndRoom ? 'Ending live room...' : 'Leaving room...')
      resetRtcState()
      let leaveResult = null
      if (activeRoomIdRef.current) {
        leaveResult = await apiRequest(`/rooms/${activeRoomIdRef.current}/leave`, {
          method: 'POST',
          body: JSON.stringify({ end_room: shouldEndRoom }),
        })
        activeRoomIdRef.current = null
      }
      setJoined(false)
      setConnectStep('ready')
      setConnectionIssue('')
      setSignalingState('idle')
      setMediaState('idle')
      if (leaveResult?.room_ended) {
        setRoom((currentRoom) => currentRoom ? { ...currentRoom, status: 'ended' } : currentRoom)
        setStatus('Live ended and room removed')
        if (navigateAfterEnd) window.setTimeout(() => onBack?.(), 250)
        return leaveResult
      }
      setStatus('Session ended and usage logged')
      return leaveResult
    } catch (error) {
      setStatus(error.message)
      return null
    }
  }

  async function toggleMic() {
    if (mediaUpdating.mic) return
    const next = !micOn
    const previous = micOn

    setMediaUpdating((state) => ({ ...state, mic: true }))
    try {
      if (joined && next && !hasLiveLocalTrack('audio')) {
        setStatus('Requesting microphone permission...')
        await attachNewLocalTrack('audio', { publish: false })
      }

      setMicOn(next)
      applyLocalMediaState(next, cameraOn)

      if (!joined) return

      const synced = await publishMediaState(next, cameraOn)
      setStatus(synced.micOn ? 'Microphone is live' : 'Microphone muted')
    } catch (error) {
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

    setMediaUpdating((state) => ({ ...state, camera: true }))
    try {
      if (joined && next && !hasLiveLocalTrack('video')) {
        setStatus('Requesting camera permission...')
        await attachNewLocalTrack('video', { publish: false })
      }

      setCameraOn(next)
      applyLocalMediaState(micOn, next)

      if (!joined) return

      const synced = await publishMediaState(micOn, next)
      setStatus(synced.cameraOn ? 'Camera is live' : 'Camera paused')
    } catch (error) {
      setCameraOn(previous)
      applyLocalMediaState(micOn, previous)
      setStatus(`Camera update failed: ${error.message}`)
    } finally {
      setMediaUpdating((state) => ({ ...state, camera: false }))
    }
  }

  async function handleBack() {
    if (joined || activeRoomIdRef.current) {
      await leaveRoom({ navigateAfterEnd: false })
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

  useEffect(() => () => {
    window.clearTimeout(joinEffectTimerRef.current)
    window.clearTimeout(giftToastTimerRef.current)
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
  const hostName = room?.owner_name || user?.name || 'Room host'
  const roomCountry = user?.current_residence || 'Australia'

  return (
    <div className="buzzcast-shell buzzcast-live-shell">
      <header className="buzzcast-topbar buzzcast-live-topbar">
        <button type="button" className="buzzcast-logo buzzcast-live-logo" onClick={handleBack} aria-label="Back to rooms">
          <div className="buzzcast-logo-mark image-mark">
            <img src={brandAssets.appIcon} alt="TalkEachOther" />
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
          <button type="button" className="buzzcast-icon-button" onClick={toggleScreenShare} disabled={joining || mediaUpdating.screen} aria-label={screenSharing ? 'Stop screen share' : 'Screen share'} title={screenSharing ? 'Stop screen share' : 'Screen share'}>
            <span className="control-glyph screen" aria-hidden="true"></span>
          </button>
          <button type="button" className="buzzcast-icon-button" onClick={() => toggleToolPanel('guard')} aria-label="AI guard" title="AI guard">
            <span className="control-glyph guard" aria-hidden="true"></span>
          </button>
          <button type="button" className="buzzcast-icon-button accent" onClick={() => toggleToolPanel('gifts')} aria-label="Gifts" title="Gifts">+</button>
          <button type="button" className="buzzcast-avatar-button" onClick={onProfile} aria-label="Open profile" title="Open profile">
            <span className="image-avatar"><img src={avatarForIndex(user?.id || 0)} alt="" /></span>
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
          {giftToast && (
            <div className="gift-toast" key={giftToast.key}>
              <span><img src={giftToast.icon} alt="" /></span>
              <strong>{user?.name || 'You'} sent {giftToast.label}</strong>
            </div>
          )}

            <div className="buzzcast-host-pill">
              <span className="image-avatar"><img src={roomAvatar} alt="" loading="lazy" /></span>
              <strong>{hostName}</strong>
              <small>{compactNumber(viewerCount)}</small>
            </div>

            <div className="buzzcast-room-metadata">
              <span>ID:{room?.id || roomId}</span>
              <strong>{roomTitle}</strong>
              <small>{roomCountry}</small>
            </div>

            <div className="buzzcast-join-ribbon">{Math.max(1, viewerCount || 21)} joined</div>

            <div className="buzzcast-room-status" aria-live="polite">
              <span className={joined ? 'online' : joining ? 'connecting' : ''}></span>
              {joined ? 'Live' : joining ? 'Connecting' : connectAttempted ? 'Ready to rejoin' : 'Ready'}
              {status ? <small>{status}</small> : null}
            </div>

            <div className="buzzcast-live-stage-streams">
              {localStream || remoteTiles.length ? (
                <>
                  <VideoTile
                    stream={localStream}
                    muted
                    label={user?.name || 'You'}
                    badge={screenSharing ? 'screen' : mediaMode}
                    micOn={micOn}
                    cameraOn={cameraOn}
                    rtcMode={rtcMode}
                    showMediaState
                  />
                  {remoteTiles.map(({ socketId, stream, mediaState, peerState, label, badge }) => (
                    <VideoTile
                      key={socketId}
                      stream={stream}
                      label={label}
                      badge={badge}
                      micOn={mediaState.micOn !== false}
                      cameraOn={mediaState.cameraOn !== false}
                      rtcMode={mediaState.rtcMode || 'video'}
                      connectionState={peerState}
                      showMediaState
                    />
                  ))}
                </>
              ) : (
                <div className="buzzcast-waiting-card">
                  <img src={roomAvatar} alt="" />
                  <strong>{roomTitle}</strong>
                  <span>Press Connect RTC to start</span>
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
                  <strong>{activeToolPanel === 'screen' ? 'Screen share' : activeToolPanel === 'gifts' ? 'Send a gift' : 'AI guard'}</strong>
                  <button type="button" onClick={() => setActiveToolPanel(null)} aria-label="Close tool panel">x</button>
                </header>
                {activeToolPanel === 'gifts' ? (
                  <div className="live-gift-grid" aria-label="Room gifts">
                    {giftCatalog.map((gift) => (
                      <button key={gift.id} type="button" onClick={() => sendGift(gift)} disabled={sendingGiftId === gift.id || !joined || room?.gift_enabled === false}>
                        <img src={gift.icon} alt="" loading="lazy" />
                        <strong>{gift.label}</strong>
                        <span>{gift.cost}</span>
                      </button>
                    ))}
                    <small>{room?.gift_enabled === false ? 'Gifts are disabled in this room.' : joined ? 'Gifts are sent into this room chat.' : 'Connect RTC before sending gifts.'}</small>
                  </div>
                ) : activeToolPanel === 'screen' ? (
                  <div className="tool-status-panel">
                    <p>{screenSharing ? 'Your screen is being sent to the room.' : 'Share a window or display while keeping the current room camera controls unchanged.'}</p>
                    <button type="button" className={screenSharing ? 'danger-button' : 'primary-button'} onClick={toggleScreenShare} disabled={mediaUpdating.screen}>
                      {mediaUpdating.screen ? 'Working...' : screenSharing ? 'Stop sharing' : 'Start screen share'}
                    </button>
                    <small>{room?.screen_share_enabled === false ? 'Owner controls have Screen share turned off.' : 'Presenter tools are available for this room.'}</small>
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
                <button className="danger-button buzzcast-connect-button" onClick={() => leaveRoom()}>
                  {ownerCanEndVideoRoom ? 'End live' : 'Leave'}
                </button>
              )}
              <button
                className={micOn ? 'media-control-button icon-only active' : 'media-control-button icon-only muted'}
                onClick={toggleMic}
                disabled={micButtonDisabled}
                aria-label={micButtonTitle}
                aria-pressed={micOn}
                title={micButtonTitle}
              >
                <span className="control-glyph mic"></span>
              </button>
              <button
                className={cameraOn ? 'media-control-button icon-only active' : 'media-control-button icon-only muted'}
                onClick={toggleCamera}
                disabled={cameraButtonDisabled}
                aria-label={cameraButtonTitle}
                aria-pressed={cameraOn}
                title={cameraButtonTitle}
              >
                <span className="control-glyph camera"></span>
              </button>
              <button className="media-control-button icon-only utility" onClick={openChatTool} aria-label="Open chat" title="Open chat">
                <span className="control-glyph chat"></span>
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

            <div className="buzzcast-gift-bar buzzcast-live-gift-bar">
              {giftCatalog.slice(0, 11).map((gift) => (
                <button key={gift.id} type="button" onClick={() => sendGift(gift)} disabled={sendingGiftId === gift.id || room?.gift_enabled === false} title={`${gift.label} - ${gift.cost}`}>
                  <img src={gift.icon} alt="" loading="lazy" />
                  <span>{gift.label}</span>
                  <small>{gift.cost}</small>
                </button>
              ))}
              <button type="button" onClick={() => toggleToolPanel('gifts')}>More</button>
              <button type="button" onClick={() => toggleToolPanel('gifts')}>0</button>
            </div>
          </div>
        </section>

        <aside className="buzzcast-live-side">
          <p className="buzzcast-guideline">Be polite and respectful. Any vulgar, violent, or private transaction behavior is strictly prohibited in TalkEachOther. Please speak in a civilized manner.</p>
          <ChatPanel
            roomId={roomId}
            signalingRoom={signalingRoomRef.current}
            socket={socketRef.current}
            user={user}
            room={room}
            focusRequest={chatFocusRequest}
            externalMessage={externalChatMessage}
            onMessagesChange={setChatMessages}
          />
          {isRoomOwner ? (
            <details className="buzzcast-owner-panel">
              <summary>Owner controls</summary>
              <OwnerControlsPanel
                roomId={roomId}
                room={room}
                user={user}
                joined={joined}
                signalingRoom={signalingRoomRef.current}
                socket={socketRef.current}
                onRoomUpdate={setRoom}
              />
            </details>
          ) : null}
        </aside>
      </main>
    </div>
  )
}
