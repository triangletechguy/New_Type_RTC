import { useMemo, useState } from 'react'
import { brandAssets } from '../../assets/rtc/catalog'
import roadmapPdf from '../../assets/agora_style_self_hosted_rtc_platform_roadmap.pdf'

/**
 * @typedef {{ id: string, label: string, title: string, language: string, code: string }} SdkTab
 */

/** @type {SdkTab[]} */
const sdkTabs = [
  {
    id: 'web',
    label: 'Web',
    title: 'Browser quickstart',
    language: 'JavaScript',
    code: `import { io } from 'socket.io-client'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api'
const signalingUrl = import.meta.env.VITE_SIGNALING_SERVER_URL || new URL(apiBaseUrl, window.location.origin).origin
const appBackendUrl = import.meta.env.VITE_APP_BACKEND_URL || ''
const roomId = 123
const externalUserId = 'user_42'
const localVideo = document.querySelector('[data-local-video]')
const remoteVideo = document.querySelector('[data-remote-video]')

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || data.code || 'Request failed')
  return data
}

// Your backend endpoint keeps CLIENT_API_KEY private and returns rtc_token, room, user.
const tokenData = await fetchJson(appBackendUrl + '/my-app/rtc-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ roomId, externalUserId, mode: 'video' }),
})

const rtcConfig = await fetchJson(apiBaseUrl + '/rtc/config')
const mediaType = tokenData.room.rtc_profile.media_type
const localStream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: mediaType === 'video',
})

if (localVideo) localVideo.srcObject = localStream

const socket = io(signalingUrl, { transports: ['websocket', 'polling'] })
const peers = new Map()

function getPeerConnection(socketId) {
  if (peers.has(socketId)) return peers.get(socketId)

  const pc = new RTCPeerConnection({
    iceServers: rtcConfig.iceServers || [],
    iceTransportPolicy: rtcConfig.iceTransportPolicy || 'all',
  })

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetSocketId: socketId,
        candidate: event.candidate,
      })
    }
  }
  pc.ontrack = (event) => {
    if (remoteVideo) remoteVideo.srcObject = event.streams[0]
  }

  peers.set(socketId, pc)
  return pc
}

async function createOffer(socketId) {
  const pc = getPeerConnection(socketId)
  await pc.setLocalDescription(await pc.createOffer())
  socket.emit('webrtc-offer', { targetSocketId: socketId, offer: pc.localDescription })
}

socket.on('connect', () => {
  socket.emit('join-room', {
    roomId: tokenData.room.signaling_room,
    databaseRoomId: tokenData.room.id,
    userId: tokenData.user.user_id,
    userName: tokenData.user.name,
    userAvatarUrl: tokenData.user.avatar_url,
    rtcMode: mediaType,
    micEnabled: true,
    cameraEnabled: mediaType === 'video',
  }, (response) => {
    if (!response?.ok) throw new Error(response?.message || 'Signaling join failed')
    response.users.forEach((peer) => createOffer(peer.socketId))
  })
})

socket.on('user-joined', (peer) => createOffer(peer.socketId))

socket.on('webrtc-offer', async ({ fromSocketId, offer }) => {
  const pc = getPeerConnection(fromSocketId)
  await pc.setRemoteDescription(offer)
  await pc.setLocalDescription(await pc.createAnswer())
  socket.emit('webrtc-answer', { targetSocketId: fromSocketId, answer: pc.localDescription })
})

socket.on('webrtc-answer', async ({ fromSocketId, answer }) => {
  await getPeerConnection(fromSocketId).setRemoteDescription(answer)
})

socket.on('webrtc-ice-candidate', async ({ fromSocketId, candidate }) => {
  await getPeerConnection(fromSocketId).addIceCandidate(candidate)
})

socket.on('user-left', ({ socketId }) => {
  peers.get(socketId)?.close()
  peers.delete(socketId)
})

window.addEventListener('beforeunload', () => {
  socket.emit('leave-room')
  peers.forEach((pc) => pc.close())
  localStream.getTracks().forEach((track) => track.stop())
})`,
  },
  {
    id: 'react',
    label: 'React',
    title: 'React room component',
    language: 'TSX',
    code: `import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

export function LiveRoom({ roomId, externalUserId }) {
  const localVideoRef = useRef(null)
  const [peers, setPeers] = useState([])

  useEffect(() => {
    let socket
    let localStream
    let stopped = false
    const peerConnections = new Map()

    async function start() {
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api'
      const signalingUrl = import.meta.env.VITE_SIGNALING_SERVER_URL || new URL(apiBaseUrl, window.location.origin).origin

      const tokenResponse = await fetch('/my-app/rtc-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, externalUserId, mode: 'video' }),
      })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok) throw new Error(tokenData.message || 'RTC token failed')

      const rtcConfig = await fetch(apiBaseUrl + '/rtc/config').then((response) => response.json())
      const mediaType = tokenData.room.rtc_profile.media_type
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mediaType === 'video',
      })
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream

      function peerConnection(socketId) {
        if (peerConnections.has(socketId)) return peerConnections.get(socketId)
        const pc = new RTCPeerConnection({
          iceServers: rtcConfig.iceServers || [],
          iceTransportPolicy: rtcConfig.iceTransportPolicy || 'all',
        })
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('webrtc-ice-candidate', { targetSocketId: socketId, candidate: event.candidate })
          }
        }
        pc.ontrack = (event) => {
          setPeers((current) => current.map((peer) => (
            peer.socketId === socketId ? { ...peer, stream: event.streams[0] } : peer
          )))
        }
        peerConnections.set(socketId, pc)
        return pc
      }

      async function offerPeer(socketId) {
        const pc = peerConnection(socketId)
        await pc.setLocalDescription(await pc.createOffer())
        socket.emit('webrtc-offer', { targetSocketId: socketId, offer: pc.localDescription })
      }

      socket = io(signalingUrl, { transports: ['websocket', 'polling'] })
      socket.on('existing-users', ({ users = [] }) => {
        setPeers(users)
        users.forEach((peer) => offerPeer(peer.socketId))
      })
      socket.on('user-joined', (peer) => {
        setPeers((current) => [...current.filter((item) => item.socketId !== peer.socketId), peer])
        offerPeer(peer.socketId)
      })
      socket.on('user-left', ({ socketId }) => {
        peerConnections.get(socketId)?.close()
        peerConnections.delete(socketId)
        setPeers((current) => current.filter((peer) => peer.socketId !== socketId))
      })
      socket.on('webrtc-offer', async ({ fromSocketId, offer }) => {
        const pc = peerConnection(fromSocketId)
        await pc.setRemoteDescription(offer)
        await pc.setLocalDescription(await pc.createAnswer())
        socket.emit('webrtc-answer', { targetSocketId: fromSocketId, answer: pc.localDescription })
      })
      socket.on('webrtc-answer', ({ fromSocketId, answer }) => {
        peerConnection(fromSocketId).setRemoteDescription(answer)
      })
      socket.on('webrtc-ice-candidate', ({ fromSocketId, candidate }) => {
        peerConnection(fromSocketId).addIceCandidate(candidate)
      })

      if (stopped) return
      socket.emit('join-room', {
        roomId: tokenData.room.signaling_room,
        databaseRoomId: tokenData.room.id,
        userId: tokenData.user.user_id,
        userName: tokenData.user.name,
        rtcMode: mediaType,
        micEnabled: true,
        cameraEnabled: mediaType === 'video',
      })
    }

    start().catch(console.error)

    return () => {
      stopped = true
      socket?.emit('leave-room')
      socket?.disconnect()
      peerConnections.forEach((pc) => pc.close())
      localStream?.getTracks().forEach((track) => track.stop())
    }
  }, [roomId, externalUserId])

  return (
    <section>
      <video ref={localVideoRef} autoPlay muted playsInline />
      {peers.map((peer) => (
        <video
          key={peer.socketId}
          ref={(element) => {
            if (element && peer.stream) element.srcObject = peer.stream
          }}
          autoPlay
          playsInline
        />
      ))}
    </section>
  )
}`,
  },
  {
    id: 'server',
    label: 'Server',
    title: 'Company backend token exchange',
    language: 'Node',
    code: `import express from 'express'

const app = express()
app.use(express.json())

const apiBase = process.env.TEO_API_BASE_URL || 'https://your-domain.com/api/client'
const requireUser = (req, _res, next) => next()
const clientHeaders = {
  Authorization: 'Bearer ' + process.env.TEO_CLIENT_API_KEY,
  'Content-Type': 'application/json',
}

app.post('/my-app/rtc-token', requireUser, async (req, res) => {
  const externalUserId = String(req.user.id)
  const roomId = Number(req.body.roomId)

  await fetch(apiBase + '/users/sync', {
    method: 'POST',
    headers: clientHeaders,
    body: JSON.stringify({
      external_user_id: externalUserId,
      name: req.user.name,
      email: req.user.email,
      avatar_url: req.user.avatarUrl,
      status: 'active',
      metadata: { plan: req.user.plan },
    }),
  })

  const tokenResponse = await fetch(apiBase + '/rtc/token', {
    method: 'POST',
    headers: clientHeaders,
    body: JSON.stringify({
      external_user_id: externalUserId,
      room_id: roomId,
      role: req.body.role || 'publisher',
      rtc_mode: req.body.mode || 'video',
      permissions: ['join', 'publish_audio', 'publish_video', 'subscribe', 'chat'],
    }),
  })
  const data = await tokenResponse.json()
  if (!tokenResponse.ok) {
    return res.status(tokenResponse.status).json(data)
  }

  res.json({
    token: data.rtc_token,
    expires_at: data.expires_at,
    billing: data.billing,
    room: data.room,
    user: data.external_user,
  })
})`,
  },
  {
    id: 'events',
    label: 'Events',
    title: 'Socket.IO event surface',
    language: 'JavaScript',
    code: `socket.on('existing-users', ({ socketId, users }) => {
  console.log('local socket', socketId, 'existing peers', users)
})

socket.on('user-joined', (peer) => {
  console.log('peer joined', peer.socketId, peer.userId, peer.userName)
})

socket.on('user-left', ({ socketId, userId, userName }) => {
  console.log('peer left', socketId, userId, userName)
})

socket.on('webrtc-offer', ({ fromSocketId, offer }) => {
  console.log('answer offer from', fromSocketId, offer.type)
})

socket.on('webrtc-answer', ({ fromSocketId, answer }) => {
  console.log('apply answer from', fromSocketId, answer.type)
})

socket.on('webrtc-ice-candidate', ({ fromSocketId, candidate }) => {
  console.log('add ICE candidate from', fromSocketId, candidate.candidate)
})

socket.on('media-state-change', (state) => {
  console.log('peer media changed', state.socketId, state.micEnabled, state.cameraEnabled)
})

socket.on('moderation-action', ({ action, targetUserId }) => {
  console.log('moderation action', action, targetUserId)
})

socket.emit('media-state-change', {
  roomId: tokenData.room.signaling_room,
  rtcMode: 'video',
  micEnabled: true,
  cameraEnabled: true,
})`,
  },
]

