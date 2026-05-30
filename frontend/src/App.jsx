import { lazy, Suspense, useEffect, useState } from 'react'
import { AUTH_EXPIRED_EVENT, clearSession, getUser } from './services/api'
import { AuthModal } from './components/auth/AuthModal'
import { Sidebar } from './components/layout/Sidebar'
import { RoomsView } from './components/rooms/RoomsView'
import { LiveRoomView } from './components/rtc/LiveRoomView'
import { defaultRtcModeForRoom } from './utils/roomConfig'
import { canUseAdminDashboard } from './utils/roles'

const AdminView = lazy(() => import('./components/admin/AdminView'))
const SdkView = lazy(() => import('./components/sdk/SdkView'))

function ViewFallback({ label }) {
  return <div className="status-bar glass-card"><strong>Loading:</strong> {label}</div>
}

export default function App() {
  const [user, setUser] = useState(getUser())
  const [view, setView] = useState('rooms')
  const [activeRoom, setActiveRoom] = useState(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authReason, setAuthReason] = useState('')
  const [pendingSignupEmail, setPendingSignupEmail] = useState('')

  useEffect(() => {
    function handleAuthExpired() {
      setUser(null)
      setActiveRoom(null)
      setView('rooms')
      setAuthReason('Your session expired. Log in again to continue.')
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [])

  function handleLogin(currentUser) {
    setUser(currentUser)
    setView('rooms')
    setAuthModalOpen(false)
    setAuthReason('')
  }

  function logout() {
    clearSession()
    setUser(null)
  }

  function changeView(nextView) {
    if (nextView === 'admin' && !user) {
      requireAuth('Log in to open the admin dashboard.', 'login')
      return
    }
    if (nextView === 'admin' && !canAccessAdminDashboard) return
    setView(nextView)
  }

  function requireAuth(reason = 'Log in or sign up to continue.', mode = 'login', email = '') {
    setAuthReason(reason)
    setAuthMode(mode)
    setPendingSignupEmail(email)
    setAuthModalOpen(true)
  }

  function openRoom(roomId, options = {}) {
    setActiveRoom({
      id: roomId,
      password: options.password || '',
      room: options.room || null,
      rtcMode: options.rtcMode || defaultRtcModeForRoom(options.room),
      autoConnect: options.autoConnect !== false,
    })
  }

  if (activeRoom?.id && user) {
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

  const canAccessAdminDashboard = canUseAdminDashboard(user)
  const safeView = view === 'admin' && !canAccessAdminDashboard ? 'rooms' : view

  if (safeView === 'rooms') {
    return (
      <>
        <RoomsView
          onEnterRoom={openRoom}
          user={user}
          onLogout={logout}
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
