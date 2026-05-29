import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../../services/api'
import { formatElapsed, formatMinutes, formatNumber, formatUsageDate, getInitials } from '../../utils/formatters'
import { ActiveSessionsMonitor } from './ActiveSessionsMonitor'
import { DashboardMetrics } from './DashboardMetrics'
import { UsageLogCard } from './UsageLogCard'
import { UsageVerificationCard } from './UsageVerificationCard'

function getUsageStatus(verification) {
  if (verification?.status === 'verified') {
    return {
      label: 'Verified',
      className: 'usage-status verified',
    }
  }

  if (verification?.status) {
    return {
      label: 'Review',
      className: 'usage-status attention',
    }
  }

  return {
    label: '-',
    className: 'usage-status neutral',
  }
}

function ScopeSummary({ payload, scope }) {
  const dashboard = payload?.dashboard
  const admin = payload?.admin
  const label = scope === 'super_admin' && !admin ? 'Platform scope' : admin?.tenant_name || 'Admin scope'

  return (
    <section className="admin-scope-summary glass-card">
      <div>
        <span className="eyebrow">{label}</span>
        <h2>{admin ? admin.name : 'All admins and rooms'}</h2>
        <p>{admin ? admin.email : 'Superadmin overview across every admin-owned room.'}</p>
      </div>
      <div className="admin-scope-pills">
        <span><b>{formatNumber(dashboard?.metrics?.rooms?.total)}</b> rooms</span>
        <span><b>{formatNumber(dashboard?.active_sessions)}</b> live sessions</span>
        <span><b>{formatMinutes(dashboard?.minutes_used_this_month)}</b> this month</span>
      </div>
    </section>
  )
}