const flowSteps = [
  ['1', 'Create company app', 'Generate app key, API key, allowed origins, billing scope, and app status.'],
  ['2', 'Sync invited user', 'Map a client app user into the company user ledger with company-paid minutes.'],
  ['3', 'Create RTC resource', 'Create or reuse an app-side room resource for audio, video, live, private, or password token scope.'],
  ['4', 'Issue RTC token', 'Return a short-lived token scoped to one tenant, app, user, room, and role.'],
  ['5', 'Join signaling and media', 'The browser receives the RTC token and signaling metadata, then uses Socket.IO and native WebRTC. Never expose the client API key.'],
  ['6', 'Apply package minutes', 'Start/end sessions and aggregate each invited user minute to the client company package.'],
]

const apiMethods = [
  ['GET /api/client/me', 'Verifies API key, app status, tenant status, and package context.'],
  ['POST /api/client/users/sync', 'Creates or updates an invited tenant-scoped user before RTC access.'],
  ['POST /api/client/rooms', 'Creates an app-scoped RTC resource; billing still follows the synced user ledger.'],
  ['PATCH /api/client/rooms/:id', 'Updates room name, privacy, seats, and feature flags.'],
  ['POST /api/client/rtc/token', 'Issues a short-lived room token for one synced user and one room.'],
  ['POST /api/client/rtc/session/start', 'Starts usage tracking when a user joins RTC.'],
  ['POST /api/client/rtc/session/end', 'Closes usage tracking and adds billable user minutes to the company package.'],
  ['GET /api/rtc/config', 'Returns ICE servers and transport policy for RTCPeerConnection.'],
  ['Socket.IO join-room', 'Joins the returned room.signaling_room and receives existing peers.'],
  ['Socket.IO room-peers', 'Refreshes the current peer list after reconnect.'],
  ['Socket.IO webrtc-offer / webrtc-answer / webrtc-ice-candidate', 'Relays native WebRTC negotiation between browser peers.'],
  ['Socket.IO media-state-change', 'Broadcasts mic, camera, and screen-share state.'],
  ['Socket.IO leave-room', 'Leaves signaling; session/end should still be called by the app backend.'],
]

