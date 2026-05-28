import { formatMinutes, formatNumber } from '../../utils/formatters'

function metricValue(value) {
  return value ?? '-'
}

function buildMetrics(dashboard, usageStatusLabel) {
  const dashboardMetrics = dashboard?.metrics

  if (!dashboardMetrics) {
    return [
      {
        label: 'Active Rooms',
        value: dashboard?.active_rooms ?? '-',
        detail: 'Waiting for room metrics',
      },
      {
        label: 'Active Sessions',
        value: dashboard?.active_sessions ?? '-',
        detail: 'Waiting for session metrics',
      },
      {
        label: 'Total Users',
        value: dashboard?.total_users ?? '-',
        detail: 'Waiting for user metrics',
      },
      {
        label: 'Minutes Today',
        value: dashboard?.minutes_used_today ?? '-',
        detail: 'Waiting for usage metrics',
      },
      {
        label: 'Monthly Minutes',
        value: dashboard?.minutes_used_this_month ?? '-',
        detail: 'Waiting for billing metrics',
      },
      {
        label: 'Usage Check',
        value: usageStatusLabel,
        detail: 'Waiting for verification metrics',
      },
    ]
  }

  const cards = [
    {
      label: 'Live Rooms',
      value: formatNumber(dashboardMetrics.rooms.active),
      detail: `${formatNumber(dashboardMetrics.rooms.total)} total · ${formatNumber(dashboardMetrics.rooms.public)} public`,
      badge: `${formatNumber(dashboardMetrics.rooms.created_today)} new`,
      tone: 'sky',
    },
    {
      label: 'Live Participants',
      value: formatNumber(dashboardMetrics.participants.active),
      detail: `${formatNumber(dashboardMetrics.participants.mics_on)} mics · ${formatNumber(dashboardMetrics.participants.cameras_on)} cameras`,
      badge: `${formatNumber(dashboardMetrics.participants.active_users)} users`,
      tone: 'mint',
    },
    {
      label: 'RTC Sessions',
      value: formatNumber(dashboardMetrics.sessions.active),
      detail: `${formatNumber(dashboardMetrics.sessions.started_today)} started · ${formatNumber(dashboardMetrics.sessions.ended_today)} ended today`,
      badge: `${formatNumber(dashboardMetrics.sessions.total)} total`,
      tone: 'violet',
    },
    {
      label: 'Users',
      value: formatNumber(dashboardMetrics.users.total),
      detail: `${formatNumber(dashboardMetrics.users.active)} active · ${formatNumber(dashboardMetrics.users.new_today)} new today`,
      badge: `${formatNumber(dashboardMetrics.users.new_7_days)} / 7d`,
      tone: 'mint',
    },
    {
      label: 'Usage Today',
      value: formatMinutes(dashboardMetrics.usage.today.minutes),
      detail: `${formatNumber(dashboardMetrics.usage.today.logs)} logs · ${formatNumber(dashboardMetrics.usage.today.users)} users`,
      badge: `${formatNumber(dashboardMetrics.usage.today.rooms)} rooms`,
      tone: 'hot',
    },
    {
      label: 'Monthly Usage',
      value: formatMinutes(dashboardMetrics.usage.month.minutes),
      detail: `${formatNumber(dashboardMetrics.usage.month.logs)} logs · ${formatNumber(dashboardMetrics.usage.month.users)} users`,
      badge: `${formatNumber(dashboardMetrics.usage.month.rooms)} rooms`,
      tone: 'amber',
    },
    {
      label: 'Chat Today',
      value: formatNumber(dashboardMetrics.chat.messages_today),
      detail: `${formatNumber(dashboardMetrics.chat.messages_last_hour)} last hour · ${formatNumber(dashboardMetrics.chat.unsent_today)} unsent`,
      badge: `${formatNumber(dashboardMetrics.chat.total)} total`,
      tone: 'sky',
    },
    {
      label: 'Moderation',
      value: formatNumber(dashboardMetrics.moderation.events_today),
      detail: `${formatNumber(dashboardMetrics.moderation.kicks_today)} kicks · ${formatNumber(dashboardMetrics.moderation.bans_today)} bans`,
      badge: `${formatNumber(dashboardMetrics.moderation.active_bans)} active bans`,
      tone: dashboardMetrics.moderation.events_today || dashboardMetrics.moderation.active_bans ? 'amber' : 'neutral',
    },
  ]

  if (dashboardMetrics.verification.issue_count > 0) {
    cards.push({
      label: 'Usage Issues',
      value: formatNumber(dashboardMetrics.verification.issue_count),
      detail: 'Verification needs review',
      badge: usageStatusLabel,
      tone: 'amber',
    })
  }

  return cards
}

export function DashboardMetrics({ dashboard, usageStatusLabel }) {
  const metrics = buildMetrics(dashboard, usageStatusLabel)

  return (
    <section className="metrics-grid">
      {metrics.map((metric) => (
        <div className={`metric metric-card glass-card ${metric.tone || 'neutral'}`} key={metric.label}>
          <div className="metric-topline">
            <span>{metric.label}</span>
            {metric.badge && <small>{metric.badge}</small>}
          </div>
          <strong>{metricValue(metric.value)}</strong>
          <p>{metric.detail}</p>
        </div>
      ))}
    </section>
  )
}
