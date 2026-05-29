import { useEffect, useState } from 'react'
import { apiRequest } from '../../services/api'
import {
  buildRoomsPath,
  defaultRoomForm,
  defaultRtcModeForRoom,
  formatRoomDate,
  getRoomFlowLabel,
  getRoomMeta,
  getRoomTags,
  getSeatLabel,
  normalizeRtcMode,
  privacyFilterOptions,
  roomFeatureOptions,
  roomFilterOptions,
  roomFormPayload,
  roomPrivacyOptions,
  roomSortOptions,
  roomSupportsVideo,
  roomTypeLabels,
  rtcModeOptions,
  themeOptions,
  validateRoomForm,
} from '../../utils/roomConfig'

function RoomCard({ room, isSelected, onSelect, onJoin }) {
  const meta = getRoomMeta(room.room_type)
  const tags = getRoomTags(room)
  const initial = room.name?.slice(0, 1)?.toUpperCase() || 'R'
  const needsPassword = room.privacy_type === 'password'
  const isPrivate = room.privacy_type === 'private'
  const flowLabel = getRoomFlowLabel(room.room_type)
  const seatLabel = getSeatLabel(room.room_type, room.max_mic_count)

  return (
    <article className={`room-card ${meta.tone}${isSelected ? ' selected' : ''}`}>
      <div className="room-cover">
        <div className="live-chip"><span></span> LIVE</div>
        <div className="room-type-chip">{needsPassword ? 'Locked' : isPrivate ? 'Private' : meta.short}</div>
        <div className="room-cover-asset" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
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
            <p>{flowLabel} - {seatLabel} - {room.status}</p>
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

export function RoomsView({ onEnterRoom }) {
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
  const featuredMeta = getRoomMeta(featuredRoom?.room_type)
  const activeParticipants = rooms.reduce((total, room) => total + Number(room.active_participants || 0), 0)
  const liveRooms = rooms.filter((room) => ['active', 'live'].includes(String(room.status || '').toLowerCase()))
  const videoRooms = rooms.filter((room) => roomSupportsVideo(room.room_type))
  const musicRooms = rooms.filter((room) => ['audio', 'group_audio'].includes(room.room_type))
  const hostRail = rooms.slice(0, 5)
  const categoryCards = [
    { value: 'live', label: 'Hot Live', detail: `${liveRooms.length || rooms.length} rooms`, tone: 'hot' },
    { value: 'video', label: 'Video Party', detail: `${videoRooms.length} stages`, tone: 'sky' },
    { value: 'music', label: 'Music Lounge', detail: `${musicRooms.length} rooms`, tone: 'mint' },
    { value: 'pk', label: 'PK Battles', detail: 'Live matchups', tone: 'violet' },
  ]
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

  function scrollToHostTools() {
    document.getElementById('host-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  function joinRoomFromCard(room) {
    if (room.privacy_type === 'password') {
      selectRoom(room)
      return
    }

    onEnterRoom(String(room.id), { room, rtcMode: defaultRtcModeForRoom(room), autoConnect: true })
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
      <header className="buzz-dashboard">
        <div className="buzz-topbar">
          <div className="buzz-brand">
            <div className="app-mark">BC</div>
            <div>
              <strong>BuzzCast Lobby</strong>
              <span>talk-each-other live rooms</span>
            </div>
          </div>
          <div className="buzz-search">
            <label className="sr-only" htmlFor="room-search">Search rooms</label>
            <input id="room-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search live rooms or hosts" />
          </div>
          <button type="button" className="primary-button buzz-go-live" onClick={scrollToHostTools}>Go Live</button>
        </div>

        <div className="buzz-tabs" role="tablist" aria-label="Room filters">
          {roomFilterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? 'buzz-tab active' : 'buzz-tab'}
              onClick={() => setFilter(option.value)}
              aria-pressed={filter === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <section className="buzz-hero-grid" aria-label="Live discovery dashboard">
        <article className={`buzz-feature-card ${featuredMeta.tone}`}>
          <div className="buzz-feature-top">
            <div className="live-chip"><span></span> LIVE</div>
            <div className="room-type-chip">{featuredRoom ? featuredMeta.short : 'New'}</div>
          </div>
          <div className="buzz-stage-visual" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div className="buzz-feature-content">
            <span className="eyebrow">Featured room</span>
            <h1>{featuredRoom?.name || 'Start the first live room'}</h1>
            <p>{featuredRoom?.description || 'Open a live video, music, chat, and creator room for your audience.'}</p>
            <div className="buzz-feature-meta">
              <span>{featuredRoom ? featuredMeta.label : 'Video Room'}</span>
              <span>{featuredRoom ? getSeatLabel(featuredRoom.room_type, featuredRoom.max_mic_count) : '8 stage seats'}</span>
              <span>{featuredRoom?.active_participants || 0} watching</span>
            </div>
            <div className="buzz-feature-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => featuredRoom ? joinRoomFromCard(featuredRoom) : scrollToHostTools()}
              >
                {featuredRoom?.privacy_type === 'password' ? 'Unlock Room' : 'Enter Room'}
              </button>
              <button type="button" onClick={() => loadRooms({ page: roomMeta.page })} disabled={loadingRooms}>
                {loadingRooms ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </article>

        <aside className="buzz-side-panel">
          <div className="buzz-panel-header">
            <span className="eyebrow">Rising hosts</span>
            <strong>{hostRail.length || 0} live</strong>
          </div>
          <div className="buzz-host-rail">
            {hostRail.length === 0 ? (
              <div className="buzz-empty-host">No live hosts yet</div>
            ) : hostRail.map((room) => {
              const initial = room.owner_name?.slice(0, 1)?.toUpperCase() || room.name?.slice(0, 1)?.toUpperCase() || 'H'

              return (
                <button key={room.id} type="button" className="buzz-host" onClick={() => selectRoom(room)}>
                  <span className="buzz-host-avatar">{initial}</span>
                  <span>
                    <strong>{room.owner_name || room.name}</strong>
                    <small>{getRoomMeta(room.room_type).label}</small>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="buzz-mini-stats">
            <div><span>Audience</span><strong>{activeParticipants}</strong></div>
            <div><span>Rooms</span><strong>{roomMeta.total}</strong></div>
            <div><span>Mode</span><strong>{joinRtcMode}</strong></div>
          </div>
        </aside>
      </section>

      <section className="buzz-category-rail" aria-label="Live room categories">
        {categoryCards.map((category) => (
          <button
            key={category.value}
            type="button"
            className={`buzz-category-card ${category.tone}${filter === category.value ? ' active' : ''}`}
            onClick={() => setFilter(category.value)}
          >
            <span>{category.label}</span>
            <strong>{category.detail}</strong>
          </button>
        ))}
      </section>

      <div className="buzz-controls">
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
        <div className="status-bar buzz-status"><strong>Status:</strong> {status}</div>
      </div>

      <section className="room-list-section buzz-room-feed">
        <div className="room-list-header">
          <div>
            <span className="eyebrow">For you</span>
            <h2>Live now</h2>
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

      <section className="split-grid" id="host-tools">
        <form className="form-card create-room-panel" onSubmit={createRoom}>
          <div className="form-title-row">
            <div>
              <span className="eyebrow">Host tools</span>
              <h2>Start Live</h2>
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
              <label>Stage Seats</label>
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
            {creating ? 'Creating...' : 'Create Live Room'}
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
                  autoConnect: true,
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
            <span>Video Stage</span><span>Music Stage</span><span>Chat</span><span>Gifts</span><span>Effects</span><span>Screen Share</span>
          </div>
        </div>
      </section>

    </div>
  )
}
