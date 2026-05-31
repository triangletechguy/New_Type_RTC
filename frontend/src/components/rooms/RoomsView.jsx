import { useEffect, useMemo, useState } from 'react'
import { avatarForIndex, brandAssets, coverForDemoTone, coverForRoomType, roomAssets } from '../../assets/rtc/catalog'
import { ProfilePanel } from '../profile/ProfilePanel'
import { apiRequest } from '../../services/api'
import { canUseAdminDashboard } from '../../utils/roles'
import {
  buildRoomsPath,
  defaultRoomForm,
  defaultRtcModeForRoom,
  getRoomMeta,
  normalizeRtcMode,
  privacyFilterOptions,
  roomFeatureOptions,
  roomFormPayload,
  roomFilterOptions,
  roomPrivacyOptions,
  roomSortOptions,
  roomSupportsVideo,
  roomTypeLabels,
  rtcModeOptions,
  themeOptions,
  validateRoomForm,
} from '../../utils/roomConfig'
import { giftCatalog } from '../../utils/gifts'

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
  { id: 'demo-1', title: 'Creator Studio Warm-up', host: 'Maya Studio', viewers: 5631, tone: 'aurora', country: 'United States', size: 'feature', badge: 'Group Video', roomType: 'group_video', avatarIndex: 0 },
  { id: 'demo-2', title: 'Open Mic Lounge', host: 'Luna Waves', viewers: 6018, tone: 'warm', category: 'Music', badge: 'Music', roomType: 'audio', avatarIndex: 1 },
  { id: 'demo-3', title: 'Daily Product Standup', host: 'Nora Labs', viewers: 1794, tone: 'rose', category: 'Video', roomType: 'video', avatarIndex: 2 },
  { id: 'demo-4', title: 'Design Review Live', host: 'Pixel Team', viewers: 6186, tone: 'sunset', roomType: 'group_video', avatarIndex: 3 },
  { id: 'demo-5', title: 'Creator Office Hours', host: 'TalkEachOther', viewers: 1090, tone: 'slate', roomType: 'solo_live', avatarIndex: 4 },
  { id: 'demo-6', title: 'Acoustic Session', host: 'Matt M.', viewers: 589, tone: 'amber', roomType: 'group_audio', avatarIndex: 5 },
  { id: 'demo-7', title: 'Night Studio', host: 'Natalie', viewers: 5689, tone: 'night', roomType: 'video', avatarIndex: 6 },
  { id: 'demo-8', title: 'Global Music Room', host: 'Lyss', viewers: 1418, tone: 'plum', country: 'Canada', roomType: 'audio', avatarIndex: 7 },
  { id: 'demo-9', title: 'Supporter Lounge', host: 'Community Ops', viewers: 2032, tone: 'copper', badge: 'Gifts', roomType: 'group_audio', avatarIndex: 1 },
  { id: 'demo-10', title: 'Morning Sync', host: 'Sarah', viewers: 7489, tone: 'cloud', roomType: 'group_video', avatarIndex: 2 },
  { id: 'demo-11', title: 'Private Client Demo', host: 'Enterprise Desk', viewers: 1853, tone: 'wine', privacy: 'private', badge: 'Private', roomType: 'video', avatarIndex: 3 },
  { id: 'demo-12', title: 'Password Beta Room', host: 'QA Studio', viewers: 928, tone: 'silver', privacy: 'password', badge: 'Locked', roomType: 'video', avatarIndex: 4 },
  { id: 'demo-13', title: 'Fresh Creator Drop', host: 'Winnie', viewers: 208, tone: 'olive', tab: 'latest', roomType: 'solo_live', avatarIndex: 5 },
  { id: 'demo-14', title: 'New Host Practice', host: 'Seyi', viewers: 84, tone: 'taupe', tab: 'latest', roomType: 'video', avatarIndex: 6 },
  { id: 'demo-15', title: 'Audio Check Room', host: 'Engineering', viewers: 77, tone: 'mono', tab: 'latest', roomType: 'audio', avatarIndex: 7 },
  { id: 'demo-16', title: 'First Stream Setup', host: 'Vee Studio', viewers: 136, tone: 'rose', tab: 'latest', roomType: 'solo_live', avatarIndex: 0 },
  { id: 'demo-17', title: 'Nearby Creators', host: 'John F.', viewers: 527, tone: 'earth', tab: 'nearby', roomType: 'group_video', avatarIndex: 1 },
  { id: 'demo-18', title: 'Community Check-in', host: 'Art Room', viewers: 181, tone: 'mid', tab: 'nearby', roomType: 'group_audio', avatarIndex: 2 },
  { id: 'demo-19', title: 'Moderator Training', host: 'Ocean Ops', viewers: 57, tone: 'violet', tab: 'nearby', roomType: 'video', avatarIndex: 3 },
  { id: 'demo-20', title: 'Local Music Circle', host: 'ChiChi', viewers: 1238, tone: 'pink', tab: 'nearby', roomType: 'audio', avatarIndex: 4 },
  { id: 'demo-21', title: 'Game Night Voice', host: 'Paniax Gaming', viewers: 299, tone: 'game', tab: 'explore', explore: 'games', roomType: 'group_video', avatarIndex: 5 },
  { id: 'demo-22', title: 'Watch Party Studio', host: 'Cleo', viewers: 1230, tone: 'sand', tab: 'explore', explore: 'games', roomType: 'group_video', avatarIndex: 6 },
  { id: 'demo-23', title: 'Film Room Live', host: 'Prime Stage', viewers: 68279, tone: 'ocean', tab: 'explore', explore: 'games', roomType: 'video', avatarIndex: 7 },
  { id: 'demo-24', title: 'PK Creator Battle', host: 'United States', viewers: 865, tone: 'sky', tab: 'party', party: true, roomType: 'pk_live', avatarIndex: 0 },
  { id: 'demo-25', title: 'Community Party', host: 'Stage Hosts', viewers: 5133, tone: 'storm', tab: 'party', party: true, roomType: 'group_video', avatarIndex: 1 },
  { id: 'demo-26', title: 'Cozy Streamer Night', host: 'The Cozy Studio', viewers: 244, tone: 'ember', tab: 'party', party: true, roomType: 'solo_live', avatarIndex: 2 },
  { id: 'demo-27', title: 'Community Guidelines Preview', host: 'Trust and Safety', viewers: 6345, tone: 'sensitive', sensitive: true, privacy: 'private', roomType: 'video', avatarIndex: 3 },
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
const paymentMethods = ['Google Pay', 'PayPal', 'Apple Pay', 'Visa/ MasterCard/ JCB/ AMEX/ DINERS', 'Dpay(USDT & Bitcoin)', 'Razer Gold Wallet']
const feedbackCategories = ['Account', 'Room / RTC', 'Payment', 'Chat', 'Safety']
const feedbackTypes = ['Bug report', 'Feature request', 'Payment issue', 'Abuse report', 'Other']

