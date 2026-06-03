import { avatarForUser, brandAssets } from '../../assets/rtc/catalog'
import { canUseAdminDashboard } from '../../utils/roles'

export function Sidebar({ user, currentView, onView, onLogout }) {
  const showAdminDashboard = canUseAdminDashboard(user) === true
  const avatar = avatarForUser(user, user?.id || 0)

  return (
    <aside className="sidebar glass-card">
      <div className="logo-row">
        <div className="logo-mark image-mark">
          <img src={brandAssets.appIconSmall} alt="TalkEachOther" decoding="async" />
        </div>
        <div>
          <strong>talk-each-other</strong>
          <span>RTC service platform</span>
        </div>
      </div>

      <button className={currentView === 'rooms' ? 'nav-item active' : 'nav-item'} onClick={() => onView('rooms')}>Rooms</button>
      {showAdminDashboard ? (
        <button className={currentView === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => onView('admin')}>Admin Dashboard</button>
      ) : null}
      <button className={currentView === 'sdk' ? 'nav-item active' : 'nav-item'} onClick={() => onView('sdk')}>Developer Docs</button>

      <div className="sidebar-user">
        <div className="avatar image-avatar"><img src={avatar} alt="" /></div>
        <div>
          <strong>{user?.name || 'User'}</strong>
          <span>{user?.email}</span>
        </div>
      </div>

      <button className="nav-item danger" onClick={onLogout}>Logout</button>
    </aside>
  )
}
