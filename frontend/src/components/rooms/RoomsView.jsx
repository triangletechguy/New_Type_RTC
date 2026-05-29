import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../../services/api'
import {
  buildRoomsPath,
  defaultRoomForm,
  defaultRtcModeForRoom,
  getRoomMeta,
  getSeatLabel,
  normalizeRtcMode,
  privacyFilterOptions,
  roomFeatureOptions,
  roomFormPayload,
  roomPrivacyOptions,
  roomSortOptions,
  roomSupportsVideo,
  roomTypeLabels,
  rtcModeOptions,
  themeOptions,
  validateRoomForm,
} from '../../utils/roomConfig'

const feedTabs = [
  { value: 'all', label: 'All Rooms', filter: 'all', privacy: 'all', sort: 'active' },
  { value: 'video', label: 'Video', filter: 'video', privacy: 'all' },
  { value: 'music', label: 'Music', filter: 'music', privacy: 'all' },
  { value: 'pk', label: 'PK', filter: 'pk', privacy: 'all' },
  { value: 'public', label: 'Public', filter: 'all', privacy: 'public' },
  { value: 'private', label: 'Private', filter: 'all', privacy: 'private' },
  { value: 'latest', label: 'Latest', filter: 'all', privacy: 'all', sort: 'newest' },
]

const typePills = [
  { value: 'all', label: 'All', filter: 'all' },
  { value: 'live', label: 'Live', filter: 'live' },
  { value: 'video', label: 'Video', filter: 'video' },
  { value: 'music', label: 'Music', filter: 'music' },
  { value: 'pk', label: 'PK', filter: 'pk' },
]

const settingsNav = [
  { value: 'account', label: 'Account Security', icon: 'U' },
  { value: 'rooms', label: 'Room Defaults', icon: 'R' },
  { value: 'media', label: 'Media and RTC', icon: 'M' },
  { value: 'privacy', label: 'Privacy Settings', icon: 'S' },
  { value: 'region', label: 'Region', icon: 'P' },
  { value: 'terms', label: 'Terms and Policies', icon: 'D' },
]

const regions = ['United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Brazil', 'Australia', 'Japan', 'South Korea']

const popularHelp = [
  {
    id: 'create-room',
    title: 'How to create a live room',
    body: 'Use Create Room, choose the room type, privacy, stage seats, and media options, then open the created room to start the RTC session.',
  },
  {
    id: 'join-room',
    title: 'How to join a room',
    body: 'Select a room card or enter the room ID in Quick Join. Password rooms require the room password before the RTC console opens.',
  },
  {
    id: 'camera-mic',
    title: 'Camera or microphone does not start',
    body: 'Close other apps using the camera or microphone, allow browser permissions, then enter the room again. talkeachother can still join receive-only while the browser waits for local devices.',
  },
  {
    id: 'room-types',
    title: 'Room type differences',
    body: 'Video rooms use camera and microphone. Music rooms use microphone-first RTC. PK rooms use the same video pipeline with a battle-style room type.',
  },
  {
    id: 'turn-relay',
    title: 'Remote video is slow or blank',
    body: 'Check the RTC relay configuration, Caddy HTTPS endpoint, and TURN UDP ports on the VPS. The room console reads the relay settings from /api/rtc/config.',
  },
]

const faqTopics = [
  'Create a public room',
  'Create a password room',
  'Switch room type',
  'Join by room ID',
  'Allow camera permissions',
  'Allow microphone permissions',
  'Use audio-only mode',
  'Open admin dashboard',
  'Open SDK flow',
  'Deploy current code to VPS',
  'Check API health',
  'Check RTC relay config',
]

function initialsFromName(name) {
  return String(name || 'User')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U'
}

