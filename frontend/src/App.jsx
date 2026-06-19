import { lazy, Suspense, useEffect, useState } from 'react'
import { AUTH_EXPIRED_EVENT, clearSession, getUser, getToken, refreshCurrentUser, saveUser } from './services/api'
import { Sidebar } from './components/layout/Sidebar'
import { LoadingMovie } from './components/common/LoadingMovie'
import { avatarForUser, initialAvatarForName } from './assets/rtc/catalog'
import { defaultRtcModeForRoom } from './utils/roomConfig'
import { canUseAdminDashboard } from './utils/roles'
import {
  applyStaticTranslations,
  normalizeSettingsLanguage,
  readStoredSettingsLanguage,
  settingsLanguageCodes,
  translateApp,
  writeStoredSettingsLanguage,
} from './components/rooms/roomsStaticData'

const AuthModal = lazy(() => import('./components/auth/AuthModal').then((module) => ({ default: module.AuthModal })))
const AdminView = lazy(() => import('./components/admin/AdminView'))
const LiveRoomView = lazy(() => import('./components/rtc/LiveRoomView').then((module) => ({ default: module.LiveRoomView })))
const ProfileModal = lazy(() => import('./components/profile/ProfilePanel').then((module) => ({ default: module.ProfileModal })))
const RoomsView = lazy(() => import('./components/rooms/RoomsView').then((module) => ({ default: module.RoomsView })))

function ViewFallback({ label, language = 'English' }) {
  const translatedLabel = translateApp(language, label)
  return <LoadingMovie label={translateApp(language, 'Loading {label}', { label: translatedLabel })} className="view-loading" />
}

function AppProfileButton({ user, onClick, language = 'English' }) {
  const label = translateApp(language, user ? 'Open profile' : 'Login or signup')
  const avatar = user ? avatarForUser(user, user?.id || 0) : initialAvatarForName(translateApp(language, 'User'))

  return (
    <button type="button" className="app-profile-button" onClick={onClick} aria-label={label} title={label}>
      <img src={avatar} alt="" />
    </button>
  )
}

function roomRoutePath(roomId) {
  return `/room/${encodeURIComponent(roomId)}`
}

function appPathForRoute(route) {
  if (route?.activeRoom?.id) return roomRoutePath(route.activeRoom.id)
  if (route?.view === 'admin') return '/admin'
  return '/'
}

function normalizeRoomRoute(room) {
  if (!room?.id) return null

  return {
    id: Number(room.id),
    password: room.password || '',
    room: room.room || null,
    rtcMode: room.rtcMode || defaultRtcModeForRoom(room.room),
    autoConnect: room.autoConnect !== false,
  }
}

function routeFromLocation(currentUser) {
  if (typeof window === 'undefined') return { view: 'rooms', activeRoom: null }

  const roomMatch = window.location.pathname.match(/^\/room\/(\d+)\/?$/)
  if (roomMatch && currentUser) {
    return {
      view: 'rooms',
      activeRoom: {
        id: Number(roomMatch[1]),
        password: '',
        room: null,
        rtcMode: 'video',
        autoConnect: true,
      },
    }
  }

  if (window.location.pathname === '/admin') return { view: 'admin', activeRoom: null }
  return { view: 'rooms', activeRoom: null }
}

