import { useEffect, useMemo, useState } from 'react'
import { assetImage2Assets, avatarForGender, avatarForIndex, brandAssets, coverForDemoTone, coverForRoomType, liveRoomAssets, roomAssets } from '../../assets/rtc/catalog'
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
import {
  defaultClientCompanies,
  demoCards,
  dmThreads,
  exploreFilters,
  faqAnswers,
  faqTopics,
  feedTabs,
  feedbackCategories,
  feedbackTypes,
  initialDmMessages,
  maxFeedbackAttachmentSize,
  paymentMethods,
  policyDocuments,
  popularHelp,
  regionAliases,
  regions,
  settingsCopy,
  settingsNav,
} from './roomsStaticData'

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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Attachment could not be read. Please try another file.'))
    reader.readAsDataURL(file)
  })
}

function savedRoomSettings() {
  if (typeof window === 'undefined') return {}
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_room_settings') || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

function savedFeedbackRecords() {
  if (typeof window === 'undefined') return []
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_feedback_records') || '[]')
    return Array.isArray(saved) ? saved.slice(0, 20) : []
  } catch {
    return []
  }
}

function savedFollowedThreadIds(defaultIds) {
  if (typeof window === 'undefined') return defaultIds
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_followed_thread_ids') || 'null')
    return Array.isArray(saved) ? saved.filter(Boolean) : defaultIds
  } catch {
    return defaultIds
  }
}

function savedRecentRoomIds() {
  if (typeof window === 'undefined') return []
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_recent_mobile_room_ids') || '[]')
    return Array.isArray(saved) ? saved.map(String).filter(Boolean).slice(0, 24) : []
  } catch {
    return []
  }
}

function saveRecentRoomIds(ids) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('rtc_recent_mobile_room_ids', JSON.stringify(ids.slice(0, 24)))
}

function formatFeedbackRecordDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function compactText(value, maxLength = 56) {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}...`
}

function threadPreview(thread, messages) {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return compactText(thread.preview || 'No messages yet')
  const prefix = lastMessage.mine ? 'You: ' : ''
  return compactText(`${prefix}${lastMessage.body}`)
}

function copyForLanguage(_language, key, replacements = {}) {
  const template = settingsCopy[key] || key
  return Object.entries(replacements).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    template
  )
}

function validEmail(value) {
  return /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(value || '').trim())
}

function regionMatchesSearch(region, search) {
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) return true
  return [region, ...(regionAliases[region] || [])]
    .some((value) => value.toLowerCase().includes(normalizedSearch))
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

function clientCompanyNameForCard(card) {
  const room = card?.room || {}
  return String(
    room.tenant_name
      || room.company_name
      || room.client_company_name
      || room.client_name
      || card?.clientCompany
      || card?.company
      || ''
  ).trim()
}

function buildClientCompanyCards(cards) {
  const clientMap = new Map()

  defaultClientCompanies.forEach((client) => {
    clientMap.set(client.name.toLowerCase(), { ...client, viewers: 0 })
  })

  cards.forEach((card, index) => {
    const name = clientCompanyNameForCard(card)
    if (!name) return

    const key = name.toLowerCase()
    const current = clientMap.get(key) || {
      id: `client-${key.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
      name,
      detail: 'Client company',
      roomCount: 0,
      viewers: 0,
      avatarIndex: cardAvatarIndex(card, index),
    }

    current.roomCount += 1
    current.viewers += Number(card.viewers || 0)
    clientMap.set(key, current)
  })

  const clients = Array.from(clientMap.values())
    .sort((a, b) => b.roomCount - a.roomCount || a.name.localeCompare(b.name))

  return clients
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
    clientCompany: room.tenant_name || null,
    country: 'United States',
    size: index === 0 ? 'feature' : '',
    roomType: room.room_type,
    privacy: room.privacy_type,
    avatarIndex: Number(room.id) || index,
  }
}

function cardMatchesActiveFeed(card, activeFeed, activeExplore) {
  if (activeFeed === 'latest') return card.tab === 'latest' || card.room
  if (activeFeed === 'nearby') return card.tab === 'nearby' || card.room
  if (activeFeed === 'party') return card.party || card.tab === 'party' || card.room?.room_type === 'pk_live'
  if (activeFeed === 'following') return Boolean(card.room || card.following || card.host === 'TalkEachOther')
  if (activeFeed === 'global') return card.tab === 'latest' || card.room || card.country || card.host === 'TalkEachOther'
  if (activeFeed === 'explore') {
    if (activeExplore === 'all') return card.tab !== 'party'
    if (activeExplore === 'pk') return card.room?.room_type === 'pk_live' || card.explore === 'pk'
    if (activeExplore === 'games') return card.explore === 'games' || roomSupportsVideo(card.room?.room_type || card.roomType)
    return card.room || card.explore === activeExplore
  }

  return true
}

function cardMatchesRoomFilters(card, filter, privacyFilter) {
  const roomType = card.room?.room_type || card.roomType
  const privacyType = card.room?.privacy_type || card.privacy || 'public'
  const typeMatches = filter === 'all'
    || (filter === 'live' && ['video', 'group_video', 'solo_live', 'pk_live'].includes(roomType))
    || (filter === 'video' && roomSupportsVideo(roomType))
    || (filter === 'music' && ['audio', 'group_audio'].includes(roomType))
    || (filter === 'pk' && roomType === 'pk_live')
  const privacyMatches = privacyFilter === 'all' || privacyType === privacyFilter

  return typeMatches && privacyMatches
}

