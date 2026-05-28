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
    if (requestedMediaMode === 'real') {
      throw new Error(getMediaApiUnavailableMessage())
    }

    return {
      stream: createMockMediaStream(requestedRtcMode),
      mode: 'mock',
      warning: `${getMediaApiUnavailableMessage()} Mock media started instead.`,
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
    if (requestedMediaMode === 'real') {
      throw new Error(formatMediaError(error, requestedRtcMode))
    }

    return {
      stream: createMockMediaStream(requestedRtcMode),
      mode: 'mock',
      warning: `${formatMediaError(error, requestedRtcMode)} Mock media started instead.`,
    }
  }
}

function normalizeMediaMode(value) {
  return ['real', 'mock', 'auto'].includes(value) ? value : 'real'
}

function getMediaApiUnavailableMessage() {
  if (window.isSecureContext === false) {
    return 'Camera access requires HTTPS on a deployed server. Open the app on an HTTPS domain, then allow camera and microphone permissions.'
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
    context.fillText('Mingtai RTC', 48, 92)

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
