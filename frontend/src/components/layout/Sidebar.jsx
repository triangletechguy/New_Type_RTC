import { canUseAdminDashboard } from '../../utils/roles'

export function Sidebar({ user, currentView, onView, onLogout }) {
  const showAdminDashboard = canUseAdminDashboard(user) === true

  return (
    <aside className="sidebar glass-card">
      <div className="logo-row">
        <div className="logo-mark">T</div>
        <div>
          <strong>talk-each-other</strong>
          <span>Video and music RTC</span>
        </div>
      </div>

      <button className={currentView === 'rooms' ? 'nav-item active' : 'nav-item'} onClick={() => onView('rooms')}>Rooms</button>
      {showAdminDashboard ? (
        <button className={currentView === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => onView('admin')}>Admin Dashboard</button>
      ) : null}
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
