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

export class NativeRtcClient {
  constructor({ socket, localStream, rtcMode = 'video', iceServers, iceTransportPolicy = 'all', onRemoteStream, onPeerState }) {
    this.socket = socket
    this.localStream = localStream
    this.rtcMode = rtcMode === 'audio' ? 'audio' : 'video'
    this.iceServers = Array.isArray(iceServers) && iceServers.length ? iceServers : buildIceServers()
    this.iceTransportPolicy = iceTransportPolicy === 'relay' ? 'relay' : 'all'
    this.onRemoteStream = onRemoteStream
    this.onPeerState = onPeerState
    this.peerConnections = {}
    this.pendingCandidates = {}
    this.remoteMediaStreams = {}
    this.makingOffers = {}
    this.ignoredOffers = {}
    this.pendingOffers = {}
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
    return peerConnection
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

    delete this.pendingCandidates[remoteSocketId]
    delete this.remoteMediaStreams[remoteSocketId]
    delete this.makingOffers[remoteSocketId]
    delete this.ignoredOffers[remoteSocketId]
    delete this.pendingOffers[remoteSocketId]
  }

  closeAll() {
    Object.values(this.peerConnections).forEach((peerConnection) => peerConnection.close())
    this.peerConnections = {}
    this.pendingCandidates = {}
    this.remoteMediaStreams = {}
    this.makingOffers = {}
    this.ignoredOffers = {}
    this.pendingOffers = {}
  }
}
