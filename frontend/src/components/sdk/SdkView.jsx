import { useMemo, useState } from 'react'

const sdkTabs = [
  {
    id: 'web',
    label: 'Web',
    title: 'Web quickstart',
    language: 'JavaScript',
    code: `import { MingtaiRTC } from '@mingtai/rtc-web'

const rtc = new MingtaiRTC({
  appKey: 'client_app_key',
  apiBaseUrl: 'https://api.example.com/api',
  signalingUrl: 'https://signal.example.com',
})

await rtc.authenticate(clientToken)

const session = await rtc.joinRoom(roomId, {
  mode: 'video',
  micEnabled: true,
  cameraEnabled: true,
})

rtc.on('peer-joined', (peer) => {
  console.log('peer joined', peer.userId)
})

rtc.on('remote-track', ({ peer, stream }) => {
  remoteVideo.srcObject = stream
})

await rtc.leaveRoom()`,
  },
  {
    id: 'react',
    label: 'React',
    title: 'React room component',
    language: 'TSX',
    code: `import { useEffect, useRef, useState } from 'react'
import { MingtaiRTC } from '@mingtai/rtc-web'

export function LiveRoom({ roomId, token }) {
  const clientRef = useRef(null)
  const [peers, setPeers] = useState([])

  useEffect(() => {
    const rtc = new MingtaiRTC({
      appKey: import.meta.env.VITE_RTC_APP_KEY,
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
      signalingUrl: import.meta.env.VITE_SIGNALING_URL,
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
    title: 'Token exchange',
    language: 'Node',
    code: `import express from 'express'
import jwt from 'jsonwebtoken'

const app = express()

app.post('/rtc/token', requireUser, async (req, res) => {
  const payload = {
    sub: req.user.id,
    tenant_id: req.user.tenantId,
    room_id: req.body.roomId,
    scope: ['room:join', 'media:publish', 'chat:write'],
  }

  const token = jwt.sign(payload, process.env.RTC_TOKEN_SECRET, {
    expiresIn: '15m',
  })

  res.json({
    token,
    expires_in: 900,
  })
})`,
  },
  {
    id: 'events',
    label: 'Events',
    title: 'Realtime callbacks',
    language: 'JavaScript',
    code: `rtc.on('connection-state', ({ state }) => {
  console.log('rtc state', state)
})

rtc.on('peer-joined', ({ userId, name, role }) => {})
rtc.on('peer-left', ({ userId, reason }) => {})
rtc.on('remote-track', ({ peer, stream, kind }) => {})
rtc.on('track-muted', ({ peer, kind }) => {})
rtc.on('room-message', ({ id, sender, body, sentAt }) => {})
rtc.on('message-unsent', ({ id, deletedBy }) => {})
rtc.on('moderation', ({ action, targetUserId, reason }) => {})

rtc.on('error', (error) => {
  reportError(error.code, error.message)
})`,
  },
]

const flowSteps = [
  ['1', 'Create client', 'Configure app key, API URL, and signaling URL.'],
  ['2', 'Authenticate', 'Exchange your app token for an RTC session token.'],
  ['3', 'Join room', 'Validate room privacy, password, role, and media mode.'],
  ['4', 'Publish media', 'Attach microphone and camera tracks to peers.'],
  ['5', 'Subscribe', 'Render remote streams and participant state changes.'],
  ['6', 'Leave cleanly', 'Close peers and write usage logs.'],
]

const apiMethods = [
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

function SdkConfigCard() {
  const envExample = `VITE_RTC_APP_KEY=client_app_key
VITE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_SIGNALING_URL=http://127.0.0.1:8000`

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
        <code>npm install @mingtai/rtc-web</code>
        <CopyButton value="npm install @mingtai/rtc-web" />
      </div>

      <pre>{envExample}</pre>

      <div className="sdk-capability-list">
        <span>Native WebRTC</span>
        <span>Socket.IO signaling</span>
        <span>Usage logging</span>
        <span>Chat events</span>
        <span>Owner controls</span>
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
  const generatedCode = `const rtc = new MingtaiRTC({
  appKey: '${config.appKey}',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  signalingUrl: import.meta.env.VITE_SIGNALING_URL,
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
          <span className="eyebrow">Developer SDK</span>
          <h1>RTC SDK Samples</h1>
          <p>Copy-ready WebRTC room flows for web apps, React apps, backend token exchange, and realtime events.</p>
        </div>
        <div className="sdk-version-card">
          <span>SDK</span>
          <strong>v1.0 Web</strong>
          <small>Native RTC + Socket.IO</small>
        </div>
      </header>

      <SdkFlow />

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

      <SdkReference />
    </div>
  )
}
