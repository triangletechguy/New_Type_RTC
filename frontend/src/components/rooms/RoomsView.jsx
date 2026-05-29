import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../../services/api'
import { canUseAdminDashboard } from '../../utils/roles'
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
  { value: 'following', label: 'Following', filter: 'all' },
  { value: 'for_you', label: 'For You', filter: 'all' },
  { value: 'explore', label: 'Explore', filter: 'all' },
  { value: 'party', label: 'Party', filter: 'pk' },
  { value: 'nearby', label: 'Nearby', filter: 'all' },
  { value: 'latest', label: 'Latest', filter: 'all', sort: 'newest' },
  { value: 'global', label: 'Global', filter: 'all' },
]

const exploreFilters = [
  { value: 'all', label: 'All', filter: 'all' },
  { value: 'new_host', label: 'New Host', filter: 'live' },
  { value: 'games', label: 'Games', filter: 'video' },
  { value: 'pk', label: 'PK', filter: 'pk' },
]

const demoCards = [
  { id: 'demo-1', title: 'I am new here', host: 'PAYA', viewers: 5631, tone: 'aurora', country: 'United States', size: 'feature' },
  { id: 'demo-2', title: 'naughty myfly', host: 'mandyiluvfrogs', viewers: 6018, tone: 'warm', category: 'Beauty' },
  { id: 'demo-3', title: '20Tokens4ANYRequests', host: 'Mary Marie31688746', viewers: 1794, tone: 'rose' },
  { id: 'demo-4', title: 'chill vibes only', host: 'BBreeBunnie', viewers: 6186, tone: 'sunset' },
  { id: 'demo-5', title: 'I am new here', host: 'love31312268', viewers: 1090, tone: 'slate' },
  { id: 'demo-6', title: 'relax..', host: 'MattM', viewers: 589, tone: 'amber' },
  { id: 'demo-7', title: 'hi', host: '6.5k Nat_5', viewers: 5689, tone: 'night' },
  { id: 'demo-8', title: 'Modo meta hasta amanecer', host: 'Lyss', viewers: 1418, tone: 'plum' },
  { id: 'demo-9', title: 'Support small gifts', host: 'BG_Unnniieee', viewers: 2032, tone: 'copper', badge: 'Make friends' },
  { id: 'demo-10', title: 'Holi', host: 'Sweetey', viewers: 7489, tone: 'cloud' },
  { id: 'demo-11', title: 'PV AGORA', host: 'Gabyzinha', viewers: 21853, tone: 'wine' },
  { id: 'demo-12', title: 'Hello', host: 'Maximum', viewers: 29888, tone: 'silver' },
  { id: 'demo-13', title: 'On max dada', host: 'Wifeykins', viewers: 8, tone: 'olive', tab: 'latest' },
  { id: 'demo-14', title: 'I am new here', host: 'Seyifunmi Debby', viewers: 8, tone: 'taupe', tab: 'latest' },
  { id: 'demo-15', title: '15 link por 5 reais no pv', host: 'anjo66631877403', viewers: 7, tone: 'mono', tab: 'latest' },
  { id: 'demo-16', title: 'Certified loner', host: 'vee sasha', viewers: 36, tone: 'rose', tab: 'latest' },
  { id: 'demo-17', title: 'COWMAN LOOKING FOR COWLADY', host: 'John F. Ke31824857', viewers: 527, tone: 'earth', tab: 'nearby' },
  { id: 'demo-18', title: 'I still feeling emotional cause got my prosthetic', host: 'Art232323', viewers: 181, tone: 'mid', tab: 'nearby' },
  { id: 'demo-19', title: 'need a day 1 bouncer', host: 'OG_Ocean', viewers: 57, tone: 'violet', tab: 'nearby' },
  { id: 'demo-20', title: 'I am new here', host: 'ChiChi80588', viewers: 1238, tone: 'pink', tab: 'nearby' },
  { id: 'demo-21', title: 'Certified game room', host: 'PANIAX GAMING', viewers: 99, tone: 'game', tab: 'explore', explore: 'games' },
  { id: 'demo-22', title: '1x equals 5', host: 'Cleo', viewers: 1230, tone: 'sand', tab: 'explore', explore: 'games' },
  { id: 'demo-23', title: 'Film room', host: 'PRIME', viewers: 68279, tone: 'ocean', tab: 'explore', explore: 'games' },
  { id: 'demo-24', title: 'Positive Boosting Time 24 7 365', host: 'United States', viewers: 865, tone: 'sky', tab: 'party', party: true },
  { id: 'demo-25', title: 'women and ladies join in', host: 'United States', viewers: 5133, tone: 'storm', tab: 'party', party: true },
  { id: 'demo-26', title: 'SUPPORT The Cozy Streamer', host: 'United States', viewers: 244, tone: 'ember', tab: 'party', party: true },
  { id: 'demo-27', title: 'This room may contain sensitive content', host: 'mandyiluvfrogs', viewers: 6345, tone: 'sensitive', sensitive: true },
]