function sortCardsForView(cards, sort) {
  const nextCards = [...cards]

  if (sort === 'name') {
    nextCards.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
  } else if (sort === 'active') {
    nextCards.sort((a, b) => Number(b.viewers || 0) - Number(a.viewers || 0))
  } else if (sort === 'oldest') {
    nextCards.sort((a, b) => Number(cardAvatarIndex(a)) - Number(cardAvatarIndex(b)))
  }

  return nextCards
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
  const roomMeta = getRoomMeta(card.room?.room_type || card.roomType)
  const privacy = card.room?.privacy_type || card.privacy || 'public'

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
          <small className="buzzcast-card-meta">
            <b>{roomMeta.label}</b>
            <em>{privacy === 'public' ? `${compactNumber(card.viewers)} watching` : privacy}</em>
          </small>
        </div>
        <span className="buzzcast-mobile-live-count" aria-hidden="true">
          <i></i>{compactNumber(card.viewers)}
        </span>
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
  const [mobileRoomGroup, setMobileRoomGroup] = useState('recently')
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  const [showMobileRoomProfile, setShowMobileRoomProfile] = useState(false)
  const [showMobileRoomTools, setShowMobileRoomTools] = useState(false)
  const [showMobileRoomLock, setShowMobileRoomLock] = useState(false)
  const [showMobileRoomSettings, setShowMobileRoomSettings] = useState(false)
  const [showMobileMembers, setShowMobileMembers] = useState(false)
  const [showRankings, setShowRankings] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [showHostPanel, setShowHostPanel] = useState(false)
  const [showRecharge, setShowRecharge] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [activeSettings, setActiveSettings] = useState('account')
  const [settingsStatus, setSettingsStatus] = useState('')
  const [selectedPolicyId, setSelectedPolicyId] = useState('')
  const [settingsDraft, setSettingsDraft] = useState(() => {
    const saved = savedRoomSettings()
    return {
      phoneBound: Boolean(saved.phoneBound),
      emailBound: Boolean(saved.emailBound || user?.email),
      loginPasswordSet: saved.loginPasswordSet !== false,
      deviceAlerts: saved.deviceAlerts !== false,
      messagePrivacy: saved.messagePrivacy || 'everyone',
      privateInvite: saved.privateInvite !== false,
      autoPrivateDeduction: Boolean(saved.autoPrivateDeduction),
      hideSensitive: saved.hideSensitive !== false,
      contentMode: saved.contentMode || 'warning',
      region: user?.current_residence || saved.region || 'United States',
    }
  })
  const [securityAction, setSecurityAction] = useState(null)
  const [securityForm, setSecurityForm] = useState({
    phone: '',
    email: user?.email || '',
    password: '',
    passwordConfirm: '',
  })
  const [securityError, setSecurityError] = useState('')
  const [helpMode, setHelpMode] = useState('popular')
  const [activeHelp, setActiveHelp] = useState('recharge')
  const [activeFaq, setActiveFaq] = useState(faqTopics[0])
  const [activeThread, setActiveThread] = useState(dmThreads[0].id)
  const [dmMessages, setDmMessages] = useState(initialDmMessages)
  const [dmInput, setDmInput] = useState('')
  const [dmStatus, setDmStatus] = useState('')
  const [mobileRoomLockCode, setMobileRoomLockCode] = useState('199')
  const [liveChatMessages, setLiveChatMessages] = useState([
    { id: 'live-1', body: 'Hi', author: 'MARTEEN', badges: ['Lv.37', 'Lv.30'] },
    { id: 'live-2', body: 'This is comment area for all users', author: 'MARTEEN', badges: ['Lv.37', 'Lv.30'] },
    { id: 'live-3', body: 'Now I can show you. Tap a user to open profile.', author: 'MARTEEN', badges: ['Lv.37'] },
  ])
  const [mobileToast, setMobileToast] = useState('')
  const [recentRoomIds, setRecentRoomIds] = useState(savedRecentRoomIds)
  const [readThreadIds, setReadThreadIds] = useState([])
  const [followedThreadIds, setFollowedThreadIds] = useState(() => savedFollowedThreadIds(dmThreads.filter((thread) => thread.followed).map((thread) => thread.id)))
  const [activeRanking, setActiveRanking] = useState('rooms')
  const [previewCard, setPreviewCard] = useState(null)
  const [acceptedWarnings, setAcceptedWarnings] = useState({})
  const [feedbackForm, setFeedbackForm] = useState({
    category: feedbackCategories[0],
    type: feedbackTypes[0],
    description: '',
    contact: user?.email || '',
    attachment: null,
  })
  const [feedbackRecords, setFeedbackRecords] = useState(savedFeedbackRecords)
  const [feedbackStatus, setFeedbackStatus] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)

  const displayName = user?.name || user?.email?.split('@')[0] || 'Guest'
  const displayId = user?.id || 0
  const profileInitials = initialsFromName(displayName)
  const profileAvatar = user?.avatar_url || avatarForGender(user?.gender, displayId)
  const showAdminDashboard = canUseAdminDashboard(user) === true
  const selectedRoomNeedsPassword = selectedRoom?.privacy_type === 'password' && roomId === String(selectedRoom.id)
  const selectedRoomSupportsVideo = !selectedRoom || roomSupportsVideo(selectedRoom.room_type)
  const canJoinRoom = Boolean(roomId.trim()) && !openingRoom && (!selectedRoomNeedsPassword || Boolean(joinPassword.trim()))
  const t = (key, replacements = {}) => copyForLanguage('English', key, replacements)

  const roomCards = useMemo(() => rooms.map(roomToFeedCard), [rooms])
  const clientCompanyCards = useMemo(() => buildClientCompanyCards(roomCards), [roomCards])
  const ownRoomCard = useMemo(() => {
    const ownLiveRoom = roomCards.find((card) => Number(card.room?.owner_id) === Number(user?.id))
    if (ownLiveRoom) {
      return {
        ...ownLiveRoom,
        title: ownLiveRoom.title || displayName,
        host: ownLiveRoom.host || displayName,
        avatarUrl: profileAvatar,
        isOwnRoom: true,
      }
    }

    if (createdRoom) {
      return {
        ...roomToFeedCard(createdRoom, 0),
        title: createdRoom.name || displayName,
        host: createdRoom.owner_name || displayName,
        avatarUrl: profileAvatar,
        isOwnRoom: true,
      }
    }

    return {
      id: 'own-mobile-room',
      title: displayName,
      host: settingsDraft.region || user?.current_residence || 'United States',
      viewers: 0,
      tone: 'mint',
      badge: 'Mine',
      category: 'Video Room',
      country: settingsDraft.region || user?.current_residence || 'United States',
      roomType: 'video',
      privacy: 'public',
      avatarIndex: displayId,
      avatarUrl: profileAvatar,
      isOwnRoom: true,
    }
  }, [createdRoom, displayId, displayName, profileAvatar, roomCards, settingsDraft.region, user?.current_residence, user?.id])
  const visibleCards = useMemo(() => {
    const usingLiveRooms = roomCards.length > 0
    let cards = usingLiveRooms ? [...roomCards] : [...demoCards]

    if (usingLiveRooms) {
      if (activeFeed === 'party') cards = cards.filter((card) => card.room?.room_type === 'pk_live')
      if (activeFeed === 'explore' && activeExplore === 'pk') cards = cards.filter((card) => card.room?.room_type === 'pk_live')
      if (activeFeed === 'explore' && activeExplore === 'games') cards = cards.filter((card) => roomSupportsVideo(card.room?.room_type))
      return sortCardsForView(cards.filter((card) => cardMatchesRoomFilters(card, filter, privacyFilter)), sort).slice(0, 48)
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

    cards = cards.filter((card) => cardMatchesRoomFilters(card, filter, privacyFilter))
    return sortCardsForView(cards, sort).slice(0, activeFeed === 'party' ? 10 : 24)
  }, [activeExplore, activeFeed, filter, privacyFilter, roomCards, sort])
  const recentRoomCards = useMemo(() => {
    const sourceCards = roomCards.length ? roomCards : demoCards
    const cardsById = new Map(sourceCards.map((card) => [String(card.id), card]))
    const rememberedCards = recentRoomIds
      .map((id) => cardsById.get(String(id)))
      .filter(Boolean)

    if (rememberedCards.length) return rememberedCards.slice(0, 24)
    return visibleCards.filter((card) => card.id !== ownRoomCard.id).slice(0, 24)
  }, [ownRoomCard.id, recentRoomIds, roomCards, visibleCards])
  const searchTerm = search.trim().toLowerCase()
  const roomSearchResults = useMemo(() => {
    const includesTerm = (value) => String(value || '').toLowerCase().includes(searchTerm)
    const candidateCards = (roomCards.length ? roomCards : demoCards)
      .filter((card) => cardMatchesActiveFeed(card, activeFeed, activeExplore))
      .filter((card) => cardMatchesRoomFilters(card, filter, privacyFilter))
      .filter((card) => !searchTerm || includesTerm(`${card.title} ${card.host} ${card.roomType} ${card.badge} ${card.category} ${card.privacy || 'public'} ${card.country}`))

    return candidateCards.slice(0, 8).map((card) => ({
      id: card.id,
      type: card.room ? 'room' : 'demo',
      name: card.title,
      detail: `${getRoomMeta(card.roomType).label} - ${card.privacy || 'public'}`,
      avatarIndex: cardAvatarIndex(card),
      room: card.room,
      card,
    }))
  }, [activeExplore, activeFeed, filter, privacyFilter, roomCards, searchTerm])

  const activeHelpItem = popularHelp.find((item) => item.id === activeHelp) || popularHelp[0]
  const messageThreads = useMemo(() => dmThreads.map((thread, index) => {
    const messages = dmMessages[thread.id] || []
    const unread = readThreadIds.includes(thread.id) ? 0 : Number(thread.unread || 0)
    return {
      ...thread,
      avatarIndex: index,
      previewText: threadPreview(thread, messages),
      unread,
    }
  }), [dmMessages, readThreadIds])
  const activeThreadData = messageThreads.find((thread) => thread.id === activeThread) || messageThreads[0]
  const activeFilterLabel = roomFilterOptions.find((option) => option.value === filter)?.label || 'For You'
  const searchPanelTitle = loadingRooms
    ? 'Searching rooms...'
    : search.trim()
      ? `${roomSearchResults.length} ${activeFilterLabel} result${roomSearchResults.length === 1 ? '' : 's'}`
      : `${activeFilterLabel} rooms`
  const activeThreadFollowed = followedThreadIds.includes(activeThread)
  const unreadThreadCount = messageThreads.reduce((total, thread) => total + Number(thread.unread || 0), 0)
  const sentBeforeFollowCount = (dmMessages[activeThread] || []).filter((message) => message.mine).length
  const dmNotice = activeThreadFollowed
    ? 'You follow each other. Private messages are open.'
    : 'Follow this user to keep sending and receiving private messages.'
  const rankingRows = useMemo(() => {
    const cards = roomCards.length ? roomCards : demoCards

    if (activeRanking === 'hosts') {
      const hosts = new Map()
      cards.forEach((card) => {
        const key = card.host || 'Room host'
        const previous = hosts.get(key) || {
          key,
          name: key,
          detail: '0 rooms',
          score: 0,
          avatarIndex: cardAvatarIndex(card),
        }
        previous.score += Number(card.viewers || 0) + (card.room ? 120 : 0)
        previous.rooms = Number(previous.rooms || 0) + 1
        previous.detail = `${previous.rooms} room${previous.rooms === 1 ? '' : 's'} hosted`
        hosts.set(key, previous)
      })
      return Array.from(hosts.values()).sort((a, b) => b.score - a.score).slice(0, 10)
    }

    if (activeRanking === 'gifts') {
      return giftCatalog
        .slice()
        .sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0))
        .slice(0, 10)
        .map((gift, index) => ({
          key: gift.id,
          name: gift.label,
          detail: `${gift.cost} diamonds`,
          score: Number(gift.cost || 0) * (10 - index),
          icon: gift.icon,
        }))
    }

    return cards
      .map((card) => ({
        key: card.id,
        name: card.title,
        detail: `${card.host} - ${getRoomMeta(card.roomType).label}`,
        score: Number(card.viewers || 0) + (card.room ? Number(card.room.active_participants || 0) * 25 : 0),
        avatarIndex: cardAvatarIndex(card),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
  }, [activeRanking, roomCards])

  function requireAuth(reason = 'Log in or sign up to continue.', mode = 'login') {
    if (user) return true
    onAuthRequired?.(reason, mode)
    return false
  }

  function isMobileViewport() {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 860px)').matches
  }

  function showMobileActionToast(message) {
    setMobileToast(message)
    if (typeof window !== 'undefined') {
      window.clearTimeout(showMobileActionToast.timeoutId)
      showMobileActionToast.timeoutId = window.setTimeout(() => setMobileToast(''), 1600)
    }
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
    setShowRankings(false)
    setReadThreadIds((previous) => previous.includes(activeThread) ? previous : [...previous, activeThread])
    setShowMessages(true)
  }

  function openRankings() {
    if (!requireAuth('Log in to view live rankings.', 'login')) return
    setShowMessages(false)
    setShowRankings(true)
  }

  function openRechargePanel() {
    if (!requireAuth('Log in to use wallet and room gifts.', 'login')) return
    setShowRecharge(true)
  }

  function openMobileMomentsSection() {
    if (!isMobileViewport()) {
      openSettingsSection()
      return
    }

    setActiveFeed('latest')
    setSort('newest')
    setActiveSection('live')
    setPreviewCard(null)
    showMobileActionToast('Showing moments')
  }

  function openMobileMessageSection() {
    if (!isMobileViewport()) {
      pushSectionHistory('help')
      setActiveSection('help')
      return
    }

    openMessagesDrawer()
  }

  function updateSettings(field, value, message) {
    setSettingsDraft((previous) => ({ ...previous, [field]: value }))
    setSettingsStatus(message)
  }

  function openSecurityAction(field) {
    setSecurityAction(field)
    setSecurityError('')
    setSecurityForm((previous) => ({
      ...previous,
      email: previous.email || user?.email || '',
      password: '',
      passwordConfirm: '',
    }))
  }

  function updateSecurityForm(field, value) {
    setSecurityForm((previous) => ({ ...previous, [field]: value }))
    setSecurityError('')
  }

  function submitSecurityAction(event) {
    event.preventDefault()

    if (securityAction === 'phoneBound') {
      const digits = securityForm.phone.replace(/\D/g, '')
      if (digits.length < 7) {
        setSecurityError(t('Enter a valid phone number.'))
        return
      }
      setSecurityAction(null)
      updateSettings('phoneBound', true, t('Cell phone bound.'))
      return
    }

    if (securityAction === 'emailBound') {
      if (!validEmail(securityForm.email)) {
        setSecurityError(t('Enter a valid email address.'))
        return
      }
      setSecurityAction(null)
      updateSettings('emailBound', true, t('Email bound.'))
      return
    }

    if (securityAction === 'loginPasswordSet') {
      if (securityForm.password.length < 10) {
        setSecurityError(t('Use at least 10 characters for the password.'))
        return
      }
      if (securityForm.password !== securityForm.passwordConfirm) {
        setSecurityError(t('Passwords do not match.'))
        return
      }
      setSecurityAction(null)
      updateSettings('loginPasswordSet', true, t('Login password set.'))
      return
    }

  }

  function updateFeedback(field, value) {
    setFeedbackForm((previous) => ({ ...previous, [field]: value }))
    setFeedbackStatus('')
  }

  function handleFeedbackAttachment(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > maxFeedbackAttachmentSize) {
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

  function saveFeedbackRecord(record) {
    setFeedbackRecords((previous) => {
      const next = [record, ...previous].slice(0, 20)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('rtc_feedback_records', JSON.stringify(next))
      }
      return next
    })
  }

  function toggleThreadFollow(threadId = activeThread) {
    setFollowedThreadIds((previous) => {
      const following = previous.includes(threadId)
      const next = following ? previous.filter((id) => id !== threadId) : [...previous, threadId]
      const thread = dmThreads.find((item) => item.id === threadId)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('rtc_followed_thread_ids', JSON.stringify(next))
      }
      setDmStatus(following
        ? `${thread?.name || 'User'} unfollowed. Message sending returns to first-contact limits.`
        : `You are now following ${thread?.name || 'this user'}. You can send and receive private messages normally.`)
      return next
    })
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
    setShowSearchPanel(false)

    if (item.room) {
      setActiveSection('live')
      setPreviewCard(null)
      joinRoomFromCard(item.room)
      return
    } else if (item.card) {
      openCard(item.card)
    }
  }

  function runSearch() {
    setActiveSection('live')
    setShowSearchPanel(true)
    loadRooms({
      page: 1,
      searchValue: search,
      filterValue: filter,
      privacyValue: privacyFilter,
      sortValue: sort,
    })
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
    setShowMobileRoomProfile(false)
    setShowMobileRoomTools(false)
    setShowMobileRoomLock(false)
    setShowMobileRoomSettings(false)
    setShowMobileMembers(false)
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

  function switchMobileRoomGroup(nextGroup) {
    setMobileRoomGroup(nextGroup)
    setActiveSection('live')
    setPreviewCard(null)

    if (nextGroup === 'recently') {
      setActiveFeed('latest')
      setSort('newest')
      setFilter('all')
      return
    }

    if (nextGroup === 'follow') {
      setActiveFeed('following')
      setFilter('all')
      return
    }

    setActiveFeed('for_you')
    setFilter('all')
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

  function rememberRecentRoom(card) {
    if (!card || card.isOwnRoom) return

    setRecentRoomIds((previous) => {
      const cardId = String(card.id)
      const nextIds = [cardId, ...previous.filter((id) => id !== cardId)].slice(0, 24)
      saveRecentRoomIds(nextIds)
      return nextIds
    })
  }

  function openCard(card) {
    rememberRecentRoom(card)

    if (card.room && !isMobileViewport()) {
      joinRoomFromCard(card.room)
      return
    }

    pushSectionHistory('room', { previewCardId: card.id })
    setShowMobileRoomProfile(false)
    setShowMobileRoomTools(false)
    setShowMobileRoomLock(false)
    setShowMobileRoomSettings(false)
    setShowMobileMembers(false)
    setPreviewCard(card)
    setActiveSection('room')
  }

  function sendLiveRoomMessage(event) {
    event.preventDefault()
    const body = dmInput.trim()
    if (!body) return

    setLiveChatMessages((previous) => [
      ...previous,
      { id: `live-${Date.now()}`, body, author: displayName, badges: ['Lv.37'] },
    ].slice(-12))
    setDmInput('')
    showMobileActionToast('Comment sent')
  }

  function sendDmMessage(event) {
    event.preventDefault()
    if (!requireAuth('Log in to send chat messages.', 'login')) return
    const body = dmInput.trim()
    if (!body) return
    if (!activeThreadFollowed && sentBeforeFollowCount >= 2) {
      setDmStatus('Follow this user first to continue the private chat.')
      return
    }

    setDmMessages((previous) => ({
      ...previous,
      [activeThread]: [
        ...(previous[activeThread] || []),
        { id: `${activeThread}-${Date.now()}`, author: displayName, body, mine: true, createdAt: new Date().toISOString() },
      ],
    }))
    setDmInput('')
    setReadThreadIds((previous) => previous.includes(activeThread) ? previous : [...previous, activeThread])
    setDmStatus(activeThreadFollowed
      ? `Sent to ${activeThreadData.name}: "${compactText(body, 44)}"`
      : `${Math.max(0, 1 - sentBeforeFollowCount)} first-contact message remaining before follow is required.`)
  }

  async function submitFeedback(event) {
    event.preventDefault()
    if (submittingFeedback) return

    if (feedbackForm.description.trim().length < 10) {
      setFeedbackStatus('Please add at least 10 characters so support can understand the issue.')
      return
    }

    try {
      setSubmittingFeedback(true)
      setFeedbackStatus(feedbackForm.attachment ? 'Preparing attachment...' : 'Sending feedback...')

      const attachmentMeta = feedbackForm.attachment ? {
        name: feedbackForm.attachment.name,
        type: feedbackForm.attachment.type,
        size: feedbackForm.attachment.size,
      } : null
      const attachment = attachmentMeta ? {
        ...attachmentMeta,
        data_url: await fileToDataUrl(feedbackForm.attachment),
      } : null

      setFeedbackStatus('Sending feedback...')
      await apiRequest('/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: feedbackForm.category,
          type: feedbackForm.type,
          description: feedbackForm.description.trim(),
          contact: feedbackForm.contact.trim(),
          attachment,
          page_url: typeof window !== 'undefined' ? window.location.href : '',
          user_agent: typeof window !== 'undefined' ? window.navigator.userAgent : '',
        }),
      })

      saveFeedbackRecord({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        category: feedbackForm.category,
        type: feedbackForm.type,
        description: feedbackForm.description.trim(),
        contact: feedbackForm.contact.trim(),
        attachment: attachmentMeta,
        created_at: new Date().toISOString(),
      })
      setHelpMode('records')
      setFeedbackStatus('Feedback sent to support.')
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
    } catch (error) {
      setFeedbackStatus(error.message || 'Feedback could not be sent. Please try again.')
    } finally {
      setSubmittingFeedback(false)
    }
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
    const featuredMobileCard = ownRoomCard
    const featuredMobileTitle = featuredMobileCard.title === displayName ? '☢️We 4 Humanity☢️' : featuredMobileCard.title
    const mobileRoomListCards = recentRoomCards.length ? recentRoomCards : visibleCards

    return (
      <section className="buzzcast-discover">
        <div className="mp4-mobile-home-shell" aria-label="Mobile room feed">
          <header className="mp4-mobile-home-hero">
            <img className="mp4-home-goat" src={assetImage2Assets.goat} alt="" loading="lazy" aria-hidden="true" />
            <button type="button" className="mp4-home-menu" onClick={openLiveSection} aria-label="Home">
              <img src={assetImage2Assets.homeIcon} alt="" loading="lazy" aria-hidden="true" />
            </button>
            <nav className="mp4-home-tabs" aria-label="Mobile feed tabs">
              <button type="button" className={activeFeed === 'following' ? 'active' : ''} onClick={() => switchFeed('following')}>Mine</button>
              <button type="button" className={activeFeed === 'for_you' ? 'active' : ''} onClick={() => switchFeed('for_you')}>Popular</button>
              <button type="button" className={activeFeed === 'explore' ? 'active' : ''} onClick={() => switchFeed('explore')}>Explore</button>
            </nav>
            <button type="button" className="mp4-home-search" onClick={() => setShowSearchPanel((current) => !current)} aria-label="Search">
              <img src={assetImage2Assets.searchIcon} alt="" loading="eager" aria-hidden="true" />
            </button>
          </header>
          {showSearchPanel ? (
            <div className="mp4-mobile-search-panel">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search room or host"
                aria-label="Search room or host"
              />
              <button type="button" onClick={runSearch}>Search</button>
              <div>
                {roomSearchResults.length ? roomSearchResults.map((item, index) => (
                  <button key={`${item.type}-${item.id}`} type="button" onClick={() => openSearchResult(item)}>
                    <i className="image-avatar"><img src={avatarForIndex(item.avatarIndex ?? index)} alt="" loading="lazy" /></i>
                    <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                  </button>
                )) : <em>Type a room name, host, or category.</em>}
              </div>
            </div>
          ) : null}
          <button type="button" className="mp4-feature-room" onClick={() => openCard(featuredMobileCard)}>
            <span className="mp4-feature-avatar">
              <img src={assetImage2Assets.creatorCard} alt="" loading="lazy" />
            </span>
            <span className="mp4-feature-copy">
              <strong>{featuredMobileTitle}</strong>
              <small>
                <img className="mp4-feature-bars" src={assetImage2Assets.bars} alt="" loading="lazy" aria-hidden="true" />
                <img className="mp4-feature-group" src={assetImage2Assets.groupIcon} alt="" loading="lazy" aria-hidden="true" />
                <i>{compactNumber(featuredMobileCard.viewers || 0)}</i>
                <img className="mp4-feature-lock" src={assetImage2Assets.lockIcon} alt="" loading="lazy" aria-hidden="true" />
              </small>
            </span>
            <span className="mp4-feature-ribbon"><span>Mine</span></span>
          </button>
          <nav className="mp4-room-tabs" aria-label="Mobile room groups">
            <button type="button" className={mobileRoomGroup === 'recently' ? 'active' : ''} onClick={() => switchMobileRoomGroup('recently')}>Recently</button>
            <button type="button" className={mobileRoomGroup === 'follow' ? 'active' : ''} onClick={() => switchMobileRoomGroup('follow')}>Follow</button>
            <button type="button" className={mobileRoomGroup === 'group' ? 'active' : ''} onClick={() => switchMobileRoomGroup('group')}>Group</button>
          </nav>
        </div>

        <nav className="buzzcast-feed-nav" aria-label="Room feed">
          {feedTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={activeFeed === tab.value ? 'active' : ''}
              onClick={() => switchFeed(tab.value)}
            >
              <span className="feed-label-full">{tab.label}</span>
              <span className="feed-label-mobile">{tab.mobileLabel || tab.label}</span>
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
          <div className="buzzcast-client-strip" aria-label="Client companies">
            {clientCompanyCards.slice(0, 6).map((client) => (
              <button
                key={client.id}
                type="button"
                className="buzzcast-client-card"
                onClick={() => {
                  setSearch(client.name)
                  setActiveFeed('for_you')
                  setStatus(`Showing ${client.name} client rooms`)
                }}
              >
                <span className="buzzcast-client-avatar image-avatar">
                  <img src={avatarForIndex(client.avatarIndex)} alt="" loading="lazy" />
                </span>
                <span className="buzzcast-client-copy">
                  <strong>{client.name}</strong>
                  <small>{client.roomCount ? `${client.roomCount} rooms - ${compactNumber(client.viewers)} watching` : client.detail}</small>
                </span>
                <span className="buzzcast-client-pill">Client</span>
              </button>
            ))}
          </div>
          <button type="button" className="buzzcast-create-room-button" onClick={() => openHostPanel()}>Create room</button>
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
            <div className={`buzzcast-card-grid desktop-feed-grid ${activeFeed === 'party' ? 'party-grid' : ''}`}>
              {visibleCards.map((card, index) => (
                <FeedCard
                  key={card.id}
                  card={card}
                  featured={index === 0 && activeFeed !== 'party'}
                  onOpen={openCard}
                />
              ))}
            </div>
            <div className={`buzzcast-card-grid mobile-recent-grid ${activeFeed === 'party' ? 'party-grid' : ''}`}>
              {mobileRoomListCards.map((card, index) => (
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
            <span><strong>{t('Who can send me a message')}</strong><small>{t('Controls the personal inbox and room chat shortcuts.')}</small></span>
            <select
              value={settingsDraft.messagePrivacy}
              onChange={(event) => updateSettings('messagePrivacy', event.target.value, t('Message privacy updated.'))}
            >
              <option value="everyone">{t('Everyone')}</option>
              <option value="followers">{t('Followers only')}</option>
              <option value="nobody">{t('Nobody')}</option>
            </select>
          </label>
          <label className="buzzcast-switch-row">
            <span><strong>{t('Private live invitation')}</strong><small>{t('Allow hosts to invite you into private live rooms.')}</small></span>
            <input
              type="checkbox"
              checked={settingsDraft.privateInvite}
              onChange={(event) => updateSettings('privateInvite', event.target.checked, t('Private live invitation setting updated.'))}
            />
          </label>
          <label className="buzzcast-switch-row">
            <span><strong>{t('Automatic deduction for entering the private live broadcast room')}</strong><small>{t('After opening, private rooms can automatically deduct diamonds.')}</small></span>
            <input
              type="checkbox"
              checked={settingsDraft.autoPrivateDeduction}
              onChange={(event) => updateSettings('autoPrivateDeduction', event.target.checked, t('Private-room deduction setting updated.'))}
            />
          </label>
          <button type="button" onClick={() => setSettingsStatus('Use Block in the chat panel to hide a user and remove their messages from your view.')}>
            <span><strong>{t('Blacklist')}</strong><small>{t('Blocked users are controlled from the chat user menu.')}</small></span>
            <b>&gt;</b>
          </button>
          <button type="button" onClick={() => updateSettings('hideSensitive', !settingsDraft.hideSensitive, t('Live preference updated.'))}>
            <span><strong>{t('Live broadcast you are not interested in')}</strong><small>{settingsDraft.hideSensitive ? t('Filtered from your feed.') : t('Visible in your feed.')}</small></span>
            <em>{settingsDraft.hideSensitive ? t('Filtered') : t('Show')}</em>
          </button>
        </div>
      )
    }

    if (activeSettings === 'content') {
      const modes = [
        { value: 'restricted', labelKey: 'Restricted Mode', helperKey: 'Hide potentially sensitive content.' },
        { value: 'warning', labelKey: 'Warning Mode', helperKey: 'Show a warning before sensitive rooms open.' },
        { value: 'all', labelKey: 'All Modes', helperKey: 'Show all room content that is available to your account.' },
      ]

      return (
        <div className="buzzcast-settings-list">
          {modes.map((item) => (
            <label key={item.value} className={settingsDraft.contentMode === item.value ? 'buzzcast-radio-row selected' : 'buzzcast-radio-row'}>
              <span><strong>{t(item.labelKey)}</strong><small>{t(item.helperKey)}</small></span>
              <input
                type="radio"
                name="content-mode"
                checked={settingsDraft.contentMode === item.value}
                onChange={() => updateSettings('contentMode', item.value, `${t(item.labelKey)} ${t('selected.')}`)}
              />
            </label>
          ))}
        </div>
      )
    }

    if (activeSettings === 'region') {
      const regionSearch = settingsDraft.regionSearch || ''
      const visibleRegions = regions.filter((item) => regionMatchesSearch(item, regionSearch))

      return (
        <div className="buzzcast-region-panel">
          <input
            placeholder={t('Search region')}
            value={regionSearch}
            onChange={(event) => setSettingsDraft((previous) => ({ ...previous, regionSearch: event.target.value }))}
          />
          <div className="buzzcast-settings-list compact">
            {visibleRegions.map((item) => (
              <label key={item} className={settingsDraft.region === item ? 'buzzcast-radio-row selected' : 'buzzcast-radio-row'}>
                <span><strong>{item}</strong></span>
                <input
                  type="radio"
                  name="region"
                  checked={settingsDraft.region === item}
                  onChange={() => {
                    setSettingsDraft((previous) => ({ ...previous, region: item, regionSearch: '' }))
                    setSettingsStatus(t('Region changed to {region}.', { region: item }))
                  }}
                />
              </label>
            ))}
            {visibleRegions.length === 0 ? (
              <div className="buzzcast-region-empty">No region matches this search.</div>
            ) : null}
          </div>
        </div>
      )
    }

    if (activeSettings === 'terms') {
      const selectedPolicy = policyDocuments.find((item) => item.id === selectedPolicyId)

      if (selectedPolicy) {
        return (
          <article className="buzzcast-policy-detail">
            <button type="button" className="buzzcast-policy-back" onClick={() => {
              setSelectedPolicyId('')
              setSettingsStatus('')
            }}>
              &lt; Back
            </button>
            <h3>{selectedPolicy.title}</h3>
            <p>{selectedPolicy.summary}</p>
            {selectedPolicy.sections.map(([title, body]) => (
              <section key={title}>
                <h4>{title}</h4>
                <p>{body}</p>
              </section>
            ))}
          </article>
        )
      }

      return (
        <div className="buzzcast-settings-list">
          {policyDocuments.map((item) => (
            <button type="button" key={item.id} onClick={() => {
              setSelectedPolicyId(item.id)
              setSettingsStatus(item.summary)
            }}>
              <span><strong>{item.title}</strong><small>{item.summary}</small></span>
              <b>&gt;</b>
            </button>
          ))}
        </div>
      )
    }

    const accountRows = [
      {
        field: 'phoneBound',
        labelKey: 'Binding cell phone',
        helperKey: 'Recommended for account recovery and high-value payments.',
        onKey: 'Bound',
        offKey: 'Bind cell phone',
      },
      {
        field: 'emailBound',
        labelKey: 'Binding email',
        helperKey: 'Used for login recovery and security notices.',
        onKey: 'Bound',
        offKey: 'Bind email',
      },
      {
        field: 'loginPasswordSet',
        labelKey: 'Set login password',
        helperKey: 'Protect this account when signing in on a new device.',
        onKey: 'Set',
        offKey: 'Set password',
      },
      {
        field: 'deviceAlerts',
        labelKey: 'Devices Logged In',
        helperKey: 'Show alerts when a new device logs in.',
        onKey: 'Alerts on',
        offKey: 'Alerts off',
      },
    ]

    return (
      <div className="buzzcast-security-panel">
        <div className="buzzcast-settings-list">
          {accountRows.map((item) => (
            <button
              type="button"
              key={item.field}
              onClick={() => {
                if (item.field === 'deviceAlerts') {
                  updateSettings(item.field, !settingsDraft[item.field], t('Device login alerts updated.'))
                  return
                }
                openSecurityAction(item.field)
              }}
            >
              <span><strong>{t(item.labelKey)}</strong><small>{t(item.helperKey)}</small></span>
              <em>{settingsDraft[item.field] ? t(item.onKey) : t(item.offKey)}</em>
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
                setSelectedPolicyId('')
              }}
            >
              <i>{item.icon}</i>
              <span>{t(item.labelKey)}</span>
              <b>&gt;</b>
            </button>
          ))}
        </aside>
        <div className="buzzcast-settings-content">
          <div className="buzzcast-settings-heading">
            <h2>{t(activeSettingsItem.labelKey)}</h2>
            <p>{settingsStatus || t('Changes are applied immediately for this session.')}</p>
          </div>
          {renderSettingsContent()}
        </div>
      </section>
    )
  }

  function renderSecurityActionModal() {
    if (!securityAction) return null

    const titleByAction = {
      phoneBound: 'Binding cell phone',
      emailBound: 'Binding email',
      loginPasswordSet: 'Set login password',
    }

    return (
      <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setSecurityAction(null)}>
        <form className="buzzcast-security-modal" onSubmit={submitSecurityAction} onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <h2>{t(titleByAction[securityAction])}</h2>
            <button type="button" onClick={() => setSecurityAction(null)}>x</button>
          </header>

          {securityAction === 'phoneBound' ? (
            <label>
              <span>{t('Cell phone number')}</span>
              <input
                value={securityForm.phone}
                onChange={(event) => updateSecurityForm('phone', event.target.value)}
                inputMode="tel"
                placeholder="+1 555 010 2020"
              />
            </label>
          ) : null}

          {securityAction === 'emailBound' ? (
            <label>
              <span>{t('Email address')}</span>
              <input
                type="email"
                value={securityForm.email}
                onChange={(event) => updateSecurityForm('email', event.target.value)}
                placeholder="name@example.com"
              />
            </label>
          ) : null}

          {securityAction === 'loginPasswordSet' ? (
            <>
              <label>
                <span>{t('New password')}</span>
                <input
                  type="password"
                  value={securityForm.password}
                  onChange={(event) => updateSecurityForm('password', event.target.value)}
                  placeholder="10+ characters"
                />
              </label>
              <label>
                <span>{t('Confirm password')}</span>
                <input
                  type="password"
                  value={securityForm.passwordConfirm}
                  onChange={(event) => updateSecurityForm('passwordConfirm', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {securityError ? <p className="buzzcast-security-error">{securityError}</p> : null}
          <div className="buzzcast-security-actions">
            <button type="button" onClick={() => setSecurityAction(null)}>{t('Cancel')}</button>
            <button type="submit" className="buzzcast-submit">{t('Save')}</button>
          </div>
        </form>
      </div>
    )
  }

  function renderHelp() {
    return (
      <section className="buzzcast-help-shell">
        <header>
          <h1>Feedback and Help</h1>
          <div className="buzzcast-help-actions">
            <button type="button" className={helpMode === 'records' ? 'active' : ''} onClick={() => setHelpMode('records')}>Feedback record</button>
            <button type="button" className="primary" onClick={() => setShowFeedback(true)}>Submit feedback</button>
          </div>
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
            {helpMode === 'records' ? (
              <div className="buzzcast-feedback-record-list">
                {feedbackRecords.length ? feedbackRecords.map((record) => (
                  <article key={record.id} className="buzzcast-feedback-record">
                    <div>
                      <strong>{record.category} - {record.type}</strong>
                      <time>{formatFeedbackRecordDate(record.created_at)}</time>
                    </div>
                    <p>{record.description}</p>
                    <small>
                      {record.contact || 'No contact provided'}
                      {record.attachment ? ` - ${record.attachment.name}` : ''}
                    </small>
                  </article>
                )) : (
                  <div className="buzzcast-feedback-empty">
                    <strong>No feedback records yet</strong>
                    <p>Submitted feedback will appear here after it is sent to support.</p>
                    <button type="button" onClick={() => setShowFeedback(true)}>Submit feedback</button>
                  </div>
                )}
              </div>
            ) : helpMode === 'faq' ? (
              <div className="buzzcast-faq-list">
                {faqTopics.map((item) => (
                  <article key={item} className={activeFaq === item ? 'buzzcast-faq-item open' : 'buzzcast-faq-item'}>
                    <button type="button" onClick={() => setActiveFaq(activeFaq === item ? '' : item)}>
                      {item}
                      <span>{activeFaq === item ? '^' : 'v'}</span>
                    </button>
                    {activeFaq === item ? <p>{faqAnswers[item]}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <article className="buzzcast-help-answer">
                <h2>{activeHelpItem.title}</h2>
                <p>{activeHelpItem.body}</p>
              </article>
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
    const roomAvatar = card.avatarUrl || previewAvatar
    const commentAvatar = card.avatarUrl || avatarForIndex(cardAvatarIndex(card) + 2)
    const roomMeta = getRoomMeta(card.room?.room_type || card.roomType)
    const isVideoRoom = roomSupportsVideo(card.room?.room_type || card.roomType)
    const blockedCount = Math.max(0, Math.round(Number(card.viewers || 0) / 25))
    const roomIdLabel = card.room?.id || 50741761
    const memberCount = Math.max(1, Math.min(999, Math.round(Number(card.viewers || 0) / 18)))
    const mobileComments = liveChatMessages
    const mobileMembers = [
      { name: card.host || 'MARTEEN', detail: 'Contributed 0 Exp', role: 'Owner' },
      { name: 'EYANA', detail: 'Contributed 1187775 Exp' },
      { name: 'Nila Rahaman', detail: 'Contributed 559000 Exp' },
      { name: '0056372496', detail: 'Contributed 487900 Exp' },
      { name: 'Saidul', detail: 'Contributed 340900 Exp' },
      { name: '_*__SARA=_', detail: 'Contributed 300600 Exp' },
      { name: 'RAJA', detail: 'Contributed 256900 Exp' },
      { name: 'Dr.Bluetooth Boy', detail: 'Contributed 215604 Exp' },
      { name: 'off line', detail: 'Contributed 181300 Exp' },
      { name: 'M.Rahman Bappi', detail: 'Contributed 143900 Exp' },
    ]
    const mobileSeats = Array.from({ length: isVideoRoom ? 12 : 8 }, (_, index) => index + 1)
    const mobileLockDigits = mobileRoomLockCode.padEnd(4, ' ').slice(0, 4).split('')

    return (
      <section className="buzzcast-room-preview">
        <section className={showMobileRoomSettings ? 'buzzcast-mobile-room-live-preview is-hidden' : 'buzzcast-mobile-room-live-preview'} aria-label={`${card.title} live room preview`}>
          <header className="buzzcast-mobile-live-head">
            <button type="button" onClick={openLiveSection} aria-label="Back to rooms">‹</button>
            <button type="button" className="buzzcast-mobile-profile-avatar-button" onClick={() => setShowMobileRoomProfile(true)} aria-label="Open room profile">
              <span className="image-avatar"><img src={roomAvatar} alt="" loading="lazy" /></span>
            </button>
            <button type="button" className="buzzcast-mobile-title-button" onClick={() => setShowMobileRoomProfile(true)} aria-label="Open room profile">
              <strong>{card.title}</strong>
              <small>ID:{roomIdLabel} - {memberCount}</small>
            </button>
            <button type="button" onClick={() => showMobileActionToast('Room link copied')} aria-label="Share">↗</button>
            <button type="button" onClick={() => setShowMobileRoomTools(true)} aria-label="More room tools">...</button>
            <button type="button" onClick={openLiveSection} aria-label="Leave room">⏻</button>
          </header>

          <div className="buzzcast-mobile-room-badges">
            <div>
              <span>Group 309</span>
              <span>NILOY</span>
            </div>
            <button type="button" className="buzzcast-mobile-member-strip" onClick={() => setShowMobileMembers(true)} aria-label="Open room members">
              {[0, 1, 2].map((index) => (
                <i key={index} className="image-avatar"><img src={index === 0 ? commentAvatar : avatarForIndex(index + 1)} alt="" loading="lazy" /></i>
              ))}
              <b>›</b>
            </button>
          </div>

          <div className="buzzcast-mobile-live-actions">
            <button type="button" onClick={() => showMobileActionToast('Room refreshed')}>Refresh</button>
            <button type="button" onClick={() => showMobileActionToast('Voice mode ready')}>Voice</button>
            <button type="button" onClick={() => showMobileActionToast('Playlist opened')}>Playlist</button>
            <button type="button" onClick={() => setShowMobileRoomTools(true)}>Tools</button>
          </div>

          <section className="buzzcast-mobile-stage-card" aria-label="Live room stage">
            <span className="buzzcast-mobile-stage-avatar image-avatar">
              <img src={roomAvatar} alt="" loading="lazy" />
            </span>
            <div>
              <small>{roomMeta.label} · {compactNumber(card.viewers || 0)} watching</small>
              <strong>{card.title}</strong>
              <em>{card.host} · Live topic</em>
            </div>
            <button type="button" onClick={() => card.room ? joinRoomFromCard(card.room) : showMobileActionToast('Preview room selected')}>
              Join
            </button>
          </section>

          <div className="buzzcast-mobile-seat-grid">
            {mobileSeats.map((seat) => (
              <button
                key={seat}
                type="button"
                className={seat === 1 ? 'active' : ''}
                onClick={() => seat === 1 ? setShowMobileRoomTools(true) : setShowMobileRoomLock(true)}
              >
                <span><img src={seat === 1 ? liveRoomAssets.seatMic : liveRoomAssets.seatLock} alt="" loading="lazy" /></span>
                <small>No.{seat}</small>
              </button>
            ))}
          </div>
          <div className="buzzcast-mobile-pk-badge">PK</div>

          <button type="button" className="buzzcast-mobile-mic-line">
            <img src={liveRoomAssets.seatMic} alt="" loading="lazy" />
            <span>Come on mic and chat together~</span>
          </button>

          <div className="buzzcast-mobile-live-comments">
            {mobileComments.map((message) => (
              <article key={message.id}>
                <span className="image-avatar"><img src={commentAvatar} alt="" loading="lazy" /></span>
                <div>
                  <strong><i>Owner</i> {card.host}</strong>
                  <small>{message.badges.map((badge) => <b key={badge}>{badge}</b>)}</small>
                  <p>{message.body}</p>
                </div>
              </article>
            ))}
          </div>

          <form className="buzzcast-mobile-live-composer" onSubmit={sendLiveRoomMessage}>
            <button type="button" onClick={() => showMobileActionToast('Voice message ready')} aria-label="Voice"><img src={liveRoomAssets.composerMic} alt="" loading="lazy" /></button>
            <input value={dmInput} onChange={(event) => setDmInput(event.target.value)} placeholder="Say hi..." />
            <button type="button" onClick={openRechargePanel} aria-label="Gift"><img src={liveRoomAssets.composerGift} alt="" loading="lazy" /></button>
            <button type="submit" aria-label="Send"><img src={liveRoomAssets.send} alt="" loading="lazy" /></button>
          </form>

          {mobileToast ? (
            <div className="buzzcast-mobile-toast" role="status">{mobileToast}</div>
          ) : null}

          {showMobileMembers ? (
            <section className="buzzcast-mobile-members-page" aria-label="Group members">
              <header>
                <button type="button" onClick={() => setShowMobileMembers(false)} aria-label="Back to room">‹</button>
                <strong>Group Members<span>({memberCount} members)</span></strong>
                <span></span>
              </header>
              <div className="buzzcast-mobile-members-list">
                {mobileMembers.map((member, index) => (
                  <button key={`${member.name}-${index}`} type="button" onClick={() => showMobileActionToast(`${member.name} selected`)}>
                    <b>{index + 1}</b>
                    <i className="image-avatar"><img src={index === 0 ? roomAvatar : avatarForIndex(index + 2)} alt="" loading="lazy" /></i>
                    <span>
                      <strong>{member.name}{member.role ? <em>{member.role}</em> : null}</strong>
                      <small>{member.detail}</small>
                    </span>
                    <mark></mark>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {showMobileRoomProfile ? (
            <div className="buzzcast-mobile-room-profile-backdrop" role="dialog" aria-modal="true" aria-labelledby="buzzcast-mobile-room-profile-title">
              <section className="buzzcast-mobile-room-profile-sheet">
                <header>
                  <span></span>
                  <strong id="buzzcast-mobile-room-profile-title">Room Profile</strong>
                  <button type="button" onClick={() => setShowMobileRoomProfile(false)} aria-label="Close room profile">×</button>
                </header>
                <button
                  type="button"
                  className="buzzcast-mobile-room-profile-settings"
                  onClick={() => {
                    setShowMobileRoomProfile(false)
                    setShowMobileRoomSettings(true)
                  }}
                  aria-label="Room settings"
                >
                  <span></span>
                  <small>Settings</small>
                </button>
                <span className="buzzcast-mobile-room-profile-avatar image-avatar"><img src={roomAvatar} alt="" loading="lazy" /></span>
                <strong className="buzzcast-mobile-room-profile-name">{card.title}</strong>
                <span className="buzzcast-mobile-room-profile-id">ID:{roomIdLabel}</span>
                <div className="buzzcast-mobile-room-profile-stats" aria-label="Room stats">
                  <span><b>49.4M</b><small>Total Diamonds</small></span>
                  <button type="button" onClick={() => { setShowMobileRoomProfile(false); setShowMobileMembers(true) }}><b>{memberCount}</b><small>Members</small></button>
                </div>
                <dl className="buzzcast-mobile-room-profile-details">
                  <div>
                    <dt>Language:</dt>
                    <dd>Bengali(বাংলা)</dd>
                  </div>
                  <div>
                    <dt>Country:</dt>
                    <dd>{card.country || 'গণপ্রজাতন্ত্রী বাংলাদেশ'}</dd>
                  </div>
                  <div>
                    <dt>Announcement:</dt>
                    <dd>{card.description || 'Please respect each other and chat in a friendly manner.'}</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : null}

          {showMobileRoomTools ? (
            <div className="buzzcast-mobile-room-tools-backdrop" role="dialog" aria-modal="true" aria-label="Room tools">
              <section className="buzzcast-mobile-room-tools-sheet">
                <button type="button" onClick={() => setShowMobileRoomTools(false)}>
                  <i className="mic"></i>
                  <span>Number of Mic</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileRoomTools(false)
                    setShowMobileRoomLock(true)
                  }}
                >
                  <i className="unlock"></i>
                  <span>Unlock</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileRoomTools(false)
                    setShowMobileRoomLock(true)
                  }}
                >
                  <i className="password"></i>
                  <span>Password</span>
                </button>
                <button type="button">
                  <i className="theme"></i>
                  <span>Theme</span>
                </button>
                <button type="button">
                  <i className="share"></i>
                  <span>Share</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileRoomTools(false)
                    setShowMobileRoomSettings(true)
                  }}
                >
                  <i className="admin"></i>
                  <span>Admin</span>
                </button>
                <button type="button">
                  <i className="clear"></i>
                  <span>Clear comments history</span>
                </button>
                <button type="button" onClick={() => setShowMobileRoomTools(false)}>
                  <i className="gather"></i>
                  <span>Gather</span>
                </button>
                <button type="button" className="cancel" onClick={() => setShowMobileRoomTools(false)}>Cancel</button>
              </section>
            </div>
          ) : null}

          {showMobileRoomLock ? (
            <div className="buzzcast-mobile-room-lock-backdrop" role="dialog" aria-modal="true" aria-labelledby="buzzcast-mobile-room-lock-title">
              <section className="buzzcast-mobile-room-lock-modal">
                <button type="button" className="close" onClick={() => setShowMobileRoomLock(false)} aria-label="Close room lock">×</button>
                <strong id="buzzcast-mobile-room-lock-title">Room lock</strong>
                <label>
                  <span>Room lock code</span>
                  <input
                    value={mobileRoomLockCode}
                    onChange={(event) => setMobileRoomLockCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    autoFocus
                    inputMode="numeric"
                    maxLength={4}
                    aria-label="Room lock code"
                  />
                </label>
                <div className="buzzcast-mobile-room-lock-digits" aria-hidden="true">
                  {mobileLockDigits.map((digit, index) => (
                    <span key={index}>{digit.trim()}</span>
                  ))}
                </div>
                <p>Please set 4 digits password</p>
                <button type="button" className="confirm" onClick={() => { setShowMobileRoomLock(false); showMobileActionToast('Lock the room successfully.') }}>Confirm</button>
                <button type="button" className="cancel" onClick={() => setShowMobileRoomLock(false)}>Cancel</button>
              </section>
            </div>
          ) : null}
        </section>
        <section className={showMobileRoomSettings ? 'buzzcast-mobile-room-settings is-visible' : 'buzzcast-mobile-room-settings'} aria-label={`${card.title} room settings`}>
          <header>
            <button type="button" onClick={() => setShowMobileRoomSettings(false)} aria-label="Back to room">‹</button>
            <strong>Settings</strong>
            <span></span>
          </header>
          <div className="buzzcast-mobile-room-group">
            <button
              type="button"
              onClick={() => {
                setShowMobileRoomSettings(false)
                setShowMobileRoomProfile(true)
              }}
            >
              <span>Profile</span>
              <span className="buzzcast-mobile-room-value with-avatar">
                <i className="image-avatar"><img src={previewAvatar} alt="" loading="lazy" /></i>
                <b>›</b>
              </span>
            </button>
          </div>
          <div className="buzzcast-mobile-room-group">
            <button type="button">
              <span>Room Name</span>
              <span className="buzzcast-mobile-room-value"><em>{card.title}</em><b>›</b></span>
            </button>
            <button type="button">
              <span>Announcement</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
          </div>
          <div className="buzzcast-mobile-room-group">
            <button type="button">
              <span>Room Title</span>
              <span className="buzzcast-mobile-room-value"><em>{roomMeta.label}</em><b>›</b></span>
            </button>
            <button type="button">
              <span>Blocked List</span>
              <span className="buzzcast-mobile-room-value"><em>{blockedCount}</em><b>›</b></span>
            </button>
            <button type="button">
              <span>Kick History</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
            <button type="button">
              <span>Remove History</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
            <button type="button">
              <span>Operate History</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
          </div>
          <div className="buzzcast-mobile-room-group">
            <button type="button">
              <span>Live Record and Balance</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
            <button type="button">
              <span>Live Guidance</span>
              <span className="buzzcast-mobile-room-value"><b>›</b></span>
            </button>
          </div>
          <div className="buzzcast-mobile-room-live">
            <span className="image-avatar"><img src={previewAvatar} alt="" loading="lazy" /></span>
            <strong>LIVE</strong>
          </div>
          <div className="buzzcast-mobile-room-follow">
            <span></span>
            <div><strong>0 Follow</strong><small>On Live</small></div>
          </div>
        </section>
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
    setSecurityForm((previous) => ({
      ...previous,
      email: previous.email || user?.email || '',
    }))
  }, [user?.email, user?.current_residence])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('rtc_room_settings', JSON.stringify({
        phoneBound: settingsDraft.phoneBound,
        emailBound: settingsDraft.emailBound,
        loginPasswordSet: settingsDraft.loginPasswordSet,
        deviceAlerts: settingsDraft.deviceAlerts,
        messagePrivacy: settingsDraft.messagePrivacy,
        privateInvite: settingsDraft.privateInvite,
        autoPrivateDeduction: settingsDraft.autoPrivateDeduction,
        hideSensitive: settingsDraft.hideSensitive,
        contentMode: settingsDraft.contentMode,
        region: settingsDraft.region,
      }))
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = 'en'
    }
  }, [settingsDraft])

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
    setShowRankings(false)
    setShowHostPanel(false)
    setShowRecharge(false)
  }, [activeSection, user])

  return (
    <div className={`buzzcast-shell section-${activeSection}`}>
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
              <span>{searchPanelTitle}</span>
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
          <IconButton label="Rankings" onClick={openRankings}><i className="buzzcast-glyph glyph-trophy" aria-hidden="true"></i></IconButton>
          <IconButton label="Messages" badge={unreadThreadCount ? String(unreadThreadCount) : ''} onClick={openMessagesDrawer}><i className="buzzcast-glyph glyph-message" aria-hidden="true"></i></IconButton>
          <IconButton label="Create live room" className="accent" onClick={() => openHostPanel()}>+</IconButton>
          <button type="button" className="buzzcast-avatar-button" onClick={openProfileSection}>
            <span className="image-avatar">
              <img src={profileAvatar} alt={profileInitials} loading="lazy" />
            </span>
          </button>
        </div>
      </header>

      <aside className="buzzcast-left-rail">
        <button
          type="button"
          className={activeSection === 'live' || activeSection === 'room' ? 'active buzzcast-rail-tab buzzcast-rail-home' : 'buzzcast-rail-tab buzzcast-rail-home'}
          data-mobile-label="Home"
          onClick={openLiveSection}
          aria-label="Home"
        >
          <span className="buzzcast-rail-icon rail-live" aria-hidden="true"></span>
          <b>Live</b>
        </button>
        <button
          type="button"
          className={activeSection === 'me' ? 'active buzzcast-rail-tab buzzcast-rail-profile' : 'buzzcast-rail-tab buzzcast-rail-profile'}
          data-mobile-label="Me"
          onClick={openProfileSection}
          aria-label="Me"
        >
          <span className="buzzcast-rail-icon rail-me image-avatar" aria-hidden="true">
            <img src={profileAvatar} alt="" loading="lazy" />
          </span>
          <b>Me</b>
        </button>
        <div className="buzzcast-rail-spacer"></div>
        <button
          type="button"
          className={activeSection === 'settings' ? 'active buzzcast-rail-tab buzzcast-rail-moments' : 'buzzcast-rail-tab buzzcast-rail-moments'}
          data-mobile-label="Moments"
          onClick={openMobileMomentsSection}
          aria-label="Moments"
        >
          <span className="buzzcast-rail-icon rail-settings" aria-hidden="true"></span>
          <b>Settings</b>
        </button>
        <button
          type="button"
          className={showMessages || activeSection === 'help' ? 'active buzzcast-rail-tab buzzcast-rail-message-tab' : 'buzzcast-rail-tab buzzcast-rail-message-tab'}
          data-mobile-label="Message"
          onClick={openMobileMessageSection}
          aria-label="Messages"
        >
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
            {messageThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={activeThread === thread.id ? 'active' : ''}
                onClick={() => {
                  setActiveThread(thread.id)
                  setReadThreadIds((previous) => previous.includes(thread.id) ? previous : [...previous, thread.id])
                  setDmStatus('')
                }}
              >
                <i className="image-avatar"><img src={avatarForIndex(thread.avatarIndex)} alt="" loading="lazy" /></i>
                <span><strong>{thread.name}</strong><small>{followedThreadIds.includes(thread.id) ? 'Following - ' : ''}{thread.previewText}</small></span>
                <time>{thread.time}</time>
                {thread.unread ? <em>{thread.unread}</em> : null}
              </button>
            ))}
          </aside>
          <main>
            <header className="buzzcast-dm-header">
              <button type="button" className="buzzcast-dm-back" onClick={() => setShowMessages(false)} aria-label="Back to rooms">‹</button>
              <span className="buzzcast-dm-peer-avatar image-avatar">
                <img src={avatarForIndex(activeThreadData.avatarIndex || 0)} alt="" loading="lazy" />
              </span>
              <strong>{activeThreadData.name}</strong>
              <span className="buzzcast-dm-peer-id">( ID: {activeThreadData.peerId})</span>
              <button type="button" className={activeThreadFollowed ? 'following' : 'follow'} onClick={() => toggleThreadFollow(activeThread)}>
                {activeThreadFollowed ? 'Following' : 'Follow'}
              </button>
              <button type="button" className="buzzcast-dm-more" aria-label="More options">...</button>
            </header>
            <section className="buzzcast-dm-moment-card">
              <div>
                <strong>Moment</strong>
                <span>More ›</span>
              </div>
              <div className="buzzcast-dm-moment-grid">
                {giftCatalog.slice(0, 4).map((gift) => (
                  <span key={gift.id}>
                    <img src={gift.icon} alt="" loading="lazy" />
                  </span>
                ))}
              </div>
            </section>
            <p className="buzzcast-dm-intro">You can meet more friends and chat with them on TalkEachOther. I hope you can find interesting souls!</p>
            <div className={activeThreadFollowed ? 'buzzcast-dm-notice open' : 'buzzcast-dm-notice'}>
              {dmStatus || dmNotice}
            </div>
            <div className="buzzcast-dm-body">
              {(dmMessages[activeThread] || []).map((message, index) => (
                <div key={message.id} className={message.mine ? 'buzzcast-dm-message mine' : 'buzzcast-dm-message'}>
                  <time>{index === 0 ? '2026-5-23 17:17' : '2026-5-23 18:13'}</time>
                  {!message.mine ? (
                    <span className="image-avatar">
                      <img src={avatarForIndex(activeThreadData.avatarIndex || 0)} alt="" loading="lazy" />
                    </span>
                  ) : null}
                  <p>{message.body}</p>
                </div>
              ))}
            </div>
            <div className="buzzcast-dm-quick-replies">
              <button type="button" onClick={() => setDmInput('হাই')}>হাই</button>
              <button type="button" onClick={() => setDmInput('হ্যালো')}>হ্যালো</button>
              <button type="button" onClick={() => setDmInput('হে! আমি আপনার সাথে বন্ধু হতে চাই।')}>হে! আমি আপনার সাথে বন্ধু হতে চাই।</button>
            </div>
            <form className="buzzcast-dm-composer" onSubmit={sendDmMessage}>
              <button type="button" aria-label="Voice message">mic</button>
              <input
                value={dmInput}
                onChange={(event) => setDmInput(event.target.value)}
                placeholder={activeThreadFollowed ? 'Type a message...' : 'Type a message...'}
              />
              <button type="button" aria-label="Photo">photo</button>
              <button type="button" aria-label="Gift">gift</button>
              <button type="submit" aria-label="Send message">send</button>
            </form>
          </main>
        </section>
      ) : null}

      {showRankings ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowRankings(false)}>
          <section className="buzzcast-rankings-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Rankings</h2>
                <p>Calculated from room viewers, active participants, host activity, and gift value.</p>
              </div>
              <button type="button" onClick={() => setShowRankings(false)}>x</button>
            </header>
            <nav>
              {[
                { value: 'rooms', label: 'Rooms' },
                { value: 'hosts', label: 'Hosts' },
                { value: 'gifts', label: 'Gifts' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={activeRanking === item.value ? 'active' : ''}
                  onClick={() => setActiveRanking(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="buzzcast-ranking-list">
              {rankingRows.map((item, index) => (
                <article key={item.key}>
                  <b>{index + 1}</b>
                  <span className="image-avatar">
                    <img src={item.icon || avatarForIndex(item.avatarIndex || index)} alt="" loading="lazy" />
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <em>{compactNumber(item.score)}</em>
                </article>
              ))}
            </div>
          </section>
        </div>
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

      {renderSecurityActionModal()}

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
            <header><h2>Feedback</h2><button type="button" onClick={() => setShowFeedback(false)} disabled={submittingFeedback}>x</button></header>
            <div className="buzzcast-feedback-row">
              <select value={feedbackForm.category} onChange={(event) => updateFeedback('category', event.target.value)} disabled={submittingFeedback}>
                {feedbackCategories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={feedbackForm.type} onChange={(event) => updateFeedback('type', event.target.value)} disabled={submittingFeedback}>
                {feedbackTypes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <label>Problem description</label>
            <textarea
              placeholder="Please provide as much detail as possible"
              maxLength={1000}
              value={feedbackForm.description}
              onChange={(event) => updateFeedback('description', event.target.value)}
              disabled={submittingFeedback}
            ></textarea>
            <label>Problem screenshot / screen recording <small>(optional)</small></label>
            <div className={`buzzcast-upload-box ${feedbackForm.attachment ? 'has-file' : ''}`}>
              <input id="feedback-attachment" type="file" accept="image/*,video/*" onChange={handleFeedbackAttachment} disabled={submittingFeedback} />
              <label htmlFor="feedback-attachment">
                <strong>{feedbackForm.attachment ? feedbackForm.attachment.name : 'Add screenshot or screen recording'}</strong>
                <small>PNG, JPG, GIF, MP4, or WebM up to 25 MB</small>
              </label>
              {feedbackForm.attachment ? (
                <button type="button" onClick={removeFeedbackAttachment} disabled={submittingFeedback}>Remove</button>
              ) : null}
            </div>
            <label>Contact information <small>(optional)</small></label>
            <input
              placeholder="Enter your email account"
              value={feedbackForm.contact}
              onChange={(event) => updateFeedback('contact', event.target.value)}
              disabled={submittingFeedback}
            />
            {feedbackStatus ? <p className="buzzcast-feedback-status">{feedbackStatus}</p> : null}
            <button type="submit" className="buzzcast-submit" disabled={submittingFeedback}>
              {submittingFeedback ? 'Sending...' : 'Submit'}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
