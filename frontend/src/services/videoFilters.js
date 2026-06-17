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

export const BACKGROUND_EFFECTS = [
  {
    id: 'none',
    label: 'Original',
    detail: 'No background processing',
  },
  {
    id: 'blur',
    label: 'Blur',
    detail: 'Blur the room behind you',
  },
  {
    id: 'replace',
    label: 'Replace',
    detail: 'Soft RTC studio scene',
  },
  {
    id: 'studio',
    label: 'Studio',
    detail: 'Clean presenter lighting',
  },
  {
    id: 'dark',
    label: 'Dark room',
    detail: 'Low-light private stage',
  },
  {
    id: 'clean',
    label: 'Clean room',
    detail: 'Bright minimal room',
  },
]

export const DEFAULT_BEAUTY_SETTINGS = Object.freeze({
  smooth: 0,
  brightness: 0,
  warmth: 0,
  contrast: 0,
  sharpen: 0,
  lighting: 0,
  mirror: false,
})

export const BEAUTY_CONTROLS = [
  { id: 'smooth', label: 'Smooth skin', min: 0, max: 100, step: 1 },
  { id: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1 },
  { id: 'warmth', label: 'Warmth', min: 0, max: 100, step: 1 },
  { id: 'contrast', label: 'Contrast', min: 0, max: 100, step: 1 },
  { id: 'sharpen', label: 'Sharpen', min: 0, max: 100, step: 1 },
  { id: 'lighting', label: 'Soft face lighting', min: 0, max: 100, step: 1 },
]

export const DEFAULT_BACKGROUND_BLUR_AMOUNT = 60