const popularHelp = [
  { id: 'recharge', title: 'How to recharge', body: 'Open a live room, click More in the gift bar, choose a payment method, then use Recharge to add diamonds.' },
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

function cardAvatarIndex(card, fallback = 0) {
  if (Number.isFinite(Number(card?.avatarIndex))) return Number(card.avatarIndex)
  if (card?.room?.id) return Number(card.room.id)
  const numericId = String(card?.id || '').match(/\d+/)?.[0]
  return Number(numericId || fallback)
}

function cardCover(card, fallback = 0) {
  if (card?.room) return coverForRoomType(card.room.room_type, card.room.privacy_type, cardAvatarIndex(card, fallback))
  if (card?.roomType || card?.privacy) return coverForRoomType(card.roomType, card.privacy, cardAvatarIndex(card, fallback))
  return coverForDemoTone(card?.tone, cardAvatarIndex(card, fallback))
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
    roomType: room.room_type,
    privacy: room.privacy_type,
    avatarIndex: Number(room.id) || index,
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
      <div className="buzzcast-logo-mark image-mark">
        <img src={brandAssets.appIcon} alt="TalkEachOther" />
      </div>
      <div>
        <strong>TalkEachOther</strong>
        <span>Video and music rooms</span>
      </div>
    </div>
  )
}

function FeedCard({ card, featured, onOpen }) {
  const cover = cardCover(card)
  const avatarIndex = cardAvatarIndex(card)

  return (
    <article className={`buzzcast-room-card ${featured ? 'featured' : ''}`}>
      <button type="button" className="buzzcast-card-button" onClick={() => onOpen(card)}>
        <div className={`buzzcast-media media-${card.tone || 'aurora'}`}>
          <img className="buzzcast-media-image" src={cover} alt="" loading="lazy" />
          {card.badge ? <span className="buzzcast-card-badge">{card.badge}</span> : null}
          {card.sensitive ? <span className="buzzcast-sensitive-dot"></span> : null}
          <span className="buzzcast-viewers">{compactNumber(card.viewers)}</span>
          <span className="buzzcast-seat-dots">
            {[0, 1, 2].map((offset) => (
              <i key={offset}><img src={avatarForIndex(avatarIndex + offset)} alt="" loading="lazy" /></i>
            ))}
          </span>
        </div>
        <div className="buzzcast-card-copy">
          <strong>{card.title}</strong>
          <span>{card.host}</span>
        </div>
      </button>
    </article>
  )
}

