import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest, clearSession, getToken, getUser, login as loginApi, register as registerApi } from './services/api'
import { createLocalMediaStream, stopMediaStream } from './services/media'
import { NativeRtcClient } from './services/rtcClient'
import { createSignalingSocket, emitMediaState, joinSignalingRoom, waitForSocketConnection } from './services/signaling'
import { RtcConnectionIndicator } from './components/rtc/RtcConnectionIndicator'
import { ChatPanel } from './components/rtc/ChatPanel'
import { VideoTile } from './components/rtc/VideoTile'
import { formatDuration, getInitials } from './utils/formatters'

const AdminView = lazy(() => import('./components/admin/AdminView'))
const SdkView = lazy(() => import('./components/sdk/SdkView'))

const roomTypeLabels = {
  audio: 'Voice Room',
  video: 'Video Room',
  group_audio: 'Group Voice',
  group_video: 'Group Video',
  solo_live: 'Solo Live',
  pk_live: 'PK Live',
}

const roomTypeMeta = {
  audio: { label: 'Voice Room', short: 'Voice', tone: 'tone-voice' },
  video: { label: 'Video Room', short: 'Video', tone: 'tone-video' },
  group_audio: { label: 'Group Voice', short: 'Group', tone: 'tone-voice' },
  group_video: { label: 'Group Video', short: 'Group', tone: 'tone-video' },
  solo_live: { label: 'Solo Live', short: 'Solo', tone: 'tone-live' },
  pk_live: { label: 'PK Live', short: 'PK', tone: 'tone-pk' },
}

const roomFilterOptions = [
  { value: 'all', label: 'For You' },
  { value: 'live', label: 'Live' },
  { value: 'video', label: 'Video' },
  { value: 'voice', label: 'Voice' },
  { value: 'pk', label: 'PK' },
]

const roomSortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'active', label: 'Most active' },
  { value: 'name', label: 'Name' },
  { value: 'oldest', label: 'Oldest' },
]

const privacyFilterOptions = [
  { value: 'all', label: 'All access' },
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'password', label: 'Password' },
]

const roomPrivacyOptions = privacyFilterOptions.slice(1)

const themeOptions = [
  { value: 'neon', label: 'Neon' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'studio', label: 'Studio' },
  { value: 'mint', label: 'Mint' },
]

const roomFeatureOptions = [
  { field: 'chat_enabled', label: 'Chat', detail: 'Live messages' },
  { field: 'gift_enabled', label: 'Gifts', detail: 'Reactions and gifts' },
  { field: 'screen_share_enabled', label: 'Screen share', detail: 'Presenter tools' },
  { field: 'ai_security_enabled', label: 'AI guard', detail: 'Moderation layer' },
]

const rtcModeOptions = [
  { value: 'audio', label: 'Audio', detail: 'Mic only' },
  { value: 'video', label: 'Video', detail: 'Mic + camera' },
]

const rtcConnectSteps = [
  { value: 'ready', label: 'Ready' },
  { value: 'backend', label: 'Room' },
  { value: 'media', label: 'Media' },
  { value: 'signaling', label: 'Signal' },
  { value: 'connected', label: 'Live' },
]

const defaultRoomForm = {
  name: 'Enterprise Live Room',
  description: 'A hosted RTC room for live video, voice, chat, and collaboration.',
  room_type: 'video',
  privacy_type: 'public',
  password: '',
  max_mic_count: 8,
  theme: 'neon',
  chat_enabled: true,
  gift_enabled: true,
  screen_share_enabled: true,
  ai_security_enabled: false,
}

function getRoomMeta(roomType) {
  return roomTypeMeta[roomType] || { label: roomType || 'Room', short: 'Live', tone: 'tone-live' }
}

function getRoomTags(room) {
  const tags = []
  if (room.chat_enabled) tags.push('Chat')
  if (room.gift_enabled) tags.push('Gifts')
  if (room.screen_share_enabled) tags.push('Share')
  if (room.ai_security_enabled) tags.push('AI Guard')
  return tags.length ? tags : ['Live']
}

function roomMatchesFilter(room, filter) {
  if (filter === 'all') return true
  if (filter === 'live') return ['solo_live', 'pk_live', 'group_video'].includes(room.room_type)
  if (filter === 'video') return ['video', 'group_video', 'solo_live', 'pk_live'].includes(room.room_type)
  if (filter === 'voice') return ['audio', 'group_audio'].includes(room.room_type)
  if (filter === 'pk') return room.room_type === 'pk_live'
  return true
}

function roomSupportsVideo(roomType) {
  return ['video', 'group_video', 'solo_live', 'pk_live'].includes(roomType)
}

function defaultRtcModeForRoom(room) {
  return roomSupportsVideo(room?.room_type) ? 'video' : 'audio'
}

function normalizeRtcMode(value, room) {
  const nextMode = value === 'audio' ? 'audio' : 'video'
  if (room && !roomSupportsVideo(room.room_type)) return 'audio'
  return nextMode
}

function normalizeMediaMode(value) {
  return ['real', 'auto', 'mock'].includes(value) ? value : 'real'
}

function getInitialMediaMode() {
  const configuredMode = normalizeMediaMode(import.meta.env.VITE_MEDIA_MODE)
  if (import.meta.env.VITE_MEDIA_MODE) return configuredMode
  return 'real'
}

function formatRoomDate(value) {
  if (!value) return 'New'

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return 'New'
  }
}

function buildRoomsPath({ page, search, filter, privacy, sort }) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: '24',
    type: filter,
    privacy,
    sort,
  })

  const searchTerm = search.trim()
  if (searchTerm) params.set('q', searchTerm)

  return `/rooms?${params.toString()}`
}

