function splitUrls(value) {
  return String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
}

function buildIceServers() {
  const configuredIceServers = import.meta.env.VITE_ICE_SERVERS

  if (configuredIceServers) {
    try {
      const parsed = JSON.parse(configuredIceServers)
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {
      // Fall through to the individual env vars below.
    }
  }

  const stunUrls = splitUrls(import.meta.env.VITE_STUN_URLS || 'stun:stun.l.google.com:19302')
  const turnUrls = splitUrls(import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL)
  const iceServers = []

  if (stunUrls.length) iceServers.push({ urls: stunUrls })

  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
    })
  }

  return iceServers
}

const RTC_STATS_INTERVAL_MS = 2000
const ICE_RESTART_DELAY_MS = 1400
const ICE_RESTART_MAX_ATTEMPTS = 3
const AUDIO_MAX_BITRATE = 48000
const CAMERA_MIN_BITRATE = 300000
const CAMERA_START_BITRATE = 700000
const CAMERA_MAX_BITRATE = 1500000
const CAMERA_MAX_FRAMERATE = 24
const CAMERA_GROUP_MIN_BITRATE = 180000
const CAMERA_GROUP_START_BITRATE = 320000
const CAMERA_GROUP_MAX_BITRATE = 620000
const CAMERA_GROUP_MAX_FRAMERATE = 18
const CAMERA_LARGE_MIN_BITRATE = 120000
const CAMERA_LARGE_START_BITRATE = 220000
const CAMERA_LARGE_MAX_BITRATE = 420000
const CAMERA_LARGE_MAX_FRAMERATE = 12
const CAMERA_FULL_ROOM_MIN_BITRATE = 90000
const CAMERA_FULL_ROOM_START_BITRATE = 160000
const CAMERA_FULL_ROOM_MAX_BITRATE = 260000
const CAMERA_FULL_ROOM_MAX_FRAMERATE = 10
const SCREEN_MIN_BITRATE = 600000
const SCREEN_START_BITRATE = 1200000
const SCREEN_MAX_BITRATE = 2500000
const SCREEN_MAX_FRAMERATE = 18
const SCREEN_LARGE_MIN_BITRATE = 350000
const SCREEN_LARGE_START_BITRATE = 650000
const SCREEN_LARGE_MAX_BITRATE = 1200000
const SCREEN_LARGE_MAX_FRAMERATE = 12
// Native WebRTC is mesh here, so every extra peer adds another outbound video stream.
const MESH_GROUP_PEER_COUNT = 6
const MESH_LARGE_PEER_COUNT = 12
const MESH_FULL_ROOM_PEER_COUNT = 18

const SDP_CAMERA_BITRATE = {
  min: Math.round(CAMERA_MIN_BITRATE / 1000),
  start: Math.round(CAMERA_START_BITRATE / 1000),
  max: Math.round(CAMERA_MAX_BITRATE / 1000),
}

const SDP_SCREEN_BITRATE = {
  min: Math.round(SCREEN_MIN_BITRATE / 1000),
  start: Math.round(SCREEN_START_BITRATE / 1000),
  max: Math.round(SCREEN_MAX_BITRATE / 1000),
}

function sdpBitrateFromLimits(limits) {
  return {
    min: Math.round(Number(limits.minBitrate || limits.maxBitrate || 0) / 1000),
    start: Math.round(Number(limits.startBitrate || limits.maxBitrate || 0) / 1000),
    max: Math.round(Number(limits.maxBitrate || 0) / 1000),
  }
}

function cameraLimitsForPeerCount(peerCount = 1) {
  if (peerCount >= MESH_FULL_ROOM_PEER_COUNT) {
    return {
      minBitrate: CAMERA_FULL_ROOM_MIN_BITRATE,
      startBitrate: CAMERA_FULL_ROOM_START_BITRATE,
      maxBitrate: CAMERA_FULL_ROOM_MAX_BITRATE,
      maxFramerate: CAMERA_FULL_ROOM_MAX_FRAMERATE,
      scaleResolutionDownBy: 2.5,
    }
  }

  if (peerCount >= MESH_LARGE_PEER_COUNT) {
    return {
      minBitrate: CAMERA_LARGE_MIN_BITRATE,
      startBitrate: CAMERA_LARGE_START_BITRATE,
      maxBitrate: CAMERA_LARGE_MAX_BITRATE,
      maxFramerate: CAMERA_LARGE_MAX_FRAMERATE,
      scaleResolutionDownBy: 2,
    }
  }

  if (peerCount >= MESH_GROUP_PEER_COUNT) {
    return {
      minBitrate: CAMERA_GROUP_MIN_BITRATE,
      startBitrate: CAMERA_GROUP_START_BITRATE,
      maxBitrate: CAMERA_GROUP_MAX_BITRATE,
      maxFramerate: CAMERA_GROUP_MAX_FRAMERATE,
      scaleResolutionDownBy: 1.4,
    }
  }

  return {
    minBitrate: CAMERA_MIN_BITRATE,
    startBitrate: CAMERA_START_BITRATE,
    maxBitrate: CAMERA_MAX_BITRATE,
    maxFramerate: CAMERA_MAX_FRAMERATE,
    scaleResolutionDownBy: 1,
  }
}

