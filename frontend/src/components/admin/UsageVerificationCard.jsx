function usageNumber(value, fallback = '-') {
  return value ?? fallback
}

export function UsageVerificationCard({ dashboard, verification, status }) {
  const checks = [
    ['User Sessions Audited', usageNumber(verification?.ended_participants)],
    ['Missing Logs', usageNumber(verification?.missing_usage_logs)],
    ['Duration Drift', usageNumber(verification?.duration_mismatches)],
    ['Duplicate Logs', usageNumber(verification?.duplicate_usage_logs)],
    ['Session Totals', usageNumber(verification?.session_total_mismatches)],
  ]

  return (
    <div className="glass-card usage-verification-card">
      <div className="usage-card-header">
        <div>
          <span className="eyebrow">Billing Integrity</span>
          <h2>Usage Verification</h2>
        </div>
        <span className={status.className}>{status.label}</span>
      </div>

      <div className="usage-check-grid">
        {checks.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="usage-period-row">
        <div>
          <span>Today</span>
          <strong>{dashboard?.usage_today?.logs ?? 0} logs</strong>
          <small>{dashboard?.usage_today?.users ?? 0} users · {dashboard?.usage_today?.minutes ?? 0} min</small>
        </div>
        <div>
          <span>This Month</span>
          <strong>{dashboard?.usage_month?.logs ?? 0} logs</strong>
          <small>{dashboard?.usage_month?.users ?? 0} users · {dashboard?.usage_month?.minutes ?? 0} min</small>
        </div>
      </div>
    </div>
  )
}
