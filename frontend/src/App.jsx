import { lazy, Suspense, useEffect, useState } from 'react'
import { AUTH_EXPIRED_EVENT, clearSession, getToken, getUser } from './services/api'
import { LoginScreen } from './components/auth/LoginScreen'
import { Sidebar } from './components/layout/Sidebar'
import { RoomsView } from './components/rooms/RoomsView'
import { LiveRoomView } from './components/rtc/LiveRoomView'
import { defaultRtcModeForRoom } from './utils/roomConfig'

const AdminView = lazy(() => import('./components/admin/AdminView'))
const SdkView = lazy(() => import('./components/sdk/SdkView'))

function ViewFallback({ label }) {
  return <div className="status-bar glass-card"><strong>Loading:</strong> {label}</div>
}

export default function App() {
  const [token, setToken] = useState(getToken())
  const [user, setUser] = useState(getUser())
  const [view, setView] = useState('rooms')
  const [activeRoom, setActiveRoom] = useState(null)

  useEffect(() => {
    function handleAuthExpired() {
      setToken('')
      setUser(null)
      setActiveRoom(null)
      setView('rooms')
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [])

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

  function openRoom(roomId, options = {}) {
    setActiveRoom({
      id: roomId,
      password: options.password || '',
      room: options.room || null,
      rtcMode: options.rtcMode || defaultRtcModeForRoom(options.room),
      autoConnect: options.autoConnect !== false,
    })
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
        {view === 'rooms' && <RoomsView onEnterRoom={openRoom} />}
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