export default function App() {
  const [user, setUser] = useState(getUser())
  const [view, setView] = useState('rooms')
  const [activeRoom, setActiveRoom] = useState(null)
  const [language, setLanguage] = useState(() => readStoredSettingsLanguage())
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authReason, setAuthReason] = useState('')
  const [pendingSignupEmail, setPendingSignupEmail] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const t = (key, replacements = {}) => translateApp(language, key, replacements)

  function setBrowserRoute(route, action = 'push') {
    if (typeof window === 'undefined') return

    const nextRoute = {
      view: route?.view || 'rooms',
      activeRoom: normalizeRoomRoute(route?.activeRoom),
      openedFromApp: action === 'push' || Boolean(route?.openedFromApp),
    }
    const path = appPathForRoute(nextRoute)
    if (action === 'replace') window.history.replaceState(nextRoute, '', path)
    else window.history.pushState(nextRoute, '', path)
  }

  function applyRoute(route) {
    const nextRoute = route || { view: 'rooms', activeRoom: null }
    setActiveRoom(normalizeRoomRoute(nextRoute.activeRoom))
    setView(nextRoute.view || 'rooms')
    setProfileOpen(false)
  }

  function changeLanguage(nextLanguage) {
    const normalizedLanguage = normalizeSettingsLanguage(nextLanguage)
    setLanguage(normalizedLanguage)
    writeStoredSettingsLanguage(normalizedLanguage)
  }

  useEffect(() => {
    const initialRoute = routeFromLocation(user)
    setBrowserRoute(initialRoute, 'replace')
    applyRoute(initialRoute)

    function handlePopState(event) {
      applyRoute(event.state || routeFromLocation(user))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = settingsLanguageCodes[language] || 'en'
    }
  }, [language])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined

    let frameId = 0
    const runTranslations = () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => applyStaticTranslations(language))
    }

    runTranslations()
    const observer = new MutationObserver(runTranslations)
    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [language])

  useEffect(() => {
    function handleAuthExpired() {
      setUser(null)
      setActiveRoom(null)
      setView('rooms')
      setBrowserRoute({ view: 'rooms', activeRoom: null }, 'replace')
      setAuthReason('Your session expired. Log in again to continue.')
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [])

  useEffect(() => {
    if (!getToken()) return undefined

    let cancelled = false
    refreshCurrentUser()
      .then((data) => {
        if (!cancelled) setUser(data.user)
      })
      .catch((error) => {
        if (cancelled) return
        if (error.status === 401 || error.status === 403) {
          clearSession()
          setUser(null)
          setProfileOpen(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  function handleLogin(currentUser) {
    setUser(currentUser)
    setView('rooms')
    setActiveRoom(null)
    setBrowserRoute({ view: 'rooms', activeRoom: null }, 'replace')
    setAuthModalOpen(false)
    setAuthReason('')
  }

  function handleProfileSaved(currentUser) {
    setUser(currentUser)
    saveUser(currentUser)
  }

  function logout() {
    clearSession()
    setUser(null)
    setProfileOpen(false)
  }

  function changeView(nextView) {
    if (nextView === 'admin' && !user) {
      requireAuth('Log in to open creator tools.', 'login')
      return
    }
    if (nextView === 'admin' && !canAccessAdminDashboard) return
    setActiveRoom(null)
    setView(nextView)
    setBrowserRoute({ view: nextView, activeRoom: null })
  }

  function requireAuth(reason = 'Log in or sign up to continue.', mode = 'login', email = '') {
    setAuthReason(reason)
    setAuthMode(mode)
    setPendingSignupEmail(email)
    setAuthModalOpen(true)
  }

  function openRoom(roomId, options = {}) {
    const nextRoom = {
      id: roomId,
      password: options.password || '',
      room: options.room || null,
      rtcMode: options.rtcMode || defaultRtcModeForRoom(options.room),
      autoConnect: options.autoConnect !== false,
    }
    setActiveRoom(nextRoom)
    setBrowserRoute({ view: 'rooms', activeRoom: nextRoom })
  }

  function leaveActiveRoomViaHistory() {
    setActiveRoom(null)
    setView('rooms')
    setBrowserRoute({ view: 'rooms', activeRoom: null }, 'replace')
  }

  function openProfile() {
    if (!user) {
      requireAuth('Log in or sign up to open your profile.', 'login')
      return
    }

    setProfileOpen(true)
  }

  if (activeRoom?.id && user) {
    return (
      <>
        <Suspense fallback={<ViewFallback label="Live room" language={language} />}>
          <LiveRoomView
            roomId={activeRoom.id}
            roomPassword={activeRoom.password}
            initialRoom={activeRoom.room}
            initialRtcMode={activeRoom.rtcMode}
            autoConnect={activeRoom.autoConnect === true}
            user={user}
            language={language}
            onBack={leaveActiveRoomViaHistory}
            onProfile={openProfile}
          />
        </Suspense>
        {profileOpen ? (
          <Suspense fallback={<LoadingMovie label={t('Loading {label}', { label: t('profile') })} compact />}>
            <ProfileModal open={profileOpen} user={user} language={language} onSaved={handleProfileSaved} onLogout={logout} onClose={() => setProfileOpen(false)} />
          </Suspense>
        ) : null}
      </>
    )
  }

  const canAccessAdminDashboard = canUseAdminDashboard(user)
  const safeView = view === 'admin' && !canAccessAdminDashboard ? 'rooms' : view

  if (safeView === 'rooms') {
    return (
      <>
        <Suspense fallback={<ViewFallback label="Rooms" language={language} />}>
          <RoomsView
            onEnterRoom={openRoom}
            user={user}
            language={language}
            onLanguageChange={changeLanguage}
            onLogout={logout}
            onUserUpdated={handleProfileSaved}
            onView={changeView}
            onAuthRequired={requireAuth}
          />
        </Suspense>
        {authModalOpen ? (
          <Suspense fallback={<LoadingMovie label={t('Loading {label}', { label: t('account') })} compact />}>
            <AuthModal
              open={authModalOpen}
              initialMode={authMode}
              initialEmail={pendingSignupEmail}
              reason={authReason}
              language={language}
              onClose={() => setAuthModalOpen(false)}
              onAuthenticated={handleLogin}
            />
          </Suspense>
        ) : null}
      </>
    )
  }

  return (
    <>
      <main className="app-shell">
        <Sidebar user={user} currentView={safeView} language={language} onView={changeView} onLogout={logout} />
        <section className="content-shell">
          {safeView === 'admin' && canAccessAdminDashboard && (
            <Suspense fallback={<ViewFallback label="Service dashboard" language={language} />}>
              <AdminView onView={changeView} onOpenRoom={openRoom} user={user} language={language} onProfile={openProfile} />
            </Suspense>
          )}
        </section>
      </main>
      {safeView === 'admin' && canAccessAdminDashboard ? null : (
        <div className="global-profile-anchor">
          <AppProfileButton user={user} language={language} onClick={openProfile} />
        </div>
      )}
      {profileOpen ? (
        <Suspense fallback={<LoadingMovie label={t('Loading {label}', { label: t('profile') })} compact />}>
          <ProfileModal open={profileOpen} user={user} language={language} onSaved={handleProfileSaved} onLogout={logout} onClose={() => setProfileOpen(false)} />
        </Suspense>
      ) : null}
      {authModalOpen ? (
        <Suspense fallback={<LoadingMovie label={t('Loading {label}', { label: t('account') })} compact />}>
          <AuthModal
            open={authModalOpen}
            initialMode={authMode}
            initialEmail={pendingSignupEmail}
            reason={authReason}
            language={language}
            onClose={() => setAuthModalOpen(false)}
            onAuthenticated={handleLogin}
          />
        </Suspense>
      ) : null}
    </>
  )
}