function screenLimitsForPeerCount(peerCount = 1) {
  if (peerCount >= MESH_LARGE_PEER_COUNT) {
    return {
      minBitrate: SCREEN_LARGE_MIN_BITRATE,
      startBitrate: SCREEN_LARGE_START_BITRATE,
      maxBitrate: SCREEN_LARGE_MAX_BITRATE,
      maxFramerate: SCREEN_LARGE_MAX_FRAMERATE,
      scaleResolutionDownBy: 1,
    }
  }

  return {
    minBitrate: SCREEN_MIN_BITRATE,
    startBitrate: SCREEN_START_BITRATE,
    maxBitrate: SCREEN_MAX_BITRATE,
    maxFramerate: SCREEN_MAX_FRAMERATE,
    scaleResolutionDownBy: 1,
  }
}

function emptyMediaStats() {
  return {
    audio: { bytes: 0, packets: 0, packetsLost: 0, bitrateKbps: 0 },
    video: { bytes: 0, packets: 0, packetsLost: 0, bitrateKbps: 0 },
  }
}

function mediaKind(report) {
  return report.kind || report.mediaType || ''
}

function addMediaStats(target, report, direction) {
  const kind = mediaKind(report)
  if (kind !== 'audio' && kind !== 'video') return

  const item = target[direction][kind]
  item.bytes += Number(report.bytesReceived || report.bytesSent || 0)
  item.packets += Number(report.packetsReceived || report.packetsSent || 0)
  item.packetsLost += Math.max(0, Number(report.packetsLost || 0))
}

function selectedCandidatePair(reportMap) {
  let pair = null

  reportMap.forEach((report) => {
    if (report.type === 'transport' && report.selectedCandidatePairId) {
      pair = reportMap.get(report.selectedCandidatePairId) || pair
    }
  })

  if (pair) return pair

  reportMap.forEach((report) => {
    if (
      report.type === 'candidate-pair'
      && report.state === 'succeeded'
      && (report.nominated || report.selected || report.bytesSent || report.bytesReceived)
    ) {
      pair = report
    }
  })

  return pair
}

function candidateType(reportMap, candidateId) {
  const candidate = candidateId ? reportMap.get(candidateId) : null
  return candidate?.candidateType || candidate?.type || ''
}

function bitrateFromDelta(current, previous, key, elapsedSeconds) {
  if (!previous || elapsedSeconds <= 0) return 0

  const delta = Number(current[key] || 0) - Number(previous[key] || 0)
  if (delta <= 0) return 0
  return Math.round((delta * 8) / elapsedSeconds / 1000)
}

function packetLossFromDelta(current, previous) {
  const packetsReceivedDelta = previous
    ? Math.max(0, Number(current.packetsReceived || 0) - Number(previous.packetsReceived || 0))
    : Number(current.packetsReceived || 0)
  const packetsLostDelta = previous
    ? Math.max(0, Number(current.packetsLost || 0) - Number(previous.packetsLost || 0))
    : Math.max(0, Number(current.packetsLost || 0))
  const totalPackets = packetsReceivedDelta + packetsLostDelta

  if (!totalPackets) return 0
  return Math.round((packetsLostDelta / totalPackets) * 1000) / 10
}

function mediaBitrateFromDelta(current, previous, direction, kind, elapsedSeconds) {
  if (!previous || elapsedSeconds <= 0) return 0

  const currentBytes = current[direction][kind].bytes
  const previousBytes = previous.media?.[direction]?.[kind]?.bytes || 0
  const delta = currentBytes - previousBytes
  if (delta <= 0) return 0
  return Math.round((delta * 8) / elapsedSeconds / 1000)
}

function connectionQuality({ connectionState, iceConnectionState, bitrateKbps, packetLossPct, rttMs }) {
  const state = connectionState === 'new' && iceConnectionState !== 'new'
    ? iceConnectionState
    : connectionState

  if (['failed', 'closed'].includes(state)) return 'failed'
  if (['disconnected'].includes(state)) return 'degraded'
  if (['connecting', 'new', 'checking'].includes(state)) return 'connecting'
  if (state !== 'connected' && state !== 'completed') return state || 'unknown'
  if (packetLossPct >= 8 || rttMs >= 450) return 'poor'
  if (packetLossPct >= 3 || rttMs >= 220) return 'fair'
  if (bitrateKbps <= 1) return 'idle'
  return 'good'
}

function isScreenTrack(track) {
  const hint = String(track?.contentHint || '').toLowerCase()
  const label = String(track?.label || '').toLowerCase()
  return hint === 'detail' || hint === 'text' || label.includes('screen') || label.includes('display') || label.includes('window')
}

function senderLimitsForTrack(track, peerCount = 1) {
  if (!track) return null
  if (track.kind === 'audio') return { maxBitrate: AUDIO_MAX_BITRATE }
  if (track.kind !== 'video') return null

  const limits = isScreenTrack(track)
    ? screenLimitsForPeerCount(peerCount)
    : cameraLimitsForPeerCount(peerCount)

  return isScreenTrack(track)
    ? {
        ...limits,
        priority: 'high',
        networkPriority: 'high',
      }
    : {
        ...limits,
        priority: peerCount >= MESH_LARGE_PEER_COUNT ? 'medium' : 'high',
        networkPriority: peerCount >= MESH_LARGE_PEER_COUNT ? 'medium' : 'high',
      }
}

