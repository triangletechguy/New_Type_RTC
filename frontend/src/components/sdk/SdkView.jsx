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
    title: 'Web quickstart',
    language: 'JavaScript',
    code: `import { TalkEachOtherRTC } from '@talk-each-other/rtc-web'

const rtc = new TalkEachOtherRTC({
  appKey: 'client_app_key',
  apiBaseUrl: 'https://api.example.com/api',
  signalingUrl: 'https://signal.example.com',
})

const clientRtcToken = 'client_rtc_token'
const roomId = 'room_1001'
const remoteVideo = document.querySelector('[data-remote-video]')

await rtc.authenticate(clientRtcToken)

const session = await rtc.joinRoom(roomId, {
  mode: 'video',
  micEnabled: true,
  cameraEnabled: true,
})

console.log('joined room', session.room?.id || roomId)

rtc.on('peer-joined', (peer) => {
  console.log('peer joined', peer.userId)
})

rtc.on('remote-track', ({ peer, stream }) => {
  if (remoteVideo) remoteVideo.srcObject = stream
  console.log('remote track from', peer.userId)
})

await rtc.leaveRoom()`,
  },
  {
    id: 'react',
    label: 'React',
    title: 'React room component',
    language: 'TSX',
    code: `import { useEffect, useRef, useState } from 'react'
import { TalkEachOtherRTC } from '@talk-each-other/rtc-web'

export function LiveRoom({ roomId, token }) {
  const clientRef = useRef(null)
  const [peers, setPeers] = useState([])

  useEffect(() => {
    const rtc = new TalkEachOtherRTC({
      appKey: import.meta.env.VITE_RTC_APP_KEY,
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
      signalingUrl: import.meta.env.VITE_SIGNALING_SERVER_URL,
    })

    clientRef.current = rtc

    rtc.authenticate(token)
      .then(() => rtc.joinRoom(roomId, { mode: 'video' }))
      .then(({ peers }) => setPeers(peers))

    rtc.on('peer-joined', (peer) => {
      setPeers((current) => [...current, peer])
    })

    rtc.on('peer-left', (peer) => {
      setPeers((current) => current.filter((item) => item.id !== peer.id))
    })

    return () => {
      rtc.leaveRoom()
      rtc.destroy()
    }
  }, [roomId, token])

  return peers.map((peer) => (
    <video key={peer.id} autoPlay playsInline />
  ))
}`,
  },
  {
    id: 'server',
    label: 'Server',
    title: 'Company backend token exchange',
    language: 'Node',
    code: `import express from 'express'

const app = express()
const apiBase = 'https://rtc.example.com/api/client'
const requireUser = (req, _res, next) => next()
const clientHeaders = {
  Authorization: 'Bearer ' + process.env.TEO_CLIENT_API_KEY,
  'Content-Type': 'application/json',
}

app.post('/my-app/rtc-token', requireUser, async (req, res) => {
  await fetch(apiBase + '/users/sync', {
    method: 'POST',
    headers: clientHeaders,
    body: JSON.stringify({
      external_user_id: req.user.id,
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
      external_user_id: req.user.id,
      room_id: req.body.roomId,
      role: req.body.role || 'publisher',
      rtc_mode: req.body.mode || 'video',
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
    title: 'Realtime callbacks',
    language: 'JavaScript',
    code: `const reportRtcError = (error) => {
  console.error(error.code, error.message)
}

rtc.on('connection-state', ({ state }) => {
  console.log('rtc state', state)
})

rtc.on('peer-joined', (peer) => {
  console.log('peer joined', peer.userId, peer.name, peer.role)
})

rtc.on('peer-left', (peer) => {
  console.log('peer left', peer.userId, peer.reason)
})

rtc.on('remote-track', ({ peer, stream, kind }) => {
  console.log('remote track', peer.userId, kind, stream.id)
})

rtc.on('track-muted', ({ peer, kind }) => {
  console.log('track muted', peer.userId, kind)
})

rtc.on('room-message', ({ id, sender, body, sentAt }) => {
  console.log('room message', id, sender.name, body, sentAt)
})

rtc.on('message-unsent', ({ id, deletedBy }) => {
  console.log('message unsent', id, deletedBy)
})

rtc.on('moderation', ({ action, targetUserId, reason }) => {
  console.log('moderation', action, targetUserId, reason)
})

rtc.on('error', (error) => {
  reportRtcError(error)
})`,
  },
]

const flowSteps = [
  ['1', 'Create company app', 'Generate app key, API key, allowed origins, billing scope, and app status.'],
  ['2', 'Sync invited user', 'Map a client app user into the company user ledger with company-paid minutes.'],
  ['3', 'Create RTC resource', 'Create or reuse an app-side room resource for audio, video, live, private, or password token scope.'],
  ['4', 'Issue RTC token', 'Return a short-lived token scoped to one tenant, app, user, room, and role.'],
  ['5', 'Join signaling and media', 'The browser or mobile SDK uses the RTC token, never the client API key.'],
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
  ['authenticate(token)', 'Stores the bearer token used for room and RTC requests.'],
  ['joinRoom(roomId, options)', 'Creates or joins an RTC session and returns signaling metadata.'],
  ['setAudioEnabled(enabled)', 'Toggles local audio and syncs participant media state.'],
  ['setVideoEnabled(enabled)', 'Toggles local camera tracks for video-capable rooms.'],
  ['sendMessage(body)', 'Persists chat and emits the realtime room message event.'],
  ['leaveRoom()', 'Disconnects WebRTC, leaves signaling, and records usage.'],
]

const eventRows = [
  ['peer-joined', 'A participant joins the signaling room.'],
  ['peer-left', 'A participant leaves or is disconnected.'],
  ['remote-track', 'A remote media stream is ready to render.'],
  ['room-message', 'A chat message has been saved and broadcast.'],
  ['message-unsent', 'A message was deleted or unsent.'],
  ['moderation', 'Mute, camera-off, kick, or ban action was applied.'],
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
  ['7', 'Developer docs', 'Quickstart, route map, SDK examples, errors, webhooks, and test console.'],
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
      ['POST /api/admin/apps/:id/api-keys', 'Rotate credentials and show the raw key once.'],
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
  const envExample = `VITE_RTC_APP_KEY=client_app_key
VITE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_SIGNALING_SERVER_URL=http://127.0.0.1:8000`

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
        <code>npm install @talk-each-other/rtc-web</code>
        <CopyButton value="npm install @talk-each-other/rtc-web" />
      </div>

      <pre>{envExample}</pre>

      <div className="sdk-capability-list">
        <span>Native WebRTC</span>
        <span>Socket.IO signaling</span>
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
    appKey: 'client_app_key',
    roomId: 'room_1001',
    uid: 'web_user_42',
    token: 'client_rtc_token',
    mode: 'video',
  })
  const [stage, setStage] = useState('init')

  const stages = [
    ['init', 'Init'],
    ['auth', 'Auth'],
    ['join', 'Join'],
    ['publish', 'Publish'],
    ['leave', 'Leave'],
  ]
  const activeIndex = stages.findIndex(([id]) => id === stage)
  const generatedCode = `const rtc = new TalkEachOtherRTC({
  appKey: '${config.appKey}',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  signalingUrl: import.meta.env.VITE_SIGNALING_SERVER_URL,
})

await rtc.authenticate('${config.token}')

await rtc.joinRoom('${config.roomId}', {
  uid: '${config.uid}',
  mode: '${config.mode}',
  micEnabled: true,
  cameraEnabled: ${config.mode === 'video'},
})`

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
            <span>App Key</span>
            <input value={config.appKey} onChange={(event) => updateField('appKey', event.target.value)} />
          </label>
          <label>
            <span>Room ID</span>
            <input value={config.roomId} onChange={(event) => updateField('roomId', event.target.value)} />
          </label>
          <label>
            <span>User ID</span>
            <input value={config.uid} onChange={(event) => updateField('uid', event.target.value)} />
          </label>
          <label>
            <span>Mode</span>
            <select value={config.mode} onChange={(event) => updateField('mode', event.target.value)}>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
            </select>
          </label>
          <label className="sdk-token-field">
            <span>Token</span>
            <textarea value={config.token} onChange={(event) => updateField('token', event.target.value)} />
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