const dmThreads = [
  { id: 'donna', name: 'Donna Walk3...', time: 'Wednesday 19:24', preview: '[Stickers]', unread: 1 },
  { id: 'jennifer', name: 'Jennifer Ortiz...', time: 'Wednesday 17:35', preview: '[Stickers]', unread: 1 },
  { id: 'friend', name: 'Friend...', time: 'Wednesday 01:27', preview: '@Jessica An3215971...', unread: 4 },
  { id: 'buzz', name: 'TalkEachOther', time: 'Wednesday 01:27', preview: 'Welcome to TalkEachOther...', unread: 1 },
]

const initialDmMessages = {
  donna: [],
  jennifer: [],
  friend: [],
  buzz: [{ id: 'welcome', author: 'TalkEachOther', body: 'Welcome to the TalkEachOther lobby.', mine: false }],
}

const settingsNav = [
  { value: 'account', label: 'Account Security', icon: 'U' },
  { value: 'privacy', label: 'Privacy Settings', icon: 'S' },
  { value: 'content', label: 'Content Preferences', icon: 'F' },
  { value: 'language', label: 'Multi-Language', icon: 'A' },
  { value: 'region', label: 'Region', icon: 'P' },
  { value: 'terms', label: 'Terms and Policies', icon: 'D' },
]

