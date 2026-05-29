function countByState(peerStates = {}) {
  return Object.values(peerStates).reduce((counts, state) => {
    const key = state || 'new'
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}

function subsystemClass(state) {
  if (['ready', 'connected', 'live'].includes(state)) return 'ready'
  if (['starting', 'connecting', 'negotiating', 'waiting', 'reconnecting'].includes(state)) return 'working'
  if (['warning', 'degraded', 'disconnected', 'failed', 'error'].includes(state)) return 'attention'
  return 'idle'
}

function buildPeerSummary(peerStates, remoteStreams, signalingPeerCount) {
  const counts = countByState(peerStates)
  const connected = counts.connected || 0
  const failed = (counts.failed || 0) + (counts.disconnected || 0)
  const connecting = (counts.connecting || 0) + (counts.new || 0) + (counts.negotiating || 0) + (counts.waiting || 0)
  const remoteStreamCount = Object.keys(remoteStreams || {}).length

  if (failed > 0) {
    return {
      state: 'degraded',
      label: `${failed} peer issue${failed === 1 ? '' : 's'}`,
      detail: `${connected} connected - ${connecting} negotiating`,
    }
  }

  if (connected > 0) {
    return {
      state: 'connected',
      label: `${connected} peer${connected === 1 ? '' : 's'} connected`,
      detail: `${remoteStreamCount} remote stream${remoteStreamCount === 1 ? '' : 's'}`,
    }
  }

  if (connecting > 0) {
    return {
      state: 'negotiating',
      label: `${connecting} peer${connecting === 1 ? '' : 's'} negotiating`,
      detail: `${signalingPeerCount || 0} signaling peer${signalingPeerCount === 1 ? '' : 's'}`,
    }
  }

  return {
    state: signalingPeerCount > 0 ? 'negotiating' : 'idle',
    label: signalingPeerCount > 0 ? 'Waiting for media' : 'Standby',
    detail: `${signalingPeerCount || 0} signaling peer${signalingPeerCount === 1 ? '' : 's'}`,
  }
}

function buildOverallState({ joined, joining, connectionIssue, signalingState, mediaState, peerSummary }) {
  if (connectionIssue || mediaState === 'failed' || signalingState === 'error') {
    return {
      state: 'attention',
      label: 'RTC Attention',
      detail: connectionIssue || 'Connection needs review',
    }
  }

  if (joined && ['disconnected', 'reconnecting'].includes(signalingState)) {
    return {
      state: 'attention',
      label: 'RTC Reconnecting',
      detail: 'Signaling is trying to recover',
    }
  }

  if (peerSummary.state === 'degraded') {
    return {
      state: 'attention',
      label: 'RTC Degraded',
      detail: peerSummary.label,
    }
  }

  if (joined) {
    return {
      state: 'online',
      label: 'RTC Connected',
      detail: 'Backend, media, and signaling are ready',
    }
  }

  if (joining) {
    return {
      state: 'connecting',
      label: 'Connecting RTC',
      detail: 'Walking through the RTC workflow',
    }
  }

  return {
    state: 'idle',
    label: 'RTC Ready',
    detail: 'Press Connect RTC to start',
  }
}

function SubsystemPill({ label, state, detail }) {
  return (
    <div className={`rtc-subsystem ${subsystemClass(state)}`}>
      <span>{label}</span>
      <strong>{state}</strong>
      <small>{detail}</small>
    </div>
  )
}

export function RtcConnectionIndicator({
  steps,
  connectStep,
  joined,
  joining,
  connectAttempted,
  session,
  localStream,
  mediaState,
  signalingState,
  signalingPeerCount,
  peerStates,
  remoteStreams,
  rtcMode,
  mediaMode,
  micOn,
  cameraOn,
  connectionIssue,
}) {
  const activeConnectStepIndex = Math.max(0, steps.findIndex((step) => step.value === connectStep))
  const audioTracks = localStream?.getAudioTracks?.() || []
  const videoTracks = localStream?.getVideoTracks?.() || []
  const liveAudio = audioTracks.filter((track) => track.readyState === 'live').length
  const liveVideo = videoTracks.filter((track) => track.readyState === 'live').length
  const backendState = session ? 'ready' : joining && connectAttempted ? 'connecting' : 'idle'
  const mediaDetail = localStream
    ? `${liveAudio} audio - ${liveVideo} video`
    : rtcMode === 'audio' ? 'Audio requested' : 'Audio and video requested'
  const peerSummary = buildPeerSummary(peerStates, remoteStreams, signalingPeerCount)
  const overall = buildOverallState({ joined, joining, connectionIssue, signalingState, mediaState, peerSummary })

  return (
    <section className={`connect-flow rtc-indicator ${overall.state}`} aria-label="RTC connection indicator">
      <div className="connect-flow-summary">
        <span className={`connect-dot ${overall.state}`}></span>
        <div>
          <strong>{overall.label}</strong>
          <span>{overall.detail}</span>
        </div>
      </div>

      <div className="rtc-indicator-main">
        <div className="connect-steps">
          {steps.map((step, index) => (
            <span
              key={step.value}
              className={index < activeConnectStepIndex ? 'connect-step done' : index === activeConnectStepIndex ? 'connect-step active' : 'connect-step'}
            >
              {step.label}
            </span>
          ))}
        </div>

        <div className="rtc-subsystem-grid">
          <SubsystemPill label="Backend" state={backendState} detail={session ? `Session #${session.id}` : 'No session'} />
          <SubsystemPill label="Media" state={mediaState} detail={mediaDetail} />
          <SubsystemPill label="Signal" state={signalingState} detail={`${signalingPeerCount || 0} peer(s)`} />
          <SubsystemPill label="Peers" state={peerSummary.state} detail={peerSummary.detail} />
        </div>

        <div className="rtc-indicator-footer">
          <span>{rtcMode} mode</span>
          <span>{mediaMode} media</span>
          <span>{micOn ? 'mic on' : 'mic muted'}</span>
          <span>{cameraOn && rtcMode === 'video' ? 'camera on' : 'camera off'}</span>
        </div>
      </div>
    </section>
  )
}