const eventRows = [
  ['existing-users', 'Sent after join-room with the local socket ID and peers already in the signaling room.'],
  ['user-joined', 'A peer joined the signaling room and should receive an offer.'],
  ['user-left', 'A peer left or disconnected; close its RTCPeerConnection.'],
  ['webrtc-offer / webrtc-answer', 'Offer and answer payloads forwarded to the target socket.'],
  ['webrtc-ice-candidate', 'ICE candidate payload forwarded to the target socket.'],
  ['media-state-change', 'Mic, camera, screen-share, and RTC mode changed for a peer.'],
  ['moderation-action', 'Mute, camera-off, kick, or ban action was applied.'],
]

const roomTypeRows = [
  ['audio', 'Normal audio room SDK', 'Voice room with mic seats and chat.'],
  ['youtube_audio', 'YouTube audio room SDK', 'Audio room profile for YouTube/music co-listening flows.'],
  ['one_to_one_audio', 'One-to-one voice calling', 'Two-seat voice call; billed as audio minutes.'],
  ['group_audio', 'Group voice chat', 'Multi-speaker audio room.'],
  ['video', 'Normal video room SDK', 'Standard camera room.'],
  ['one_to_one_video', 'One-to-one video calling', 'Two-seat video call with beauty/filter support.'],
  ['group_video', 'Normal video group chat', 'Multi-user camera grid.'],
  ['solo_live', 'Solo video live', 'Host-led live video room.'],
  ['pk_live', 'Live video PK', 'Two-host live video battle room.'],
]