function mergeFmtpBitrate(line, bitrate) {
  const match = line.match(/^a=fmtp:(\d+)\s*(.*)$/)
  if (!match) return line

  const params = match[2]
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^x-google-(min|start|max)-bitrate=/i.test(item))

  params.push(
    `x-google-min-bitrate=${bitrate.min}`,
    `x-google-start-bitrate=${bitrate.start}`,
    `x-google-max-bitrate=${bitrate.max}`,
  )

  return `a=fmtp:${match[1]} ${params.join(';')}`
}

function bitrateFmtpLine(payloadType, bitrate) {
  return `a=fmtp:${payloadType} x-google-min-bitrate=${bitrate.min};x-google-start-bitrate=${bitrate.start};x-google-max-bitrate=${bitrate.max}`
}

function preferVideoBitrateInSection(section, bitrate = SDP_CAMERA_BITRATE) {
  if (!section.startsWith('m=video')) return section

  const lines = section.split('\r\n')
  const videoPayloads = new Set()
  const fmtpPayloads = new Set()
  let bandwidthInserted = false
  const nextLines = []

  lines.forEach((line) => {
    const match = line.match(/^a=rtpmap:(\d+)\s+([^/\s]+)/i)
    const codec = match?.[2]?.toLowerCase() || ''
    if (['vp8', 'vp9', 'h264', 'av1'].includes(codec)) {
      videoPayloads.add(match[1])
    }
  })

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue

    if (/^b=(AS|TIAS):/i.test(line)) {
      continue
    }

    const fmtpPayload = line.match(/^a=fmtp:(\d+)/)?.[1]
    nextLines.push(line.startsWith('a=fmtp:') && videoPayloads.has(fmtpPayload) ? mergeFmtpBitrate(line, bitrate) : line)

    if (fmtpPayload && videoPayloads.has(fmtpPayload)) {
      fmtpPayloads.add(fmtpPayload)
    }

    if (!bandwidthInserted && (line.startsWith('c=') || (line.startsWith('m=video') && !lines[index + 1]?.startsWith('c=')))) {
      nextLines.push(`b=AS:${bitrate.max}`, `b=TIAS:${bitrate.max * 1000}`)
      bandwidthInserted = true
    }
  }

  for (const payload of Array.from(videoPayloads)) {
    if (!fmtpPayloads.has(payload)) nextLines.push(bitrateFmtpLine(payload, bitrate))
  }

  return nextLines.join('\r\n')
}

function preferVideoBitrate(description, bitrate = SDP_CAMERA_BITRATE) {
  if (!description?.sdp) return description

  const sections = description.sdp.split(/\r\n(?=m=)/)
  const tunedSdp = sections
    .map((section) => preferVideoBitrateInSection(section, bitrate))
    .join('\r\n')

  return {
    type: description.type,
    sdp: tunedSdp,
  }
}

function bitrateForPeerConnection(peerConnection, peerCount = 1) {
  const hasScreenTrack = peerConnection?.getSenders?.()
    .some((sender) => sender?.track?.kind === 'video' && isScreenTrack(sender.track))

  if (hasScreenTrack) return sdpBitrateFromLimits(screenLimitsForPeerCount(peerCount))
  if (peerCount < MESH_GROUP_PEER_COUNT) return SDP_CAMERA_BITRATE
  return sdpBitrateFromLimits(cameraLimitsForPeerCount(peerCount))
}

