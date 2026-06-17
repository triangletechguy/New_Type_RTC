import { avatarForUser, brandAssets } from '../../assets/rtc/catalog'
import { canUseAdminDashboard } from '../../utils/roles'
import { translateApp } from '../rooms/roomsStaticData'

export function Sidebar({ user, currentView, onView, onLogout, language = 'English' }) {
  const showAdminDashboard = canUseAdminDashboard(user) === true
  const showDeveloperDocs = showAdminDashboard
  const avatar = avatarForUser(user, user?.id || 0)
  const t = (key, replacements = {}) => translateApp(language, key, replacements)

  return (
    <aside className="sidebar glass-card">
      <div className="logo-row">
        <div className="logo-mark image-mark">
          <img src={brandAssets.appIconSmall} alt="TalkEachOther" decoding="async" />
        </div>
        <div>
          <strong>TalkEachOther</strong>
          <span>{t('Live social rooms')}</span>
        </div>
      </div>

      <button className={currentView === 'rooms' ? 'nav-item active' : 'nav-item'} onClick={() => onView('rooms')}>{t('Live Rooms')}</button>
      {showAdminDashboard ? (
        <button className={currentView === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => onView('admin')}>{t('Admin Dashboard')}</button>
      ) : null}
      {showDeveloperDocs ? (
        <button className={currentView === 'sdk' ? 'nav-item active' : 'nav-item'} onClick={() => onView('sdk')}>{t('Developer Docs')}</button>
      ) : null}

      <div className="sidebar-user">
        <div className="avatar image-avatar"><img src={avatar} alt="" /></div>
        <div>
          <strong>{user?.name || t('User')}</strong>
          <span>{user?.email}</span>
        </div>
      </div>

      <button className="nav-item danger" onClick={onLogout}>{t('Logout')}</button>
    </aside>
  )
}