const rtcProfileRows = [
  ['Communication', 'audio, one_to_one_audio, video, one_to_one_video, group_audio, group_video', 'Agora-style rtc/communication profile for calls and group rooms.'],
  ['Live broadcast', 'solo_live, pk_live', 'Agora-style live profile with publisher/audience roles.'],
  ['Audio-only', 'audio, youtube_audio, one_to_one_audio, group_audio', 'Publish microphone, disable camera by default, bill usage as audio.'],
  ['Video-capable', 'video, one_to_one_video, group_video, solo_live, pk_live', 'Publish microphone and camera, support screen share and video effects when enabled.'],
]

const buildMilestones = [
  ['1', 'Company-first admin', 'Tenants, apps, packages, status, contacts, and billing setup.'],
  ['2', 'Client API auth', 'API keys resolve company/app and reject suspended or revoked access.'],
  ['3', 'Invited users', 'External user sync keeps client users in the company ledger for package billing.'],
  ['4', 'RTC token API', 'Short-lived JWTs carry tenant, app, room, role, and permission claims.'],
  ['5', 'RTC resource API', 'Client backends create/list/update/disable/delete token-scoped RTC resources.'],
  ['6', 'Company usage and billing', 'Invited-user minutes, room telemetry, peak concurrency, and client-company invoice state.'],
  ['7', 'Developer docs', 'Quickstart, route map, native WebRTC examples, errors, webhooks, and test console.'],
  ['8', 'SFU upgrade', 'Add mediasoup, Janus, or LiveKit-style media when room scale demands it.'],
]

