import { formatNumber, formatUsageDate } from '../../utils/formatters'

function formatKbps(value) {
  const number = Number(value || 0)
  if (number >= 1000) return `${(number / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Mb/s`
  return `${Math.round(number).toLocaleString()} kb/s`
}

function formatMs(value) {
  const number = Number(value || 0)
  return number > 0 ? `${Math.round(number).toLocaleString()} ms` : '-'
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function qualityState(summary) {
  if (!summary?.samples) return 'idle'
  if (Number(summary.failed_samples || 0) > 0 || Number(summary.issue_rate || 0) >= 20) return 'attention'
  if (Number(summary.issue_samples || 0) > 0) return 'warning'
  return 'live'
}

function CandidateList({ title, items }) {
  const rows = items || []

  return (
    <div className="rtc-quality-candidates">
      <strong>{title}</strong>
      {rows.length ? rows.map((item) => (
        <span key={item.type}>
          {item.type}
          <b>{formatNumber(item.count)}</b>
        </span>
      )) : <small>No candidate data</small>}
    </div>
  )
}

export function RtcQualityPanel({ quality }) {
  const summary = quality?.summary || {}
  const rooms = quality?.rooms || []
  const recentIssues = quality?.recent_issues || []
  const state = qualityState(summary)

  return (
    <section className="glass-card rtc-quality-panel">
      <div className="monitor-header">
        <div>
          <span className="eyebrow">RTC Quality</span>
          <h2>Connection Quality Monitor</h2>
          <p>{formatNumber(summary.samples)} samples in the last {summary.window_hours || 24} hours · {formatNumber(summary.samples_last_5m)} fresh samples</p>
        </div>
        <div className="monitor-header-state">
          <span className={`monitor-status ${state === 'warning' ? 'attention' : state}`}>
            {state === 'attention' ? 'Attention' : state === 'warning' ? 'Review' : state === 'live' ? 'Healthy' : 'Waiting'}
          </span>
          <small>{summary.last_sample_at ? `Last sample ${formatUsageDate(summary.last_sample_at)}` : 'No samples yet'}</small>
        </div>
      </div>

      <div className="rtc-quality-summary-grid">
        <div><span>Issue rate</span><strong>{formatPercent(summary.issue_rate)}</strong><small>{formatNumber(summary.issue_samples)} issue samples</small></div>
        <div><span>Good samples</span><strong>{formatNumber(summary.good_samples)}</strong><small>{formatNumber(summary.fair_samples)} fair</small></div>
        <div><span>Latency</span><strong>{formatMs(summary.avg_rtt_ms)}</strong><small>Average RTT</small></div>
        <div><span>Packet loss</span><strong>{formatPercent(summary.max_packet_loss_pct)}</strong><small>Peak in window</small></div>
        <div><span>Throughput</span><strong>{formatKbps(summary.avg_incoming_kbps + summary.avg_outgoing_kbps)}</strong><small>Average in + out</small></div>
      </div>

      <div className="rtc-quality-grid">
        <div className="rtc-quality-block">
          <div className="admin-panel-header compact">
            <div>
              <span className="eyebrow">Rooms</span>
              <h3>Rooms Needing Review</h3>
            </div>
          </div>
          <div className="rtc-quality-room-list">
            {rooms.length ? rooms.map((room) => (
              <article className={room.issue_samples ? 'attention' : ''} key={room.room_id}>
                <div>
                  <strong>{room.room_name || `Room #${room.room_id}`}</strong>
                  <span>{formatNumber(room.samples)} samples · {formatPercent(room.issue_rate)} issue rate</span>
                </div>
                <div>
                  <b>{formatMs(room.avg_rtt_ms)}</b>
                  <small>{formatPercent(room.max_packet_loss_pct)} loss</small>
                </div>
              </article>
            )) : <div className="empty-control">No room quality samples yet.</div>}
          </div>
        </div>

        <div className="rtc-quality-block">
          <div className="admin-panel-header compact">
            <div>
              <span className="eyebrow">Transport</span>
              <h3>ICE Candidate Usage</h3>
            </div>
          </div>
          <div className="rtc-quality-candidate-grid">
            <CandidateList title="Local" items={summary.local_candidate_types} />
            <CandidateList title="Remote" items={summary.remote_candidate_types} />
          </div>
        </div>
      </div>

      <div className="rtc-quality-block">
        <div className="admin-panel-header compact">
          <div>
            <span className="eyebrow">Recent Issues</span>
            <h3>Latest Poor Connections</h3>
          </div>
        </div>
        <div className="rtc-quality-issue-list">
          {recentIssues.length ? recentIssues.map((issue) => (
            <article key={issue.id}>
              <div>
                <span className={`monitor-status ${issue.quality === 'failed' ? 'attention' : 'idle'}`}>{issue.quality}</span>
                <strong>{issue.room_name || `Room #${issue.room_id}`}</strong>
                <small>{issue.user_name} · {formatUsageDate(issue.created_at)}</small>
              </div>
              <div>
                <span>{formatMs(issue.rtt_ms)}</span>
                <span>{formatPercent(issue.packet_loss_pct)} loss</span>
                <span>{formatKbps(issue.incoming_kbps + issue.outgoing_kbps)}</span>
              </div>
            </article>
          )) : <div className="empty-control">No poor RTC samples in the current window.</div>}
        </div>
      </div>
    </section>
  )
}
