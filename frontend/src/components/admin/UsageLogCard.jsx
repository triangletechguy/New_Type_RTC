import { formatDuration, formatUsageDate } from '../../utils/formatters'

export function UsageLogCard({ billingMode, logs = [] }) {
  return (
    <div className="glass-card usage-log-card">
      <div className="usage-card-header">
        <div>
          <span className="eyebrow">Recent Records</span>
          <h2>Usage Logs</h2>
        </div>
        <span className="usage-status neutral">{billingMode || 'participant_minutes'}</span>
      </div>

      <div className="usage-log-list">
        {logs.length === 0 ? (
          <div className="empty-control">No usage logs recorded yet.</div>
        ) : logs.map((log) => (
          <article className="usage-log-row" key={log.id}>
            <div>
              <strong>{log.user_name || `User #${log.user_id}`}</strong>
              <span>{log.usage_type} · {log.room_name || `Room #${log.room_id}`}</span>
            </div>
            <div>
              <strong>{formatDuration(log.duration_seconds)}</strong>
              <span>{log.billable_minutes} min · {formatUsageDate(log.ended_at || log.created_at)}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