const tokenClaims = [
  ['tenant_id', 'Prevents cross-company room access.'],
  ['app_id', 'Connects usage and permissions to one client app.'],
  ['external_user_id', 'Maps the RTC session to the invited company user whose minutes count toward the package.'],
  ['room_id', 'Limits the token to one room/channel.'],
  ['room_type / rtc_profile', 'Maps to communication/live profile, web mode, media type, and publisher role.'],
  ['role', 'Controls audience, publisher, moderator, and admin behavior.'],
  ['permissions', 'Controls join, publish_audio, publish_video, screen_share, chat, mute, kick.'],
  ['billing_payer / billing_scope / user_pays', 'Marks the client company as payer while synced users spend company package minutes.'],
  ['exp / iat', 'Keeps tokens short-lived. Fifteen minutes is the default target.'],
]

const routeGroups = [
  {
    title: 'Platform Admin APIs',
    rows: [
      ['GET /api/admin/companies', 'List client companies and operational status.'],
      ['POST /api/admin/companies', 'Create tenant, contacts, package, and client-company billing scope.'],
      ['PATCH /api/admin/companies/:id', 'Edit tenant identity, contacts, package, limits, and status.'],
      ['POST /api/admin/client-apps', 'Generate app key, API key, SDK token, and allowed origins.'],
      ['POST /api/admin/client-apps/:appId/rotate-credentials', 'Rotate credentials and show the raw key once.'],
      ['GET /api/admin/companies/:id/detail', 'Open company dashboard: apps, users, package minutes, usage, billing.'],
    ],
  },
  {
    title: 'Client Company APIs',
    rows: [
      ['GET /api/client/me', 'Verify API key and tenant/app/client billing state.'],
      ['POST /api/client/users/sync', 'Create or update an invited tenant-scoped user.'],
      ['GET /api/client/users/:external_user_id', 'Read one synced external user.'],
      ['POST /api/client/rooms', 'Create a tenant/app-scoped RTC resource.'],
      ['GET /api/client/rooms', 'List RTC resources for this client app.'],
      ['PATCH /api/client/rooms/:id', 'Update resource fields and feature flags.'],
      ['POST /api/client/rooms/:id/disable', 'Disable an RTC resource without losing history.'],
      ['DELETE /api/client/rooms/:id', 'End/archive an RTC resource and preserve usage records.'],
      ['POST /api/client/rtc/token', 'Issue a room-scoped RTC token.'],
      ['POST /api/client/rtc/session/start', 'Start usage tracking for a user entering RTC.'],
      ['POST /api/client/rtc/session/end', 'End usage tracking and calculate client-company billable minutes.'],
    ],
  },
]

const errorRows = [
  ['invalid_api_key', 'API key is missing, invalid, revoked, or malformed.'],
  ['company_suspended', 'Tenant company is suspended; token and room APIs fail.'],
  ['app_suspended', 'The specific client app is suspended.'],
  ['origin_not_allowed', 'The web origin is not in the app allowed origins list.'],
  ['room_disabled', 'The requested room exists but is disabled.'],
  ['room_not_found', 'The room does not exist inside this tenant/app scope.'],
  ['user_not_synced', 'The external user must be synced before token generation.'],
  ['permission_denied', 'Requested role or permission is not allowed.'],
  ['room_capacity_reached', 'The room has reached its configured participant capacity.'],
]

const webhookEvents = [
  'room.started',
  'room.ended',
  'room.disabled',
  'participant.joined',
  'participant.left',
  'participant.reconnected',
  'usage.updated',
  'billing.usage_warning',
  'billing.invoice_ready',
]

