import { useEffect, useRef, useState } from 'react'
import { avatarForUser } from '../../assets/rtc/catalog'

function visualIndexFromLabel(label) {
  return String(label || 'User')
    .split('')
    .reduce((total, char) => total + char.charCodeAt(0), 0)
}

function hasLiveMediaTrack(stream, kind) {
  return stream?.getTracks?.().some((track) => (
    track.kind === kind
    && track.readyState === 'live'
  )) || false
}

function hasMediaTrack(stream, kind) {
  return stream?.getTracks?.().some((track) => (
    track.kind === kind && track.readyState !== 'ended'
  )) || false
}

function isVideoConnectingState(connectionState, stream) {
  const state = String(connectionState || '').toLowerCase()
  if (!stream) return true
  return ['', 'new', 'waiting', 'negotiating', 'connecting', 'checking', 'reconnecting', 'glare'].includes(state)
}

export function VideoTile({
  stream,
  label,
  userId,
  gender = '',
  avatarUrl = '',
  muted = false,
  badge,
  micOn = true,
  cameraOn = true,
  rtcMode = 'video',
  showMediaState = false,
  connectionState = '',
  followStatus = '',
  onFollowAction,
  onExpand,
  expandLabel = 'Open screen share full screen',
}) {
  const videoRef = useRef(null)
  const audioRef = useRef(null)
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false)
  const [streamVersion, setStreamVersion] = useState(0)
  const hasLiveVideo = hasLiveMediaTrack(stream, 'video')
  const hasAudio = hasMediaTrack(stream, 'audio')
  const isScreenSharing = badge === 'screen'
  const cameraExpected = cameraOn !== false && rtcMode === 'video'
  const videoExpected = isScreenSharing || cameraExpected
  const showVideo = Boolean(stream && hasLiveVideo && videoExpected)
  const videoConnecting = videoExpected && !hasLiveVideo && isVideoConnectingState(connectionState, stream)
  const videoStateClass = videoExpected
    ? hasLiveVideo ? 'on' : videoConnecting ? 'pending' : 'off'
    : 'off'
  const videoStateLabel = isScreenSharing
    ? hasLiveVideo ? 'Screen' : videoConnecting ? 'Screen connecting' : 'No screen'
    : cameraExpected
      ? hasLiveVideo ? 'Cam on' : videoConnecting ? 'Cam connecting' : 'No video'
      : 'Cam off'
  const canExpand = typeof onExpand === 'function'
  const canUseFollowAction = Boolean(userId && typeof onFollowAction === 'function')
  const followLabel = {
    following: 'Message',
    requested: 'Requested',
    incoming: 'Respond',
    loading: '...',
  }[followStatus] || 'Follow'
  const followDisabled = followStatus === 'requested' || followStatus === 'loading'
  const visualIndex = visualIndexFromLabel(label)
  const avatar = avatarForUser({ id: userId, name: label, gender, avatar_url: avatarUrl }, userId || visualIndex)

  function playRemoteAudio() {
    const audio = audioRef.current
    if (!audio || muted || !hasAudio) return

    audio.muted = false
    const playPromise = audio.play()
    if (playPromise?.then) {
      playPromise
        .then(() => setAudioPlaybackBlocked(false))
        .catch(() => setAudioPlaybackBlocked(true))
    }
  }

  useEffect(() => {
    setStreamVersion((version) => version + 1)
    if (!stream || typeof stream.addEventListener !== 'function') return undefined

    const trackCleanups = new Map()
    const refresh = () => setStreamVersion((version) => version + 1)
    const watchTrack = (track) => {
      if (!track || typeof track.addEventListener !== 'function' || trackCleanups.has(track)) return

      track.addEventListener('mute', refresh)
      track.addEventListener('unmute', refresh)
      track.addEventListener('ended', refresh)
      trackCleanups.set(track, () => {
        track.removeEventListener('mute', refresh)
        track.removeEventListener('unmute', refresh)
        track.removeEventListener('ended', refresh)
      })
    }
    const unwatchTrack = (track) => {
      const cleanup = trackCleanups.get(track)
      if (!cleanup) return
      cleanup()
      trackCleanups.delete(track)
    }
    const handleAddTrack = (event) => {
      watchTrack(event.track)
      refresh()
    }
    const handleRemoveTrack = (event) => {
      unwatchTrack(event.track)
      refresh()
    }

    stream.getTracks?.().forEach((track) => watchTrack(track))
    stream.addEventListener('addtrack', handleAddTrack)
    stream.addEventListener('removetrack', handleRemoveTrack)

    return () => {
      stream.removeEventListener('addtrack', handleAddTrack)
      stream.removeEventListener('removetrack', handleRemoveTrack)
      trackCleanups.forEach((cleanup) => cleanup())
      trackCleanups.clear()
    }
  }, [stream])

  useEffect(() => {
    const video = videoRef.current

    if (video && stream && showVideo) {
      if (video.srcObject !== stream) video.srcObject = stream
      video.muted = true
      const playPromise = video.play()
      if (playPromise?.catch) playPromise.catch(() => {})
    } else if (video) {
      video.srcObject = null
    }

    const audio = audioRef.current

    if (audio && stream && hasAudio) {
      if (audio.srcObject !== stream) audio.srcObject = stream
      audio.muted = Boolean(muted)
      const playPromise = audio.play()
      if (playPromise?.then) {
        playPromise
          .then(() => setAudioPlaybackBlocked(false))
          .catch(() => {
            if (!muted) setAudioPlaybackBlocked(true)
          })
      }
    } else if (audio) {
      audio.srcObject = null
      setAudioPlaybackBlocked(false)
    }
  }, [stream, showVideo, hasAudio, muted, streamVersion])

  useEffect(() => {
    if (!audioPlaybackBlocked || muted || !hasAudio) return undefined

    function retryPlayback() {
      playRemoteAudio()
    }

    window.addEventListener('pointerdown', retryPlayback, { capture: true })
    window.addEventListener('keydown', retryPlayback, { capture: true })

    return () => {
      window.removeEventListener('pointerdown', retryPlayback, { capture: true })
      window.removeEventListener('keydown', retryPlayback, { capture: true })
    }
  }, [audioPlaybackBlocked, hasAudio, muted, stream])

  function handleKeyDown(event) {
    if (!canExpand) return
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    onExpand()
  }

  function handleFollowClick(event) {
    event.stopPropagation()
    if (followDisabled || !canUseFollowAction) return
    onFollowAction()
  }

  function handlePointerDown() {
    if (audioPlaybackBlocked) playRemoteAudio()
  }

  return (
    <div
      className={`video-tile${isScreenSharing ? ' screen-sharing-tile' : ''}${canExpand ? ' expandable' : ''}`}
      onClick={canExpand ? onExpand : undefined}
      onPointerDownCapture={handlePointerDown}
      onKeyDown={canExpand ? handleKeyDown : undefined}
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
      aria-label={canExpand ? expandLabel : undefined}
    >
      {badge && <div className="video-badge">{badge}</div>}
      {canExpand ? <span className="screen-expand-icon" aria-hidden="true"></span> : null}
      {canUseFollowAction ? (
        <button
          type="button"
          className={`video-follow-button ${followStatus || 'none'}`}
          onClick={handleFollowClick}
          disabled={followDisabled}
          aria-label={`${followLabel} ${label}`}
          title={`${followLabel} ${label}`}
        >
          {followLabel}
        </button>
      ) : null}
      {stream && hasAudio ? (
        <audio ref={audioRef} autoPlay playsInline muted={muted} className="audio-element" />
      ) : null}
      {audioPlaybackBlocked && !muted ? (
        <button type="button" className="video-audio-button" onClick={(event) => {
          event.stopPropagation()
          playRemoteAudio()
        }}>
          Play audio
        </button>
      ) : null}
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className="video-element" />
      ) : stream ? (
        <>
          <div className="video-placeholder media-avatar-panel">
            <div className="avatar-stage">
              <div className="avatar-ring"><div className="avatar-core"><img src={avatar} alt="" /></div></div>
              {showMediaState && (
                <div className="media-state-strip">
                  <span className={micOn ? 'state-pill on' : 'state-pill off'}><span></span>{micOn ? 'Mic on' : 'Muted'}</span>
                  <span className={`state-pill ${videoStateClass}`}><span></span>{videoStateLabel}</span>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="video-placeholder">
          <div className="avatar-stage">
            <div className="avatar-ring idle"><div className="avatar-core"><img src={avatar} alt="" /></div></div>
            {showMediaState && (
              <div className="media-state-strip">
                <span className={micOn ? 'state-pill on' : 'state-pill off'}><span></span>{micOn ? 'Mic on' : 'Muted'}</span>
                <span className={`state-pill ${videoStateClass}`}><span></span>{videoStateLabel}</span>
              </div>
            )}
            {connectionState && <span className={`tile-state-text ${connectionState}`}>{connectionState}</span>}
          </div>
          <span>{label}</span>
        </div>
      )}
      <div className="video-caption">{label}</div>
    </div>
  )
}