export function RoomsView({ onEnterRoom, user, onLogout, onUserUpdated, onView, onAuthRequired }) {
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
  const [settingsStatus, setSettingsStatus] = useState('')
  const [settingsDraft, setSettingsDraft] = useState({
    phoneBound: false,
    emailBound: Boolean(user?.email),
    loginPasswordSet: true,
    paymentPasswordSet: false,
    deviceAlerts: true,
    messagePrivacy: 'everyone',
    privateInvite: true,
    autoPrivateDeduction: false,
    hideSensitive: true,
    contentMode: 'warning',
    language: 'English',
    region: user?.current_residence || 'United States',
  })
  const [helpMode, setHelpMode] = useState('popular')
  const [activeHelp, setActiveHelp] = useState('recharge')
  const [activeThread, setActiveThread] = useState(dmThreads[0].id)
  const [dmMessages, setDmMessages] = useState(initialDmMessages)
  const [dmInput, setDmInput] = useState('')
  const [previewCard, setPreviewCard] = useState(null)
  const [acceptedWarnings, setAcceptedWarnings] = useState({})
  const [feedbackForm, setFeedbackForm] = useState({
    category: feedbackCategories[0],
    type: feedbackTypes[0],
    description: '',
    contact: user?.email || '',
    attachment: null,
  })
  const [feedbackStatus, setFeedbackStatus] = useState('')

  const displayName = user?.name || user?.email?.split('@')[0] || 'Guest'
  const displayId = user?.id || 0
  const profileInitials = initialsFromName(displayName)
  const showAdminDashboard = canUseAdminDashboard(user) === true
  const selectedRoomNeedsPassword = selectedRoom?.privacy_type === 'password' && roomId === String(selectedRoom.id)
  const selectedRoomSupportsVideo = !selectedRoom || roomSupportsVideo(selectedRoom.room_type)
  const canJoinRoom = Boolean(roomId.trim()) && !openingRoom && (!selectedRoomNeedsPassword || Boolean(joinPassword.trim()))

  const roomCards = useMemo(() => rooms.map(roomToFeedCard), [rooms])
  const searchTerm = search.trim().toLowerCase()
  const roomSearchResults = useMemo(() => {
    const includesTerm = (value) => String(value || '').toLowerCase().includes(searchTerm)
    const liveResults = rooms
      .filter((room) => !searchTerm || includesTerm(`${room.name} ${room.host_name} ${room.room_type} ${room.privacy_type}`))
      .slice(0, 8)
      .map((room) => ({
        id: room.id,
        type: 'room',
        name: room.name || `Room ${room.id}`,
        detail: `${getRoomMeta(room.room_type).label} - ${room.privacy_type || 'public'}`,
        room,
      }))
    const demoResults = searchTerm
      ? demoCards
        .filter((card) => includesTerm(`${card.title} ${card.host} ${card.roomType} ${card.badge} ${card.privacy || 'public'}`))
        .slice(0, 6)
        .map((card) => ({
          id: card.id,
          type: 'demo',
          name: card.title,
          detail: `${getRoomMeta(card.roomType).label} - ${card.privacy || 'public'}`,
          avatarIndex: card.avatarIndex,
          card,
        }))
      : []

    return [...liveResults, ...demoResults].slice(0, 8)
  }, [rooms, searchTerm])
  const visibleCards = useMemo(() => {
    const usingLiveRooms = roomCards.length > 0
    let cards = usingLiveRooms ? [...roomCards] : [...demoCards]

    if (usingLiveRooms) {
      if (activeFeed === 'party') cards = cards.filter((card) => card.room?.room_type === 'pk_live')
      if (activeFeed === 'explore' && activeExplore === 'pk') cards = cards.filter((card) => card.room?.room_type === 'pk_live')
      if (activeFeed === 'explore' && activeExplore === 'games') cards = cards.filter((card) => roomSupportsVideo(card.room?.room_type))
      return cards.slice(0, 48)
    }

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

  function requireAuth(reason = 'Log in or sign up to continue.', mode = 'login') {
    if (user) return true
    onAuthRequired?.(reason, mode)
    return false
  }

  function pushSectionHistory(section, options = {}) {
    if (typeof window === 'undefined') return

    const state = {
      ...(window.history.state || {}),
      view: 'rooms',
      activeRoom: null,
      buzzcastSection: section,
      previewCardId: options.previewCardId || null,
    }
    const path = section === 'room' && options.previewCardId
      ? `/preview/${encodeURIComponent(options.previewCardId)}`
      : section === 'live'
        ? '/'
        : `/${section}`

    window.history.pushState(state, '', path)
  }

  function applySectionFromHistory(state = {}) {
    const section = state.buzzcastSection || 'live'
    if (section === 'room' && state.previewCardId) {
      const card = demoCards.find((item) => item.id === state.previewCardId)
      if (card) {
        setPreviewCard(card)
        setActiveSection('room')
        return
      }
    }

    if (['live', 'me', 'settings', 'help'].includes(section)) {
      setActiveSection(section)
      if (section !== 'room') setPreviewCard(null)
    }
  }

  function openProfileSection() {
    if (!requireAuth('Log in or sign up to open your profile.', 'login')) return
    pushSectionHistory('me')
    setActiveSection('me')
  }

  function openSettingsSection(nextSettings = activeSettings) {
    if (!requireAuth('Log in to manage your account settings.', 'login')) return
    pushSectionHistory('settings')
    setActiveSettings(nextSettings)
    setActiveSection('settings')
  }

  function openHostPanel(reason = 'Log in or sign up to create a live room.') {
    if (!requireAuth(reason, 'register')) return
    setShowHostPanel(true)
  }

  function openMessagesDrawer() {
    if (!requireAuth('Log in to open messages and chat with people.', 'login')) return
    setShowMessages(true)
  }

  function openRechargePanel() {
    if (!requireAuth('Log in to use wallet and room gifts.', 'login')) return
    setShowRecharge(true)
  }

  function updateSettings(field, value, message) {
    setSettingsDraft((previous) => ({ ...previous, [field]: value }))
    setSettingsStatus(message)
  }

  function updateFeedback(field, value) {
    setFeedbackForm((previous) => ({ ...previous, [field]: value }))
    setFeedbackStatus('')
  }

  function handleFeedbackAttachment(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 25 * 1024 * 1024) {
      event.target.value = ''
      setFeedbackStatus('Attachment must be 25 MB or smaller.')
      return
    }

    updateFeedback('attachment', file)
    setFeedbackStatus(`${file.name} attached.`)
  }

  function removeFeedbackAttachment() {
    setFeedbackForm((previous) => ({ ...previous, attachment: null }))
    setFeedbackStatus('Attachment removed.')
  }

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

  function openSearchResult(item) {
    if (item.room) {
      selectRoom(item.room)
      setActiveSection('live')
      setPreviewCard(null)
    } else if (item.card) {
      openCard(item.card)
    }

    setShowSearchPanel(false)
  }

  function runSearch() {
    setShowSearchPanel(true)
    loadRooms({ page: 1, searchValue: search })
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setShowSearchPanel(false)
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    if (roomSearchResults[0]) {
      openSearchResult(roomSearchResults[0])
      return
    }

    runSearch()
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
    pushSectionHistory('live')
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
    const path = buildRoomsPath({
      page,
      search: searchValue,
      filter: filterValue,
      privacy: privacyValue,
      sort: sortValue,
    })

    function applyRoomData(data) {
      const meta = data.rooms?.meta || { page, per_page: 24, total: 0, total_pages: 1 }
      setRooms(data.rooms?.data || [])
      setRoomMeta(meta)
      setStatus(meta.total === 1 ? 'Showing 1 room' : `Showing ${meta.total} rooms`)
    }

    try {
      if (!quiet) setStatus('Loading rooms...')
      applyRoomData(await apiRequest(path))
    } catch (error) {
      if (error.status === 401) {
        try {
          applyRoomData(await apiRequest(path))
          return
        } catch (retryError) {
          setStatus(retryError.message)
          return
        }
      }

      setStatus(error.message)
    } finally {
      setLoadingRooms(false)
    }
  }

  async function createRoom(event) {
    event.preventDefault()
    if (!requireAuth('Log in or sign up to create a live room.', 'register')) return

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
    if (!requireAuth('Log in to open the RTC console.', 'login')) return
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
    if (!requireAuth('Log in to join live rooms.', 'login')) return

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

    pushSectionHistory('room', { previewCardId: card.id })
    setPreviewCard(card)
    setActiveSection('room')
  }

  function sendDmMessage(event) {
    event.preventDefault()
    if (!requireAuth('Log in to send chat messages.', 'login')) return
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

  function submitFeedback(event) {
    event.preventDefault()
    if (feedbackForm.description.trim().length < 10) {
      setFeedbackStatus('Please add at least 10 characters so support can understand the issue.')
      return
    }

    setFeedbackStatus('Feedback submitted. Thank you for helping improve TalkEachOther.')
    window.setTimeout(() => {
      setShowFeedback(false)
      setFeedbackStatus('')
      setFeedbackForm({
        category: feedbackCategories[0],
        type: feedbackTypes[0],
        description: '',
        contact: user?.email || '',
        attachment: null,
      })
    }, 900)
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
      <section className="buzzcast-discover">
        <nav className="buzzcast-feed-nav" aria-label="Room feed">
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

        {activeFeed === 'explore' ? (
          <div className="buzzcast-filter-pills">
            {exploreFilters.map((option) => (
              <button
                key={option.value}
                type="button"
                className={activeExplore === option.value ? 'active' : ''}
                onClick={() => switchExplore(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="buzzcast-match-banner">
          <strong>Live rooms built for video, music, chat, gifts, and enterprise RTC demos</strong>
          <button type="button" onClick={() => openHostPanel()}>Create room</button>
        </div>

        <div className="buzzcast-feed-controls">
          <span>{visibleCards.length} rooms - {loadingRooms ? 'Refreshing rooms...' : status}</span>
          <div>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Room type filter">
              {roomFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={privacyFilter} onChange={(event) => setPrivacyFilter(event.target.value)} aria-label="Room privacy filter">
              {privacyFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Room sort">
              {roomSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        {loadingRooms && rooms.length === 0 ? (
          <div className="buzzcast-empty-state">Loading rooms...</div>
        ) : visibleCards.length === 0 ? (
          <div className="buzzcast-empty-state visual">
            <img src={roomAssets.studioStage} alt="" loading="lazy" />
            <div>
              <strong>No matching rooms yet</strong>
              <span>Create one or adjust the filters to bring live rooms into this grid.</span>
            </div>
          </div>
        ) : (
          <>
            <div className={`buzzcast-card-grid ${activeFeed === 'party' ? 'party-grid' : ''}`}>
              {visibleCards.map((card, index) => (
                <FeedCard
                  key={card.id}
                  card={card}
                  featured={index === 0 && activeFeed !== 'party'}
                  onOpen={openCard}
                />
              ))}
            </div>

            {roomMeta.total_pages > 1 ? (
              <div className="buzzcast-pagination">
                <button type="button" onClick={() => loadRooms({ page: Math.max(1, roomMeta.page - 1) })} disabled={loadingRooms || roomMeta.page <= 1}>Previous</button>
                <span>{roomMeta.total} total rooms</span>
                <button type="button" onClick={() => loadRooms({ page: Math.min(roomMeta.total_pages, roomMeta.page + 1) })} disabled={loadingRooms || roomMeta.page >= roomMeta.total_pages}>Next</button>
              </div>
            ) : null}
          </>
        )}
      </section>
    )
  }

  function renderProfile() {
    return <ProfilePanel user={user} onSaved={onUserUpdated} onLogout={onLogout} />
  }

  function renderSettingsContent() {
    if (activeSettings === 'privacy') {
      return (
        <div className="buzzcast-settings-list">
          <label className="buzzcast-select-row">
            <span><strong>Who can send me a message</strong><small>Controls the personal inbox and room chat shortcuts.</small></span>
            <select
              value={settingsDraft.messagePrivacy}
              onChange={(event) => updateSettings('messagePrivacy', event.target.value, 'Message privacy updated.')}
            >
              <option value="everyone">Everyone</option>
              <option value="followers">Followers only</option>
              <option value="nobody">Nobody</option>
            </select>
          </label>
          <label className="buzzcast-switch-row">
            <span><strong>Private live invitation</strong><small>Allow hosts to invite you into private live rooms.</small></span>
            <input
              type="checkbox"
              checked={settingsDraft.privateInvite}
              onChange={(event) => updateSettings('privateInvite', event.target.checked, 'Private live invitation setting updated.')}
            />
          </label>
          <label className="buzzcast-switch-row">
            <span><strong>Automatic deduction for entering the private live broadcast room</strong><small>After opening, private rooms can automatically deduct diamonds.</small></span>
            <input
              type="checkbox"
              checked={settingsDraft.autoPrivateDeduction}
              onChange={(event) => updateSettings('autoPrivateDeduction', event.target.checked, 'Private-room deduction setting updated.')}
            />
          </label>
          <button type="button" onClick={() => setSettingsStatus('Use Block in the chat panel to hide a user and remove their messages from your view.')}>
            <span><strong>Blacklist</strong><small>Blocked users are controlled from the chat user menu.</small></span>
            <b>&gt;</b>
          </button>
          <button type="button" onClick={() => updateSettings('hideSensitive', !settingsDraft.hideSensitive, 'Live preference updated.')}>
            <span><strong>Live broadcast you are not interested in</strong><small>{settingsDraft.hideSensitive ? 'Filtered from your feed.' : 'Visible in your feed.'}</small></span>
            <em>{settingsDraft.hideSensitive ? 'Filtered' : 'Show'}</em>
          </button>
        </div>
      )
    }

    if (activeSettings === 'content') {
      const modes = [
        { value: 'restricted', label: 'Restricted Mode', helper: 'Hide potentially sensitive content.' },
        { value: 'warning', label: 'Warning Mode', helper: 'Show a warning before sensitive rooms open.' },
        { value: 'all', label: 'All Modes', helper: 'Show all room content that is available to your account.' },
      ]

      return (
        <div className="buzzcast-settings-list">
          {modes.map((item) => (
            <label key={item.value} className="buzzcast-radio-row">
              <span><strong>{item.label}</strong><small>{item.helper}</small></span>
              <input
                type="radio"
                name="content-mode"
                checked={settingsDraft.contentMode === item.value}
                onChange={() => updateSettings('contentMode', item.value, `${item.label} selected.`)}
              />
            </label>
          ))}
        </div>
      )
    }

    if (activeSettings === 'language') {
      return (
        <div className="buzzcast-settings-list compact">
          {languages.map((item) => (
            <label key={item} className="buzzcast-radio-row">
              <span><strong>{item}</strong></span>
              <input
                type="radio"
                name="language"
                checked={settingsDraft.language === item}
                onChange={() => updateSettings('language', item, `Language changed to ${item}.`)}
              />
            </label>
          ))}
        </div>
      )
    }

    if (activeSettings === 'region') {
      const regionSearch = settingsDraft.regionSearch || ''
      const visibleRegions = regions.filter((item) => !regionSearch.trim() || item.toLowerCase().includes(regionSearch.trim().toLowerCase()))

      return (
        <div className="buzzcast-region-panel">
          <input
            placeholder="Search region"
            value={regionSearch}
            onChange={(event) => setSettingsDraft((previous) => ({ ...previous, regionSearch: event.target.value }))}
          />
          <div className="buzzcast-settings-list compact">
            {visibleRegions.map((item) => (
              <label key={item} className="buzzcast-radio-row">
                <span><strong>{item}</strong></span>
                <input
                  type="radio"
                  name="region"
                  checked={settingsDraft.region === item}
                  onChange={() => {
                    setSettingsDraft((previous) => ({ ...previous, region: item, regionSearch: '' }))
                    setSettingsStatus(`Region changed to ${item}.`)
                  }}
                />
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
            <button type="button" key={item} onClick={() => setSettingsStatus(`${item} will open in the production policy page.`)}>
              <span><strong>{item}</strong></span>
              <b>&gt;</b>
            </button>
          ))}
        </div>
      )
    }

    const accountRows = [
      {
        field: 'phoneBound',
        label: 'Binding cell phone',
        helper: 'Recommended for account recovery and high-value payments.',
        on: 'Bound',
        off: 'Bind cell phone',
      },
      {
        field: 'emailBound',
        label: 'Binding email',
        helper: 'Used for login recovery and security notices.',
        on: 'Bound',
        off: 'Bind email',
      },
      {
        field: 'loginPasswordSet',
        label: 'Set login password',
        helper: 'Protect this account when signing in on a new device.',
        on: 'Set',
        off: 'Set password',
      },
      {
        field: 'paymentPasswordSet',
        label: 'Set payment password',
        helper: 'Add a second check before diamond purchases.',
        on: 'Set',
        off: 'Set password',
      },
      {
        field: 'deviceAlerts',
        label: 'Devices Logged In',
        helper: 'Show alerts when a new device logs in.',
        on: 'Alerts on',
        off: 'Alerts off',
      },
    ]

    return (
      <div className="buzzcast-security-panel">
        <div className="buzzcast-safety-card">
          <strong>{settingsDraft.emailBound && settingsDraft.loginPasswordSet ? 'Normal level of safety' : 'Improve account safety'}</strong>
          <button type="button" onClick={() => setSettingsStatus('Account security checked.')}>OK</button>
        </div>
        <div className="buzzcast-settings-list">
          {accountRows.map((item) => (
            <button
              type="button"
              key={item.field}
              onClick={() => updateSettings(item.field, !settingsDraft[item.field], `${item.label} updated.`)}
            >
              <span><strong>{item.label}</strong><small>{item.helper}</small></span>
              <em>{settingsDraft[item.field] ? item.on : item.off}</em>
            </button>
          ))}
        </div>
      </div>
    )
  }

  function renderSettings() {
    const activeSettingsItem = settingsNav.find((item) => item.value === activeSettings) || settingsNav[0]

    return (
      <section className="buzzcast-settings-shell">
        <aside className="buzzcast-settings-nav">
          {settingsNav.map((item) => (
            <button
              key={item.value}
              type="button"
              className={activeSettings === item.value ? 'active' : ''}
              onClick={() => {
                setActiveSettings(item.value)
                setSettingsStatus('')
              }}
            >
              <i>{item.icon}</i>
              <span>{item.label}</span>
              <b>&gt;</b>
            </button>
          ))}
        </aside>
        <div className="buzzcast-settings-content">
          <div className="buzzcast-settings-heading">
            <h2>{activeSettingsItem.label}</h2>
            <p>{settingsStatus || 'Changes are applied immediately for this session.'}</p>
          </div>
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
    const previewCover = cardCover(card)
    const previewAvatar = avatarForIndex(cardAvatarIndex(card))

    return (
      <section className="buzzcast-room-preview">
        <div className={`buzzcast-stage media-${card.tone || 'sensitive'}`}>
          <img className="buzzcast-stage-image" src={previewCover} alt="" />
          {isWarning ? (
            <div className="buzzcast-warning-panel">
              <strong>This live broadcast may contain sensitive content</strong>
              <button type="button" onClick={() => setAcceptedWarnings((previous) => ({ ...previous, [card.id]: true }))}>View</button>
              <button type="button" onClick={() => openSettingsSection('content')}>Content Preferences</button>
            </div>
          ) : (
            <>
              <div className="buzzcast-host-pill">
                <span className="image-avatar"><img src={previewAvatar} alt="" loading="lazy" /></span>
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
                {giftCatalog.slice(0, 11).map((gift) => (
                  <button key={gift.id} type="button" title={`${gift.label} - ${gift.cost}`}>
                    <img src={gift.icon} alt="" loading="lazy" />
                    <span>{gift.label}</span>
                    <small>{gift.cost}</small>
                  </button>
                ))}
                <button type="button" onClick={openRechargePanel}>More</button>
                <button type="button" onClick={openRechargePanel}>0</button>
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
    setSettingsDraft((previous) => ({
      ...previous,
      emailBound: previous.emailBound || Boolean(user?.email),
      region: user?.current_residence || previous.region || 'United States',
    }))
    setFeedbackForm((previous) => ({
      ...previous,
      contact: previous.contact || user?.email || '',
    }))
  }, [user?.email, user?.current_residence])

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

  useEffect(() => {
    function handlePopState(event) {
      applySectionFromHistory(event.state || {})
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (user) return
    if (activeSection === 'me' || activeSection === 'settings') setActiveSection('live')
    setShowMessages(false)
    setShowHostPanel(false)
    setShowRecharge(false)
  }, [activeSection, user])

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
            onKeyDown={handleSearchKeyDown}
            onFocus={() => setShowSearchPanel(true)}
            onBlur={() => window.setTimeout(() => setShowSearchPanel(false), 160)}
            placeholder="Search"
          />
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={runSearch} aria-label="Search rooms">
            <span className="buzzcast-search-icon" aria-hidden="true"></span>
          </button>
          {showSearchPanel ? (
            <div className="buzzcast-search-panel">
              <span>{loadingRooms ? 'Searching rooms...' : search.trim() ? `${roomSearchResults.length} result${roomSearchResults.length === 1 ? '' : 's'}` : 'Search live rooms'}</span>
              {roomSearchResults.map((item, index) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openSearchResult(item)}
                >
                  <i className="image-avatar"><img src={avatarForIndex(item.avatarIndex ?? item.id ?? index)} alt="" loading="lazy" /></i>
                  <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                </button>
              ))}
              {!loadingRooms && roomSearchResults.length === 0 ? (
                <em>{search.trim() ? 'Try another room name, host, or room type.' : 'Type a room name, host, or category.'}</em>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="buzzcast-actions">
          {showAdminDashboard ? (
            <IconButton label="Admin dashboard" onClick={() => onView?.('admin')}><i className="buzzcast-glyph glyph-admin" aria-hidden="true"></i></IconButton>
          ) : null}
          <IconButton label="Rankings"><i className="buzzcast-glyph glyph-trophy" aria-hidden="true"></i></IconButton>
          <IconButton label="Create live room" className="accent" onClick={() => openHostPanel()}>+</IconButton>
          <button type="button" className="buzzcast-avatar-button" onClick={openProfileSection}>
            <span className="image-avatar">
              <img src={avatarForIndex(displayId)} alt={profileInitials} loading="lazy" />
            </span>
          </button>
        </div>
      </header>

      <aside className="buzzcast-left-rail">
        <button type="button" className={activeSection === 'live' || activeSection === 'room' ? 'active' : ''} onClick={openLiveSection}>
          <span className="buzzcast-rail-icon rail-live" aria-hidden="true"></span>
          <b>Live</b>
        </button>
        <button type="button" className={activeSection === 'me' ? 'active' : ''} onClick={openProfileSection}>
          <span className="buzzcast-rail-icon rail-me" aria-hidden="true"></span>
          <b>Me</b>
        </button>
        <div className="buzzcast-rail-spacer"></div>
        <button type="button" onClick={() => setShowInstall(true)}>
          <span className="buzzcast-rail-icon rail-app" aria-hidden="true"></span>
          <b>Get the App</b>
        </button>
        <button type="button" className={activeSection === 'settings' ? 'active' : ''} onClick={() => openSettingsSection()}>
          <span className="buzzcast-rail-icon rail-settings" aria-hidden="true"></span>
          <b>Settings</b>
        </button>
        <button type="button" className={activeSection === 'help' ? 'active' : ''} onClick={() => { pushSectionHistory('help'); setActiveSection('help') }}>
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
            {dmThreads.map((thread, index) => (
              <button
                key={thread.id}
                type="button"
                className={activeThread === thread.id ? 'active' : ''}
                onClick={() => setActiveThread(thread.id)}
              >
                <i className="image-avatar"><img src={avatarForIndex(index)} alt="" loading="lazy" /></i>
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
              <div className="buzzcast-logo-mark image-mark">
                <img src={brandAssets.appIcon} alt="" />
              </div>
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
                  onClick={() => {
                    if (!requireAuth('Log in to open the RTC console.', 'login')) return
                    onEnterRoom(String(createdRoom.id), {
                      password: joinPassword.trim(),
                      room: createdRoom,
                      rtcMode: defaultRtcModeForRoom(createdRoom),
                      autoConnect: true,
                    })
                  }}
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
          <form className="buzzcast-feedback-modal" onSubmit={submitFeedback}>
            <header><h2>Feedback</h2><button type="button" onClick={() => setShowFeedback(false)}>x</button></header>
            <div className="buzzcast-feedback-row">
              <select value={feedbackForm.category} onChange={(event) => updateFeedback('category', event.target.value)}>
                {feedbackCategories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={feedbackForm.type} onChange={(event) => updateFeedback('type', event.target.value)}>
                {feedbackTypes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <label>Problem description</label>
            <textarea
              placeholder="Please provide as much detail as possible"
              maxLength={1000}
              value={feedbackForm.description}
              onChange={(event) => updateFeedback('description', event.target.value)}
            ></textarea>
            <label>Problem screenshot / screen recording <small>(optional)</small></label>
            <div className={`buzzcast-upload-box ${feedbackForm.attachment ? 'has-file' : ''}`}>
              <input id="feedback-attachment" type="file" accept="image/*,video/*" onChange={handleFeedbackAttachment} />
              <label htmlFor="feedback-attachment">
                <strong>{feedbackForm.attachment ? feedbackForm.attachment.name : 'Add screenshot or screen recording'}</strong>
                <small>PNG, JPG, GIF, MP4, or WebM up to 25 MB</small>
              </label>
              {feedbackForm.attachment ? (
                <button type="button" onClick={removeFeedbackAttachment}>Remove</button>
              ) : null}
            </div>
            <label>Contact information <small>(optional)</small></label>
            <input
              placeholder="Enter your email account"
              value={feedbackForm.contact}
              onChange={(event) => updateFeedback('contact', event.target.value)}
            />
            {feedbackStatus ? <p className="buzzcast-feedback-status">{feedbackStatus}</p> : null}
            <button type="submit" className="buzzcast-submit">Submit</button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