const mediaUpgradeRows = [
  ['MVP media', 'Native peer-to-peer WebRTC for 1:1 and small rooms.'],
  ['Signaling scale', 'Socket.IO now; add Redis/NATS for multi-node routing later.'],
  ['TURN reliability', 'Use self-hosted TURN for NAT traversal and monitor usage.'],
  ['SFU adapter', 'Keep a provider boundary: p2p, mediasoup, janus, or livekit_style.'],
  ['Admin metrics', 'Track packet loss, bitrate, RTT, jitter, reconnects, and token failures.'],
]

/**
 * @param {{ value: string, label?: string }} props
 */
function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button className="sdk-copy-button" onClick={copy}>
      {copied ? 'Copied' : label}
    </button>
  )
}

/**
 * @param {{ tab: SdkTab }} props
 */
function CodePanel({ tab }) {
  return (
    <div className="glass-card sdk-code-card">
      <div className="sdk-card-header">
        <div>
          <span className="eyebrow">{tab.language}</span>
          <h2>{tab.title}</h2>
        </div>
        <CopyButton value={tab.code} />
      </div>
      <pre>{tab.code}</pre>
    </div>
  )
}

function SdkFlow() {
  return (
    <section className="sdk-flow-grid">
      {flowSteps.map(([number, title, detail]) => (
        <div className="glass-card sdk-flow-step" key={number}>
          <span>{number}</span>
          <strong>{title}</strong>
          <p>{detail}</p>
        </div>
      ))}
    </section>
  )
}

