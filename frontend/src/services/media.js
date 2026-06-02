const audioConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

const videoConstraints = {
  width: { ideal: 640, max: 1280 },
  height: { ideal: 360, max: 720 },
  frameRate: { ideal: 24, max: 30 },
}

const permissionNames = {
  audio: 'microphone',
  video: 'camera',
}

export async function createLocalMediaStream(mediaMode = 'auto', rtcMode = 'video', options = {}) {
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

  const recovered = await captureAvailableMedia(requestedRtcMode, options)

  if (recovered.stream.getTracks().length || requestedMediaMode === 'real') {
    return recovered
  }

  return {
    stream: createMockMediaStream(requestedRtcMode),
    mode: 'mock',
    warning: `${formatMediaError(recovered.primaryError, requestedRtcMode)} Mock media started instead.`,
  }
}

export async function requestLocalMediaTrack(kind) {
  const mediaKind = kind === 'audio' ? 'audio' : 'video'

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(getMediaApiUnavailableMessage())
  }

  try {
    const permissionState = await getLocalMediaPermissionState(mediaKind)
    if (permissionState === 'denied') throw createPermissionBlockedError(mediaKind)

    const stream = await navigator.mediaDevices.getUserMedia(
      mediaKind === 'audio'
        ? { audio: audioConstraints, video: false }
        : { audio: false, video: videoConstraints }
    )
    const [track] = mediaKind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks()

    if (!track) {
      throw new Error(`No ${mediaKind === 'audio' ? 'microphone' : 'camera'} track was returned by the browser.`)
    }

    return { stream, track }
  } catch (error) {
    if (error?.message?.startsWith('No ')) throw error
    throw new Error(formatSingleMediaError(error, mediaKind))
  }
}

export async function getLocalMediaPermissionState(kind) {
  const mediaKind = kind === 'audio' ? 'audio' : 'video'
  const permissionName = permissionNames[mediaKind]

  if (!navigator.permissions?.query || !permissionName) return 'unknown'

  try {
    const status = await navigator.permissions.query({ name: permissionName })
    return status?.state || 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function getLocalMediaPermissionStates(rtcMode = 'video') {
  const [audio, video] = await Promise.all([
    getLocalMediaPermissionState('audio'),
    rtcMode === 'video' ? getLocalMediaPermissionState('video') : Promise.resolve('not-needed'),
  ])

  return { audio, video }
}

export async function watchLocalMediaPermissions(rtcMode = 'video', onChange = () => {}) {
  const mediaKinds = rtcMode === 'video' ? ['audio', 'video'] : ['audio']
  const watchers = []
  let active = true

  if (!navigator.permissions?.query) return () => {}

  const notify = async () => {
    if (!active) return
    onChange(await getLocalMediaPermissionStates(rtcMode))
  }

  for (const kind of mediaKinds) {
    const permissionName = permissionNames[kind]
    if (!permissionName) continue

    try {
      const status = await navigator.permissions.query({ name: permissionName })
      const handler = () => notify().catch(() => {})

      if (typeof status.addEventListener === 'function') {
        status.addEventListener('change', handler)
        watchers.push(() => status.removeEventListener('change', handler))
      } else {
        status.onchange = handler
        watchers.push(() => { status.onchange = null })
      }
    } catch {
      // Some browsers expose getUserMedia but not camera/microphone permission queries.
    }
  }

  await notify()

  return () => {
    active = false
    watchers.forEach((cleanup) => cleanup())
  }
}

async function captureAvailableMedia(rtcMode, options = {}) {
  const stream = createEmptyMediaStream()
  const failures = {}
  const pendingKinds = []
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 0))
  const onLateTrack = typeof options.onLateTrack === 'function' ? options.onLateTrack : null
  const captureKinds = rtcMode === 'video' ? ['video', 'audio'] : ['audio']

  for (const kind of captureKinds) {
    const capture = startMediaCapture(
      kind,
      kind === 'audio'
        ? { audio: audioConstraints, video: false }
        : { audio: false, video: videoConstraints }
    )
    const result = timeoutMs > 0 ? await waitForCapture(capture, timeoutMs) : await capture.promise

    if (result?.timedOut) {
      pendingKinds.push(capture.kind)
      capture.promise.then((lateResult) => {
        if (lateResult.track && onLateTrack) {
          onLateTrack(lateResult)
        } else if (lateResult.stream) {
          stopMediaStream(lateResult.stream)
        }
      }).catch(() => {})

      if (capture.kind === 'video') break
      continue
    }

    if (result?.track) {
      stream.addTrack(result.track)
      continue
    }

    if (result?.error) failures[result.kind || capture.kind] = result.error
  }

  const primaryError = failures.video || failures.audio || null

  return {
    stream,
    mode: stream.getTracks().length ? 'real' : 'receive-only',
    warning: buildMediaWarning(stream, failures, primaryError, rtcMode, pendingKinds),
    primaryError,
  }
}

