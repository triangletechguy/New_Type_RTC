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

const ICE_SERVERS = buildIceServers()

export class NativeRtcClient {
  constructor({ socket, localStream, onRemoteStream, onPeerState }) {
    this.socket = socket
    this.localStream = localStream
    this.onRemoteStream = onRemoteStream
    this.onPeerState = onPeerState
    this.peerConnections = {}
    this.pendingCandidates = {}
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
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 4,
    })

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, this.localStream)
      })
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
      const [stream] = event.streams
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
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)

    this.socket.emit('webrtc-offer', {
      targetSocketId: remoteSocketId,
      offer,
    })
  }

  async handleOffer(fromSocketId, offer) {
    const peerConnection = this.createPeerConnection(fromSocketId)
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
    await this.flushPendingCandidates(fromSocketId)

    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)

    this.socket.emit('webrtc-answer', {
      targetSocketId: fromSocketId,
      answer,
    })
  }

  async handleAnswer(fromSocketId, answer) {
    const peerConnection = this.peerConnections[fromSocketId]
    if (!peerConnection) return

    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
    await this.flushPendingCandidates(fromSocketId)
  }

  async handleIceCandidate(fromSocketId, candidate) {
    const peerConnection = this.peerConnections[fromSocketId]

    if (!peerConnection || !peerConnection.remoteDescription) {
      this.pendingCandidates[fromSocketId] ||= []
      this.pendingCandidates[fromSocketId].push(candidate)
      return
    }

    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
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
  }

  closeAll() {
    Object.values(this.peerConnections).forEach((peerConnection) => peerConnection.close())
    this.peerConnections = {}
    this.pendingCandidates = {}
  }
}
