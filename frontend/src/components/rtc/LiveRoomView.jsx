import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest, getRtcConfig } from '../../services/api'
import { createLocalMediaStream, stopMediaStream } from '../../services/media'
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
  rtcConnectSteps,
  rtcModeOptions,
  stageLayoutOptions,
} from '../../utils/roomConfig'
import { ChatPanel } from './ChatPanel'
import { OwnerControlsPanel } from './OwnerControlsPanel'
import { RtcConnectionIndicator } from './RtcConnectionIndicator'
import { VideoTile } from './VideoTile'

export function LiveRoomView({ roomId, roomPassword = '', initialRoom = null, initialRtcMode = 'video', autoConnect = false, user, onBack }) {
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
  const [stageLayout, setStageLayout] = useState('grid')
  const [rtcConfigState, setRtcConfigState] = useState(null)
  const [joinEffect, setJoinEffect] = useState(null)
  const autoConnectAttemptedRef = useRef(false)
  const socketRef = useRef(null)
  const rtcRef = useRef(null)
  const streamRef = useRef(null)
  const activeRoomIdRef = useRef(null)
  const signalingRoomRef = useRef(null)
  const localSocketIdRef = useRef(null)
  const joinedRef = useRef(false)
  const negotiatedPeersRef = useRef(new Set())
  const joinEffectTimerRef = useRef(null)

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
      }
    })
  }, [peerMediaStates, peerStates, remoteStreams])
  const remoteStreamCount = Object.keys(remoteStreams).length
  const remotePeerCount = Math.max(signalingPeerCount, remoteTiles.length)
  const stageSeatCount = Math.min(16, Math.max(1, Number(room?.max_mic_count || 8)))
  const liveRoomSupportsVideo = !room || roomSupportsVideo(room.room_type)

  function setAndStoreMediaMode(value) {
    setMediaMode(value)
    localStorage.setItem('media_mode', value)
  }

  function updateRtcMode(value) {
    const nextMode = normalizeRtcMode(value, room)
    setRtcMode(nextMode)
    if (nextMode === 'audio') setCameraOn(false)
    if (nextMode === 'video' && !joined) setCameraOn(true)
  }

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
    }
  }

  function applyLocalMediaState(nextMicOn, nextCameraOn) {
    rtcRef.current?.setAudioEnabled(nextMicOn)
    rtcRef.current?.setVideoEnabled(nextCameraOn)
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = nextMicOn })
    streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = nextCameraOn })
  }

  async function publishMediaState(nextMicOn, nextCameraOn) {
    if (!joined || !activeRoomIdRef.current) return { micOn: nextMicOn, cameraOn: nextCameraOn }

    const allowedCameraOn = rtcMode === 'video' && nextCameraOn
    const data = await apiRequest(`/rooms/${activeRoomIdRef.current}/media-state`, {
      method: 'POST',
      body: JSON.stringify({
        mic_enabled: nextMicOn,
        camera_enabled: allowedCameraOn,
      }),
    })

    const serverMicOn = Boolean(data.rtc?.mic_enabled)
    const serverCameraOn = rtcMode === 'video' && Boolean(data.rtc?.camera_enabled)
    applyLocalMediaState(serverMicOn, serverCameraOn)
    setMicOn(serverMicOn)
    setCameraOn(serverCameraOn)

    if (socketRef.current && signalingRoomRef.current) {
      await emitMediaState(socketRef.current, {
        roomId: signalingRoomRef.current,
        rtcMode,
        micEnabled: serverMicOn,
        cameraEnabled: serverCameraOn,
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
      setStatus('Starting local media...')
      const media = await createLocalMediaStream(mediaMode === 'real' ? 'real' : mediaMode === 'mock' ? 'mock' : 'auto', joinedRtcMode)
      streamRef.current = media.stream
      setLocalStream(media.stream)
      setMediaState(media.warning ? 'warning' : 'ready')
      media.stream.getAudioTracks().forEach((track) => { track.enabled = Boolean(joinData.rtc.mic_enabled) })
      media.stream.getVideoTracks().forEach((track) => { track.enabled = joinedRtcMode === 'video' && Boolean(joinData.rtc.camera_enabled) })

      setStatus('Loading TURN/ICE configuration...')
      const rtcConfig = await getRtcConfig().catch((error) => {
        setConnectionIssue(`Could not load TURN/ICE config: ${error.message}`)
        return { iceServers: [], iceTransportPolicy: 'all', turnConfigured: false }
      })
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
        iceServers: rtcConfig.iceServers,
        iceTransportPolicy: rtcConfig.iceTransportPolicy,
        onRemoteStream: handleRemoteStream,
        onPeerState: (remoteSocketId, state) => {
          setPeerStates((previous) => ({ ...previous, [remoteSocketId]: state }))
          if (state === 'failed') setConnectionIssue(`Peer ${remoteSocketId.slice(0, 6)} connection failed. A TURN server may be required for this network.`)
        },
      })
      rtcRef.current = rtcClient

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
      const signalingJoin = await joinSignalingRoom(socket, {
        roomId: joinData.rtc.signaling_room,
        userId: user?.id,
        userName: user?.name || 'User',
        rtcMode: joinedRtcMode,
        micEnabled: Boolean(joinData.rtc.mic_enabled),
        cameraEnabled: joinedRtcMode === 'video' && Boolean(joinData.rtc.camera_enabled),
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

  async function leaveRoom() {
    try {
      setStatus('Leaving room...')
      resetRtcState()
      if (activeRoomIdRef.current) {
        await apiRequest(`/rooms/${activeRoomIdRef.current}/leave`, { method: 'POST', body: JSON.stringify({}) })
        activeRoomIdRef.current = null
      }
      setJoined(false)
      setConnectStep('ready')
      setConnectionIssue('')
      setSignalingState('idle')
      setMediaState('idle')
      setStatus('Session ended and usage logged')
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function toggleMic() {
    if (mediaUpdating.mic) return
    const next = !micOn
    const previous = micOn

    setMicOn(next)
    applyLocalMediaState(next, cameraOn)

    if (!joined) return

    setMediaUpdating((state) => ({ ...state, mic: true }))
    try {
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

    setCameraOn(next)
    applyLocalMediaState(micOn, next)

    if (!joined) return

    setMediaUpdating((state) => ({ ...state, camera: true }))
    try {
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
      await leaveRoom()
    }
    onBack()
  }

  useEffect(() => {
    joinedRef.current = joined
  }, [joined])

  useEffect(() => () => {
    window.clearTimeout(joinEffectTimerRef.current)
    resetRtcState({ clearState: false })
  }, [])

  useEffect(() => {
    if (!autoConnect || autoConnectAttemptedRef.current) return
    autoConnectAttemptedRef.current = true
    joinRoom()
  }, [])

  return (
    <div className="live-page">
      <header className="live-header glass-card">
        <div className="room-identity">
          <div className="room-avatar large">{room?.name?.slice(0, 1)?.toUpperCase() || 'R'}</div>
          <div>
            <div className="live-badge"><span></span> Live RTC</div>
            <h1>{room?.name || `Room #${roomId}`}</h1>
            <p>{session?.signaling_room || 'Not connected'} - {room?.room_type || 'video'}</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="mode-selector compact" aria-label="RTC mode">
            {rtcModeOptions.map((option) => {
              const disabled = joined || joining || (option.value === 'video' && !liveRoomSupportsVideo)

              return (
                <button
                  key={option.value}
                  type="button"
                  className={rtcMode === option.value ? 'mode-option active' : 'mode-option'}
                  onClick={() => updateRtcMode(option.value)}
                  disabled={disabled}
                >
                  <strong>{option.label}</strong>
                </button>
              )
            })}
          </div>
          <select value={mediaMode} onChange={(event) => setAndStoreMediaMode(event.target.value)} disabled={joined || joining}>
            <option value="real">Real camera/mic</option>
            <option value="auto">Auto fallback</option>
            <option value="mock">Mock media</option>
          </select>
          <button onClick={handleBack} disabled={joining}>Back</button>
        </div>
      </header>

      <div className="status-bar glass-card"><strong>Status:</strong> {status}</div>
      <div className={rtcConfigState?.turnConfigured ? 'status-bar glass-card turn-status ready' : 'status-bar glass-card turn-status'}>
        <strong>TURN:</strong> {rtcConfigState
          ? rtcConfigState.turnConfigured
            ? `enabled (${rtcConfigState.iceTransportPolicy || 'all'} mode)`
            : 'not configured on backend'
          : 'not loaded yet'}
      </div>

      <RtcConnectionIndicator
        steps={rtcConnectSteps}
        connectStep={connectStep}
        joined={joined}
        joining={joining}
        connectAttempted={connectAttempted}
        session={session}
        localStream={localStream}
        mediaState={mediaState}
        signalingState={signalingState}
        signalingPeerCount={signalingPeerCount}
        peerStates={peerStates}
        remoteStreams={remoteStreams}
        rtcMode={rtcMode}
        mediaMode={mediaMode}
        micOn={micOn}
        cameraOn={cameraOn}
        connectionIssue={connectionIssue}
      />

      <main className="live-layout">
        <section className="stage glass-card">
          {joinEffect && (
            <div className="join-effect" key={joinEffect.key}>
              <span></span>
              <strong>{joinEffect.name} joined</strong>
            </div>
          )}
          <div className="stage-toolbar">
            <div>
              <span>{rtcMode === 'audio' ? 'Music room audio stage' : 'Live video stage'}</span>
              <small>{remoteStreamCount} stream(s) - {remotePeerCount} remote peer(s)</small>
            </div>
            <div className="stage-layout-controls" role="group" aria-label="Stage layout">
              {stageLayoutOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={stageLayout === option.value ? 'stage-layout-button active' : 'stage-layout-button'}
                  onClick={() => setStageLayout(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`video-grid layout-${stageLayout}`}>
            <VideoTile
              stream={localStream}
              muted
              label={user?.name || 'Local User'}
              badge={mediaMode}
              micOn={micOn}
              cameraOn={cameraOn}
              rtcMode={rtcMode}
              showMediaState
            />
            {remoteTiles.length === 0 ? (
              <VideoTile label="Waiting for remote users" />
            ) : remoteTiles.map(({ socketId, stream, mediaState, peerState, label }) => {
              return (
                <VideoTile
                  key={socketId}
                  stream={stream}
                  label={label}
                  micOn={mediaState.micOn !== false}
                  cameraOn={mediaState.cameraOn !== false}
                  rtcMode={mediaState.rtcMode || 'video'}
                  connectionState={peerState}
                  showMediaState
                />
              )
            })}
          </div>

          <div className="mic-seat-row">
            {Array.from({ length: stageSeatCount }).map((_, index) => (
              <div className="mic-seat" key={index}>
                <div>{index + 1}</div><span>Seat {index + 1}</span>
              </div>
            ))}
          </div>

          {showPasswordRecovery && (
            <div className="join-recovery">
              <div>
                <strong>Room password required</strong>
                <span>Enter the password and retry the RTC workflow.</span>
              </div>
              <input
                type="password"
                value={roomPasswordInput}
                onChange={(event) => setRoomPasswordInput(event.target.value)}
                placeholder="Room password"
                autoComplete="current-password"
              />
            </div>
          )}

          <div className="rtc-controls">
            {!joined ? (
              <button className="primary-button" onClick={joinRoom} disabled={joining}>
                {joining ? 'Connecting RTC...' : connectAttempted ? 'Retry RTC' : 'Connect RTC'}
              </button>
            ) : <button className="danger-button" onClick={leaveRoom}>Leave Room</button>}
            <button
              className={micOn ? 'media-control-button icon-only active' : 'media-control-button icon-only muted'}
              onClick={toggleMic}
              disabled={joining || mediaUpdating.mic}
              aria-label={mediaUpdating.mic ? 'Saving microphone' : micOn ? 'Mute microphone' : 'Unmute microphone'}
              aria-pressed={micOn}
              title={mediaUpdating.mic ? 'Saving microphone' : micOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              <span className="control-glyph mic"></span>
            </button>
            <button
              className={cameraOn ? 'media-control-button icon-only active' : 'media-control-button icon-only muted'}
              onClick={toggleCamera}
              disabled={joining || mediaUpdating.camera || rtcMode === 'audio'}
              aria-label={mediaUpdating.camera ? 'Saving camera' : cameraOn ? 'Turn camera off' : 'Turn camera on'}
              aria-pressed={cameraOn}
              title={mediaUpdating.camera ? 'Saving camera' : cameraOn ? 'Turn camera off' : 'Turn camera on'}
            >
              <span className="control-glyph camera"></span>
            </button>
            <button className="media-control-button icon-only utility" disabled aria-label="Screen share" title="Screen share">
              <span className="control-glyph screen"></span>
            </button>
            <button className="media-control-button icon-only utility" disabled aria-label="Effects" title="Effects">
              <span className="control-glyph effects"></span>
            </button>
            <button className="media-control-button icon-only utility" disabled aria-label="Gifts" title="Gifts">
              <span className="control-glyph gift"></span>
            </button>
          </div>
        </section>

        <div className="side-column">
          <ChatPanel roomId={roomId} signalingRoom={signalingRoomRef.current} socket={socketRef.current} user={user} room={room} />
          <OwnerControlsPanel
            roomId={roomId}
            room={room}
            user={user}
            joined={joined}
            signalingRoom={signalingRoomRef.current}
            socket={socketRef.current}
            onRoomUpdate={setRoom}
          />
        </div>
      </main>
    </div>
  )
}