const FILTER_MAP = new Map(VIDEO_FILTERS.map((filter) => [filter.id, filter]))
const DEFAULT_FILTER = VIDEO_FILTERS[0]
const BACKGROUND_MAP = new Map(BACKGROUND_EFFECTS.map((effect) => [effect.id, effect]))
const DEFAULT_BACKGROUND = BACKGROUND_EFFECTS[0]
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720
const DEFAULT_FPS = 24
const SEGMENTATION_FPS = 10
const ADAPTIVE_HEIGHT = 480
const PERFORMANCE_SAMPLE_SIZE = 30
const SLOW_FRAME_MS = 46
const VERY_SLOW_FRAME_MS = 72
const PERFORMANCE_COOLDOWN_MS = 4500
const MASK_CONFIDENCE_LOW = 0.32
const MASK_CONFIDENCE_HIGH = 0.72
const MASK_TEMPORAL_BLEND = 0.58
const MASK_FEATHER_PX = 7
const MEDIAPIPE_TASKS_VERSION = '0.10.35'
const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/wasm`
const SELFIE_SEGMENTER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
let imageSegmenterPromise = null

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function normalizeBoolean(value) {
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  }

  return value === true || value === 1
}

function nextAnimationFrame(callback, delayMs = 1000 / DEFAULT_FPS) {
  const delay = clampNumber(delayMs, 16, 250, 1000 / DEFAULT_FPS)

  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    return window.setTimeout(() => {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(callback)
        return
      }

      callback()
    }, delay)
  }

  return setTimeout(callback, delay)
}

function cancelAnimationFrameSafe(handle) {
  if (!handle) return
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle)
  }

  if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
    window.clearTimeout(handle)
    return
  }

  clearTimeout(handle)
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

export function normalizeBackgroundEffectId(effectId) {
  const normalized = String(effectId || '').trim().toLowerCase()
  return BACKGROUND_MAP.has(normalized) ? normalized : DEFAULT_BACKGROUND.id
}

export function getBackgroundEffect(effectId) {
  return BACKGROUND_MAP.get(normalizeBackgroundEffectId(effectId)) || DEFAULT_BACKGROUND
}

export function isBackgroundEffectActive(effectId) {
  return normalizeBackgroundEffectId(effectId) !== DEFAULT_BACKGROUND.id
}

export function normalizeBeautySettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {}
  const normalized = BEAUTY_CONTROLS.reduce((nextSettings, control) => {
    nextSettings[control.id] = Math.round(clampNumber(source[control.id], control.min, control.max, DEFAULT_BEAUTY_SETTINGS[control.id]))
    return nextSettings
  }, {})

  normalized.mirror = normalizeBoolean(source.mirror)
  return normalized
}

export function normalizeBackgroundBlurAmount(value) {
  return Math.round(clampNumber(value, 0, 100, DEFAULT_BACKGROUND_BLUR_AMOUNT))
}

export function isBeautySettingsActive(settings = {}) {
  const normalized = normalizeBeautySettings(settings)
  return normalized.mirror || BEAUTY_CONTROLS.some((control) => normalized[control.id] > DEFAULT_BEAUTY_SETTINGS[control.id])
}

export function isCameraFilterEffectActive(filterId, beautySettings = {}, backgroundEffect = DEFAULT_BACKGROUND.id) {
  return isVideoFilterActive(filterId) || isBeautySettingsActive(beautySettings) || isBackgroundEffectActive(backgroundEffect)
}

function settingRatio(settings, key) {
  return clampNumber(settings?.[key], 0, 100, 0) / 100
}

function buildBeautyCanvasFilter(filter, beautySettings) {
  const settings = normalizeBeautySettings(beautySettings)
  const brightness = 1 + settingRatio(settings, 'brightness') * 0.32
  const contrast = 1 + settingRatio(settings, 'contrast') * 0.34
  const warmth = settingRatio(settings, 'warmth')
  const sharpen = settingRatio(settings, 'sharpen')
  const parts = []

  if (filter?.canvasFilter && filter.canvasFilter !== 'none') parts.push(filter.canvasFilter)
  if (brightness !== 1) parts.push(`brightness(${brightness.toFixed(3)})`)
  if (contrast !== 1 || sharpen > 0) parts.push(`contrast(${(contrast + sharpen * 0.16).toFixed(3)})`)
  if (warmth > 0) {
    parts.push(`sepia(${(warmth * 0.22).toFixed(3)})`)
    parts.push(`saturate(${(1 + warmth * 0.18).toFixed(3)})`)
    parts.push(`hue-rotate(${(-warmth * 5).toFixed(2)}deg)`)
  }

  return parts.length ? parts.join(' ') : 'none'
}

function drawVideoFrame(context, source, width, height, mirrored = false, dx = 0, dy = 0, drawWidth = width, drawHeight = height) {
  if (!mirrored) {
    context.drawImage(source, dx, dy, drawWidth, drawHeight)
    return
  }

  context.save()
  context.translate(width, 0)
  context.scale(-1, 1)
  context.drawImage(source, width - dx - drawWidth, dy, drawWidth, drawHeight)
  context.restore()
}

export function supportsCameraFilterPipeline() {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  return typeof canvas.captureStream === 'function' && typeof MediaStream !== 'undefined'
}

async function loadImageSegmenter() {
  if (imageSegmenterPromise) return imageSegmenterPromise

  imageSegmenterPromise = import('@mediapipe/tasks-vision')
    .then(async ({ FilesetResolver, ImageSegmenter }) => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL)
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: SELFIE_SEGMENTER_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: true,
      })
    })
    .catch((error) => {
      imageSegmenterPromise = null
      throw error
    })

  return imageSegmenterPromise
}

function setCanvasSize(canvas, width, height) {
  if (!canvas) return
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

function createOutputCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function scaledDimensions(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const width = sourceWidth || DEFAULT_WIDTH
  const height = sourceHeight || DEFAULT_HEIGHT
  const scale = Math.min(1, maxWidth / width, maxHeight / height)

  return {
    width: Math.max(240, Math.round(width * scale)),
    height: Math.max(180, Math.round(height * scale)),
  }
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function smoothstep(edge0, edge1, value) {
  const nextValue = clampNumber((value - edge0) / (edge1 - edge0), 0, 1, 0)
  return nextValue * nextValue * (3 - 2 * nextValue)
}

export class CameraFilterPipeline {
  constructor(sourceTrack, filterId = DEFAULT_FILTER.id, options = {}) {
    this.sourceTrack = sourceTrack
    this.filterId = normalizeVideoFilterId(filterId)
    this.beautySettings = normalizeBeautySettings(options.beautySettings)
    this.backgroundEffect = normalizeBackgroundEffectId(options.backgroundEffect)
    this.backgroundBlurAmount = normalizeBackgroundBlurAmount(options.backgroundBlurAmount)
    this.frameRate = clampNumber(options.frameRate, 8, 30, DEFAULT_FPS)
    this.maxWidth = clampNumber(options.maxWidth, 240, 1280, DEFAULT_WIDTH)
    this.maxHeight = clampNumber(options.maxHeight, 180, 720, DEFAULT_HEIGHT)
    this.onPerformanceChange = typeof options.onPerformanceChange === 'function' ? options.onPerformanceChange : null
    this.video = null
    this.canvas = null
    this.context = null
    this.scratchCanvas = null
    this.scratchContext = null
    this.maskCanvas = null
    this.maskContext = null
    this.detailCanvas = null
    this.detailContext = null
    this.sourceStream = null
    this.outputStream = null
    this.outputTrack = null
    this.frameHandle = null
    this.segmenter = null
    this.segmenterLoading = false
    this.segmenterError = null
    this.foregroundCategoryIndex = Number.isFinite(Number(options.foregroundCategoryIndex))
      ? Math.round(Number(options.foregroundCategoryIndex))
      : null
    this.previousAlphaMask = null
    this.hasSegmentationMask = false
    this.lastSegmentationAt = 0
    this.segmentationIntervalMs = 1000 / SEGMENTATION_FPS
    this.frameIntervalMs = 1000 / this.frameRate
    this.frameDurations = []
    this.performanceStage = 0
    this.lastPerformanceChangeAt = 0
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
    const { width, height } = scaledDimensions(sourceWidth, sourceHeight, this.maxWidth, this.maxHeight)

    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.context = this.canvas.getContext('2d', { alpha: false })
    this.scratchCanvas = document.createElement('canvas')
    this.scratchCanvas.width = width
    this.scratchCanvas.height = height
    this.scratchContext = this.scratchCanvas.getContext('2d', { alpha: true })
    this.maskCanvas = createOutputCanvas(width, height)
    this.maskContext = this.maskCanvas.getContext('2d', { alpha: true })
    this.detailCanvas = createOutputCanvas(width, height)
    this.detailContext = this.detailCanvas.getContext('2d', { alpha: false })

    if (!this.context || !this.scratchContext || !this.maskContext || !this.detailContext) {
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

    this.lastPerformanceChangeAt = nowMs()
    this.drawFrame()
    return this.outputTrack
  }

  setFilter(filterId) {
    this.filterId = normalizeVideoFilterId(filterId)
  }

  setBeautySettings(settings) {
    this.beautySettings = normalizeBeautySettings(settings)
  }

  setBackgroundEffect(effectId) {
    this.backgroundEffect = normalizeBackgroundEffectId(effectId)
    if (isBackgroundEffectActive(this.backgroundEffect) && this.performanceStage >= 2) {
      this.performanceStage = 1
      this.frameDurations = []
      this.hasSegmentationMask = false
      this.lastPerformanceChangeAt = nowMs()
    }
  }

  setBackgroundBlurAmount(value) {
    this.backgroundBlurAmount = normalizeBackgroundBlurAmount(value)
  }

  notifyPerformanceChange(payload) {
    if (!this.onPerformanceChange) return

    try {
      this.onPerformanceChange(payload)
    } catch (error) {
      console.error('[video-filter] Performance callback failed', error)
    }
  }

  resizeProcessingResolution(maxHeight = ADAPTIVE_HEIGHT) {
    if (!this.canvas) return false

    const currentWidth = this.canvas.width || DEFAULT_WIDTH
    const currentHeight = this.canvas.height || DEFAULT_HEIGHT
    if (currentHeight <= maxHeight) return false

    const aspectRatio = currentWidth / currentHeight
    const nextHeight = Math.max(180, Math.min(maxHeight, currentHeight))
    const nextWidth = Math.max(240, Math.round(nextHeight * aspectRatio))

    setCanvasSize(this.canvas, nextWidth, nextHeight)
    setCanvasSize(this.scratchCanvas, nextWidth, nextHeight)
    setCanvasSize(this.maskCanvas, nextWidth, nextHeight)
    setCanvasSize(this.detailCanvas, nextWidth, nextHeight)
    this.previousAlphaMask = null
    this.hasSegmentationMask = false
    return true
  }

  recordFramePerformance(startTime, backgroundActive) {
    const elapsed = nowMs() - startTime
    if (!Number.isFinite(elapsed) || elapsed <= 0) return

    this.frameDurations.push(elapsed)
    if (this.frameDurations.length > PERFORMANCE_SAMPLE_SIZE) {
      this.frameDurations.shift()
    }

    if (this.frameDurations.length < PERFORMANCE_SAMPLE_SIZE) return

    const now = nowMs()
    if (now - this.lastPerformanceChangeAt < PERFORMANCE_COOLDOWN_MS) return

    const average = this.frameDurations.reduce((total, value) => total + value, 0) / this.frameDurations.length
    const peak = Math.max(...this.frameDurations)

    if (this.performanceStage === 0 && (average > SLOW_FRAME_MS || peak > SLOW_FRAME_MS * 2.2)) {
      this.performanceStage = 1
      this.lastPerformanceChangeAt = now
      this.frameDurations = []
      this.frameIntervalMs = Math.max(this.frameIntervalMs, 1000 / 20)
      this.segmentationIntervalMs = 1000 / 8
      this.resizeProcessingResolution(ADAPTIVE_HEIGHT)
      this.notifyPerformanceChange({ type: 'reduced-resolution', label: '480p adaptive' })
      return
    }

    if (this.performanceStage === 1 && backgroundActive && (average > VERY_SLOW_FRAME_MS || peak > VERY_SLOW_FRAME_MS * 2)) {
      this.performanceStage = 2
      this.lastPerformanceChangeAt = now
      this.frameDurations = []
      this.frameIntervalMs = Math.max(this.frameIntervalMs, 1000 / 18)
      this.backgroundEffect = DEFAULT_BACKGROUND.id
      this.previousAlphaMask = null
      this.hasSegmentationMask = false
      this.notifyPerformanceChange({ type: 'disabled-background', label: 'background disabled' })
    }
  }

  ensureSegmenter() {
    if (!isBackgroundEffectActive(this.backgroundEffect) || this.segmenter || this.segmenterLoading || this.segmenterError || this.stopped) return

    this.segmenterLoading = true
    loadImageSegmenter()
      .then((segmenter) => {
        if (this.stopped) return
        this.segmenter = segmenter
        this.segmenterError = null
      })
      .catch((error) => {
        this.segmenterError = error
        console.error('[video-filter] MediaPipe background segmentation failed', error)
      })
      .finally(() => {
        this.segmenterLoading = false
      })
  }

  inferForegroundCategory(maskData, width, height) {
    if (!maskData?.length || !width || !height) return 0

    const categoryCounts = new Map()
    const cornerCounts = new Map()
    const addCount = (map, category) => {
      map.set(category, (map.get(category) || 0) + 1)
    }
    const categoryAt = (x, y) => {
      const index = Math.min(maskData.length - 1, Math.max(0, Math.round(y) * width + Math.round(x)))
      return Math.round(maskData[index])
    }
    const sampleSize = Math.max(8, Math.round(Math.min(width, height) * 0.08))
    const cornerOrigins = [
      [0, 0],
      [Math.max(0, width - sampleSize), 0],
      [0, Math.max(0, height - sampleSize)],
      [Math.max(0, width - sampleSize), Math.max(0, height - sampleSize)],
    ]

    for (let index = 0; index < maskData.length; index += Math.max(1, Math.floor(maskData.length / 5000))) {
      addCount(categoryCounts, Math.round(maskData[index]))
    }

    for (const [originX, originY] of cornerOrigins) {
      for (let y = 0; y < sampleSize; y += 2) {
        for (let x = 0; x < sampleSize; x += 2) {
          addCount(cornerCounts, categoryAt(originX + x, originY + y))
        }
      }
    }

    const backgroundCategory = Array.from(cornerCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0]
    const foregroundEntry = Array.from(categoryCounts.entries())
      .filter(([category]) => category !== backgroundCategory)
      .sort((a, b) => b[1] - a[1])[0]

    if (foregroundEntry) return foregroundEntry[0]

    const centerCategory = categoryAt(width / 2, height / 2)
    return centerCategory === backgroundCategory ? 0 : centerCategory
  }

  captureSegmentationMask(result) {
    const categoryMask = result?.categoryMask
    const confidenceMasks = Array.isArray(result?.confidenceMasks) ? result.confidenceMasks : []
    if ((!categoryMask && !confidenceMasks.length) || !this.maskContext || !this.maskCanvas) {
      try { result?.close?.() } catch {}
      return
    }

    try {
      const categoryData = categoryMask
        ? (typeof categoryMask.getAsUint8Array === 'function'
          ? categoryMask.getAsUint8Array()
          : categoryMask.getAsFloat32Array())
        : null
      const fallbackMask = categoryMask || confidenceMasks[0]
      const width = fallbackMask?.width || this.canvas?.width || DEFAULT_WIDTH
      const height = fallbackMask?.height || this.canvas?.height || DEFAULT_HEIGHT

      if (!width || !height) return

      setCanvasSize(this.maskCanvas, width, height)

      const imageData = this.maskContext.createImageData(width, height)
      const output = imageData.data
      const pixelCount = Math.min(width * height, categoryData?.length || width * height)
      const foregroundCategory = Number.isFinite(this.foregroundCategoryIndex)
        ? this.foregroundCategoryIndex
        : this.inferForegroundCategory(categoryData, width, height)
      const confidenceMask = confidenceMasks[foregroundCategory]
        || confidenceMasks.find((mask, index) => index !== 0 && mask?.width === width && mask?.height === height)
        || confidenceMasks[confidenceMasks.length - 1]
        || null
      const confidenceData = confidenceMask && typeof confidenceMask.getAsFloat32Array === 'function'
        ? confidenceMask.getAsFloat32Array()
        : null
      const canBlendPrevious = this.previousAlphaMask?.length === pixelCount
      const nextAlphaMask = new Uint8ClampedArray(pixelCount)

      for (let index = 0; index < pixelCount; index += 1) {
        const categoryAlpha = Math.round(categoryData?.[index]) === foregroundCategory ? 1 : 0
        const confidenceValue = Number(confidenceData?.[index])
        const confidenceAlpha = Number.isFinite(confidenceValue)
          ? smoothstep(MASK_CONFIDENCE_LOW, MASK_CONFIDENCE_HIGH, confidenceValue)
          : categoryAlpha
        const rawAlpha = categoryData ? Math.max(categoryAlpha * 0.42, confidenceAlpha) : confidenceAlpha
        const previousAlpha = canBlendPrevious ? this.previousAlphaMask[index] / 255 : rawAlpha
        const blendedAlpha = previousAlpha * MASK_TEMPORAL_BLEND + rawAlpha * (1 - MASK_TEMPORAL_BLEND)
        const alpha = Math.round(clampNumber(blendedAlpha, 0, 1, 0) * 255)
        const offset = index * 4
        nextAlphaMask[index] = alpha
        output[offset] = 255
        output[offset + 1] = 255
        output[offset + 2] = 255
        output[offset + 3] = alpha
      }

      this.previousAlphaMask = nextAlphaMask
      this.maskContext.putImageData(imageData, 0, 0)
      this.hasSegmentationMask = true
    } catch (error) {
      this.hasSegmentationMask = false
      this.previousAlphaMask = null
      this.segmenterError = error
      console.error('[video-filter] MediaPipe mask conversion failed', error)
    } finally {
      try { result?.close?.() } catch {}
    }
  }

  updateSegmentationMask(video) {
    if (!isBackgroundEffectActive(this.backgroundEffect)) return
    this.ensureSegmenter()

    if (!this.segmenter || this.segmenterError) return

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - this.lastSegmentationAt < this.segmentationIntervalMs) return

    this.lastSegmentationAt = now

    try {
      this.segmenter.segmentForVideo(video, now, (result) => this.captureSegmentationMask(result))
    } catch (error) {
      this.segmenterError = error
      console.error('[video-filter] MediaPipe video segmentation failed', error)
    }
  }

  drawProcessedFrame(targetContext, video, width, height, filter, beautySettings, canvasFilter) {
    const smooth = settingRatio(beautySettings, 'smooth')
    const mirrored = Boolean(beautySettings?.mirror)

    targetContext.save()
    targetContext.clearRect(0, 0, width, height)
    targetContext.filter = canvasFilter
    drawVideoFrame(targetContext, video, width, height, mirrored)
    targetContext.filter = 'none'

    if (smooth > 0) {
      targetContext.globalAlpha = smooth * 0.28
      targetContext.filter = `${canvasFilter === 'none' ? '' : `${canvasFilter} `}blur(${(1 + smooth * 2.3).toFixed(2)}px)`
      drawVideoFrame(targetContext, video, width, height, mirrored)
      targetContext.globalAlpha = 1
      targetContext.filter = 'none'
    }

    if (filter.overlay) {
      targetContext.fillStyle = filter.overlay
      targetContext.fillRect(0, 0, width, height)
    }

    targetContext.restore()
  }

  drawBackgroundLayer(context, video, width, height, mirrored = false) {
    const effectId = normalizeBackgroundEffectId(this.backgroundEffect)
    const blurAmount = normalizeBackgroundBlurAmount(this.backgroundBlurAmount)
    context.save()
    context.clearRect(0, 0, width, height)

    if (effectId === 'blur') {
      const blurPx = 3 + (blurAmount / 100) * 25
      const pad = Math.ceil(blurPx * 2)
      context.filter = `blur(${blurPx.toFixed(1)}px) saturate(1.08) brightness(.84)`
      drawVideoFrame(context, video, width, height, mirrored, -pad, -pad, width + pad * 2, height + pad * 2)
      context.filter = 'none'
      context.fillStyle = 'rgba(2, 6, 23, .18)'
      context.fillRect(0, 0, width, height)
    } else if (effectId === 'studio') {
      const gradient = context.createRadialGradient(width * 0.5, height * 0.3, 0, width * 0.5, height * 0.3, Math.max(width, height) * 0.84)
      gradient.addColorStop(0, '#2b3656')
      gradient.addColorStop(0.46, '#121a32')
      gradient.addColorStop(1, '#050814')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
      context.fillStyle = 'rgba(125, 92, 255, .14)'
      context.fillRect(0, Math.round(height * 0.72), width, Math.round(height * 0.28))
    } else if (effectId === 'dark') {
      const gradient = context.createRadialGradient(width * 0.5, height * 0.24, 0, width * 0.5, height * 0.42, Math.max(width, height) * 0.74)
      gradient.addColorStop(0, '#20233a')
      gradient.addColorStop(0.52, '#080b18')
      gradient.addColorStop(1, '#000000')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
      context.fillStyle = 'rgba(56, 189, 248, .1)'
      context.fillRect(0, 0, width, Math.max(2, Math.round(height * 0.015)))
    } else if (effectId === 'clean') {
      const gradient = context.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, '#eef7ff')
      gradient.addColorStop(0.48, '#d9f7f0')
      gradient.addColorStop(1, '#f8fbff')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
      context.fillStyle = 'rgba(15, 23, 42, .06)'
      context.fillRect(0, Math.round(height * 0.7), width, Math.round(height * 0.3))
    } else {
      const gradient = context.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, '#10334b')
      gradient.addColorStop(0.42, '#372070')
      gradient.addColorStop(1, '#061522')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)

      const glow = context.createRadialGradient(width * 0.76, height * 0.2, 0, width * 0.76, height * 0.2, Math.max(width, height) * 0.58)
      glow.addColorStop(0, 'rgba(74, 222, 128, .34)')
      glow.addColorStop(0.48, 'rgba(125, 92, 255, .16)')
      glow.addColorStop(1, 'rgba(125, 92, 255, 0)')
      context.fillStyle = glow
      context.fillRect(0, 0, width, height)
    }

    context.restore()
  }

  applyForegroundMask(width, height, mirrored = false) {
    if (!this.scratchContext || !this.maskCanvas) return false
    if (!this.hasSegmentationMask || !this.maskCanvas.width || !this.maskCanvas.height) return false

    this.scratchContext.save()
    this.scratchContext.globalCompositeOperation = 'destination-in'
    this.scratchContext.filter = `blur(${MASK_FEATHER_PX}px)`
    drawVideoFrame(this.scratchContext, this.maskCanvas, width, height, mirrored)
    this.scratchContext.filter = 'none'
    this.scratchContext.restore()
    return true
  }

  applySoftLighting(context, width, height, lighting) {
    if (lighting <= 0) return

    const centerX = width * 0.5
    const centerY = height * 0.38
    const radius = Math.max(width, height) * 0.52
    const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius)
    gradient.addColorStop(0, `rgba(255, 244, 224, ${(lighting * 0.26).toFixed(3)})`)
    gradient.addColorStop(0.42, `rgba(255, 231, 199, ${(lighting * 0.12).toFixed(3)})`)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    context.save()
    context.globalCompositeOperation = 'screen'
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
    context.restore()
  }

  applySharpen(context, video, width, height, sharpen, mirrored = false) {
    if (sharpen <= 0 || !this.detailContext || !this.detailCanvas) return

    this.detailContext.clearRect(0, 0, width, height)
    this.detailContext.filter = `contrast(${(1.28 + sharpen * 0.48).toFixed(3)}) saturate(${(1 + sharpen * 0.12).toFixed(3)})`
    drawVideoFrame(this.detailContext, video, width, height, mirrored)
    this.detailContext.filter = 'none'

    context.save()
    context.globalAlpha = sharpen * 0.13
    context.globalCompositeOperation = 'soft-light'
    context.drawImage(this.detailCanvas, 0, 0)
    context.restore()
  }

  drawFrame = () => {
    if (this.stopped) return

    const frameStartedAt = nowMs()

    const context = this.context
    const canvas = this.canvas
    const video = this.video

    if (context && canvas && video && video.readyState >= 2) {
      const filter = getVideoFilter(this.filterId)
      const beautySettings = normalizeBeautySettings(this.beautySettings)
      const canvasFilter = buildBeautyCanvasFilter(filter, beautySettings)
      const sharpen = settingRatio(beautySettings, 'sharpen')
      const lighting = settingRatio(beautySettings, 'lighting')
      const backgroundActive = isBackgroundEffectActive(this.backgroundEffect)
      const mirrored = Boolean(beautySettings.mirror)
      const width = canvas.width
      const height = canvas.height

      if (backgroundActive && this.scratchContext && this.scratchCanvas) {
        this.updateSegmentationMask(video)
        this.drawProcessedFrame(this.scratchContext, video, width, height, filter, beautySettings, canvasFilter)

        const masked = this.applyForegroundMask(width, height, mirrored)
        if (masked) {
          this.drawBackgroundLayer(context, video, width, height, mirrored)
          context.drawImage(this.scratchCanvas, 0, 0)
        } else {
          context.clearRect(0, 0, width, height)
          context.drawImage(this.scratchCanvas, 0, 0)
        }
      } else {
        this.drawProcessedFrame(context, video, width, height, filter, beautySettings, canvasFilter)
      }

      this.applySoftLighting(context, width, height, lighting)
      this.applySharpen(context, video, width, height, sharpen, mirrored)
      this.recordFramePerformance(frameStartedAt, backgroundActive)
    }

    this.frameHandle = nextAnimationFrame(this.drawFrame, this.frameIntervalMs)
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
    this.scratchContext = null
    this.scratchCanvas = null
    this.maskContext = null
    this.maskCanvas = null
    this.detailContext = null
    this.detailCanvas = null
    this.previousAlphaMask = null
    this.hasSegmentationMask = false
    this.frameDurations = []
    this.onPerformanceChange = null
  }
}

export const VideoFilterPipeline = CameraFilterPipeline
