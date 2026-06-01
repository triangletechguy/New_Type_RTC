import { lazy, Suspense, useEffect, useState } from 'react'
import { avatarForIndex } from './assets/rtc/catalog'
import { AUTH_EXPIRED_EVENT, clearSession, getUser, getToken, refreshCurrentUser, saveUser } from './services/api'
import { AuthModal } from './components/auth/AuthModal'
import { Sidebar } from './components/layout/Sidebar'
import { ProfileModal } from './components/profile/ProfilePanel'
import { RoomsView } from './components/rooms/RoomsView'
import { LiveRoomView } from './components/rtc/LiveRoomView'
import { defaultRtcModeForRoom } from './utils/roomConfig'
import { canUseAdminDashboard } from './utils/roles'

const AdminView = lazy(() => import('./components/admin/AdminView'))
const SdkView = lazy(() => import('./components/sdk/SdkView'))

function ViewFallback({ label }) {
  return <div className="status-bar glass-card"><strong>Loading:</strong> {label}</div>
}

function AppProfileButton({ user, onClick }) {
  const label = user ? 'Open profile' : 'Login or signup'
  const avatar = user?.avatar_url || avatarForIndex(user?.id || 0)

  return (
    <button type="button" className="app-profile-button" onClick={onClick} aria-label={label} title={label}>
      {user ? <img src={avatar} alt="" /> : <span></span>}
    </button>
  )
}

function roomRoutePath(roomId) {
  return `/room/${encodeURIComponent(roomId)}`
}

function appPathForRoute(route) {
  if (route?.activeRoom?.id) return roomRoutePath(route.activeRoom.id)
  if (route?.view === 'admin') return '/admin'
  if (route?.view === 'sdk') return '/sdk'
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
  if (window.location.pathname === '/sdk') return { view: 'sdk', activeRoom: null }
  return { view: 'rooms', activeRoom: null }
}

export default function App() {
  const [user, setUser] = useState(getUser())
  const [view, setView] = useState('rooms')
  const [activeRoom, setActiveRoom] = useState(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authReason, setAuthReason] = useState('')
  const [pendingSignupEmail, setPendingSignupEmail] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)

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
      requireAuth('Log in to open the admin dashboard.', 'login')
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
        <LiveRoomView
          roomId={activeRoom.id}
          roomPassword={activeRoom.password}
          initialRoom={activeRoom.room}
          initialRtcMode={activeRoom.rtcMode}
          autoConnect={activeRoom.autoConnect === true}
          user={user}
          onBack={leaveActiveRoomViaHistory}
          onProfile={openProfile}
        />
        <ProfileModal open={profileOpen} user={user} onSaved={handleProfileSaved} onLogout={logout} onClose={() => setProfileOpen(false)} />
      </>
    )
  }

  const canAccessAdminDashboard = canUseAdminDashboard(user)
  const safeView = view === 'admin' && !canAccessAdminDashboard ? 'rooms' : view

  if (safeView === 'rooms') {
    return (
      <>
        <RoomsView
          onEnterRoom={openRoom}
          user={user}
          onLogout={logout}
          onUserUpdated={handleProfileSaved}
          onView={changeView}
          onAuthRequired={requireAuth}
        />
        <AuthModal
          open={authModalOpen}
          initialMode={authMode}
          initialEmail={pendingSignupEmail}
          reason={authReason}
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={handleLogin}
        />
      </>
    )
  }

  return (
    <>
      <main className="app-shell">
        <Sidebar user={user} currentView={safeView} onView={changeView} onLogout={logout} />
        <section className="content-shell">
          {safeView === 'admin' && canAccessAdminDashboard && (
            <Suspense fallback={<ViewFallback label="Admin dashboard" />}>
              <AdminView onView={changeView} onOpenRoom={openRoom} />
            </Suspense>
          )}
          {safeView === 'sdk' && (
            <Suspense fallback={<ViewFallback label="SDK samples" />}>
              <SdkView />
            </Suspense>
          )}
        </section>
      </main>
      <div className="global-profile-anchor">
        <AppProfileButton user={user} onClick={openProfile} />
      </div>
      <ProfileModal open={profileOpen} user={user} onSaved={handleProfileSaved} onLogout={logout} onClose={() => setProfileOpen(false)} />
      <AuthModal
        open={authModalOpen}
        initialMode={authMode}
        initialEmail={pendingSignupEmail}
        reason={authReason}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={handleLogin}
      />
    </>
  )
}