function compactNumber(value) {
  const number = Number(value || 0)
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`
  return String(number)
}

function roomTone(roomType, index) {
  if (['audio', 'group_audio'].includes(roomType)) return 'ocean'
  if (roomType === 'pk_live') return 'violet'
  if (['solo_live', 'group_video', 'video'].includes(roomType)) return ['aurora', 'warm', 'rose', 'sunset'][index % 4]
  return ['slate', 'amber', 'night', 'plum'][index % 4]
}

function roomToFeedCard(room, index) {
  const meta = getRoomMeta(room.room_type)
  const privacyLabel = room.privacy_type === 'password' ? 'Password' : room.privacy_type === 'private' ? 'Private' : 'Public'

  return {
    id: `room-${room.id}`,
    room,
    title: room.name || `Room ${room.id}`,
    host: room.owner_name || 'talkeachother host',
    viewers: Number(room.active_participants || 0),
    tone: roomTone(room.room_type, index),
    badge: `${meta.short} - ${privacyLabel}`,
    detail: `${getSeatLabel(room.room_type, room.max_mic_count)} - ${room.status || 'ready'}`,
  }
}

function IconButton({ label, children, badge, className = '', onClick }) {
  return (
    <button type="button" className={`talk-icon-button ${className}`} onClick={onClick} aria-label={label} title={label}>
      <span>{children}</span>
      {badge ? <em>{badge}</em> : null}
    </button>
  )
}

function TalkLogo() {
  return (
    <div className="talk-logo">
      <div className="talk-logo-mark">TE</div>
      <div>
        <strong>talkeachother</strong>
        <span>Live video and music rooms</span>
      </div>
    </div>
  )
}

function FeedCard({ card, featured, onOpen }) {
  return (
    <article className={`talk-room-card ${featured ? 'featured' : ''}`}>
      <button type="button" className="talk-card-button" onClick={() => onOpen(card)}>
        <div className={`talk-media media-${card.tone || 'aurora'}`}>
          <span className="talk-card-badge">{card.badge}</span>
          <span className="talk-viewers">{compactNumber(card.viewers)} active</span>
          <span className="talk-seat-dots"><i></i><i></i><i></i></span>
        </div>
        <div className="talk-card-copy">
          <strong>{card.title}</strong>
          <span>{card.host}</span>
          <small>{card.detail}</small>
        </div>
      </button>
    </article>
  )
}

export function RoomsView({ onEnterRoom, user, onLogout, onView }) {
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
  const [sort, setSort] = useState('active')
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [creating, setCreating] = useState(false)
  const [openingRoom, setOpeningRoom] = useState(false)
  const [activeSection, setActiveSection] = useState('live')
  const [activeFeed, setActiveFeed] = useState('all')
  const [activeTypePill, setActiveTypePill] = useState('all')
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [showHostPanel, setShowHostPanel] = useState(false)
  const [showStatusPanel, setShowStatusPanel] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [activeSettings, setActiveSettings] = useState('account')
  const [helpMode, setHelpMode] = useState('popular')
  const [activeHelp, setActiveHelp] = useState('create-room')

  const displayName = user?.name || user?.email?.split('@')[0] || 'talkeachother User'
  const displayId = user?.id || user?.email || 'session'
  const profileInitials = initialsFromName(displayName)
  const activeParticipants = rooms.reduce((total, room) => total + Number(room.active_participants || 0), 0)
  const selectedRoomNeedsPassword = selectedRoom?.privacy_type === 'password' && roomId === String(selectedRoom.id)
  const selectedRoomSupportsVideo = !selectedRoom || roomSupportsVideo(selectedRoom.room_type)
  const canJoinRoom = Boolean(roomId.trim()) && !openingRoom && (!selectedRoomNeedsPassword || Boolean(joinPassword.trim()))
  const roomCards = useMemo(() => rooms.map(roomToFeedCard), [rooms])
  const searchRecommendations = useMemo(() => rooms.slice(0, 6).map((room) => ({
    id: room.id,
    name: room.name,
    detail: `${getRoomMeta(room.room_type).label} - ${room.privacy_type}`,
    room,
  })), [rooms])
  const activeHelpItem = popularHelp.find((item) => item.id === activeHelp) || popularHelp[0]

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

  function openLiveSection() {
    setActiveSection('live')
  }

  function switchFeed(nextFeed) {
    const tab = feedTabs.find((item) => item.value === nextFeed)
    setActiveSection('live')
    setActiveFeed(nextFeed)
    setActiveTypePill(tab?.filter || 'all')
    setFilter(tab?.filter || 'all')
    setPrivacyFilter(tab?.privacy || 'all')
    setSort(tab?.sort || 'active')
  }

  function switchTypePill(nextValue) {
    const next = typePills.find((item) => item.value === nextValue)
    setActiveTypePill(nextValue)
    setFilter(next?.filter || 'all')
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
        autoConnect: true,
      })
    } catch (error) {
      setStatus(error.message)
    } finally {
      setOpeningRoom(false)
    }
  }

  function openRoomCard(card) {
    const room = card.room
    selectRoom(room)
    if (room.privacy_type === 'password') {
      setShowHostPanel(true)
      return
    }

    onEnterRoom(String(room.id), { room, rtcMode: defaultRtcModeForRoom(room), autoConnect: true })
  }

  async function handleInstallApp() {
    if (installPrompt) {
      installPrompt.prompt()
      await installPrompt.userChoice.catch(() => null)
      setInstallPrompt(null)
      setShowInstall(false)
      return
    }

    setStatus('Use the browser install control when it appears for this app.')
    setShowInstall(false)
  }

  function renderLiveFeed() {
    return (
      <>
        <nav className="talk-feed-nav" aria-label="Room filters">
          {feedTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={activeFeed === tab.value ? 'active' : ''}
              onClick={() => switchFeed(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="talk-filter-pills">
          {typePills.map((item) => (
            <button
              key={item.value}
              type="button"
              className={activeTypePill === item.value ? 'active' : ''}
              onClick={() => switchTypePill(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="talk-match-banner">
          <strong>{roomMeta.total} rooms</strong>
          <span>{activeParticipants} active participant(s)</span>
        </div>

        <div className="talk-feed-controls">
          <div>
            <select value={privacyFilter} onChange={(event) => setPrivacyFilter(event.target.value)} aria-label="Privacy filter">
              {privacyFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort rooms">
              {roomSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <span>{loadingRooms ? 'Refreshing rooms...' : status}</span>
        </div>

        {roomCards.length ? (
          <section className="talk-card-grid">
            {roomCards.map((card, index) => (
              <FeedCard
                key={card.id}
                card={card}
                featured={activeFeed === 'all' && index === 0}
                onOpen={openRoomCard}
              />
            ))}
          </section>
        ) : (
          <section className="talk-empty-feed">
            <strong>No rooms match this view.</strong>
            <span>Create a room or change the filters.</span>
            <button type="button" onClick={() => setShowHostPanel(true)}>Create Room</button>
          </section>
        )}

        {roomMeta.total_pages > 1 ? (
          <div className="talk-pagination">
            <button type="button" onClick={() => loadRooms({ page: Math.max(1, roomMeta.page - 1) })} disabled={loadingRooms || roomMeta.page <= 1}>Previous</button>
            <span>{roomMeta.page} / {roomMeta.total_pages}</span>
            <button type="button" onClick={() => loadRooms({ page: Math.min(roomMeta.total_pages, roomMeta.page + 1) })} disabled={loadingRooms || roomMeta.page >= roomMeta.total_pages}>Next</button>
          </div>
        ) : null}
      </>
    )
  }

  function renderProfile() {
    return (
      <section className="talk-profile-panel">
        <div className="talk-profile-hero">
          <div className="talk-profile-avatar">{profileInitials}</div>
          <div>
            <h1>{displayName}</h1>
            <span>ID: {displayId}</span>
            <div className="talk-profile-badges">
              <strong>{roomMeta.total}</strong>
              <strong>{activeParticipants}</strong>
            </div>
            <p>Rooms <b>{roomMeta.total}</b> Active participants <b>{activeParticipants}</b> RTC mode <b>{joinRtcMode}</b></p>
            <small>{user?.email || 'Signed in session'}</small>
          </div>
        </div>
        <div className="talk-profile-grid">
          <h2>Profile</h2>
          <dl>
            <dt>Name</dt><dd>{displayName}</dd>
            <dt>Email</dt><dd>{user?.email || 'Not provided'}</dd>
            <dt>Default RTC</dt><dd>{joinRtcMode}</dd>
            <dt>Current View</dt><dd>{activeFeed}</dd>
          </dl>
        </div>
        <div className="talk-profile-links">
          <button type="button" onClick={() => setShowHostPanel(true)}>Create Room</button>
          <button type="button" onClick={() => setShowActivity(true)}>Room Activity</button>
          <button type="button" onClick={() => setShowStatusPanel(true)}>System Status</button>
          <button type="button" onClick={onLogout}>Sign out</button>
        </div>
      </section>
    )
  }

  function renderSettingsContent() {
    if (activeSettings === 'rooms') {
      return (
        <div className="talk-settings-list">
          <button type="button"><span>Default room name</span><em>{defaultRoomForm.name}</em></button>
          <button type="button"><span>Default room type</span><em>{roomTypeLabels[defaultRoomForm.room_type]}</em></button>
          <button type="button"><span>Default privacy</span><em>{defaultRoomForm.privacy_type}</em></button>
          <button type="button"><span>Default stage seats</span><em>{defaultRoomForm.max_mic_count}</em></button>
        </div>
      )
    }

    if (activeSettings === 'media') {
      return (
        <div className="talk-settings-list">
          {rtcModeOptions.map((option) => (
            <label key={option.value} className="talk-radio-row">
              <span><strong>{option.label}</strong><small>{option.detail}</small></span>
              <input type="radio" name="rtc-mode" checked={joinRtcMode === option.value} onChange={() => updateJoinRtcMode(option.value)} />
            </label>
          ))}
          <button type="button"><span>TURN relay policy</span><em>From /api/rtc/config</em></button>
          <button type="button"><span>Media capture mode</span><em>Real devices</em></button>
        </div>
      )
    }

    if (activeSettings === 'privacy') {
      return (
        <div className="talk-settings-list">
          <button type="button"><span>Public rooms</span><em>Anyone signed in can open</em></button>
          <button type="button"><span>Password rooms</span><em>Password required before RTC</em></button>
          <button type="button"><span>Private rooms</span><em>Visible as private in room list</em></button>
          <label className="talk-switch-row">
            <span><strong>AI security option</strong><small>Available when creating rooms from Host Tools.</small></span>
            <input type="checkbox" checked={Boolean(roomForm.ai_security_enabled)} onChange={(event) => updateRoomForm('ai_security_enabled', event.target.checked)} />
          </label>
        </div>
      )
    }

    if (activeSettings === 'region') {
      return (
        <div className="talk-region-panel">
          <input placeholder="Search region" />
          <div className="talk-settings-list compact">
            {regions.map((item, index) => (
              <label key={item} className="talk-radio-row">
                <span><strong>{item}</strong></span>
                <input type="radio" name="region" defaultChecked={index === 0} />
              </label>
            ))}
          </div>
        </div>
      )
    }

    if (activeSettings === 'terms') {
      return (
        <div className="talk-settings-list">
          {['Terms of Service', 'Privacy Policy', 'Child Safety Policy', 'Anti-Bullying Policy', 'Copyright'].map((item) => (
            <button type="button" key={item}><span>{item}</span><b>&gt;</b></button>
          ))}
        </div>
      )
    }

    return (
      <div className="talk-security-panel">
        <div className="talk-safety-card">
          <strong>talkeachother account session</strong>
          <span>OK</span>
        </div>
        <div className="talk-settings-list">
          <button type="button"><span>Signed in as</span><em>{displayName}</em></button>
          <button type="button"><span>Email</span><em>{user?.email || 'Not provided'}</em></button>
          <button type="button"><span>Backend session</span><em>Authenticated</em></button>
          <button type="button" onClick={onLogout}><span>Sign out</span><em>End session</em></button>
        </div>
      </div>
    )
  }

  function renderSettings() {
    return (
      <section className="talk-settings-shell">
        <aside className="talk-settings-nav">
          {settingsNav.map((item) => (
            <button
              key={item.value}
              type="button"
              className={activeSettings === item.value ? 'active' : ''}
              onClick={() => setActiveSettings(item.value)}
            >
              <i>{item.icon}</i>
              <span>{item.label}</span>
              <b>&gt;</b>
            </button>
          ))}
        </aside>
        <div className="talk-settings-content">
          {renderSettingsContent()}
        </div>
      </section>
    )
  }

  function renderHelp() {
    return (
      <section className="talk-help-shell">
        <header>
          <h1>Feedback and Help</h1>
          <button type="button" onClick={() => setShowFeedback(true)}>Send Feedback</button>
        </header>
        <div className="talk-help-layout">
          <aside className="talk-help-menu">
            <button type="button" className={helpMode === 'popular' ? 'active' : ''} onClick={() => setHelpMode('popular')}>Popular Questions</button>
            {popularHelp.map((item) => (
              <button
                key={item.id}
                type="button"
                className={helpMode === 'popular' && activeHelp === item.id ? 'active soft' : ''}
                onClick={() => {
                  setHelpMode('popular')
                  setActiveHelp(item.id)
                }}
              >
                {item.title}
              </button>
            ))}
            <button type="button" className={helpMode === 'faq' ? 'active' : ''} onClick={() => setHelpMode('faq')}>Frequently Asked Question</button>
          </aside>
          <main className="talk-help-content">
            {helpMode === 'faq' ? (
              <div className="talk-faq-list">
                {faqTopics.map((item) => <button type="button" key={item}>{item}<span>v</span></button>)}
              </div>
            ) : (
              <p>{activeHelpItem.body}</p>
            )}
          </main>
        </div>
      </section>
    )
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

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      setInstallPrompt(event)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  }, [])

  return (
    <div className="talk-shell">
      <header className="talk-topbar">
        <TalkLogo />
        <div className="talk-search-wrap">
          <label className="sr-only" htmlFor="talk-search">Search</label>
          <input
            id="talk-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onFocus={() => setShowSearchPanel(true)}
            onBlur={() => window.setTimeout(() => setShowSearchPanel(false), 160)}
            placeholder="Search rooms or hosts"
          />
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => loadRooms({ page: 1 })}>Q</button>
          {showSearchPanel ? (
            <div className="talk-search-panel">
              <span>Room recommendations</span>
              {searchRecommendations.length ? searchRecommendations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    selectRoom(item.room)
                    setShowHostPanel(true)
                  }}
                >
                  <i>{initialsFromName(item.name)}</i>
                  <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                </button>
              )) : <p>No rooms loaded yet.</p>}
            </div>
          ) : null}
        </div>
        <div className="talk-actions">
          <IconButton label="Admin dashboard" onClick={() => onView?.('admin')}>AD</IconButton>
          <IconButton label="SDK flow" onClick={() => onView?.('sdk')}>SDK</IconButton>
          <IconButton label="Room activity" badge={rooms.length || null} onClick={() => setShowActivity(true)}>RA</IconButton>
          <button type="button" className="talk-balance" onClick={() => setShowStatusPanel(true)}><span>Rooms</span><strong>{roomMeta.total}</strong></button>
          <IconButton label="Create room" className="accent" onClick={() => setShowHostPanel(true)}>+</IconButton>
          <button type="button" className="talk-avatar-button" onClick={() => setActiveSection('me')}>
            <span>{profileInitials}</span>
          </button>
        </div>
      </header>

      <aside className="talk-left-rail">
        <button type="button" className={activeSection === 'live' ? 'active' : ''} onClick={openLiveSection}>
          <span>[]</span> Rooms
        </button>
        <button type="button" className={activeSection === 'me' ? 'active' : ''} onClick={() => setActiveSection('me')}>
          <span>O</span> Profile
        </button>
        <button type="button" onClick={() => onView?.('admin')}>
          <span>A</span> Admin
        </button>
        <button type="button" onClick={() => onView?.('sdk')}>
          <span>S</span> SDK
        </button>
        <div className="talk-rail-spacer"></div>
        <button type="button" onClick={() => setShowInstall(true)}><span>I</span> Install App</button>
        <button type="button" className={activeSection === 'settings' ? 'active' : ''} onClick={() => setActiveSection('settings')}>
          <span>G</span> Settings
        </button>
        <button type="button" className={activeSection === 'help' ? 'active' : ''} onClick={() => setActiveSection('help')}>
          <span>?</span> Help
        </button>
      </aside>

      <main className="talk-main">
        {activeSection === 'live' && renderLiveFeed()}
        {activeSection === 'me' && renderProfile()}
        {activeSection === 'settings' && renderSettings()}
        {activeSection === 'help' && renderHelp()}
      </main>

      {showActivity ? (
        <section className="talk-messages-drawer">
          <aside>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rooms" />
            {rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                className={selectedRoom?.id === room.id ? 'active' : ''}
                onClick={() => selectRoom(room)}
              >
                <i>{initialsFromName(room.name)}</i>
                <span><strong>{room.name}</strong><small>{getRoomMeta(room.room_type).label}</small></span>
                <time>{room.privacy_type}</time>
              </button>
            ))}
          </aside>
          <main>
            <header>
              <strong>{selectedRoom?.name || 'Room Activity'}</strong>
              <span>{selectedRoom ? `( ID: ${selectedRoom.id})` : ''}</span>
              <button type="button" onClick={() => setShowActivity(false)}>Close</button>
            </header>
            <div className="talk-dm-notice">{status}</div>
            <div className="talk-dm-body">
              {selectedRoom ? (
                <>
                  <p>Type: {getRoomMeta(selectedRoom.room_type).label}</p>
                  <p>Privacy: {selectedRoom.privacy_type}</p>
                  <p>Seats: {getSeatLabel(selectedRoom.room_type, selectedRoom.max_mic_count)}</p>
                </>
              ) : <p>Select a room to see details.</p>}
            </div>
            <button className="talk-submit" type="button" onClick={joinSelectedRoom} disabled={!canJoinRoom}>{openingRoom ? 'Opening...' : 'Open Selected Room'}</button>
          </main>
        </section>
      ) : null}

      {showInstall ? (
        <div className="talk-modal-backdrop">
          <section className="talk-install-modal">
            <h2>Install app</h2>
            <div>
              <div className="talk-logo-mark">TE</div>
              <span><strong>talkeachother</strong><small>{window.location.host}</small></span>
            </div>
            <footer>
              <button type="button" className="primary" onClick={handleInstallApp}>Install</button>
              <button type="button" onClick={() => setShowInstall(false)}>Cancel</button>
            </footer>
          </section>
        </div>
      ) : null}

      {showHostPanel ? (
        <div className="talk-modal-backdrop dark" onMouseDown={() => setShowHostPanel(false)}>
          <section className="talk-host-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Create or Join Room</h2>
              <button type="button" onClick={() => setShowHostPanel(false)}>x</button>
            </header>
            <form onSubmit={createRoom}>
              <label>Room Name</label>
              <input value={roomForm.name} onChange={(event) => updateRoomForm('name', event.target.value)} aria-invalid={Boolean(formErrors.name)} />
              {formErrors.name && <small className="form-error">{formErrors.name}</small>}
              <label>Description</label>
              <textarea value={roomForm.description} onChange={(event) => updateRoomForm('description', event.target.value)} rows={3} aria-invalid={Boolean(formErrors.description)} />
              {formErrors.description && <small className="form-error">{formErrors.description}</small>}
              <label>Room Type</label>
              <div className="talk-choice-grid">
                {Object.entries(roomTypeLabels).map(([value, label]) => (
                  <button key={value} type="button" className={roomForm.room_type === value ? 'active' : ''} onClick={() => updateRoomForm('room_type', value)}>{label}</button>
                ))}
              </div>
              <label>Privacy</label>
              <div className="talk-choice-grid">
                {roomPrivacyOptions.map((option) => (
                  <button key={option.value} type="button" className={roomForm.privacy_type === option.value ? 'active' : ''} onClick={() => updateRoomForm('privacy_type', option.value)}>{option.label}</button>
                ))}
              </div>
              {roomForm.privacy_type === 'password' ? (
                <>
                  <label>Password</label>
                  <input type="password" value={roomForm.password} onChange={(event) => updateRoomForm('password', event.target.value)} autoComplete="new-password" aria-invalid={Boolean(formErrors.password)} />
                  {formErrors.password && <small className="form-error">{formErrors.password}</small>}
                </>
              ) : null}
              <div className="talk-host-fields">
                <div>
                  <label>Stage Seats</label>
                  <input type="number" min="1" max="16" value={roomForm.max_mic_count} onChange={(event) => updateRoomForm('max_mic_count', event.target.value)} aria-invalid={Boolean(formErrors.max_mic_count)} />
                </div>
                <div>
                  <label>Theme</label>
                  <select value={roomForm.theme} onChange={(event) => updateRoomForm('theme', event.target.value)}>
                    {themeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="talk-toggle-grid">
                {roomFeatureOptions.map((option) => (
                  <label key={option.field}>
                    <input type="checkbox" checked={Boolean(roomForm[option.field])} onChange={(event) => updateRoomForm(option.field, event.target.checked)} />
                    <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  </label>
                ))}
              </div>
              <button className="talk-submit" disabled={creating} type="submit">{creating ? 'Creating...' : 'Create Room'}</button>
            </form>

            <div className="talk-quick-join">
              <h3>Quick Join</h3>
              <label>RTC Mode</label>
              <div className="talk-choice-grid">
                {rtcModeOptions.map((option) => {
                  const disabled = option.value === 'video' && !selectedRoomSupportsVideo
                  return (
                    <button key={option.value} type="button" className={joinRtcMode === option.value ? 'active' : ''} onClick={() => updateJoinRtcMode(option.value)} disabled={disabled}>
                      {disabled ? 'Unavailable' : option.label}
                    </button>
                  )
                })}
              </div>
              <label>Room ID</label>
              <input value={roomId} onChange={(event) => clearSelectedRoomIfManual(event.target.value)} placeholder="Select room or enter ID" />
              <label>Room Password</label>
              <input type="password" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} placeholder="Only needed for locked rooms" autoComplete="current-password" />
              <button className="talk-submit secondary" type="button" onClick={joinSelectedRoom} disabled={!canJoinRoom}>{openingRoom ? 'Opening...' : 'Open RTC Console'}</button>
              {createdRoom ? (
                <button
                  className="talk-submit"
                  type="button"
                  onClick={() => onEnterRoom(String(createdRoom.id), {
                    password: joinPassword.trim(),
                    room: createdRoom,
                    rtcMode: defaultRtcModeForRoom(createdRoom),
                    autoConnect: true,
                  })}
                >
                  Open Created Room #{createdRoom.id}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {showStatusPanel ? (
        <div className="talk-modal-backdrop dark" onMouseDown={() => setShowStatusPanel(false)}>
          <section className="talk-status-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Room Status <span>{roomMeta.total}</span></h2>
              <button type="button" onClick={() => setShowStatusPanel(false)}>x</button>
            </header>
            <div className="talk-status-tabs"><button type="button" className="active">Live</button><button type="button">RTC</button></div>
            <button type="button"><span>Total rooms</span><span>{roomMeta.total}</span></button>
            <button type="button"><span>Active participants</span><span>{activeParticipants}</span></button>
            <button type="button"><span>Current filter</span><span>{activeFeed}</span></button>
            <button type="button"><span>RTC mode</span><span>{joinRtcMode}</span></button>
            <button type="button" className="talk-status-button" onClick={() => loadRooms({ page: roomMeta.page })}>Refresh Rooms</button>
          </section>
        </div>
      ) : null}

      {showFeedback ? (
        <div className="talk-modal-backdrop dark">
          <section className="talk-feedback-modal">
            <header><h2>Feedback</h2><button type="button" onClick={() => setShowFeedback(false)}>x</button></header>
            <div className="talk-feedback-row">
              <select><option>Room issue</option><option>Camera issue</option><option>Deployment issue</option></select>
              <select><option>Frontend</option><option>Backend</option><option>RTC</option></select>
            </div>
            <label>Problem description</label>
            <textarea placeholder="Please provide as much detail as possible" maxLength={1000}></textarea>
            <label>Problem screenshot / screen recording <small>(optional)</small></label>
            <div className="talk-upload-box"></div>
            <label>Contact information <small>(optional)</small></label>
            <input placeholder="Enter your email account" />
            <button type="button" className="talk-submit" onClick={() => setShowFeedback(false)}>Submit</button>
          </section>
        </div>
      ) : null}
    </div>
  )
}