function validateRoomForm(form) {
  const errors = {}
  const name = form.name.trim()
  const password = form.password.trim()
  const maxMicCount = Number(form.max_mic_count)

  if (!name) errors.name = 'Room name is required.'
  if (name && name.length < 3) errors.name = 'Use at least 3 characters.'
  if (name.length > 150) errors.name = 'Keep the room name under 150 characters.'
  if (form.description.length > 700) errors.description = 'Keep the description under 700 characters.'
  if (!Number.isInteger(maxMicCount) || maxMicCount < 1 || maxMicCount > 16) {
    errors.max_mic_count = 'Choose 1 to 16 mic seats.'
  }
  if (form.privacy_type === 'password' && password.length < 4) {
    errors.password = 'Use at least 4 characters.'
  }

  return errors
}

function roomFormPayload(form) {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    room_type: form.room_type,
    privacy_type: form.privacy_type,
    password: form.privacy_type === 'password' ? form.password.trim() : undefined,
    max_mic_count: Number(form.max_mic_count),
    theme: form.theme,
    chat_enabled: form.chat_enabled,
    gift_enabled: form.gift_enabled,
    screen_share_enabled: form.screen_share_enabled,
    ai_security_enabled: form.ai_security_enabled,
  }
}

function isPasswordJoinError(error) {
  return error?.status === 403 && String(error.message || '').toLowerCase().includes('password')
}

function peerMediaFromSignal(user) {
  const rtcMode = user?.rtcMode === 'audio' ? 'audio' : 'video'
  return {
    userId: user?.userId || null,
    userName: user?.userName || 'Remote User',
    rtcMode,
    micOn: user?.micEnabled !== false,
    cameraOn: rtcMode === 'video' && user?.cameraEnabled !== false,
  }
}

function peerMediaMapFromUsers(users = []) {
  return users.reduce((next, user) => {
    if (user?.socketId) next[user.socketId] = peerMediaFromSignal(user)
    return next
  }, {})
}



function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('Test User')
  const [email, setEmail] = useState('admin@rtc.com')
  const [password, setPassword] = useState('Admin@123456')
  const [status, setStatus] = useState('Use admin@rtc.com / Admin@123456 for the seeded admin account.')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)

    try {
      if (mode === 'register') {
        setStatus('Creating account...')
        await registerApi(name, email, password)
        setStatus('Account created. Logging in...')
      } else {
        setStatus('Logging in...')
      }

      const data = await loginApi(email, password)
      onLogin(data.access_token, data.user)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-showcase" aria-label="Live room preview">
        <div className="showcase-topbar">
          <div className="app-mark">BC</div>
          <div>
            <strong>BuzzCast RTC</strong>
            <span>Enterprise live lobby</span>
          </div>
          <div className="online-pill"><span></span> Online</div>
        </div>

        <div className="phone-preview">
          <div className="phone-toolbar">
            <button type="button" className="preview-tab active">Hot</button>
            <button type="button" className="preview-tab">Nearby</button>
            <button type="button" className="preview-tab">New</button>
          </div>

          <div className="preview-live-card">
            <div className="live-chip"><span></span> LIVE</div>
            <div className="preview-host">
              <div className="preview-avatar">M</div>
              <div>
                <strong>Mingtai Studio</strong>
                <span>4 hosts on stage</span>
              </div>
            </div>
            <div className="preview-meter">
              <span>2.4K watching</span>
              <span>Native RTC</span>
            </div>
          </div>

          <div className="mini-live-grid">
            <div className="mini-live-card tone-video">
              <div>Video Room</div>
              <strong>Daily Standup</strong>
              <span>8 seats</span>
            </div>
            <div className="mini-live-card tone-voice">
              <div>Voice Room</div>
              <strong>Support Lounge</strong>
              <span>12 seats</span>
            </div>
          </div>
        </div>

        <div className="showcase-stats">
          <div><span>Latency</span><strong>Low</strong></div>
          <div><span>Rooms</span><strong>Live</strong></div>
          <div><span>Mode</span><strong>{import.meta.env.VITE_MEDIA_MODE || 'Real'}</strong></div>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-heading">
          <span className="eyebrow">Welcome back</span>
          <h1>Enter the live lobby</h1>
          <p>Sign in with the seeded admin account or create a host profile.</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')} type="button">Login</button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')} type="button">Register</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <label>Name</label>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </>
          )}

          <label>Email</label>
          <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />

          <label>Password</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />

          <button className="primary-button full-width" disabled={submitting} type="submit">
            {submitting ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>

        <div className="status-box">{status}</div>
      </section>
    </main>
  )
}

function Sidebar({ user, currentView, onView, onLogout }) {
  return (
    <aside className="sidebar glass-card">
      <div className="logo-row">
        <div className="logo-mark">M</div>
        <div>
          <strong>Mingtai RTC</strong>
          <span>Enterprise Web</span>
        </div>
      </div>

      <button className={currentView === 'rooms' ? 'nav-item active' : 'nav-item'} onClick={() => onView('rooms')}>Rooms</button>
      <button className={currentView === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => onView('admin')}>Admin Dashboard</button>
      <button className={currentView === 'sdk' ? 'nav-item active' : 'nav-item'} onClick={() => onView('sdk')}>SDK Flow</button>

      <div className="sidebar-user">
        <div className="avatar">{user?.name?.slice(0, 1)?.toUpperCase() || 'U'}</div>
        <div>
          <strong>{user?.name || 'User'}</strong>
          <span>{user?.email}</span>
        </div>
      </div>

      <button className="nav-item danger" onClick={onLogout}>Logout</button>
    </aside>
  )
}