function buildStatsSnapshot(remoteSocketId, peerConnection, reportMap, previous) {
  const timestamp = Date.now()
  const elapsedSeconds = previous ? Math.max(0, (timestamp - previous.timestamp) / 1000) : 0
  const media = {
    inbound: emptyMediaStats(),
    outbound: emptyMediaStats(),
  }
  const totals = {
    bytesReceived: 0,
    bytesSent: 0,
    packetsReceived: 0,
    packetsSent: 0,
    packetsLost: 0,
  }

  reportMap.forEach((report) => {
    if (report.type === 'inbound-rtp' && !report.isRemote) {
      totals.bytesReceived += Number(report.bytesReceived || 0)
      totals.packetsReceived += Number(report.packetsReceived || 0)
      totals.packetsLost += Math.max(0, Number(report.packetsLost || 0))
      addMediaStats(media, report, 'inbound')
    }

    if (report.type === 'outbound-rtp' && !report.isRemote) {
      totals.bytesSent += Number(report.bytesSent || 0)
      totals.packetsSent += Number(report.packetsSent || 0)
      addMediaStats(media, report, 'outbound')
    }
  })

  const candidatePair = selectedCandidatePair(reportMap)
  const incomingKbps = bitrateFromDelta(totals, previous?.totals, 'bytesReceived', elapsedSeconds)
  const outgoingKbps = bitrateFromDelta(totals, previous?.totals, 'bytesSent', elapsedSeconds)
  const bitrateKbps = incomingKbps + outgoingKbps
  const packetLossPct = packetLossFromDelta(totals, previous?.totals)
  const rttMs = Math.round(Number(candidatePair?.currentRoundTripTime || 0) * 1000)

  media.inbound.audio.bitrateKbps = mediaBitrateFromDelta({ inbound: media.inbound, outbound: media.outbound }, previous, 'inbound', 'audio', elapsedSeconds)
  media.inbound.video.bitrateKbps = mediaBitrateFromDelta({ inbound: media.inbound, outbound: media.outbound }, previous, 'inbound', 'video', elapsedSeconds)
  media.outbound.audio.bitrateKbps = mediaBitrateFromDelta({ inbound: media.inbound, outbound: media.outbound }, previous, 'outbound', 'audio', elapsedSeconds)
  media.outbound.video.bitrateKbps = mediaBitrateFromDelta({ inbound: media.inbound, outbound: media.outbound }, previous, 'outbound', 'video', elapsedSeconds)

  return {
    remoteSocketId,
    timestamp,
    connectionState: peerConnection.connectionState,
    iceConnectionState: peerConnection.iceConnectionState,
    signalingState: peerConnection.signalingState,
    incomingKbps,
    outgoingKbps,
    bitrateKbps,
    packetLossPct,
    rttMs,
    availableOutgoingKbps: Math.round(Number(candidatePair?.availableOutgoingBitrate || 0) / 1000),
    localCandidateType: candidateType(reportMap, candidatePair?.localCandidateId),
    remoteCandidateType: candidateType(reportMap, candidatePair?.remoteCandidateId),
    media,
    totals,
    quality: connectionQuality({
      connectionState: peerConnection.connectionState,
      iceConnectionState: peerConnection.iceConnectionState,
      bitrateKbps,
      packetLossPct,
      rttMs,
    }),
  }
}

export class NativeRtcClient {
  constructor({ socket, localStream, rtcMode = 'video', iceServers, iceTransportPolicy = 'all', onRemoteStream, onPeerState, onPeerStats, onPeerRecovery }) {
    this.socket = socket
    this.localStream = localStream
    this.rtcMode = rtcMode === 'audio' ? 'audio' : 'video'
    this.iceServers = Array.isArray(iceServers) && iceServers.length ? iceServers : buildIceServers()
    this.iceTransportPolicy = iceTransportPolicy === 'relay' ? 'relay' : 'all'
    this.onRemoteStream = onRemoteStream
    this.onPeerState = onPeerState
    this.onPeerStats = onPeerStats
    this.onPeerRecovery = onPeerRecovery
    this.peerConnections = {}
    this.pendingCandidates = {}
    this.remoteMediaStreams = {}
    this.makingOffers = {}
    this.ignoredOffers = {}
    this.pendingOffers = {}
    this.pendingIceRestarts = {}
    this.iceRestartTimers = {}
    this.iceRestartAttempts = {}
    this.statsTimers = {}
    this.previousStats = {}
    this.remoteTrackCleanups = {}
  }

  emitPeerState(remoteSocketId, peerConnection) {
    if (!this.onPeerState) return
    const state = peerConnection.connectionState === 'new' && peerConnection.iceConnectionState !== 'new'
      ? peerConnection.iceConnectionState
      : peerConnection.connectionState
    this.onPeerState(remoteSocketId, state)
  }

  emitPeerRecovery(remoteSocketId, status, detail = '') {
    if (this.onPeerRecovery) this.onPeerRecovery(remoteSocketId, status, detail)
  }

  meshPeerCount(additionalPeers = 0) {
    return Math.max(1, Object.keys(this.peerConnections || {}).length + Number(additionalPeers || 0))
  }

