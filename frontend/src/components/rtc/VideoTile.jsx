import { useEffect, useRef } from 'react'
import { getInitials } from '../../utils/formatters'

export function VideoTile({
  stream,
  label,
  muted = false,
  badge,
  micOn = true,
  cameraOn = true,
  rtcMode = 'video',
  showMediaState = false,
  connectionState = '',
}) {
  const videoRef = useRef(null)
  const audioRef = useRef(null)
  const hasVideo = stream?.getVideoTracks?.().some((track) => track.readyState !== 'ended')
  const showVideo = Boolean(stream && hasVideo && cameraOn && rtcMode === 'video')
  const initials = getInitials(label)

  useEffect(() => {
    const video = videoRef.current

    if (video && stream && showVideo) {
      if (video.srcObject !== stream) video.srcObject = stream
      const playPromise = video.play()
      if (playPromise?.catch) playPromise.catch(() => {})
    } else if (video) {
      video.srcObject = null
    }

    const audio = audioRef.current

    if (audio && stream && !showVideo) {
      if (audio.srcObject !== stream) audio.srcObject = stream
      const playPromise = audio.play()
      if (playPromise?.catch) playPromise.catch(() => {})
    } else if (audio) {
      audio.srcObject = null
    }
  }, [stream, showVideo])

  return (
    <div className="video-tile">
      {badge && <div className="video-badge">{badge}</div>}
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} className="video-element" />
      ) : stream ? (
        <>
          <audio ref={audioRef} autoPlay muted={muted} className="audio-element" />
          <div className="video-placeholder media-avatar-panel">
            <div className="avatar-stage">
              <div className="avatar-ring"><div className="avatar-core">{initials}</div></div>
              {showMediaState && (
                <div className="media-state-strip">
                  <span className={micOn ? 'state-pill on' : 'state-pill off'}><span></span>{micOn ? 'Mic on' : 'Muted'}</span>
                  <span className={cameraOn && rtcMode === 'video' ? 'state-pill on' : 'state-pill off'}><span></span>{cameraOn && rtcMode === 'video' ? 'Cam on' : 'Cam off'}</span>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="video-placeholder">
          <div className="avatar-stage">
            <div className="avatar-ring idle"><div className="avatar-core">{initials}</div></div>
            {showMediaState && (
              <div className="media-state-strip">
                <span className={micOn ? 'state-pill on' : 'state-pill off'}><span></span>{micOn ? 'Mic on' : 'Muted'}</span>
                <span className={cameraOn && rtcMode === 'video' ? 'state-pill on' : 'state-pill off'}><span></span>{cameraOn && rtcMode === 'video' ? 'Cam on' : 'Cam off'}</span>
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
