import { useEffect, useState } from 'react'
import { apiRequest } from '../../services/api'
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

export default function AdminView() {
  const [dashboard, setDashboard] = useState(null)
  const [status, setStatus] = useState('Loading dashboard...')
  const usageVerification = dashboard?.usage_verification
  const recentUsageLogs = dashboard?.recent_usage_logs || []
  const usageStatus = getUsageStatus(usageVerification)

  async function load(options = {}) {
    try {
      if (!options.silent) setStatus('Loading dashboard...')
      const data = await apiRequest('/admin/dashboard')
      setDashboard(data.dashboard)
      setStatus(options.silent ? 'Dashboard auto-refreshed' : 'Dashboard loaded')
    } catch (error) {
      setStatus(error.message)
    }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(() => load({ silent: true }), 15000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="view-stack">
      <header className="page-header glass-card">
        <div>
          <span className="eyebrow">Client Admin</span>
          <h1>Admin Dashboard</h1>
          <p>Active sessions, usage minutes, and RTC health.</p>
        </div>
        <button className="primary-button" onClick={load}>Refresh</button>
      </header>

      <div className="status-bar glass-card"><strong>Status:</strong> {status}</div>

      <DashboardMetrics dashboard={dashboard} usageStatusLabel={usageStatus.label} />

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