function RoomCard({ room, isSelected, onSelect, onJoin }) {
  const meta = getRoomMeta(room.room_type)
  const tags = getRoomTags(room)
  const initial = room.name?.slice(0, 1)?.toUpperCase() || 'R'
  const needsPassword = room.privacy_type === 'password'
  const isPrivate = room.privacy_type === 'private'

  return (
    <article className={`room-card ${meta.tone}${isSelected ? ' selected' : ''}`}>
      <div className="room-cover">
        <div className="live-chip"><span></span> LIVE</div>
        <div className="room-type-chip">{needsPassword ? 'Locked' : isPrivate ? 'Private' : meta.short}</div>
        <div className="room-cover-content">
          <div className="room-avatar large">{initial}</div>
          <div>
            <span>{room.owner_name || 'Room host'}</span>
            <strong>{meta.label}</strong>
          </div>
        </div>
      </div>
      <div className="room-body">
        <div className="room-title-row">
          <div>
            <h3>#{room.id} - {room.name}</h3>
            <p>{room.privacy_type} room - {room.max_mic_count} mic seats - {room.status}</p>
          </div>
          <div className="room-avatar">{initial}</div>
        </div>
        {room.description && <p className="room-description">{room.description}</p>}
        <div className="room-stat-row">
          <span>{room.active_participants || 0} active</span>
          <span>{formatRoomDate(room.created_at)}</span>
        </div>
        <div className="room-tags">
          {tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        <div className="room-actions">
          <button type="button" className={isSelected ? 'selected-button' : ''} onClick={() => onSelect(room)}>
            {isSelected ? 'Selected' : 'Select'}
          </button>
          <button type="button" className="primary-button" onClick={() => onJoin(room)}>
            {needsPassword ? 'Unlock' : 'Open'}
          </button>
        </div>
      </div>
    </article>
  )
}

function RoomsView({ onEnterRoom }) {
  const [rooms, setRooms] = useState([])
  const [roomMeta, setRoomMeta] = useState({ page: 1, per_page: 24, total: 0, total_pages: 1 })
  const [status, setStatus] = useState('Ready')
  const [roomId, setRoomId] = useState('')
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [joinPassword, setJoinPassword] = useState('')
  const [joinRtcMode, setJoinRtcMode] = useState('video')
  const [roomForm, setRoomForm] = useState(defaultRoomForm)
  const [formErrors, setFormErrors] = useState({})
  const [createdRoom, setCreatedRoom] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [privacyFilter, setPrivacyFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [creating, setCreating] = useState(false)
  const [openingRoom, setOpeningRoom] = useState(false)

  const featuredRoom = rooms[0]
  const selectedRoomNeedsPassword = selectedRoom?.privacy_type === 'password' && roomId === String(selectedRoom.id)
  const selectedRoomSupportsVideo = !selectedRoom || roomSupportsVideo(selectedRoom.room_type)
  const canJoinRoom = Boolean(roomId.trim()) && !openingRoom && (!selectedRoomNeedsPassword || Boolean(joinPassword.trim()))

  function updateRoomForm(field, value) {
    setRoomForm((previous) => ({ ...previous, [field]: value }))
    setFormErrors((previous) => {
      if (!previous[field]) return previous
      const next = { ...previous }
      delete next[field]
      return next
    })
  }

  function selectRoom(room) {
    setSelectedRoom(room)
    setRoomId(String(room.id))
    setJoinPassword('')
    setJoinRtcMode(defaultRtcModeForRoom(room))
    setStatus(room.privacy_type === 'password' ? `Room #${room.id} needs a password before joining.` : `Room #${room.id} selected.`)
  }

  function clearSelectedRoomIfManual(value) {
    setRoomId(value)
    if (selectedRoom && value !== String(selectedRoom.id)) {
      setSelectedRoom(null)
      setJoinPassword('')
    }
  }

  function updateJoinRtcMode(value) {
    setJoinRtcMode(normalizeRtcMode(value, selectedRoom))
  }

  async function loadRooms({
    page = roomMeta.page,
    searchValue = search,
    filterValue = filter,
    privacyValue = privacyFilter,
    sortValue = sort,
    quiet = false,
  } = {}) {
    setLoadingRooms(true)
    try {
      if (!quiet) setStatus('Loading rooms...')
      const data = await apiRequest(buildRoomsPath({
        page,
        search: searchValue,
        filter: filterValue,
        privacy: privacyValue,
        sort: sortValue,
      }))
      const meta = data.rooms?.meta || { page, per_page: 24, total: 0, total_pages: 1 }
      setRooms(data.rooms?.data || [])
      setRoomMeta(meta)
      setStatus(meta.total === 1 ? 'Showing 1 room' : `Showing ${meta.total} rooms`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoadingRooms(false)
    }
  }

  async function createRoom(event) {
    event.preventDefault()
    const nextErrors = validateRoomForm(roomForm)
    setFormErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      setStatus('Please fix the highlighted room details.')
      return
    }

    const payload = roomFormPayload(roomForm)
    setCreating(true)
    try {
      setStatus('Creating room...')
      const data = await apiRequest('/rooms', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setRoomId(String(data.room.id))
      setSelectedRoom(data.room)
      setJoinPassword(payload.password || '')
      setJoinRtcMode(defaultRtcModeForRoom(data.room))
      setCreatedRoom(data.room)
      setStatus(`Created room #${data.room.id}`)
      setSearch('')
      setFilter('all')
      setPrivacyFilter('all')
      setSort('newest')
      updateRoomForm('password', '')
      await loadRooms({
        page: 1,
        searchValue: '',
        filterValue: 'all',
        privacyValue: 'all',
        sortValue: 'newest',
        quiet: true,
      })
    } catch (error) {
      if (error.errors && Object.keys(error.errors).length) setFormErrors(error.errors)
      setStatus(error.message)
    } finally {
      setCreating(false)
    }
  }

  async function joinSelectedRoom() {
    if (!roomId.trim()) return
    if (selectedRoomNeedsPassword && !joinPassword.trim()) {
      setStatus('Enter the room password before joining.')
      return
    }

    try {
      setOpeningRoom(true)
      setStatus('Checking room access...')
      const roomData = selectedRoom && roomId.trim() === String(selectedRoom.id)
        ? { room: selectedRoom }
        : await apiRequest(`/rooms/${roomId.trim()}`)
      const targetRoom = roomData.room

      if (targetRoom?.privacy_type === 'password' && !joinPassword.trim()) {
        setSelectedRoom(targetRoom)
        setJoinRtcMode(defaultRtcModeForRoom(targetRoom))
        setStatus('Enter the room password before opening the RTC console.')
        return
      }

      onEnterRoom(roomId.trim(), {
        password: joinPassword.trim(),
        room: targetRoom,
        rtcMode: normalizeRtcMode(joinRtcMode, targetRoom),
        autoConnect: false,
      })
    } catch (error) {
      setStatus(error.message)
    } finally {
      setOpeningRoom(false)
    }
  }

  function joinRoomFromCard(room) {
    if (room.privacy_type === 'password') {
      selectRoom(room)
      return
    }

    onEnterRoom(String(room.id), { room, rtcMode: defaultRtcModeForRoom(room), autoConnect: false })
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadRooms({
        page: 1,
        searchValue: search,
        filterValue: filter,
        privacyValue: privacyFilter,
        sortValue: sort,
        quiet: true,
      })
    }, search.trim() ? 300 : 0)

    return () => clearTimeout(timeout)
  }, [search, filter, privacyFilter, sort])

  return (
    <div className="view-stack">
      <header className="lobby-hero">
        <div className="lobby-title">
          <span className="eyebrow">Live Discovery</span>
          <h1>Room Lobby</h1>
          <p>Browse live rooms, start a broadcast, or jump into a session.</p>
        </div>
        <div className="lobby-feature">
          <span>Now featuring</span>
          <strong>{featuredRoom?.name || 'Create the first live room'}</strong>
          <button className="primary-button" onClick={() => loadRooms({ page: roomMeta.page })} disabled={loadingRooms}>Refresh</button>
        </div>
      </header>

      <div className="lobby-command-bar">
        <label className="sr-only" htmlFor="room-search">Search rooms</label>
        <input id="room-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rooms, types, or IDs" />
        <div className="filter-tabs" role="tablist" aria-label="Room filters">
          {roomFilterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? 'filter-tab active' : 'filter-tab'}
              onClick={() => setFilter(option.value)}
              aria-pressed={filter === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="room-tools">
          <label className="sr-only" htmlFor="privacy-filter">Privacy</label>
          <select id="privacy-filter" value={privacyFilter} onChange={(event) => setPrivacyFilter(event.target.value)}>
            {privacyFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label className="sr-only" htmlFor="room-sort">Sort rooms</label>
          <select id="room-sort" value={sort} onChange={(event) => setSort(event.target.value)}>
            {roomSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      <div className="status-bar"><strong>Status:</strong> {status}</div>

      <section className="metrics-grid">
        <div className="metric"><span>Total Rooms</span><strong>{roomMeta.total}</strong></div>
        <div className="metric"><span>This Page</span><strong>{rooms.length}</strong></div>
        <div className="metric"><span>Selected</span><strong>{roomId || '-'}</strong></div>
        <div className="metric"><span>Join Mode</span><strong>{joinRtcMode}</strong></div>
      </section>

      <section className="split-grid">
        <form className="form-card create-room-panel" onSubmit={createRoom}>
          <div className="form-title-row">
            <div>
              <span className="eyebrow">Host tools</span>
              <h2>Create Room</h2>
            </div>
            <span className="form-badge">Go live</span>
          </div>
          <label>Room Name</label>
          <input value={roomForm.name} onChange={(event) => updateRoomForm('name', event.target.value)} />
          {formErrors.name && <small className="form-error">{formErrors.name}</small>}

          <label>Description</label>
          <textarea value={roomForm.description} onChange={(event) => updateRoomForm('description', event.target.value)} rows={3} />
          {formErrors.description && <small className="form-error">{formErrors.description}</small>}

          <label>Room Type</label>
          <div className="type-grid">
            {Object.entries(roomTypeLabels).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={roomForm.room_type === value ? 'type-option active' : 'type-option'}
                onClick={() => updateRoomForm('room_type', value)}
              >
                <span>{getRoomMeta(value).short}</span>
                <strong>{label}</strong>
              </button>
            ))}
          </div>
          {formErrors.room_type && <small className="form-error">{formErrors.room_type}</small>}

          <label>Privacy</label>
          <div className="privacy-tabs">
            {roomPrivacyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={roomForm.privacy_type === option.value ? 'privacy-tab active' : 'privacy-tab'}
                onClick={() => updateRoomForm('privacy_type', option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {formErrors.privacy_type && <small className="form-error">{formErrors.privacy_type}</small>}

          {roomForm.privacy_type === 'password' && (
            <>
              <label>Password</label>
              <input type="password" value={roomForm.password} onChange={(event) => updateRoomForm('password', event.target.value)} autoComplete="new-password" />
              {formErrors.password && <small className="form-error">{formErrors.password}</small>}
            </>
          )}

          <div className="field-row">
            <div>
              <label>Mic Seats</label>
              <input type="number" min="1" max="16" value={roomForm.max_mic_count} onChange={(event) => updateRoomForm('max_mic_count', event.target.value)} />
            </div>
            <div>
              <label>Theme</label>
              <select value={roomForm.theme} onChange={(event) => updateRoomForm('theme', event.target.value)}>
                {themeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <input className="mic-range" type="range" min="1" max="16" value={roomForm.max_mic_count} onChange={(event) => updateRoomForm('max_mic_count', event.target.value)} />
          {formErrors.max_mic_count && <small className="form-error">{formErrors.max_mic_count}</small>}

          <div className="toggle-grid">
            {roomFeatureOptions.map((option) => (
              <label className="toggle-row" key={option.field}>
                <input
                  type="checkbox"
                  checked={Boolean(roomForm[option.field])}
                  onChange={(event) => updateRoomForm(option.field, event.target.checked)}
                />
                <span className="toggle-switch"></span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </span>
              </label>
            ))}
          </div>

          <button className="primary-button full-width" disabled={creating} type="submit">
            {creating ? 'Creating...' : 'Create Room'}
          </button>

          {createdRoom && (
            <div className="creation-summary">
              <span>Created #{createdRoom.id}</span>
              <strong>{createdRoom.name}</strong>
              <button
                type="button"
                onClick={() => onEnterRoom(String(createdRoom.id), {
                  password: joinPassword.trim(),
                  room: createdRoom,
                  rtcMode: defaultRtcModeForRoom(createdRoom),
                  autoConnect: false,
                })}
              >
                Open Console
              </button>
            </div>
          )}
        </form>

        <div className="form-card join-room-panel">
          <div className="form-title-row">
            <div>
              <span className="eyebrow">Quick join</span>
              <h2>Join Room</h2>
            </div>
            <span className="form-badge">RTC</span>
          </div>
          <div className={selectedRoom ? 'selected-room-summary' : 'selected-room-summary empty-selection'}>
            {selectedRoom ? (
              <>
                <span>Selected room</span>
                <strong>#{selectedRoom.id} - {selectedRoom.name}</strong>
                <small>{getRoomMeta(selectedRoom.room_type).label} - {selectedRoom.privacy_type}</small>
              </>
            ) : (
              <>
                <span>Selected room</span>
                <strong>None</strong>
                <small>Choose a room card or enter an ID.</small>
              </>
            )}
          </div>
          <label>RTC Mode</label>
          <div className="mode-selector">
            {rtcModeOptions.map((option) => {
              const disabled = option.value === 'video' && !selectedRoomSupportsVideo

              return (
                <button
                  key={option.value}
                  type="button"
                  className={joinRtcMode === option.value ? 'mode-option active' : 'mode-option'}
                  onClick={() => updateJoinRtcMode(option.value)}
                  disabled={disabled}
                >
                  <strong>{option.label}</strong>
                  <span>{disabled ? 'Unavailable' : option.detail}</span>
                </button>
              )
            })}
          </div>
          <label>Room ID</label>
          <input value={roomId} onChange={(event) => clearSelectedRoomIfManual(event.target.value)} placeholder="Select room or enter ID" />
          <label>Room Password</label>
          <input type="password" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} placeholder="Only needed for locked rooms" autoComplete="current-password" />
          <button className="primary-button full-width" onClick={joinSelectedRoom} disabled={!canJoinRoom}>{openingRoom ? 'Opening...' : 'Open RTC Console'}</button>
          <div className="feature-list">
            <span>Mic/Cam</span><span>Chat</span><span>Gifts</span><span>Effects</span><span>Screen Share</span><span>Usage Logs</span>
          </div>
        </div>
      </section>

      <section className="room-list-section">
        <div className="room-list-header">
          <div>
            <span className="eyebrow">Room list</span>
            <h2>Live rooms</h2>
          </div>
          <span className="room-count">Page {roomMeta.page} of {roomMeta.total_pages}</span>
        </div>

        {loadingRooms && rooms.length === 0 ? (
          <div className="empty">Loading rooms...</div>
        ) : (
          <div className="room-grid">
            {rooms.length === 0 ? <div className="empty">No matching rooms yet. Create one or change the filters.</div> : rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                isSelected={roomId === String(room.id)}
                onSelect={selectRoom}
                onJoin={joinRoomFromCard}
              />
            ))}
          </div>
        )}

        <div className="pagination-row">
          <button type="button" onClick={() => loadRooms({ page: Math.max(1, roomMeta.page - 1) })} disabled={loadingRooms || roomMeta.page <= 1}>Previous</button>
          <span>{roomMeta.total} total rooms</span>
          <button type="button" onClick={() => loadRooms({ page: Math.min(roomMeta.total_pages, roomMeta.page + 1) })} disabled={loadingRooms || roomMeta.page >= roomMeta.total_pages}>Next</button>
        </div>
      </section>
    </div>
  )
}


function OwnerControlsPanel({ roomId, room, user, joined, signalingRoom, socket, onRoomUpdate }) {
  const [controls, setControls] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Controls ready')
  const [savingFields, setSavingFields] = useState({})
  const [moderating, setModerating] = useState({})
  const [privacyPassword, setPrivacyPassword] = useState('')

  const activeRoom = controls?.room || room || {}
  const participants = controls?.participants || []
  const role = controls?.role || (activeRoom.owner_id === user?.id ? 'owner' : 'end_user')
  const canManage = Boolean(controls?.can_manage)

  async function loadControls({ quiet = false } = {}) {
    if (!roomId) return

    try {
      setLoading(true)
      if (!quiet) setStatus('Loading controls...')
      const data = await apiRequest(`/rooms/${roomId}/controls`)
      setControls(data.controls)
      if (data.controls?.room) onRoomUpdate(data.controls.room)
      setStatus(data.controls?.can_manage ? 'Owner controls active' : 'Viewer mode')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function updateControl(field, value) {
    if (!canManage) return

    try {
      setSavingFields((previous) => ({ ...previous, [field]: true }))
      setStatus('Saving room control...')
      const data = await apiRequest(`/rooms/${roomId}/controls`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      })
      setControls(data.controls)
      if (data.controls?.room) onRoomUpdate(data.controls.room)
      setStatus('Room control saved')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSavingFields((previous) => {
        const next = { ...previous }
        delete next[field]
        return next
      })
    }
  }

  async function updatePrivacy(value) {
    if (!canManage) return

    if (value === 'password' && activeRoom.privacy_type !== 'password' && privacyPassword.trim().length < 4) {
      setStatus('Enter a password of at least 4 characters before locking the room.')
      return
    }

    const payload = {
      privacy_type: value,
      ...(value === 'password' && privacyPassword.trim() ? { password: privacyPassword.trim() } : {}),
    }

    try {
      setSavingFields((previous) => ({ ...previous, privacy_type: true }))
      setStatus('Saving privacy...')
      const data = await apiRequest(`/rooms/${roomId}/controls`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setControls(data.controls)
      if (data.controls?.room) onRoomUpdate(data.controls.room)
      setPrivacyPassword('')
      setStatus(value === 'password' ? 'Room is password protected' : `Room privacy set to ${value}`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSavingFields((previous) => {
        const next = { ...previous }
        delete next.privacy_type
        return next
      })
    }
  }

  async function updatePassword() {
    if (!canManage) return
    if (privacyPassword.trim().length < 4) {
      setStatus('Room password must be at least 4 characters.')
      return
    }

    try {
      setSavingFields((previous) => ({ ...previous, password: true }))
      setStatus('Updating password...')
      const data = await apiRequest(`/rooms/${roomId}/controls`, {
        method: 'PATCH',
        body: JSON.stringify({ password: privacyPassword.trim() }),
      })
      setControls(data.controls)
      setPrivacyPassword('')
      setStatus('Room password updated')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSavingFields((previous) => {
        const next = { ...previous }
        delete next.password
        return next
      })
    }
  }

  async function moderateParticipant(participant, action) {
    if (!canManage || !participant?.user_id) return

    const key = `${participant.user_id}-${action}`
    const endpoint = action === 'mute_mic'
      ? `/rooms/${roomId}/participants/${participant.user_id}/mute`
      : action === 'kick'
        ? `/rooms/${roomId}/participants/${participant.user_id}/kick`
        : action === 'ban'
          ? `/rooms/${roomId}/participants/${participant.user_id}/ban`
          : `/rooms/${roomId}/participants/${participant.user_id}/moderation`
    const body = action === 'ban'
      ? { ban_type: 'permanent', reason: 'Banned from owner controls.' }
      : action === 'disable_camera'
        ? { action }
        : {}

    try {
      setModerating((previous) => ({ ...previous, [key]: true }))
      setStatus('Applying moderation...')
      const data = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      })

      setControls(data.controls)
      setStatus('Moderation action applied')

      if (socket && signalingRoom) {
        socket.timeout(3000).emit(
          'moderation-action',
          {
            roomId: signalingRoom,
            targetUserId: participant.user_id,
            action: data.action || action,
            participant: data.participant,
            ban: data.ban,
          },
          (error, response) => {
            if (error || !response?.ok) setStatus('Moderation saved. Realtime sync will resume when signaling reconnects.')
          }
        )
      }
    } catch (error) {
      setStatus(error.message)
    } finally {
      setModerating((previous) => {
        const next = { ...previous }
        delete next[key]
        return next
      })
    }
  }

  useEffect(() => {
    loadControls({ quiet: true })
  }, [roomId, joined])

  return (
    <section className="glass-card control-panel">
      <div className="control-panel-header">
        <div>
          <span className="eyebrow">Room Ops</span>
          <h3>Owner Controls</h3>
        </div>
        <span className={canManage ? 'role-badge manager' : 'role-badge'}>{role}</span>
      </div>

      <div className="control-summary">
        <div><span>Active</span><strong>{participants.length}</strong></div>
        <div><span>Seats</span><strong>{activeRoom.max_mic_count || 0}</strong></div>
        <div><span>Privacy</span><strong>{activeRoom.privacy_type || 'public'}</strong></div>
      </div>

      <div className="control-section privacy-control">
        <div className="control-section-title">
          <strong>Access</strong>
          <span>{activeRoom.is_password_protected ? 'Password required' : activeRoom.privacy_type || 'public'}</span>
        </div>
        <div className="privacy-control-grid">
          <label>
            <span>Privacy</span>
            <select value={activeRoom.privacy_type || 'public'} onChange={(event) => updatePrivacy(event.target.value)} disabled={!canManage || Boolean(savingFields.privacy_type)}>
              {roomPrivacyOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={privacyPassword}
              onChange={(event) => setPrivacyPassword(event.target.value)}
              placeholder={activeRoom.privacy_type === 'password' ? 'Set new password' : 'Required for password mode'}
              disabled={!canManage || Boolean(savingFields.privacy_type || savingFields.password)}
              autoComplete="new-password"
            />
          </label>
          <button type="button" onClick={updatePassword} disabled={!canManage || activeRoom.privacy_type !== 'password' || privacyPassword.trim().length < 4 || Boolean(savingFields.password)}>
            {savingFields.password ? 'Saving' : 'Update Password'}
          </button>
        </div>
      </div>

      <div className="control-section">
        <div className="control-section-title">
          <strong>Room Settings</strong>
          <button type="button" onClick={() => loadControls()} disabled={loading}>{loading ? 'Loading' : 'Refresh'}</button>
        </div>
        <div className="owner-toggle-grid">
          {roomFeatureOptions.map((option) => (
            <label className="owner-toggle" key={option.field}>
              <input
                type="checkbox"
                checked={Boolean(activeRoom[option.field])}
                onChange={(event) => updateControl(option.field, event.target.checked)}
                disabled={!canManage || Boolean(savingFields[option.field])}
              />
              <span className="toggle-switch"></span>
              <span>
                <strong>{option.label}</strong>
                <small>{savingFields[option.field] ? 'Saving...' : option.detail}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="control-section compact-controls">
        <label>
          <span>Theme</span>
          <select value={activeRoom.theme || 'neon'} onChange={(event) => updateControl('theme', event.target.value)} disabled={!canManage || Boolean(savingFields.theme)}>
            {themeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Mic Seats</span>
          <input
            type="number"
            min="1"
            max="16"
            value={activeRoom.max_mic_count || 1}
            onChange={(event) => updateControl('max_mic_count', event.target.value)}
            disabled={!canManage || Boolean(savingFields.max_mic_count)}
          />
        </label>
      </div>

      <div className="control-section">
        <div className="control-section-title">
          <strong>Participants</strong>
          <span>{canManage ? 'Live actions' : 'Read only'}</span>
        </div>

        <div className="participant-list">
          {participants.length === 0 ? (
            <div className="empty-control">No active participants yet.</div>
          ) : participants.map((participant) => {
            const isSelf = participant.user_id === user?.id
            const muteKey = `${participant.user_id}-mute_mic`
            const cameraKey = `${participant.user_id}-disable_camera`
            const kickKey = `${participant.user_id}-kick`
            const banKey = `${participant.user_id}-ban`
            const actionsDisabled = !canManage || isSelf

            return (
              <article className="participant-row" key={participant.id}>
                <div className="participant-avatar">{getInitials(participant.user_name)}</div>
                <div className="participant-main">
                  <div className="participant-name-row">
                    <strong>{isSelf ? 'You' : participant.user_name}</strong>
                    <span>{participant.role_in_room}</span>
                  </div>
                  <div className="participant-state-row">
                    <span className={participant.mic_enabled ? 'mini-state on' : 'mini-state off'}>{participant.mic_enabled ? 'Mic' : 'Muted'}</span>
                    <span className={participant.camera_enabled ? 'mini-state on' : 'mini-state off'}>{participant.camera_enabled ? 'Cam' : 'Cam off'}</span>
                    <span>{participant.connection_status}</span>
                    <span>{formatDuration(participant.duration_seconds)}</span>
                  </div>
                </div>
                <div className="participant-actions">
                  <button type="button" onClick={() => moderateParticipant(participant, 'mute_mic')} disabled={actionsDisabled || !participant.mic_enabled || Boolean(moderating[muteKey])}>Mute</button>
                  <button type="button" onClick={() => moderateParticipant(participant, 'disable_camera')} disabled={actionsDisabled || !participant.camera_enabled || Boolean(moderating[cameraKey])}>Cam</button>
                  <button type="button" className="danger-mini" onClick={() => moderateParticipant(participant, 'kick')} disabled={actionsDisabled || Boolean(moderating[kickKey])}>Kick</button>
                  <button type="button" className="danger-mini" onClick={() => moderateParticipant(participant, 'ban')} disabled={actionsDisabled || Boolean(moderating[banKey])}>Ban</button>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <div className="control-status">{status}</div>
    </section>
  )
}

function ViewFallback({ label }) {
  return <div className="status-bar glass-card"><strong>Loading:</strong> {label}</div>
}

function LiveRoomView({ roomId, roomPassword = '', initialRoom = null, initialRtcMode = 'video', autoConnect = false, user, onBack }) {
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
  const autoConnectAttemptedRef = useRef(false)
  const socketRef = useRef(null)
  const rtcRef = useRef(null)
  const streamRef = useRef(null)
  const activeRoomIdRef = useRef(null)
  const signalingRoomRef = useRef(null)
  const joinedRef = useRef(false)

  const remoteList = useMemo(() => Object.entries(remoteStreams), [remoteStreams])
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

  async function joinRoom() {
    let backendJoined = false

    try {
      if (joined || joining) return
      setJoining(true)
      setJoined(false)
      setConnectAttempted(true)
      setConnectionIssue('')
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

      setConnectStep('signaling')
      setSignalingState('connecting')
      setStatus('Connecting to signaling...')
      const socket = createSignalingSocket()
      socketRef.current = socket

      const rtcClient = new NativeRtcClient({
        socket,
        localStream: media.stream,
        onRemoteStream: (remoteSocketId, remoteStream) => setRemoteStreams((previous) => ({ ...previous, [remoteSocketId]: remoteStream })),
        onPeerState: (remoteSocketId, state) => {
          setPeerStates((previous) => ({ ...previous, [remoteSocketId]: state }))
          if (state === 'failed') setConnectionIssue(`Peer ${remoteSocketId.slice(0, 6)} connection failed.`)
        },
      })
      rtcRef.current = rtcClient

      socket.on('connect', () => {
        if (socketRef.current === socket) {
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

      socket.on('existing-users', async ({ users }) => {
        const existingUsers = Array.isArray(users) ? users : []
        setSignalingPeerCount(existingUsers.length)
        setPeerMediaStates(peerMediaMapFromUsers(existingUsers))
        if (!existingUsers.length) return

        setStatus(`Negotiating ${existingUsers.length} peer connection(s)...`)
        for (const remoteUser of existingUsers) {
          try {
            await rtcClient.createOffer(remoteUser.socketId)
          } catch (error) {
            setConnectionIssue(`Peer negotiation failed: ${error.message}`)
            setStatus(`Peer negotiation failed: ${error.message}`)
          }
        }
      })

      socket.on('user-joined', (payload) => {
        const { socketId } = payload
        setSignalingPeerCount((count) => count + 1)
        setPeerMediaStates((previous) => ({ ...previous, [socketId]: peerMediaFromSignal(payload) }))
        setStatus(`Peer joined: ${socketId.slice(0, 6)}`)
      })
      socket.on('webrtc-offer', async ({ fromSocketId, offer }) => {
        try {
          await rtcClient.handleOffer(fromSocketId, offer)
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

      const peerCount = Array.isArray(signalingJoin.users) ? signalingJoin.users.length : 0
      setSignalingPeerCount(peerCount)
      setPeerMediaStates(peerMediaMapFromUsers(signalingJoin.users || []))
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
            <p>{session?.signaling_room || 'Not connected'} · {room?.room_type || 'video'}</p>
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
          <div className="stage-toolbar">
            <span>{rtcMode === 'audio' ? 'Native WebRTC Audio' : 'Native WebRTC Video'}</span>
            <span>{remoteList.length} remote peer(s)</span>
          </div>
          <div className="video-grid">
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
            {remoteList.length === 0 ? (
              <VideoTile label="Waiting for remote users" />
            ) : remoteList.map(([socketId, stream]) => {
              const mediaState = peerMediaStates[socketId] || {}
              const remoteLabel = `${mediaState.userName || `Remote ${socketId.slice(0, 6)}`} - ${peerStates[socketId] || 'connecting'}`

              return (
                <VideoTile
                  key={socketId}
                  stream={stream}
                  label={remoteLabel}
                  micOn={mediaState.micOn !== false}
                  cameraOn={mediaState.cameraOn !== false}
                  rtcMode={mediaState.rtcMode || 'video'}
                  showMediaState
                />
              )
            })}
          </div>

          <div className="mic-seat-row">
            {Array.from({ length: 8 }).map((_, index) => (
              <div className="mic-seat" key={index}>
                <div>{index + 1}</div><span>Mic {index + 1}</span>
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
            <button className={micOn ? 'media-control-button active' : 'media-control-button muted'} onClick={toggleMic} disabled={joining || mediaUpdating.mic}>
              <span className="control-glyph mic"></span>
              <span>{mediaUpdating.mic ? 'Saving...' : micOn ? 'Mute Mic' : 'Unmute Mic'}</span>
            </button>
            <button className={cameraOn ? 'media-control-button active' : 'media-control-button muted'} onClick={toggleCamera} disabled={joining || mediaUpdating.camera || rtcMode === 'audio'}>
              <span className="control-glyph camera"></span>
              <span>{mediaUpdating.camera ? 'Saving...' : cameraOn ? 'Camera Off' : 'Camera On'}</span>
            </button>
            <button disabled>Screen Share</button>
            <button disabled>Effects</button>
            <button disabled>Gifts</button>
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

export default function App() {
  const [token, setToken] = useState(getToken())
  const [user, setUser] = useState(getUser())
  const [view, setView] = useState('rooms')
  const [activeRoom, setActiveRoom] = useState(null)

  function handleLogin(accessToken, currentUser) {
    setToken(accessToken)
    setUser(currentUser)
    setView('rooms')
  }

  function logout() {
    clearSession()
    setToken('')
    setUser(null)
  }

  if (!token) return <LoginScreen onLogin={handleLogin} />

  if (activeRoom?.id) {
    return (
      <LiveRoomView
        roomId={activeRoom.id}
        roomPassword={activeRoom.password}
        initialRoom={activeRoom.room}
        initialRtcMode={activeRoom.rtcMode}
        autoConnect={activeRoom.autoConnect === true}
        user={user}
        onBack={() => setActiveRoom(null)}
      />
    )
  }

  return (
    <main className="app-shell">
      <Sidebar user={user} currentView={view} onView={setView} onLogout={logout} />
      <section className="content-shell">
        {view === 'rooms' && <RoomsView onEnterRoom={(roomId, options = {}) => setActiveRoom({
          id: roomId,
          password: options.password || '',
          room: options.room || null,
          rtcMode: options.rtcMode || defaultRtcModeForRoom(options.room),
          autoConnect: options.autoConnect === true,
        })} />}
        {view === 'admin' && (
          <Suspense fallback={<ViewFallback label="Admin dashboard" />}>
            <AdminView />
          </Suspense>
        )}
        {view === 'sdk' && (
          <Suspense fallback={<ViewFallback label="SDK samples" />}>
            <SdkView />
          </Suspense>
        )}
      </section>
    </main>
  )
}
