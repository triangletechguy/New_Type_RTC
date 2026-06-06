import { avatarForUser } from '../../assets/rtc/catalog'
import { formatElapsed, formatNumber, formatUsageDate } from '../../utils/formatters'

function sessionTypeLabel(type) {
  return String(type || 'rtc').replace(/_/g, ' ')
}

function formatMs(value) {
  const number = Number(value || 0)
  return number > 0 ? `${Math.round(number)} ms` : '-'
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function HealthBadge({ health }) {
  const label = health === 'attention' ? 'Attention' : health === 'idle' ? 'Idle' : 'Live'
  return <span className={`monitor-status ${health || 'idle'}`}>{label}</span>
}

function QualityBadge({ quality }) {
  if (!quality) return <span className="monitor-quality unknown">No stats</span>

  const state = ['failed', 'poor', 'degraded', 'connecting'].includes(quality.quality) ? 'attention' : quality.quality || 'unknown'

  return (
    <span className={`monitor-quality ${state}`}>
      {quality.quality || 'unknown'} · {formatMs(quality.rtt_ms)}
    </span>
  )
}

function ParticipantPreview({ participant }) {
  const avatar = avatarForUser({ ...participant, name: participant.user_name }, participant.user_id || 0)

  return (
    <div className="monitor-participant">
      <div className="monitor-avatar"><img src={avatar} alt="" loading="lazy" /></div>
      <div>
        <strong>{participant.user_name}</strong>
        <span>{participant.role} · {formatElapsed(participant.connected_seconds)}</span>
        <QualityBadge quality={participant.quality} />
      </div>
      <div className="monitor-media">
        <span className={participant.mic_enabled ? 'on' : 'off'}>Mic</span>
        <span className={participant.camera_enabled ? 'on' : 'off'}>Cam</span>
      </div>
    </div>
  )
}

function SessionRow({ session }) {
  const visibleParticipants = session.participants.slice(0, 4)
  const hiddenParticipants = Math.max(0, session.participants.length - visibleParticipants.length)

  return (
    <article className={`monitor-session-row ${session.health}`}>
      <div className="monitor-session-main">
        <div className="monitor-session-title">
          <div>
            <strong>{session.room_name || `Room #${session.room_id}`}</strong>
            <span>Session #{session.id} · {session.owner_name}</span>
          </div>
          <HealthBadge health={session.health} />
        </div>

        <div className="monitor-session-meta">
          <span>{sessionTypeLabel(session.session_type)}</span>
          <span>{session.room_privacy}</span>
          <span>{formatElapsed(session.elapsed_seconds)}</span>
          <span>{session.signaling_room}</span>
          {session.quality?.samples ? <span>{formatNumber(session.quality.samples)} quality samples</span> : null}
        </div>

        <div className="monitor-capacity">
          <span style={{ width: `${session.capacity_percent}%` }}></span>
        </div>
      </div>

      <div className="monitor-session-stats">
        <div><span>People</span><strong>{formatNumber(session.active_participants)}/{formatNumber(session.max_mic_count)}</strong></div>
        <div><span>Mics</span><strong>{formatNumber(session.mics_on)}</strong></div>
        <div><span>Cameras</span><strong>{formatNumber(session.cameras_on)}</strong></div>
        <div><span>Reconn.</span><strong>{formatNumber(session.reconnecting)}</strong></div>
        <div><span>Loss</span><strong>{formatPercent(session.quality?.max_packet_loss_pct)}</strong></div>
      </div>

      <div className="monitor-participants-list">
        {visibleParticipants.length === 0 ? (
          <div className="empty-control">No active participants attached.</div>
        ) : visibleParticipants.map((participant) => (
          <ParticipantPreview participant={participant} key={participant.id} />
        ))}
        {hiddenParticipants > 0 && (
          <div className="monitor-more">+{hiddenParticipants} more</div>
        )}
      </div>
    </article>
  )
}

export function ActiveSessionsMonitor({ monitor }) {
  const sessions = monitor?.sessions || []
  const summary = monitor?.summary || {}
  const hasAttention = Number(summary.reconnecting || 0) > 0

  return (
    <section className="glass-card active-sessions-monitor">
      <div className="monitor-header">
        <div>
          <span className="eyebrow">Live RTC</span>
          <h2>Active Sessions Monitor</h2>
          <p>{formatNumber(summary.sessions)} sessions · {formatNumber(summary.participants)} participants · {formatNumber(summary.active_users)} users</p>
        </div>
        <div className="monitor-header-state">
          <span className={hasAttention ? 'monitor-status attention' : sessions.length ? 'monitor-status live' : 'monitor-status idle'}>
            {hasAttention ? 'Attention' : sessions.length ? 'Live' : 'Idle'}
          </span>
          <small>{monitor?.generated_at ? `Updated ${formatUsageDate(monitor.generated_at)}` : 'Waiting for data'}</small>
        </div>
      </div>

      <div className="monitor-summary-grid">
        <div><span>Sessions</span><strong>{formatNumber(summary.sessions)}</strong></div>
        <div><span>Participants</span><strong>{formatNumber(summary.participants)}</strong></div>
        <div><span>Mics On</span><strong>{formatNumber(summary.mics_on)}</strong></div>
        <div><span>Cameras On</span><strong>{formatNumber(summary.cameras_on)}</strong></div>
        <div><span>Reconnecting</span><strong>{formatNumber(summary.reconnecting)}</strong></div>
      </div>

      <div className="monitor-session-list">
        {sessions.length === 0 ? (
          <div className="empty-control">No live RTC sessions right now.</div>
        ) : sessions.map((session) => (
          <SessionRow session={session} key={session.id} />
        ))}
      </div>
    </section>
  )
}