const languages = ['English', 'Japanese', 'Korean', 'French', 'Italian', 'Russian', 'Spanish', 'German', 'Portuguese', 'Hindi']
const regions = ['Afghanistan', 'Aland Islands', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla', 'Antigua and Barbuda', 'Argentina', 'Australia', 'Brazil', 'Canada', 'United States']
const giftItems = [
  { label: 'Rose', cost: 9 },
  { label: 'Lipstick', cost: 99 },
  { label: 'Love Overflow', cost: 399 },
  { label: 'Sweet Melody', cost: 399 },
  { label: 'Expression', cost: 1 },
  { label: 'Candy World', cost: 1000 },
  { label: 'Sweet Date', cost: 5999 },
  { label: 'Paw Ice Cream', cost: 1 },
  { label: 'Star', cost: 5 },
  { label: 'Sparklers', cost: 9 },
  { label: 'Cola', cost: 99 },
]

const paymentMethods = ['Google Pay', 'PayPal', 'Apple Pay', 'Visa/ MasterCard/ JCB/ AMEX/ DINERS', 'Dpay(USDT & Bitcoin)', 'Razer Gold Wallet']

const popularHelp = [
  { id: 'recharge', title: 'How to recharge', body: 'Please go to your profile page, click the Wallet button, click the recharge button or the Gift button in the live room, then choose a payment method to recharge diamonds.' },
  { id: 'vip', title: 'How to become VIP/SVIP', body: 'Buy VIP through the personal center or use diamonds to buy VIP. VIP rewards and privileges are visible from the personal center.' },
  { id: 'bind', title: 'How do I bind my phone number and email address?', body: 'For account security, bind your mobile phone number and email address in Settings, Account Security.' },
  { id: 'mvp', title: 'How to become an MVP and its benefits', body: 'MVP status unlocks monthly rewards, profile progress, and room benefits after qualifying top-up milestones.' },
  { id: 'missing', title: "I made a payment, but I did not receive the diamonds", body: 'Check the payment record first. If the recharge is still missing, submit feedback with your payment time and receipt screenshot.' },
]

const faqTopics = [
  'Modify personal information',
  'Unfollow accounts that are frozen or deactivated',
  'How to create a voice chat room',
  'How do I bind my phone number and email address?',
  'How to upgrade the TalkEachOther app',
  "Delete the other people's comments on your post or private message with others",
  'The live streaming page cannot be opened or is not smooth',
  'How to do a live/private live broadcast',
  'Block others',
  'What can crystals be used for',
  'How to upgrade my account level',
  "Join other people's private broadcast",
  'Hide profile',
  'Turn off my location',
  'Delete video',
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

function roomToFeedCard(room, index) {
  const meta = getRoomMeta(room.room_type)
  return {
    id: `room-${room.id}`,
    room,
    title: room.name || `Live room ${room.id}`,
    host: room.owner_name || 'Room host',
    viewers: Number(room.active_participants || 0) || 100 + index * 37,
    tone: ['aurora', 'warm', 'rose', 'sunset', 'slate', 'amber', 'night', 'plum'][index % 8],
    badge: room.privacy_type === 'password' ? 'Locked' : meta.short,
    category: meta.label,
    country: 'United States',
    size: index === 0 ? 'feature' : '',
  }
}

function IconButton({ label, children, badge, className = '', onClick }) {
  return (
    <button type="button" className={`buzzcast-icon-button ${className}`} onClick={onClick} aria-label={label} title={label}>
      <span className="buzzcast-icon-inner">{children}</span>
      {badge ? <em>{badge}</em> : null}
    </button>
  )
}

function BuzzLogo() {
  return (
    <div className="buzzcast-logo">
      <div className="buzzcast-logo-mark">TE</div>
      <div>
        <strong>TalkEachOther</strong>
        <span>Video and music rooms</span>
      </div>
    </div>
  )
}

function FeedCard({ card, featured, onOpen }) {
  return (
    <article className={`buzzcast-room-card ${featured ? 'featured' : ''}`}>
      <button type="button" className="buzzcast-card-button" onClick={() => onOpen(card)}>
        <div className={`buzzcast-media media-${card.tone || 'aurora'}`}>
          {card.badge ? <span className="buzzcast-card-badge">{card.badge}</span> : null}
          {card.sensitive ? <span className="buzzcast-sensitive-dot"></span> : null}
          <span className="buzzcast-viewers">{compactNumber(card.viewers)}</span>
          <span className="buzzcast-seat-dots"><i></i><i></i><i></i></span>
        </div>
        <div className="buzzcast-card-copy">
          <strong>{card.title}</strong>
          <span>{card.host}</span>
        </div>
      </button>
    </article>
  )
}

function DashboardRoomCard({ room, isSelected, onSelect, onJoin }) {
  const meta = getRoomMeta(room.room_type)
  const tags = getRoomTags(room)
  const initial = room.owner_name?.slice(0, 1)?.toUpperCase() || room.name?.slice(0, 1)?.toUpperCase() || 'R'
  const needsPassword = room.privacy_type === 'password'
  const isPrivate = room.privacy_type === 'private'
  const coverLabel = needsPassword ? 'Locked' : isPrivate ? 'Private' : meta.short
  const flowLabel = getRoomFlowLabel(room.room_type)
  const seatLabel = getSeatLabel(room.room_type, room.max_mic_count)
  const roomStatus = room.status || 'active'
  const description = room.description || 'A hosted room for live video, music, chat, and creator collaboration.'

  return (
    <article className={`talk-dashboard-card ${meta.tone}${isSelected ? ' selected' : ''}`}>
      <div className="talk-dashboard-cover">
        <div className="talk-live-chip"><span></span> LIVE</div>
        <div className="talk-cover-chip">{coverLabel}</div>
        <div className="talk-cover-asset" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div className="talk-cover-host">
          <div className="talk-room-avatar large">{initial}</div>
          <div>
            <span>{room.owner_name || 'Room host'}</span>
            <strong>{meta.label}</strong>
          </div>
        </div>
      </div>

      <div className="talk-dashboard-card-body">
        <div className="talk-room-title-row">
          <div>
            <h2>#{room.id} - {room.name || meta.label}</h2>
            <p>{flowLabel} - {seatLabel} - {roomStatus}</p>
          </div>
          <div className="talk-room-avatar">{initial}</div>
        </div>
        <p className="talk-room-description">{description}</p>
        <div className="talk-room-stat-row">
          <span>{room.active_participants || 0} active</span>
          <time>{formatRoomDate(room.created_at)}</time>
        </div>
        <div className="talk-room-tags">
          {tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        <div className="talk-room-actions">
          <button type="button" className={isSelected ? 'selected' : ''} onClick={() => onSelect(room)}>
            {isSelected ? 'Selected' : 'Select'}
          </button>
          <button type="button" className="primary" onClick={() => onJoin(room)}>
            {needsPassword ? 'Unlock' : 'Open'}
          </button>
        </div>
      </div>
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
  const [sort, setSort] = useState('newest')
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [creating, setCreating] = useState(false)
  const [openingRoom, setOpeningRoom] = useState(false)
  const [activeSection, setActiveSection] = useState('live')
  const [activeFeed, setActiveFeed] = useState('for_you')
  const [activeExplore, setActiveExplore] = useState('all')
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [showHostPanel, setShowHostPanel] = useState(false)
  const [showRecharge, setShowRecharge] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [activeSettings, setActiveSettings] = useState('account')
  const [helpMode, setHelpMode] = useState('popular')
  const [activeHelp, setActiveHelp] = useState('recharge')
  const [activeThread, setActiveThread] = useState(dmThreads[0].id)
  const [dmMessages, setDmMessages] = useState(initialDmMessages)
  const [dmInput, setDmInput] = useState('')
  const [previewCard, setPreviewCard] = useState(null)
  const [acceptedWarnings, setAcceptedWarnings] = useState({})

  const displayName = user?.name || user?.email?.split('@')[0] || 'Michael Sa32160161'
  const displayId = user?.id || 32160161
  const profileInitials = initialsFromName(displayName)
  const showAdminDashboard = canUseAdminDashboard(user)
  const selectedRoomNeedsPassword = selectedRoom?.privacy_type === 'password' && roomId === String(selectedRoom.id)
  const selectedRoomSupportsVideo = !selectedRoom || roomSupportsVideo(selectedRoom.room_type)
  const canJoinRoom = Boolean(roomId.trim()) && !openingRoom && (!selectedRoomNeedsPassword || Boolean(joinPassword.trim()))

  const roomCards = useMemo(() => rooms.map(roomToFeedCard), [rooms])
  const roomSearchResults = useMemo(() => rooms.slice(0, 6).map((room) => ({
    id: room.id,
    name: room.name || `Room ${room.id}`,
    detail: `${getRoomMeta(room.room_type).label} - ${room.privacy_type}`,
    room,
  })), [rooms])
  const visibleCards = useMemo(() => {
    let cards = [...roomCards, ...demoCards]

    if (activeFeed === 'latest') cards = cards.filter((card) => card.tab === 'latest' || card.room).slice(0, 16)
    if (activeFeed === 'nearby') cards = cards.filter((card) => card.tab === 'nearby' || card.room).slice(0, 16)
    if (activeFeed === 'party') cards = cards.filter((card) => card.party || card.tab === 'party' || card.room?.room_type === 'pk_live')
    if (activeFeed === 'explore') {
      cards = cards.filter((card) => {
        if (activeExplore === 'all') return card.tab !== 'party'
        if (activeExplore === 'pk') return card.room?.room_type === 'pk_live' || card.explore === 'pk'
        if (activeExplore === 'games') return card.explore === 'games' || roomSupportsVideo(card.room?.room_type)
        return card.room || card.explore === activeExplore
      })
    }
    if (activeFeed === 'following') cards = cards.filter((card, index) => card.room || index < 6)
    if (activeFeed === 'global') cards = cards.filter((card) => card.tab === 'latest' || card.room).concat(demoCards.slice(0, 4))

    return cards.slice(0, activeFeed === 'party' ? 10 : 24)
  }, [activeExplore, activeFeed, roomCards])

  const activeHelpItem = popularHelp.find((item) => item.id === activeHelp) || popularHelp[0]
  const activeThreadData = dmThreads.find((thread) => thread.id === activeThread) || dmThreads[0]

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
    setPreviewCard(null)
  }

  function switchFeed(nextFeed) {
    const tab = feedTabs.find((item) => item.value === nextFeed)
    setActiveSection('live')
    setPreviewCard(null)
    setActiveFeed(nextFeed)
    if (tab?.filter) setFilter(tab.filter)
    if (tab?.sort) setSort(tab.sort)
  }

  function switchExplore(nextExplore) {
    const next = exploreFilters.find((item) => item.value === nextExplore)
    setActiveExplore(nextExplore)
    if (activeFeed === 'explore') setFilter(next?.filter || 'all')
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
      setShowHostPanel(true)
      return
    }

    onEnterRoom(String(room.id), { room, rtcMode: defaultRtcModeForRoom(room), autoConnect: true })
  }

  function openCard(card) {
    if (card.room) {
      joinRoomFromCard(card.room)
      return
    }

    setPreviewCard(card)
    setActiveSection('room')
  }

  function sendDmMessage(event) {
    event.preventDefault()
    const body = dmInput.trim()
    if (!body) return

    setDmMessages((previous) => ({
      ...previous,
      [activeThread]: [
        ...(previous[activeThread] || []),
        { id: `${activeThread}-${Date.now()}`, author: displayName, body, mine: true },
      ],
    }))
    setDmInput('')
  }

  async function handleInstallApp() {
    if (installPrompt) {
      installPrompt.prompt()
      await installPrompt.userChoice.catch(() => null)
      setInstallPrompt(null)
      setShowInstall(false)
      return
    }

    setStatus('Use the browser install button when it appears for this app.')
    setShowInstall(false)
  }

  function renderLiveFeed() {
    return (
      <section className="talk-dashboard">
        <header className="talk-dashboard-header">
          <h1>Live now</h1>
          <span>{loadingRooms ? 'Refreshing rooms...' : `Page ${roomMeta.page} of ${roomMeta.total_pages || 1}`}</span>
        </header>

        {loadingRooms && rooms.length === 0 ? (
          <div className="talk-dashboard-empty">Loading rooms...</div>
        ) : (
          <div className="talk-dashboard-grid">
            {rooms.length === 0 ? (
              <div className="talk-dashboard-empty">No matching rooms yet. Create one or change the filters.</div>
            ) : rooms.map((room) => (
              <DashboardRoomCard
                key={room.id}
                room={room}
                isSelected={roomId === String(room.id)}
                onSelect={selectRoom}
                onJoin={joinRoomFromCard}
              />
            ))}
          </div>
        )}

        {roomMeta.total_pages > 1 ? (
          <div className="talk-dashboard-pagination">
            <button type="button" onClick={() => loadRooms({ page: Math.max(1, roomMeta.page - 1) })} disabled={loadingRooms || roomMeta.page <= 1}>Previous</button>
            <span>{roomMeta.total} total rooms</span>
            <button type="button" onClick={() => loadRooms({ page: Math.min(roomMeta.total_pages, roomMeta.page + 1) })} disabled={loadingRooms || roomMeta.page >= roomMeta.total_pages}>Next</button>
          </div>
        ) : null}
      </section>
    )
  }

  function renderProfile() {
    return (
      <section className="buzzcast-profile-panel">
        <div className="buzzcast-profile-hero">
          <div className="buzzcast-profile-avatar">{profileInitials}</div>
          <div>
            <h1>{displayName}</h1>
            <span>ID:{displayId}</span>
            <div className="buzzcast-profile-badges">
              <strong>29</strong>
              <strong>1</strong>
            </div>
            <p>Following <b>0</b> Followers <b>3</b> Received <b>0</b> Sent <b>0</b></p>
            <small>United States</small>
          </div>
        </div>
        <div className="buzzcast-profile-grid">
          <h2>Profile</h2>
          <dl>
            <dt>Name</dt><dd>{displayName}</dd>
            <dt>Gender</dt><dd>Male</dd>
            <dt>Birthday</dt><dd>12/10/1996</dd>
            <dt>Current Residence</dt><dd>United States</dd>
          </dl>
        </div>
        <div className="buzzcast-profile-links">
          <button type="button" onClick={() => setShowRecharge(true)}>Wallet</button>
          <button type="button">Backpack</button>
          <button type="button">Supporters</button>
          <button type="button" onClick={onLogout}>Sign out</button>
        </div>
      </section>
    )
  }

  function renderSettingsContent() {
    if (activeSettings === 'privacy') {
      return (
        <div className="buzzcast-settings-list">
          <button type="button"><span>Who can send me a message</span><b>&gt;</b></button>
          <button type="button"><span>Private live invitation</span><b>&gt;</b></button>
          <label className="buzzcast-switch-row">
            <span><strong>Automatic deduction for entering the private live broadcast room</strong><small>After opening, private rooms can automatically deduct diamonds.</small></span>
            <input type="checkbox" />
          </label>
          <button type="button"><span>Blacklist</span><b>&gt;</b></button>
          <button type="button"><span>Live broadcast you are not interested in</span><b>&gt;</b></button>
        </div>
      )
    }

    if (activeSettings === 'content') {
      return (
        <div className="buzzcast-settings-list">
          {['Restricted Mode', 'Warning Mode', 'All Modes'].map((item, index) => (
            <label key={item} className="buzzcast-radio-row">
              <span><strong>{item}</strong><small>{index === 1 ? 'The content is hidden by default behind filters that require user actions.' : index === 0 ? 'Hide potentially sensitive content.' : 'You will see all the content.'}</small></span>
              <input type="radio" name="content-mode" defaultChecked={index === 1} />
            </label>
          ))}
        </div>
      )
    }

    if (activeSettings === 'language') {
      return (
        <div className="buzzcast-settings-list compact">
          {languages.map((item, index) => (
            <label key={item} className="buzzcast-radio-row">
              <span><strong>{item}</strong></span>
              <input type="radio" name="language" defaultChecked={index === 0} />
            </label>
          ))}
        </div>
      )
    }

    if (activeSettings === 'region') {
      return (
        <div className="buzzcast-region-panel">
          <input placeholder="Search" />
          <div className="buzzcast-settings-list compact">
            {regions.map((item, index) => (
              <label key={item} className="buzzcast-radio-row">
                <span><strong>{item}</strong></span>
                <input type="radio" name="region" defaultChecked={index === regions.length - 1} />
              </label>
            ))}
          </div>
        </div>
      )
    }

    if (activeSettings === 'terms') {
      return (
        <div className="buzzcast-settings-list">
          {['Terms of Service', 'Privacy Policy', 'Child Safety Policy', 'Anti-Bullying Policy', 'Copyright'].map((item) => (
            <button type="button" key={item}><span>{item}</span><b>&gt;</b></button>
          ))}
        </div>
      )
    }

    return (
      <div className="buzzcast-security-panel">
        <div className="buzzcast-safety-card">
          <strong>Very low level of safety</strong>
          <span>OK</span>
        </div>
        <div className="buzzcast-settings-list">
          {['Binding cell phone', 'Binding email', 'Binding Wallet', 'Set login password', 'Set payment password', 'Devices Logged In'].map((item) => (
            <button type="button" key={item}><span>{item}</span><em>{item.includes('Binding') ? item : item === 'Devices Logged In' ? 'Device' : item}</em></button>
          ))}
        </div>
      </div>
    )
  }

  function renderSettings() {
    return (
      <section className="buzzcast-settings-shell">
        <aside className="buzzcast-settings-nav">
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
        <div className="buzzcast-settings-content">
          {renderSettingsContent()}
        </div>
      </section>
    )
  }

  function renderHelp() {
    return (
      <section className="buzzcast-help-shell">
        <header>
          <h1>Feedback and Help</h1>
          <button type="button" onClick={() => setShowFeedback(true)}>Feedback record</button>
        </header>
        <div className="buzzcast-help-layout">
          <aside className="buzzcast-help-menu">
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
          <main className="buzzcast-help-content">
            {helpMode === 'faq' ? (
              <div className="buzzcast-faq-list">
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

  function renderRoomPreview() {
    const card = previewCard || demoCards[0]
    const isWarning = card.sensitive && !acceptedWarnings[card.id]

    return (
      <section className="buzzcast-room-preview">
        <div className={`buzzcast-stage media-${card.tone || 'sensitive'}`}>
          {isWarning ? (
            <div className="buzzcast-warning-panel">
              <strong>This live broadcast may contain sensitive content</strong>
              <button type="button" onClick={() => setAcceptedWarnings((previous) => ({ ...previous, [card.id]: true }))}>View</button>
              <button type="button" onClick={() => {
                setActiveSettings('content')
                setActiveSection('settings')
              }}>Content Preferences</button>
            </div>
          ) : (
            <>
              <div className="buzzcast-host-pill">
                <span>{initialsFromName(card.host)}</span>
                <strong>{card.host}</strong>
                <small>{compactNumber(card.viewers)}</small>
              </div>
              <div className="buzzcast-room-metadata">
                <span>ID:29803275</span>
                <strong>{card.title}</strong>
                <small>{card.country || 'Australia'}</small>
              </div>
              <div className="buzzcast-join-ribbon">21 joined</div>
              <div className="buzzcast-gift-bar">
                {giftItems.map((gift) => (
                  <button key={gift.label} type="button">
                    <span>{gift.label}</span>
                    <small>{gift.cost}</small>
                  </button>
                ))}
                <button type="button" onClick={() => setShowRecharge(true)}>More</button>
                <button type="button" onClick={() => setShowRecharge(true)}>0</button>
              </div>
            </>
          )}
        </div>
        <aside className="buzzcast-live-chat">
          <p>Be polite and respectful. Any vulgar, violent, or private transaction behavior is strictly prohibited in TalkEachOther. Please speak in a civilized manner.</p>
          <div className="buzzcast-chat-log">
            <span><b>18</b> joined</span>
            <span><b>2</b> joined</span>
          </div>
          <form onSubmit={sendDmMessage}>
            <input value={dmInput} onChange={(event) => setDmInput(event.target.value)} placeholder="Send a chat" />
          </form>
        </aside>
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
    <div className="buzzcast-shell">
      <header className="buzzcast-topbar">
        <BuzzLogo />
        <div className="buzzcast-search-wrap">
          <label className="sr-only" htmlFor="buzzcast-search">Search</label>
          <input
            id="buzzcast-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onFocus={() => setShowSearchPanel(true)}
            onBlur={() => window.setTimeout(() => setShowSearchPanel(false), 160)}
            placeholder="Search"
          />
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => loadRooms({ page: 1 })} aria-label="Search rooms">
            <span className="buzzcast-search-icon" aria-hidden="true"></span>
          </button>
          {showSearchPanel ? (
            <div className="buzzcast-search-panel">
              <span>{roomSearchResults.length ? 'Rooms' : 'No room matches yet'}</span>
              {roomSearchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectRoom(item.room)}
                >
                  <i>{initialsFromName(item.name)}</i>
                  <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="buzzcast-actions">
          {showAdminDashboard ? (
            <IconButton label="Admin dashboard" onClick={() => onView?.('admin')}><i className="buzzcast-glyph glyph-admin" aria-hidden="true"></i></IconButton>
          ) : null}
          <IconButton label="Rankings"><i className="buzzcast-glyph glyph-trophy" aria-hidden="true"></i></IconButton>
          <IconButton label="Messages" badge="5" onClick={() => setShowMessages(true)}><i className="buzzcast-glyph glyph-message" aria-hidden="true"></i></IconButton>
          <IconButton label="Create live room" className="accent" onClick={() => setShowHostPanel(true)}>+</IconButton>
          <button type="button" className="buzzcast-avatar-button" onClick={() => setActiveSection('me')}>
            <span>{profileInitials}</span>
          </button>
        </div>
      </header>

      <aside className="buzzcast-left-rail">
        <button type="button" className={activeSection === 'live' || activeSection === 'room' ? 'active' : ''} onClick={openLiveSection}>
          <span className="buzzcast-rail-icon rail-live" aria-hidden="true"></span>
          <b>Live</b>
        </button>
        <button type="button" className={activeSection === 'me' ? 'active' : ''} onClick={() => setActiveSection('me')}>
          <span className="buzzcast-rail-icon rail-me" aria-hidden="true"></span>
          <b>Me</b>
        </button>
        <div className="buzzcast-rail-spacer"></div>
        <button type="button" onClick={() => setShowInstall(true)}>
          <span className="buzzcast-rail-icon rail-app" aria-hidden="true"></span>
          <b>Get the App</b>
        </button>
        <button type="button" className={activeSection === 'settings' ? 'active' : ''} onClick={() => setActiveSection('settings')}>
          <span className="buzzcast-rail-icon rail-settings" aria-hidden="true"></span>
          <b>Settings</b>
        </button>
        <button type="button" className={activeSection === 'help' ? 'active' : ''} onClick={() => setActiveSection('help')}>
          <span className="buzzcast-rail-icon rail-help" aria-hidden="true"></span>
          <b>Feedback and Help</b>
        </button>
      </aside>

      <main className="buzzcast-main">
        {activeSection === 'live' && renderLiveFeed()}
        {activeSection === 'room' && renderRoomPreview()}
        {activeSection === 'me' && renderProfile()}
        {activeSection === 'settings' && renderSettings()}
        {activeSection === 'help' && renderHelp()}
      </main>

      {showMessages ? (
        <section className="buzzcast-messages-drawer">
          <aside>
            <input placeholder="Search" />
            {dmThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={activeThread === thread.id ? 'active' : ''}
                onClick={() => setActiveThread(thread.id)}
              >
                <i>{initialsFromName(thread.name)}</i>
                <span><strong>{thread.name}</strong><small>{thread.preview}</small></span>
                <time>{thread.time}</time>
                {thread.unread ? <em>{thread.unread}</em> : null}
              </button>
            ))}
          </aside>
          <main>
            <header>
              <strong>{activeThreadData.name}</strong>
              <span>( ID: 32165333)</span>
              <button type="button" onClick={() => setShowMessages(false)}>End session</button>
            </header>
            <div className="buzzcast-dm-notice">You can send up to 2 messages before they reply or follow you</div>
            <div className="buzzcast-dm-body">
              {(dmMessages[activeThread] || []).map((message) => (
                <p key={message.id} className={message.mine ? 'mine' : ''}>{message.body}</p>
              ))}
            </div>
            <form onSubmit={sendDmMessage}>
              <input value={dmInput} onChange={(event) => setDmInput(event.target.value)} placeholder="Send a chat" />
            </form>
          </main>
        </section>
      ) : null}

      {showInstall ? (
        <div className="buzzcast-modal-backdrop">
          <section className="buzzcast-install-modal">
            <h2>Install app</h2>
            <div>
              <div className="buzzcast-logo-mark">TE</div>
              <span><strong>TalkEachOther</strong><small>TalkEachOther RTC</small></span>
            </div>
            <footer>
              <button type="button" className="primary" onClick={handleInstallApp}>Install</button>
              <button type="button" onClick={() => setShowInstall(false)}>Cancel</button>
            </footer>
          </section>
        </div>
      ) : null}

      {showHostPanel ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowHostPanel(false)}>
          <section className="buzzcast-host-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Create Live Room</h2>
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
              <div className="buzzcast-choice-grid">
                {Object.entries(roomTypeLabels).map(([value, label]) => (
                  <button key={value} type="button" className={roomForm.room_type === value ? 'active' : ''} onClick={() => updateRoomForm('room_type', value)}>{label}</button>
                ))}
              </div>
              <label>Privacy</label>
              <div className="buzzcast-choice-grid">
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
              <div className="buzzcast-host-fields">
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
              <div className="buzzcast-toggle-grid">
                {roomFeatureOptions.map((option) => (
                  <label key={option.field}>
                    <input type="checkbox" checked={Boolean(roomForm[option.field])} onChange={(event) => updateRoomForm(option.field, event.target.checked)} />
                    <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  </label>
                ))}
              </div>
              <button className="buzzcast-submit" disabled={creating} type="submit">{creating ? 'Creating...' : 'Create Live Room'}</button>
            </form>

            <div className="buzzcast-quick-join">
              <h3>Quick Join</h3>
              <label>RTC Mode</label>
              <div className="buzzcast-choice-grid">
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
              <button className="buzzcast-submit secondary" type="button" onClick={joinSelectedRoom} disabled={!canJoinRoom}>{openingRoom ? 'Opening...' : 'Open RTC Console'}</button>
              {createdRoom ? (
                <button
                  className="buzzcast-submit"
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

      {showRecharge ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowRecharge(false)}>
          <section className="buzzcast-recharge-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Balance <span>0</span></h2>
              <button type="button" onClick={() => setShowRecharge(false)}>x</button>
            </header>
            <div className="buzzcast-recharge-tabs"><button type="button" className="active">Top-up</button><button type="button">Reseller</button></div>
            {paymentMethods.map((method) => <button type="button" key={method}>{method}<span>v</span></button>)}
            <button type="button" className="buzzcast-recharge-button">Recharge</button>
          </section>
        </div>
      ) : null}

      {showFeedback ? (
        <div className="buzzcast-modal-backdrop dark">
          <section className="buzzcast-feedback-modal">
            <header><h2>Feedback</h2><button type="button" onClick={() => setShowFeedback(false)}>x</button></header>
            <div className="buzzcast-feedback-row">
              <select><option>Select question type</option></select>
              <select><option>Select question type</option></select>
            </div>
            <label>Problem description</label>
            <textarea placeholder="Please provide as much detail as possible" maxLength={1000}></textarea>
            <label>Problem screenshot / screen recording <small>(optional)</small></label>
            <div className="buzzcast-upload-box"></div>
            <label>Contact information <small>(optional)</small></label>
            <input placeholder="Enter your email account" />
            <button type="button" className="buzzcast-submit" onClick={() => setShowFeedback(false)}>Submit</button>
          </section>
        </div>
      ) : null}
    </div>
  )
}