  async tuneSenderForTrack(sender, track, peerCount = this.meshPeerCount()) {
    const limits = senderLimitsForTrack(track, peerCount)
    if (!sender || !limits || typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') return

    try {
      const parameters = sender.getParameters() || {}
      const encodings = Array.isArray(parameters.encodings) && parameters.encodings.length
        ? parameters.encodings
        : [{}]

      parameters.encodings = encodings.map((encoding) => ({
        ...encoding,
        ...limits,
      }))

      await sender.setParameters(parameters)
    } catch {
      // Some browsers reject sender parameter changes until negotiation settles.
    }
  }

  async tuneAllSenders() {
    const peerCount = this.meshPeerCount()
    const peerConnections = Object.values(this.peerConnections || {})

    for (const peerConnection of peerConnections) {
      const senders = peerConnection?.getSenders?.() || []
      for (const sender of senders) {
        if (sender?.track) await this.tuneSenderForTrack(sender, sender.track, peerCount)
      }
    }
  }

  transceiverKind(transceiver) {
    return transceiver?.sender?.track?.kind || transceiver?.receiver?.track?.kind || ''
  }

  findTransceiverForKind(peerConnection, kind) {
    const mediaKind = kind === 'audio' ? 'audio' : 'video'
    return peerConnection.getTransceivers()
      .find((transceiver) => (
        !transceiver.stopped
        && this.transceiverKind(transceiver) === mediaKind
      )) || null
  }

  hasLiveInboundTrack(remoteSocketId, kind) {
    const mediaKind = kind === 'audio' ? 'audio' : 'video'
    return this.remoteMediaStreams[remoteSocketId]?.getTracks?.()
      .some((track) => (
        track.kind === mediaKind
        && track.readyState !== 'ended'
        && track.muted !== true
      )) || false
  }

  setTransceiverDirection(transceiver, direction) {
    if (!transceiver || transceiver.stopped || transceiver.direction === direction) return

    try {
      transceiver.direction = direction
    } catch {
      // Some browsers reject direction updates on stopped or settling transceivers.
    }
  }

  ensureReceiveTransceiver(peerConnection, kind) {
    const mediaKind = kind === 'audio' ? 'audio' : 'video'
    const existingTransceiver = this.findTransceiverForKind(peerConnection, mediaKind)

    if (existingTransceiver) {
      if (!existingTransceiver.sender?.track) {
        this.setTransceiverDirection(existingTransceiver, 'recvonly')
      }
      return existingTransceiver
    }

    return peerConnection.addTransceiver(mediaKind, { direction: 'recvonly' })
  }

  liveLocalTrack(kind) {
    const mediaKind = kind === 'audio' ? 'audio' : 'video'
    return this.localStream?.getTracks?.()
      .find((track) => track.kind === mediaKind && track.readyState !== 'ended') || null
  }

  async syncLocalTracksToPeerConnection(peerConnection) {
    if (!peerConnection || peerConnection.signalingState === 'closed') return

    await this.replaceTrackOnPeerConnection(
      peerConnection,
      'audio',
      this.liveLocalTrack('audio'),
      this.localStream,
    )

    if (this.rtcMode === 'video') {
      await this.replaceTrackOnPeerConnection(
        peerConnection,
        'video',
        this.liveLocalTrack('video'),
        this.localStream,
      )
    }
  }

  async repairMissingInboundAudio(remoteSocketId, options = {}) {
    const peerConnection = this.createPeerConnection(remoteSocketId)
    await this.replaceTrackOnPeerConnection(
      peerConnection,
      'audio',
      this.liveLocalTrack('audio'),
      this.localStream,
    )

    return options.iceRestart
      ? this.restartIce(remoteSocketId, 'remote-audio-missing')
      : this.createOffer(remoteSocketId)
  }

  async replaceTrackOnPeerConnection(peerConnection, kind, track, stream = this.localStream) {
    const mediaKind = kind === 'audio' ? 'audio' : 'video'
    const transceiver = this.findTransceiverForKind(peerConnection, mediaKind)

    if (transceiver?.sender) {
      this.setTransceiverDirection(transceiver, track ? 'sendrecv' : 'recvonly')
      await transceiver.sender.replaceTrack(track || null)
      if (track) await this.tuneSenderForTrack(transceiver.sender, track)
      return transceiver.sender
    }

    if (track) {
      return this.addTunedTrack(peerConnection, track, stream)
    }

    return this.ensureReceiveTransceiver(peerConnection, mediaKind).sender
  }

  addTunedTrack(peerConnection, track, stream, peerCount = this.meshPeerCount()) {
    const limits = senderLimitsForTrack(track, peerCount)

    if (limits && typeof peerConnection.addTransceiver === 'function') {
      try {
        const transceiver = peerConnection.addTransceiver(track, {
          direction: 'sendrecv',
          streams: stream ? [stream] : [],
          sendEncodings: [limits],
        })
        this.tuneSenderForTrack(transceiver.sender, track, peerCount).catch(() => {})
        return transceiver.sender
      } catch {
        // Fall back to addTrack for browsers that reject sendEncodings.
      }
    }

    const sender = stream ? peerConnection.addTrack(track, stream) : peerConnection.addTrack(track)
    this.tuneSenderForTrack(sender, track, peerCount).catch(() => {})
    return sender
  }

  clearIceRestart(remoteSocketId) {
    if (this.iceRestartTimers[remoteSocketId]) {
      clearTimeout(this.iceRestartTimers[remoteSocketId])
      delete this.iceRestartTimers[remoteSocketId]
    }
  }

  resetIceRestart(remoteSocketId) {
    this.clearIceRestart(remoteSocketId)
    delete this.iceRestartAttempts[remoteSocketId]
    delete this.pendingIceRestarts[remoteSocketId]
  }

  emitWebrtcSignal(eventName, remoteSocketId, payload, { requireAck = true, timeoutMs = 5000 } = {}) {
    if (!this.socket?.connected) {
      return Promise.reject(new Error('Signaling socket is not connected.'))
    }

    const message = {
      targetSocketId: remoteSocketId,
      ...payload,
    }

    if (!requireAck) {
      this.socket.emit(eventName, message)
      return Promise.resolve({ ok: true })
    }

    return new Promise((resolve, reject) => {
      this.socket.timeout(timeoutMs).emit(eventName, message, (error, response) => {
        if (error) {
          reject(new Error(`${eventName} timed out.`))
          return
        }

        if (!response?.ok) {
          reject(new Error(response?.message || `${eventName} failed.`))
          return
        }

        resolve(response)
      })
    })
  }

  emitRemoteStream(remoteSocketId) {
    const stream = this.remoteMediaStreams[remoteSocketId]
    if (stream && this.onRemoteStream) this.onRemoteStream(remoteSocketId, stream)
  }

  watchRemoteTrack(remoteSocketId, track) {
    if (!track || typeof track.addEventListener !== 'function') return

    this.remoteTrackCleanups[remoteSocketId] ||= new Map()
    const cleanups = this.remoteTrackCleanups[remoteSocketId]
    if (cleanups.has(track)) return

    const notify = () => this.emitRemoteStream(remoteSocketId)
    const handleEnded = () => {
      const stream = this.remoteMediaStreams[remoteSocketId]
      if (stream?.getTracks?.().includes(track)) {
        stream.removeTrack(track)
      }
      notify()
    }

    track.addEventListener('mute', notify)
    track.addEventListener('unmute', notify)
    track.addEventListener('ended', handleEnded)

    cleanups.set(track, () => {
      track.removeEventListener('mute', notify)
      track.removeEventListener('unmute', notify)
      track.removeEventListener('ended', handleEnded)
    })
  }

  cleanupRemoteTracks(remoteSocketId) {
    const cleanups = this.remoteTrackCleanups[remoteSocketId]
    if (!cleanups) return

    cleanups.forEach((cleanup) => cleanup())
    delete this.remoteTrackCleanups[remoteSocketId]
  }

  scheduleIceRestart(remoteSocketId, reason = 'ice') {
    const peerConnection = this.peerConnections[remoteSocketId]
    if (!peerConnection || ['closed', 'failed'].includes(peerConnection.signalingState)) return
    if (this.iceRestartTimers[remoteSocketId]) return

    const attempts = Number(this.iceRestartAttempts[remoteSocketId] || 0)
    if (attempts >= ICE_RESTART_MAX_ATTEMPTS) {
      this.emitPeerRecovery(remoteSocketId, 'failed', 'ICE restart limit reached')
      return
    }

    this.emitPeerRecovery(remoteSocketId, 'scheduled', reason)
    this.iceRestartTimers[remoteSocketId] = setTimeout(() => {
      delete this.iceRestartTimers[remoteSocketId]
      this.restartIce(remoteSocketId, reason).catch((error) => {
        this.emitPeerRecovery(remoteSocketId, 'failed', error.message)
      })
    }, reason === 'failed' ? 0 : ICE_RESTART_DELAY_MS)
  }

  async restartIce(remoteSocketId, reason = 'ice') {
    const peerConnection = this.peerConnections[remoteSocketId]
    if (!peerConnection || peerConnection.signalingState === 'closed') return false
    if (!this.socket?.connected) {
      this.pendingIceRestarts[remoteSocketId] = true
      this.emitPeerRecovery(remoteSocketId, 'waiting', 'Signaling is reconnecting')
      return false
    }

    this.iceRestartAttempts[remoteSocketId] = Number(this.iceRestartAttempts[remoteSocketId] || 0) + 1
    this.pendingIceRestarts[remoteSocketId] = true
    this.emitPeerRecovery(remoteSocketId, 'restarting', reason)
    return this.createOffer(remoteSocketId, { iceRestart: true })
  }

  createPeerConnection(remoteSocketId) {
    if (this.peerConnections[remoteSocketId]) {
      return this.peerConnections[remoteSocketId]
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.iceTransportPolicy,
      iceCandidatePoolSize: 4,
    })

    const localTracks = this.localStream?.getTracks?.() || []
    const localAudioTrack = localTracks.find((track) => track.kind === 'audio' && track.readyState !== 'ended') || null
    const localVideoTrack = this.rtcMode === 'video'
      ? localTracks.find((track) => track.kind === 'video' && track.readyState !== 'ended') || null
      : null

    const projectedPeerCount = this.meshPeerCount(1)

    if (localAudioTrack) {
      this.addTunedTrack(peerConnection, localAudioTrack, this.localStream, projectedPeerCount)
    } else {
      this.ensureReceiveTransceiver(peerConnection, 'audio')
    }

    if (this.rtcMode === 'video') {
      if (localVideoTrack) {
        this.addTunedTrack(peerConnection, localVideoTrack, this.localStream, projectedPeerCount)
      } else {
        this.ensureReceiveTransceiver(peerConnection, 'video')
      }
    }

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.emitWebrtcSignal(
          'webrtc-ice-candidate',
          remoteSocketId,
          { candidate: event.candidate },
          { requireAck: false },
        ).catch(() => {})
      }
    }

    peerConnection.ontrack = (event) => {
      const stream = this.remoteMediaStreams[remoteSocketId] || new MediaStream()
      const incomingTracks = [
        event.track,
        ...((event.streams || []).flatMap((eventStream) => eventStream?.getTracks?.() || [])),
      ].filter(Boolean)

      incomingTracks.forEach((track) => {
        if (!stream.getTracks().includes(track)) stream.addTrack(track)
        this.watchRemoteTrack(remoteSocketId, track)
      })

      this.remoteMediaStreams[remoteSocketId] = stream
      this.emitRemoteStream(remoteSocketId)
    }

    peerConnection.onconnectionstatechange = () => {
      this.emitPeerState(remoteSocketId, peerConnection)
      if (peerConnection.connectionState === 'connected') this.resetIceRestart(remoteSocketId)
      if (peerConnection.connectionState === 'failed') this.scheduleIceRestart(remoteSocketId, 'failed')
    }

    peerConnection.oniceconnectionstatechange = () => {
      this.emitPeerState(remoteSocketId, peerConnection)
      if (['connected', 'completed'].includes(peerConnection.iceConnectionState)) this.resetIceRestart(remoteSocketId)
      if (peerConnection.iceConnectionState === 'disconnected') this.scheduleIceRestart(remoteSocketId, 'disconnected')
      if (peerConnection.iceConnectionState === 'failed') this.scheduleIceRestart(remoteSocketId, 'failed')
    }

    this.peerConnections[remoteSocketId] = peerConnection
    this.emitPeerState(remoteSocketId, peerConnection)
    this.startStats(remoteSocketId)
    this.tuneAllSenders().catch(() => {})
    return peerConnection
  }

  startStats(remoteSocketId) {
    if (!this.onPeerStats || this.statsTimers[remoteSocketId]) return

    const collect = () => {
      this.collectStats(remoteSocketId).catch((error) => {
        if (this.onPeerStats) {
          this.onPeerStats(remoteSocketId, {
            remoteSocketId,
            timestamp: Date.now(),
            quality: 'unknown',
            error: error.message,
          })
        }
      })
    }

    collect()
    this.statsTimers[remoteSocketId] = setInterval(collect, RTC_STATS_INTERVAL_MS)
  }

  stopStats(remoteSocketId) {
    if (this.statsTimers[remoteSocketId]) {
      clearInterval(this.statsTimers[remoteSocketId])
      delete this.statsTimers[remoteSocketId]
    }

    delete this.previousStats[remoteSocketId]
  }

  async collectStats(remoteSocketId) {
    const peerConnection = this.peerConnections[remoteSocketId]
    if (!peerConnection || !this.onPeerStats) return null

    const reportMap = await peerConnection.getStats()
    const snapshot = buildStatsSnapshot(
      remoteSocketId,
      peerConnection,
      reportMap,
      this.previousStats[remoteSocketId],
    )

    this.previousStats[remoteSocketId] = snapshot
    this.onPeerStats(remoteSocketId, snapshot)
    return snapshot
  }

  async createOffer(remoteSocketId, options = {}) {
    const peerConnection = this.createPeerConnection(remoteSocketId)
    const iceRestart = Boolean(options.iceRestart || this.pendingIceRestarts[remoteSocketId])

    if (!this.socket?.connected) {
      this.pendingOffers[remoteSocketId] = true
      if (iceRestart) this.pendingIceRestarts[remoteSocketId] = true
      return false
    }

    if (peerConnection.signalingState !== 'stable') {
      this.pendingOffers[remoteSocketId] = true
      if (iceRestart) this.pendingIceRestarts[remoteSocketId] = true
      return false
    }

    this.makingOffers[remoteSocketId] = true
    this.pendingOffers[remoteSocketId] = false

    try {
      if (iceRestart && typeof peerConnection.restartIce === 'function') {
        peerConnection.restartIce()
      }
      await this.syncLocalTracksToPeerConnection(peerConnection)
      const offer = await peerConnection.createOffer(iceRestart ? { iceRestart: true } : undefined)
      if (peerConnection.signalingState !== 'stable') {
        this.pendingOffers[remoteSocketId] = true
        if (iceRestart) this.pendingIceRestarts[remoteSocketId] = true
        return false
      }

      try {
        await peerConnection.setLocalDescription(offer)
      } catch (error) {
        if (peerConnection.signalingState !== 'stable' || error?.name === 'InvalidStateError') {
          this.pendingOffers[remoteSocketId] = true
          if (iceRestart) this.pendingIceRestarts[remoteSocketId] = true
          return false
        }

        throw error
      }

      await this.emitWebrtcSignal('webrtc-offer', remoteSocketId, {
        offer: peerConnection.localDescription,
      })

      if (iceRestart) this.pendingIceRestarts[remoteSocketId] = false
      return true
    } finally {
      this.makingOffers[remoteSocketId] = false
    }
  }

  async flushPendingOffer(remoteSocketId) {
    const peerConnection = this.peerConnections[remoteSocketId]
    if (!this.pendingOffers[remoteSocketId] || !peerConnection || peerConnection.signalingState !== 'stable') return false
    return this.createOffer(remoteSocketId, { iceRestart: Boolean(this.pendingIceRestarts[remoteSocketId]) })
  }

  async handleOffer(fromSocketId, offer, { polite = true } = {}) {
    const peerConnection = this.createPeerConnection(fromSocketId)
    const offerCollision = peerConnection.signalingState !== 'stable' || this.makingOffers[fromSocketId]
    const ignoreOffer = !polite && offerCollision

    this.ignoredOffers[fromSocketId] = ignoreOffer
    if (ignoreOffer) return false

    if (offerCollision && peerConnection.signalingState !== 'stable') {
      await peerConnection.setLocalDescription({ type: 'rollback' }).catch(() => {})
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
    await this.flushPendingCandidates(fromSocketId)

    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)

    await this.emitWebrtcSignal('webrtc-answer', fromSocketId, {
      answer: peerConnection.localDescription,
    })

    await this.flushPendingOffer(fromSocketId)

    return true
  }

  async handleAnswer(fromSocketId, answer) {
    const peerConnection = this.peerConnections[fromSocketId]
    if (!peerConnection) return
    if (peerConnection.signalingState !== 'have-local-offer') return

    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
    await this.flushPendingCandidates(fromSocketId)
    await this.flushPendingOffer(fromSocketId)
  }

  async handleIceCandidate(fromSocketId, candidate) {
    const peerConnection = this.peerConnections[fromSocketId]

    if (!peerConnection || !peerConnection.remoteDescription) {
      this.pendingCandidates[fromSocketId] ||= []
      this.pendingCandidates[fromSocketId].push(candidate)
      return
    }

    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (error) {
      if (!this.ignoredOffers[fromSocketId]) throw error
    }
  }

  async flushPendingCandidates(remoteSocketId) {
    const peerConnection = this.peerConnections[remoteSocketId]
    const candidates = this.pendingCandidates[remoteSocketId] || []

    if (!peerConnection || candidates.length === 0) return

    for (const candidate of candidates) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    }

    this.pendingCandidates[remoteSocketId] = []
  }

  async addLocalTrack(track, stream = this.localStream) {
    if (!track) return
    const mediaStream = stream || this.localStream || new MediaStream()
    this.localStream = mediaStream

    if (!mediaStream.getTracks().includes(track)) {
      mediaStream.addTrack(track)
    }

    const remoteSocketIds = Object.keys(this.peerConnections)

    for (const remoteSocketId of remoteSocketIds) {
      const peerConnection = this.peerConnections[remoteSocketId]
      await this.replaceTrackOnPeerConnection(peerConnection, track.kind, track, mediaStream)
    }

    await this.tuneAllSenders()
    await this.renegotiateAll()
  }

  async replaceLocalTrack(kind, track, stream = this.localStream, options = {}) {
    const mediaStream = stream || this.localStream || (track ? new MediaStream([track]) : null)
    if (mediaStream) this.localStream = mediaStream

    if (track && mediaStream && !mediaStream.getTracks().includes(track)) {
      mediaStream.addTrack(track)
    }

    const remoteSocketIds = Object.keys(this.peerConnections)

    for (const remoteSocketId of remoteSocketIds) {
      const peerConnection = this.peerConnections[remoteSocketId]
      await this.replaceTrackOnPeerConnection(peerConnection, kind, track, mediaStream)
    }

    await this.tuneAllSenders()
    if (options.renegotiate !== false) await this.renegotiateAll()
  }

  async renegotiateAll() {
    const remoteSocketIds = Object.keys(this.peerConnections)

    for (const remoteSocketId of remoteSocketIds) {
      await this.createOffer(remoteSocketId)
    }
  }

  setAudioEnabled(enabled) {
    if (!this.localStream) return
    this.localStream.getAudioTracks().forEach((track) => { track.enabled = enabled })
  }

  setVideoEnabled(enabled) {
    if (!this.localStream) return
    this.localStream.getVideoTracks().forEach((track) => { track.enabled = enabled })
  }

  closePeer(remoteSocketId) {
    const peerConnection = this.peerConnections[remoteSocketId]
    if (peerConnection) {
      peerConnection.close()
      if (this.onPeerState) this.onPeerState(remoteSocketId, 'closed')
      delete this.peerConnections[remoteSocketId]
    }

    this.stopStats(remoteSocketId)
    delete this.pendingCandidates[remoteSocketId]
    delete this.remoteMediaStreams[remoteSocketId]
    delete this.makingOffers[remoteSocketId]
    delete this.ignoredOffers[remoteSocketId]
    delete this.pendingOffers[remoteSocketId]
    this.cleanupRemoteTracks(remoteSocketId)
    this.resetIceRestart(remoteSocketId)
    this.tuneAllSenders().catch(() => {})
  }

  closeAll() {
    Object.values(this.peerConnections).forEach((peerConnection) => peerConnection.close())
    Object.keys(this.statsTimers).forEach((remoteSocketId) => this.stopStats(remoteSocketId))
    this.peerConnections = {}
    this.pendingCandidates = {}
    this.remoteMediaStreams = {}
    this.makingOffers = {}
    this.ignoredOffers = {}
    this.pendingOffers = {}
    Object.keys(this.iceRestartTimers).forEach((remoteSocketId) => this.clearIceRestart(remoteSocketId))
    this.pendingIceRestarts = {}
    this.iceRestartTimers = {}
    this.iceRestartAttempts = {}
    this.statsTimers = {}
    this.previousStats = {}
    Object.keys(this.remoteTrackCleanups).forEach((remoteSocketId) => this.cleanupRemoteTracks(remoteSocketId))
    this.remoteTrackCleanups = {}
  }
}
