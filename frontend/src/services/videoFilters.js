export const VIDEO_FILTERS = [
  {
    id: 'normal',
    label: 'Normal',
    detail: 'Original camera',
    canvasFilter: 'none',
  },
  {
    id: 'warm',
    label: 'Warm',
    detail: 'Soft warm tone',
    canvasFilter: 'saturate(1.16) sepia(0.18) brightness(1.04)',
  },
  {
    id: 'cool',
    label: 'Cool',
    detail: 'Clean blue tone',
    canvasFilter: 'saturate(1.08) hue-rotate(178deg) brightness(1.02)',
  },
  {
    id: 'vintage',
    label: 'Vintage',
    detail: 'Retro color',
    canvasFilter: 'sepia(0.42) contrast(1.12) saturate(0.9) brightness(1.02)',
    overlay: 'rgba(118, 69, 30, 0.08)',
  },
  {
    id: 'bright',
    label: 'Bright',
    detail: 'More light',
    canvasFilter: 'brightness(1.18) saturate(1.06)',
  },
  {
    id: 'contrast',
    label: 'Contrast',
    detail: 'Crisp image',
    canvasFilter: 'contrast(1.28) saturate(1.08)',
  },
  {
    id: 'grayscale',
    label: 'Gray',
    detail: 'Black and white',
    canvasFilter: 'grayscale(1) contrast(1.08)',
  },
  {
    id: 'blur',
    label: 'Blur',
    detail: 'Soft focus',
    canvasFilter: 'blur(2px) brightness(1.04)',
  },
]

const FILTER_MAP = new Map(VIDEO_FILTERS.map((filter) => [filter.id, filter]))
const DEFAULT_FILTER = VIDEO_FILTERS[0]
const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 360
const DEFAULT_FPS = 20

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function nextAnimationFrame(callback) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback)
  }

  return window.setTimeout(callback, 1000 / DEFAULT_FPS)
}

function cancelAnimationFrameSafe(handle) {
  if (!handle) return
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle)
    return
  }

  window.clearTimeout(handle)
}

function waitForVideoReady(video) {
  if (video.readyState >= 2 && video.videoWidth && video.videoHeight) return Promise.resolve()

  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done)
      video.removeEventListener('canplay', done)
      resolve()
    }

    video.addEventListener('loadedmetadata', done, { once: true })
    video.addEventListener('canplay', done, { once: true })
    window.setTimeout(done, 700)
  })
}

export function normalizeVideoFilterId(filterId) {
  const normalized = String(filterId || '').trim().toLowerCase()
  return FILTER_MAP.has(normalized) ? normalized : DEFAULT_FILTER.id
}

export function getVideoFilter(filterId) {
  return FILTER_MAP.get(normalizeVideoFilterId(filterId)) || DEFAULT_FILTER
}

export function isVideoFilterActive(filterId) {
  return normalizeVideoFilterId(filterId) !== DEFAULT_FILTER.id
}

export function supportsCameraFilterPipeline() {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  return typeof canvas.captureStream === 'function' && typeof MediaStream !== 'undefined'
}

export class CameraFilterPipeline {
  constructor(sourceTrack, filterId = DEFAULT_FILTER.id, options = {}) {
    this.sourceTrack = sourceTrack
    this.filterId = normalizeVideoFilterId(filterId)
    this.frameRate = clampNumber(options.frameRate, 8, 30, DEFAULT_FPS)
    this.maxWidth = clampNumber(options.maxWidth, 240, 1280, DEFAULT_WIDTH)
    this.maxHeight = clampNumber(options.maxHeight, 180, 720, DEFAULT_HEIGHT)
    this.video = null
    this.canvas = null
    this.context = null
    this.sourceStream = null
    this.outputStream = null
    this.outputTrack = null
    this.frameHandle = null
    this.stopped = false
  }

  async start() {
    if (!supportsCameraFilterPipeline()) {
      throw new Error('Camera filters are not supported in this browser.')
    }

    if (!this.sourceTrack || this.sourceTrack.readyState === 'ended') {
      throw new Error('Camera track is not available for filters.')
    }

    this.sourceStream = new MediaStream([this.sourceTrack])
    this.video = document.createElement('video')
    this.video.autoplay = true
    this.video.muted = true
    this.video.playsInline = true
    this.video.srcObject = this.sourceStream

    await this.video.play().catch(() => {})
    await waitForVideoReady(this.video)

    if (this.stopped) {
      throw new Error('Camera filter startup was cancelled.')
    }

    const settings = this.sourceTrack.getSettings?.() || {}
    const sourceWidth = settings.width || this.video.videoWidth || DEFAULT_WIDTH
    const sourceHeight = settings.height || this.video.videoHeight || DEFAULT_HEIGHT
    const aspectRatio = sourceWidth && sourceHeight ? sourceWidth / sourceHeight : DEFAULT_WIDTH / DEFAULT_HEIGHT
    const width = clampNumber(sourceWidth, 240, this.maxWidth, DEFAULT_WIDTH)
    const height = clampNumber(Math.round(width / aspectRatio), 180, this.maxHeight, DEFAULT_HEIGHT)

    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.context = this.canvas.getContext('2d', { alpha: false })

    if (!this.context) {
      throw new Error('Camera filter canvas could not be created.')
    }

    this.outputStream = this.canvas.captureStream(this.frameRate)
    this.outputTrack = this.outputStream.getVideoTracks()[0] || null

    if (!this.outputTrack) {
      throw new Error('Camera filter output track could not be created.')
    }

    try {
      this.outputTrack.contentHint = 'motion'
    } catch {
      // contentHint is best-effort.
    }

    this.drawFrame()
    return this.outputTrack
  }

  setFilter(filterId) {
    this.filterId = normalizeVideoFilterId(filterId)
  }

  drawFrame = () => {
    if (this.stopped) return

    const context = this.context
    const canvas = this.canvas
    const video = this.video

    if (context && canvas && video && video.readyState >= 2) {
      const filter = getVideoFilter(this.filterId)
      context.save()
      context.filter = filter.canvasFilter || 'none'
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      context.filter = 'none'

      if (filter.overlay) {
        context.fillStyle = filter.overlay
        context.fillRect(0, 0, canvas.width, canvas.height)
      }

      context.restore()
    }

    this.frameHandle = nextAnimationFrame(this.drawFrame)
  }

  stop({ stopSource = false } = {}) {
    this.stopped = true
    cancelAnimationFrameSafe(this.frameHandle)
    this.frameHandle = null

    if (this.video) {
      this.video.pause()
      this.video.srcObject = null
      this.video = null
    }

    this.outputStream?.getTracks?.().forEach((track) => {
      try { track.stop() } catch {}
    })

    if (stopSource && this.sourceTrack && this.sourceTrack.readyState !== 'ended') {
      try { this.sourceTrack.stop() } catch {}
    }

    this.outputTrack = null
    this.outputStream = null
    this.sourceStream = null
    this.context = null
    this.canvas = null
  }
}