function startMediaCapture(kind, constraints) {
  const promise = getLocalMediaPermissionState(kind)
    .then((permissionState) => {
      if (permissionState === 'denied') {
        return { kind, error: createPermissionBlockedError(kind) }
      }

      return navigator.mediaDevices.getUserMedia(constraints)
    })
    .then((stream) => {
      if (stream?.error) return stream

      const [track] = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks()

      if (!track) {
        stopMediaStream(stream)
        return {
          kind,
          error: new Error(`No ${kind === 'audio' ? 'microphone' : 'camera'} track was returned by the browser.`),
        }
      }

      return { kind, stream, track }
    })
    .catch((error) => ({ kind, error }))

  return { kind, promise }
}

function waitForCapture(capture, timeoutMs) {
  return Promise.race([
    capture.promise,
    new Promise((resolve) => {
      window.setTimeout(() => resolve({ kind: capture.kind, timedOut: true }), timeoutMs)
    }),
  ])
}

function stopCapturedStream(stream) {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

function stopMediaStream(stream) {
  stopCapturedStream(stream)
  if (typeof stream?.__cleanup === 'function') {
    stream.__cleanup()
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

  if (error?.permissionState === 'denied') return error.message

  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return `Permission denied for ${mediaLabel}. Allow camera and microphone in the browser address-bar permissions, then try again.`
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

  if (error?.permissionState === 'denied') return error.message

  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return `Permission denied for ${mediaLabel}. Allow it in browser permissions, then try again.`
  }

  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return `No ${mediaLabel} device was found.`
  }

  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return `The ${mediaLabel} is already in use by another app or browser tab.`
  }

  return `${error?.name || 'MediaError'}: ${error?.message || `Unable to start ${mediaLabel}.`}`
}

function createPermissionBlockedError(kind) {
  const mediaLabel = kind === 'audio' ? 'microphone' : 'camera'
  const browserLabel = kind === 'audio' ? 'Microphone' : 'Camera'
  const error = new Error(`Browser permission is blocked for ${mediaLabel}. Click the lock/camera icon in the address bar for this site, set ${browserLabel} to Allow, then retry.`)
  error.name = 'NotAllowedError'
  error.permissionState = 'denied'
  return error
}

function buildMediaWarning(stream, failures, combinedError, rtcMode, pendingKinds = []) {
  const hasAudio = stream.getAudioTracks().some((track) => track.readyState !== 'ended')
  const hasVideo = stream.getVideoTracks().some((track) => track.readyState !== 'ended')
  const messages = []

  const audioPending = pendingKinds.includes('audio')
  const videoPending = pendingKinds.includes('video')

  if (videoPending && !hasVideo) messages.push('Camera permission is still pending.')
  if (rtcMode === 'video' && !hasVideo && !videoPending) messages.push(formatSingleMediaError(failures.video || combinedError, 'video'))
  if (audioPending && !hasAudio) messages.push('Microphone permission is still pending.')
  if (!hasAudio && !audioPending) messages.push(formatSingleMediaError(failures.audio || combinedError, 'audio'))

  const uniqueMessages = Array.from(new Set(messages))
  const joinedAs = describeCapturedMedia(stream, rtcMode)

  if (!uniqueMessages.length) return null
  if (joinedAs === 'receive-only') {
    return `${uniqueMessages.join(' ')} Joined fast in receive-only mode; remote audio/video can still work.`
  }

  return `${uniqueMessages.join(' ')} Joined fast with ${joinedAs}; remote audio/video can still work.`
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

export { stopMediaStream }
