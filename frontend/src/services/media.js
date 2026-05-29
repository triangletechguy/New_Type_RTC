export async function createLocalMediaStream(mediaMode = 'auto', rtcMode = 'video') {
  const requestedMediaMode = normalizeMediaMode(mediaMode || import.meta.env.VITE_MEDIA_MODE || 'real')
  const requestedRtcMode = rtcMode === 'audio' ? 'audio' : 'video'

  if (requestedMediaMode === 'mock') {
    return {
      stream: createMockMediaStream(requestedRtcMode),
      mode: 'mock',
      warning: null,
    }
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const warning = `${getMediaApiUnavailableMessage()} Joined receive-only; remote audio/video can still work.`
    return requestedMediaMode === 'auto'
      ? {
          stream: createMockMediaStream(requestedRtcMode),
          mode: 'mock',
          warning: `${getMediaApiUnavailableMessage()} Mock media started instead.`,
        }
      : {
          stream: createEmptyMediaStream(),
          mode: 'receive-only',
          warning,
        }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: requestedRtcMode === 'video',
    })

    return {
      stream,
      mode: 'real',
      warning: null,
    }
  } catch (error) {
    const recovered = await captureAvailableMedia(requestedRtcMode, error)

    if (recovered.stream.getTracks().length || requestedMediaMode === 'real') {
      return recovered
    }

    return {
      stream: createMockMediaStream(requestedRtcMode),
      mode: 'mock',
      warning: `${formatMediaError(error, requestedRtcMode)} Mock media started instead.`,
    }
  }
}

async function captureAvailableMedia(rtcMode, combinedError) {
  const stream = createEmptyMediaStream()
  const failures = {}

  async function capture(kind, constraints) {
    try {
      const capturedStream = await navigator.mediaDevices.getUserMedia(constraints)
      capturedStream.getTracks().forEach((track) => stream.addTrack(track))
    } catch (error) {
      failures[kind] = error
    }
  }

  await capture('audio', { audio: true, video: false })
  if (rtcMode === 'video') {
    await capture('video', { audio: false, video: true })
  }

  return {
    stream,
    mode: stream.getTracks().length ? 'real' : 'receive-only',
    warning: buildMediaWarning(stream, failures, combinedError, rtcMode),
  }
}

function normalizeMediaMode(value) {
  return ['real', 'mock', 'auto'].includes(value) ? value : 'real'
}

function getMediaApiUnavailableMessage() {
  if (window.isSecureContext === false) {
    return 'Your browser blocks local camera access on this HTTP site. Use an HTTPS domain; the camera will be your PC camera, not the VPS camera.'
  }

  return 'This browser does not expose camera and microphone access.'
}

function formatMediaError(error, rtcMode) {
  const mediaLabel = rtcMode === 'audio' ? 'microphone' : 'camera/microphone'

  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return `Permission denied for ${mediaLabel}. Allow browser permissions and try again.`
  }

  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return `No ${mediaLabel} device was found.`
  }

  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return `The ${mediaLabel} is already in use by another app or browser tab.`
  }

  return `${error?.name || 'MediaError'}: ${error?.message || `Unable to start ${mediaLabel}.`}`
}

function formatSingleMediaError(error, kind) {
  const mediaLabel = kind === 'audio' ? 'microphone' : 'camera'

  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return `Permission denied for ${mediaLabel}.`
  }

  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return `No ${mediaLabel} device was found.`
  }

  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return `The ${mediaLabel} is already in use by another app or browser tab.`
  }

  return `${error?.name || 'MediaError'}: ${error?.message || `Unable to start ${mediaLabel}.`}`
}

function buildMediaWarning(stream, failures, combinedError, rtcMode) {
  const hasAudio = stream.getAudioTracks().some((track) => track.readyState !== 'ended')
  const hasVideo = stream.getVideoTracks().some((track) => track.readyState !== 'ended')
  const messages = []

  if (!hasAudio) messages.push(formatSingleMediaError(failures.audio || combinedError, 'audio'))
  if (rtcMode === 'video' && !hasVideo) messages.push(formatSingleMediaError(failures.video || combinedError, 'video'))

  const uniqueMessages = Array.from(new Set(messages))
  const joinedAs = describeCapturedMedia(stream, rtcMode)

  if (!uniqueMessages.length) return null
  if (joinedAs === 'receive-only') {
    return `${uniqueMessages.join(' ')} Joined receive-only; remote audio/video can still work.`
  }

  return `${uniqueMessages.join(' ')} Joined with ${joinedAs}; remote audio/video can still work.`
}

function describeCapturedMedia(stream, rtcMode) {
  const hasAudio = stream.getAudioTracks().some((track) => track.readyState !== 'ended')
  const hasVideo = stream.getVideoTracks().some((track) => track.readyState !== 'ended')

  if (hasAudio && hasVideo && rtcMode === 'video') return 'camera and microphone'
  if (hasVideo) return 'camera only'
  if (hasAudio) return 'microphone only'
  return 'receive-only'
}

function createEmptyMediaStream() {
  const stream = new MediaStream()
  stream.__cleanup = () => {}
  return stream
}

function createMockMediaStream(rtcMode = 'video') {
  const cleanupTasks = []
  const tracks = []

  if (rtcMode === 'video') {
    const video = createMockVideoTrack()
    tracks.push(video.track)
    cleanupTasks.push(video.cleanup)
  }

  const audio = createMockAudioTrack()
  if (audio.track) tracks.push(audio.track)
  if (audio.cleanup) cleanupTasks.push(audio.cleanup)

  const stream = new MediaStream(tracks)
  stream.__cleanup = () => {
    cleanupTasks.forEach((cleanup) => cleanup())
  }

  return stream
}

function createMockVideoTrack() {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720

  const context = canvas.getContext('2d')
  let frame = 0

  const drawTimer = setInterval(() => {
    frame += 1
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, '#0f172a')
    gradient.addColorStop(0.45, '#312e81')
    gradient.addColorStop(1, '#be185d')

    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)

    context.fillStyle = 'rgba(255,255,255,0.14)'
    context.beginPath()
    context.arc(180 + (frame % 680), 220, 90, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = 'rgba(255,255,255,0.08)'
    context.beginPath()
    context.arc(930 - (frame % 500), 520, 140, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = '#ffffff'
    context.font = 'bold 54px Arial'
    context.fillText('talk-each-other RTC', 48, 92)

    context.font = '28px Arial'
    context.fillText('Mock Video Stream', 52, 142)
    context.fillText(new Date().toLocaleTimeString(), 52, 650)

    context.fillStyle = '#22c55e'
    context.fillRect(52, 172, 170, 42)
    context.fillStyle = '#052e16'
    context.font = 'bold 22px Arial'
    context.fillText('LIVE MOCK', 72, 200)
  }, 100)

  const [track] = canvas.captureStream(15).getVideoTracks()

  return {
    track,
    cleanup: () => clearInterval(drawTimer),
  }
}

function createMockAudioTrack() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    const audioContext = new AudioContextClass()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const destination = audioContext.createMediaStreamDestination()

    oscillator.frequency.value = 440
    gain.gain.value = 0.0001
    oscillator.connect(gain)
    gain.connect(destination)
    oscillator.start()

    const [track] = destination.stream.getAudioTracks()

    return {
      track,
      cleanup: () => {
        try { oscillator.stop() } catch {}
        try { audioContext.close() } catch {}
      },
    }
  } catch {
    return {
      track: null,
      cleanup: null,
    }
  }
}

export function stopMediaStream(stream) {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
  if (typeof stream.__cleanup === 'function') {
    stream.__cleanup()
  }
}