function SdkRoadmap() {
  return (
    <section className="glass-card sdk-roadmap-panel">
      <div className="sdk-card-header">
        <div>
          <span className="eyebrow">Build Roadmap</span>
          <h2>Control Plane First</h2>
        </div>
        <a className="sdk-copy-button" href={roadmapPdf} target="_blank" rel="noreferrer">Open PDF</a>
      </div>

      <div className="sdk-roadmap-grid">
        {buildMilestones.map(([number, title, detail]) => (
          <article key={number}>
            <span>{number}</span>
            <div>
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="sdk-done-condition">
        <span>MVP done condition</span>
        <strong>A client company can receive an API key, sync an invited user, create an RTC resource, request an RTC token, join WebRTC from a sample frontend, and see user minutes in the admin dashboard.</strong>
      </div>
    </section>
  )
}

function SdkReference() {
  return (
    <section className="sdk-reference-grid">
      <div className="glass-card sdk-reference-card">
        <div className="sdk-card-header">
          <div>
            <span className="eyebrow">Client API</span>
            <h2>Core Methods</h2>
          </div>
        </div>
        <div className="sdk-method-list">
          {apiMethods.map(([name, detail]) => (
            <div className="sdk-method-row" key={name}>
              <code>{name}</code>
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card sdk-reference-card">
        <div className="sdk-card-header">
          <div>
            <span className="eyebrow">Realtime</span>
            <h2>Event Surface</h2>
          </div>
        </div>
        <div className="sdk-method-list">
          {eventRows.map(([name, detail]) => (
            <div className="sdk-method-row" key={name}>
              <code>{name}</code>
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SdkTokenContract() {
  return (
    <section className="glass-card sdk-token-contract">
      <div className="sdk-card-header">
        <div>
          <span className="eyebrow">RTC Token</span>
          <h2>Agora-Style Claims</h2>
        </div>
      </div>
      <div className="sdk-token-grid">
        {tokenClaims.map(([claim, detail]) => (
          <div key={claim}>
            <code>{claim}</code>
            <span>{detail}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function SdkRoomTypes() {
  return (
    <section className="sdk-reference-grid">
      <div className="glass-card sdk-reference-card">
        <div className="sdk-card-header">
          <div>
            <span className="eyebrow">Room Types</span>
            <h2>Required RTC Surface</h2>
          </div>
        </div>
        <div className="sdk-method-list">
          {roomTypeRows.map(([type, label, detail]) => (
            <div className="sdk-method-row" key={type}>
              <code>{type}</code>
              <span><strong>{label}</strong> {detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card sdk-reference-card">
        <div className="sdk-card-header">
          <div>
            <span className="eyebrow">Agora-Type Map</span>
            <h2>RTC Profiles</h2>
          </div>
        </div>
        <div className="sdk-method-list">
          {rtcProfileRows.map(([profile, types, detail]) => (
            <div className="sdk-method-row" key={profile}>
              <code>{profile}</code>
              <span><strong>{types}</strong> {detail}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SdkRouteMap() {
  return (
    <section className="sdk-route-map">
      {routeGroups.map((group) => (
        <div className="glass-card sdk-reference-card" key={group.title}>
          <div className="sdk-card-header">
            <div>
              <span className="eyebrow">Route Map</span>
              <h2>{group.title}</h2>
            </div>
          </div>
          <div className="sdk-method-list">
            {group.rows.map(([route, detail]) => (
              <div className="sdk-method-row" key={route}>
                <code>{route}</code>
                <span>{detail}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

function SdkReliability() {
  return (
    <section className="sdk-reliability-grid">
      <div className="glass-card sdk-reference-card">
        <div className="sdk-card-header">
          <div>
            <span className="eyebrow">Errors</span>
            <h2>Integration Error Codes</h2>
          </div>
        </div>
        <div className="sdk-method-list">
          {errorRows.map(([code, detail]) => (
            <div className="sdk-method-row" key={code}>
              <code>{code}</code>
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card sdk-reference-card">
        <div className="sdk-card-header">
          <div>
            <span className="eyebrow">Webhooks</span>
            <h2>Events To Support</h2>
          </div>
        </div>
        <div className="sdk-chip-grid">
          {webhookEvents.map((event) => <code key={event}>{event}</code>)}
        </div>
      </div>

      <div className="glass-card sdk-reference-card">
        <div className="sdk-card-header">
          <div>
            <span className="eyebrow">Media Plane</span>
            <h2>SFU-Ready Upgrade Path</h2>
          </div>
        </div>
        <div className="sdk-method-list">
          {mediaUpgradeRows.map(([name, detail]) => (
            <div className="sdk-method-row" key={name}>
              <code>{name}</code>
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SdkConfigCard() {
  const installCommand = 'npm install socket.io-client'
  const envExample = `# Frontend
VITE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_SIGNALING_SERVER_URL=http://127.0.0.1:8000
VITE_APP_BACKEND_URL=http://127.0.0.1:3000

# Your backend only
TEO_API_BASE_URL=http://127.0.0.1:8000/api/client
TEO_CLIENT_API_KEY=copy_full_key_from_admin_once`

  return (
    <aside className="glass-card sdk-config-card">
      <div className="sdk-card-header">
        <div>
          <span className="eyebrow">Project Setup</span>
          <h2>Install and configure</h2>
        </div>
        <CopyButton value={envExample} label="Copy env" />
      </div>

      <div className="sdk-install-row">
        <code>{installCommand}</code>
        <CopyButton value={installCommand} />
      </div>

      <pre>{envExample}</pre>

      <div className="sdk-capability-list">
        <span>Native WebRTC</span>
        <span>Socket.IO signaling</span>
        <span>Server-side API key only</span>
        <span>Hashed API keys</span>
        <span>Allowed origins</span>
        <span>Usage logging</span>
        <span>Chat events</span>
      </div>
    </aside>
  )
}

function SdkPlayground() {
  const [config, setConfig] = useState({
    tokenEndpoint: '/my-app/rtc-token',
    roomId: '123',
    externalUserId: 'user_42',
    mode: 'video',
  })
  const [stage, setStage] = useState('token')

  const stages = [
    ['token', 'Token'],
    ['media', 'Media'],
    ['signal', 'Signal'],
    ['publish', 'Publish'],
    ['leave', 'Leave'],
  ]
  const activeIndex = stages.findIndex(([id]) => id === stage)
  const generatedCode = `import { io } from 'socket.io-client'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api'
const signalingUrl = import.meta.env.VITE_SIGNALING_SERVER_URL || new URL(apiBaseUrl, window.location.origin).origin

const tokenResponse = await fetch('${config.tokenEndpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    roomId: ${Number(config.roomId) || 123},
    externalUserId: '${config.externalUserId}',
    mode: '${config.mode}',
  }),
})
const tokenData = await tokenResponse.json()
if (!tokenResponse.ok) throw new Error(tokenData.message || 'RTC token failed')

const rtcConfig = await fetch(apiBaseUrl + '/rtc/config').then((response) => response.json())
const localStream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: ${config.mode === 'video'},
})

const socket = io(signalingUrl, { transports: ['websocket', 'polling'] })
socket.emit('join-room', {
  roomId: tokenData.room.signaling_room,
  databaseRoomId: tokenData.room.id,
  userId: tokenData.user.user_id,
  userName: tokenData.user.name,
  rtcMode: '${config.mode}',
  micEnabled: true,
  cameraEnabled: ${config.mode === 'video'},
})

console.log('ready for RTCPeerConnection', rtcConfig.iceServers, localStream)`

  function updateField(field, value) {
    setConfig((current) => ({ ...current, [field]: value }))
  }

  return (
    <section className="glass-card sdk-playground">
      <div className="sdk-card-header">
        <div>
          <span className="eyebrow">SDK Console</span>
          <h2>Join Sample Builder</h2>
        </div>
        <CopyButton value={generatedCode} label="Copy sample" />
      </div>

      <div className="sdk-playground-grid">
        <div className="sdk-form-grid">
          <label>
            <span>Token Endpoint</span>
            <input value={config.tokenEndpoint} onChange={(event) => updateField('tokenEndpoint', event.target.value)} />
          </label>
          <label>
            <span>Room ID</span>
            <input value={config.roomId} onChange={(event) => updateField('roomId', event.target.value)} />
          </label>
          <label>
            <span>External User ID</span>
            <input value={config.externalUserId} onChange={(event) => updateField('externalUserId', event.target.value)} />
          </label>
          <label>
            <span>Mode</span>
            <select value={config.mode} onChange={(event) => updateField('mode', event.target.value)}>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
            </select>
          </label>
        </div>

        <div className="sdk-stage-panel">
          <div className="sdk-stage-row">
            {stages.map(([id, label], index) => (
              <button
                className={index < activeIndex ? 'sdk-stage done' : id === stage ? 'sdk-stage active' : 'sdk-stage'}
                key={id}
                onClick={() => setStage(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="sdk-live-summary">
            <div><span>Current Stage</span><strong>{stages[activeIndex]?.[1] || 'Init'}</strong></div>
            <div><span>Room</span><strong>{config.roomId || '-'}</strong></div>
            <div><span>Media</span><strong>{config.mode}</strong></div>
          </div>
          <pre>{generatedCode}</pre>
        </div>
      </div>
    </section>
  )
}

export default function SdkView() {
  const [activeTab, setActiveTab] = useState('web')
  const selectedTab = useMemo(
    () => sdkTabs.find((tab) => tab.id === activeTab) || sdkTabs[0],
    [activeTab]
  )

  return (
    <div className="view-stack sdk-page">
      <header className="page-header glass-card sdk-header">
        <div>
          <span className="eyebrow">Developer Docs</span>
          <h1>Self-Hosted RTC Integration</h1>
          <p>Company app credentials, invited users, RTC resource APIs, short-lived RTC tokens, package-minute usage tracking, and SFU-ready media architecture.</p>
        </div>
        <div className="sdk-version-card">
          <span>Roadmap</span>
          <strong>v1.0</strong>
          <small>Control plane first</small>
        </div>
        <div className="sdk-visual-card">
          <img src={brandAssets.appScreenshots} alt="" loading="lazy" />
        </div>
      </header>

      <SdkFlow />
      <SdkRoadmap />

      <section className="sdk-sample-layout">
        <div className="sdk-sample-main">
          <div className="sdk-tab-row">
            {sdkTabs.map((tab) => (
              <button
                className={tab.id === activeTab ? 'sdk-tab active' : 'sdk-tab'}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <CodePanel tab={selectedTab} />
        </div>

        <SdkConfigCard />
      </section>

      <SdkPlayground />
      <SdkRoomTypes />
      <SdkTokenContract />
      <SdkRouteMap />
      <SdkReliability />

      <SdkReference />
    </div>
  )
}