function AdminList({ admins, selectedAdminId, onSelect, onPlatform }) {
  return (
    <section className="admin-list-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Super Admin</span>
          <h2>Company Admins</h2>
        </div>
        <button type="button" className={!selectedAdminId ? 'active' : ''} onClick={onPlatform}>All rooms</button>
      </div>

      <div className="admin-account-grid">
        {admins.length === 0 ? (
          <div className="empty-control">No company admins found.</div>
        ) : admins.map((admin) => (
          <button
            type="button"
            className={selectedAdminId === admin.id ? 'admin-account-card active' : 'admin-account-card'}
            key={admin.id}
            onClick={() => onSelect(admin)}
          >
            <span className="admin-account-avatar">{getInitials(admin.name)}</span>
            <span>
              <strong>{admin.name}</strong>
              <small>{admin.email}</small>
            </span>
            <span className="admin-account-stats">
              <b>{formatNumber(admin.stats?.active_rooms)}</b> live
              <b>{formatMinutes(admin.stats?.minutes_month)}</b>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function AdminRoomsTable({ rooms }) {
  return (
    <section className="admin-data-card glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Room Data</span>
          <h2>Live State And Usage</h2>
        </div>
        <span>{formatNumber(rooms.length)} rooms</span>
      </div>

      <div className="admin-table-scroll">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>State</th>
              <th>Type</th>
              <th>Live</th>
              <th>Usage</th>
              <th>Owner</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 ? (
              <tr><td colSpan="7">No rooms in this scope yet.</td></tr>
            ) : rooms.map((room) => (
              <tr key={room.id}>
                <td>
                  <strong>#{room.id} - {room.name}</strong>
                  <span>{room.description || 'No description'}</span>
                </td>
                <td><span className={`admin-state ${room.status}`}>{room.status}</span></td>
                <td>{String(room.room_type || '').replace(/_/g, ' ')}</td>
                <td>{formatNumber(room.active_participants)} people · {formatNumber(room.mics_on)} mic · {formatNumber(room.cameras_on)} cam</td>
                <td>{formatMinutes(room.billable_minutes)} · {formatNumber(room.usage_logs)} logs</td>
                <td>{room.owner_name}</td>
                <td>{formatUsageDate(room.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DailyUsageTable({ usage }) {
  return (
    <section className="admin-data-card glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Daily Usage</span>
          <h2>Usage Amount By Day</h2>
        </div>
      </div>

      <div className="admin-table-scroll compact">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Minutes</th>
              <th>Rooms</th>
              <th>Users</th>
              <th>Logs</th>
            </tr>
          </thead>
          <tbody>
            {usage.length === 0 ? (
              <tr><td colSpan="5">No usage has been recorded in the last 30 days.</td></tr>
            ) : usage.map((day) => (
              <tr key={String(day.usage_date)}>
                <td>{formatUsageDate(day.usage_date)}</td>
                <td>{formatMinutes(day.minutes)}</td>
                <td>{formatNumber(day.rooms)}</td>
                <td>{formatNumber(day.users)}</td>
                <td>{formatNumber(day.logs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ParticipantRecordsTable({ records }) {
  return (
    <section className="admin-data-card glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Detailed Records</span>
          <h2>Join And Exit History</h2>
        </div>
        <span>{formatNumber(records.length)} records</span>
      </div>

      <div className="admin-table-scroll compact">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Room</th>
              <th>Joined</th>
              <th>Exit</th>
              <th>Duration</th>
              <th>Media</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan="6">No join or exit records in this scope yet.</td></tr>
            ) : records.map((record) => (
              <tr key={record.id}>
                <td>
                  <strong>{record.user_name}</strong>
                  <span>{record.user_email || record.role}</span>
                </td>
                <td>#{record.room_id} - {record.room_name}</td>
                <td>{formatUsageDate(record.joined_at)}</td>
                <td>{record.left_at ? formatUsageDate(record.left_at) : 'Live now'}</td>
                <td>{record.left_at ? formatElapsed(record.duration_seconds) : record.connection_status}</td>
                <td>{record.mic_enabled ? 'Mic on' : 'Mic off'} · {record.camera_enabled ? 'Cam on' : 'Cam off'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function AdminView() {
  const [overview, setOverview] = useState(null)
  const [selectedDetail, setSelectedDetail] = useState(null)
  const [selectedAdminId, setSelectedAdminId] = useState(null)
  const [status, setStatus] = useState('Loading dashboard...')
  const [loadingAdminId, setLoadingAdminId] = useState(null)

  const activePayload = selectedDetail || overview
  const dashboard = activePayload?.dashboard
  const usageVerification = dashboard?.usage_verification
  const recentUsageLogs = dashboard?.recent_usage_logs || []
  const usageStatus = getUsageStatus(usageVerification)
  const isSuperAdmin = overview?.scope === 'super_admin'
  const rooms = activePayload?.rooms || []
  const dailyUsage = activePayload?.daily_usage || []
  const participantRecords = activePayload?.participant_records || []
  const pageTitle = useMemo(() => {
    if (isSuperAdmin && selectedDetail?.admin) return `${selectedDetail.admin.name} Dashboard`
    if (isSuperAdmin) return 'Super Admin Dashboard'
    return 'Admin Dashboard'
  }, [isSuperAdmin, selectedDetail])

  async function load(options = {}) {
    try {
      if (!options.silent) setStatus('Loading dashboard...')
      const data = await apiRequest('/admin/overview')
      setOverview(data)
      setSelectedDetail(null)
      setSelectedAdminId(null)
      setStatus(options.silent ? 'Dashboard auto-refreshed' : 'Dashboard loaded')
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function loadAdmin(admin) {
    try {
      setSelectedAdminId(admin.id)
      setLoadingAdminId(admin.id)
      setStatus(`Loading ${admin.name}...`)
      const data = await apiRequest(`/admin/admins/${admin.id}`)
      setSelectedDetail(data)
      setStatus(`${admin.name} loaded`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoadingAdminId(null)
    }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(() => load({ silent: true }), 15000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="view-stack admin-dashboard-view">
      <header className="page-header glass-card">
        <div>
          <span className="eyebrow">{isSuperAdmin ? 'Super Admin' : 'Client Admin'}</span>
          <h1>{pageTitle}</h1>
          <p>{isSuperAdmin ? 'All admins, room live state, usage amounts, and detailed records.' : 'Your rooms, live state, usage, join dates, and exit dates.'}</p>
        </div>
        <div className="admin-header-actions">
          {isSuperAdmin && selectedDetail ? (
            <button className="secondary-button" onClick={() => {
              setSelectedDetail(null)
              setSelectedAdminId(null)
              setStatus('Showing all admin data')
            }}>All admins</button>
          ) : null}
          <button className="primary-button" onClick={load}>Refresh</button>
        </div>
      </header>

      <div className="status-bar glass-card">
        <strong>Status:</strong> {loadingAdminId ? `${status} (#${loadingAdminId})` : status}
      </div>

      {isSuperAdmin ? (
        <AdminList
          admins={overview?.admins || []}
          selectedAdminId={selectedAdminId}
          onSelect={loadAdmin}
          onPlatform={() => {
            setSelectedDetail(null)
            setSelectedAdminId(null)
            setStatus('Showing all admin data')
          }}
        />
      ) : null}

      <ScopeSummary payload={activePayload} scope={overview?.scope} />

      <DashboardMetrics dashboard={dashboard} usageStatusLabel={usageStatus.label} />

      <div className="admin-detail-grid">
        <AdminRoomsTable rooms={rooms} />
        <DailyUsageTable usage={dailyUsage} />
      </div>

      <ParticipantRecordsTable records={participantRecords} />

      <ActiveSessionsMonitor monitor={dashboard?.active_sessions_monitor} />

      <section className="usage-dashboard-grid">
        <UsageVerificationCard
          dashboard={dashboard}
          verification={usageVerification}
          status={usageStatus}
        />
        <UsageLogCard billingMode={dashboard?.billing_mode} logs={recentUsageLogs} />
      </section>
    </div>
  )
}
