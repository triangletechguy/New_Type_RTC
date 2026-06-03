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
  constructor({ socket, localStream, rtcMode = 'video', iceServers, iceTransportPolicy = 'all', onRemoteStream, onPeerState, onPeerStats }) {
    this.socket = socket
    this.localStream = localStream
    this.rtcMode = rtcMode === 'audio' ? 'audio' : 'video'
    this.iceServers = Array.isArray(iceServers) && iceServers.length ? iceServers : buildIceServers()
    this.iceTransportPolicy = iceTransportPolicy === 'relay' ? 'relay' : 'all'
    this.onRemoteStream = onRemoteStream
    this.onPeerState = onPeerState
    this.onPeerStats = onPeerStats
    this.peerConnections = {}
    this.pendingCandidates = {}
    this.remoteMediaStreams = {}
    this.makingOffers = {}
    this.ignoredOffers = {}
    this.pendingOffers = {}
    this.statsTimers = {}
    this.previousStats = {}
  }

  emitPeerState(remoteSocketId, peerConnection) {
    if (!this.onPeerState) return
    const state = peerConnection.connectionState === 'new' && peerConnection.iceConnectionState !== 'new'
      ? peerConnection.iceConnectionState
      : peerConnection.connectionState
    this.onPeerState(remoteSocketId, state)
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
    const hasLocalAudio = localTracks.some((track) => track.kind === 'audio')
    const hasLocalVideo = localTracks.some((track) => track.kind === 'video')

    if (this.localStream) {
      localTracks.forEach((track) => {
        peerConnection.addTrack(track, this.localStream)
      })
    }

    if (!hasLocalAudio) {
      peerConnection.addTransceiver('audio', { direction: 'recvonly' })
    }

    if (this.rtcMode === 'video' && !hasLocalVideo) {
      peerConnection.addTransceiver('video', { direction: 'recvonly' })
    }

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('webrtc-ice-candidate', {
          targetSocketId: remoteSocketId,
          candidate: event.candidate,
        })
      }
    }

    peerConnection.ontrack = (event) => {
      const [eventStream] = event.streams
      const stream = eventStream || this.remoteMediaStreams[remoteSocketId] || new MediaStream()

      if (!eventStream) {
        stream.addTrack(event.track)
      }

      this.remoteMediaStreams[remoteSocketId] = stream
      if (stream && this.onRemoteStream) {
        this.onRemoteStream(remoteSocketId, stream)
      }
    }

    peerConnection.onconnectionstatechange = () => {
      this.emitPeerState(remoteSocketId, peerConnection)
    }

    peerConnection.oniceconnectionstatechange = () => {
      this.emitPeerState(remoteSocketId, peerConnection)
    }

    this.peerConnections[remoteSocketId] = peerConnection
    this.emitPeerState(remoteSocketId, peerConnection)
    this.startStats(remoteSocketId)
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

  async createOffer(remoteSocketId) {
    const peerConnection = this.createPeerConnection(remoteSocketId)

    if (peerConnection.signalingState !== 'stable') {
      this.pendingOffers[remoteSocketId] = true
      return false
    }

    this.makingOffers[remoteSocketId] = true
    this.pendingOffers[remoteSocketId] = false

    try {
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      this.socket.emit('webrtc-offer', {
        targetSocketId: remoteSocketId,
        offer: peerConnection.localDescription,
      })

      return true
    } finally {
      this.makingOffers[remoteSocketId] = false
    }
  }

  async flushPendingOffer(remoteSocketId) {
    const peerConnection = this.peerConnections[remoteSocketId]
    if (!this.pendingOffers[remoteSocketId] || !peerConnection || peerConnection.signalingState !== 'stable') return false
    return this.createOffer(remoteSocketId)
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

    this.socket.emit('webrtc-answer', {
      targetSocketId: fromSocketId,
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
      const sender = peerConnection.getSenders()
        .find((item) => item.track?.kind === track.kind)
      const transceiver = peerConnection.getTransceivers()
        .find((item) => item.sender && !item.sender.track && item.receiver?.track?.kind === track.kind)

      if (sender) {
        await sender.replaceTrack(track)
      } else if (transceiver) {
        transceiver.direction = transceiver.direction.includes('recv') ? 'sendrecv' : 'sendonly'
        await transceiver.sender.replaceTrack(track)
      } else {
        peerConnection.addTrack(track, mediaStream)
      }
    }

    await this.renegotiateAll()
  }

  async replaceLocalTrack(kind, track, stream = this.localStream) {
    const mediaStream = stream || this.localStream || (track ? new MediaStream([track]) : null)
    if (mediaStream) this.localStream = mediaStream

    if (track && mediaStream && !mediaStream.getTracks().includes(track)) {
      mediaStream.addTrack(track)
    }

    const remoteSocketIds = Object.keys(this.peerConnections)

    for (const remoteSocketId of remoteSocketIds) {
      const peerConnection = this.peerConnections[remoteSocketId]
      const sender = peerConnection.getSenders()
        .find((item) => item.track?.kind === kind)
      const transceiver = peerConnection.getTransceivers()
        .find((item) => item.sender && item.receiver?.track?.kind === kind)

      if (sender) {
        await sender.replaceTrack(track || null)
      } else if (transceiver) {
        transceiver.direction = track
          ? transceiver.direction.includes('recv') ? 'sendrecv' : 'sendonly'
          : transceiver.direction.includes('recv') ? 'recvonly' : 'inactive'
        await transceiver.sender.replaceTrack(track || null)
      } else if (track && mediaStream) {
        peerConnection.addTrack(track, mediaStream)
      }
    }

    await this.renegotiateAll()
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
    this.statsTimers = {}
    this.previousStats = {}
  }
}
