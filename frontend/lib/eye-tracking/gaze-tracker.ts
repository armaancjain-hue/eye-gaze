import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision'
import {
  type RawGazeFeature,
  type CalibrationModel,
  type CalibrationSample,
  fitCalibration,
  predictGaze,
  defaultGaze,
  saveCalibration,
  loadCalibration,
  clearCalibration,
} from './calibration'

/**
 * MediaPipe FaceLandmarker (478-point mesh with refined irises + blendshapes)
 * wrapped into a small, framework-agnostic tracker. Given a <video> element it
 * produces, per frame: a screen-space gaze point, a blink score, and the raw
 * face geometry the calibration model is fitted against.
 *
 * All WASM + model assets are self-hosted under /public/mediapipe so the app
 * runs with no external network calls at runtime.
 */

// --- Landmark indices (MediaPipe canonical face mesh) ---------------------
// "Right"/"left" are in image space; consistency is all that matters here.
const RIGHT_EYE_INNER = 133
const RIGHT_EYE_OUTER = 33
const RIGHT_EYE_TOP = 159
const RIGHT_EYE_BOTTOM = 145
const RIGHT_IRIS_CENTER = 468

const LEFT_EYE_INNER = 362
const LEFT_EYE_OUTER = 263
const LEFT_EYE_TOP = 386
const LEFT_EYE_BOTTOM = 374
const LEFT_IRIS_CENTER = 473

export interface FrameResult {
  facePresent: boolean
  /** Smoothed gaze point in CSS pixels relative to the viewport. */
  gazePoint: { x: number; y: number }
  /** The raw geometric feature used for calibration this frame. */
  feature: RawGazeFeature
  /** 0 (eyes open) .. 1 (fully closed), averaged over both eyes. */
  blinkScore: number
  /** True while the eyes are held closed past the sensitivity threshold. */
  eyesClosed: boolean
  /** 0..1 rough confidence in the gaze estimate. */
  confidence: number
}

interface Point3 {
  x: number
  y: number
  z: number
}

function dist2d(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * MediaPipe's TFLite runtime prints benign one-time startup lines (e.g.
 * "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.") to stderr, which
 * Emscripten routes to console.error — tripping Next.js's dev error overlay.
 * Filter out only those specific known-benign lines; everything else passes
 * through untouched, so real errors are never hidden. Installed once.
 */
let benignLogFilterInstalled = false
function suppressMediapipeInfoLogs(): void {
  if (benignLogFilterInstalled) return
  benignLogFilterInstalled = true

  const benignPatterns = [
    /Created TensorFlow Lite XNNPACK delegate/,
    /GL version/,
    /Feedback manager requires/,
  ]
  const isBenign = (args: unknown[]): boolean => {
    const first = args[0]
    if (typeof first !== 'string') return false
    return benignPatterns.some((p) => p.test(first))
  }

  const methods = ['error', 'warn', 'info'] as const
  for (const method of methods) {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => {
      if (isBenign(args)) return
      original(...args)
    }
  }
}

export class GazeTracker {
  private landmarker: FaceLandmarker | null = null
  private calibration: CalibrationModel | null = null
  private lastFeature: RawGazeFeature | null = null

  // Exponential-moving-average state for output smoothing.
  private emaX: number | null = null
  private emaY: number | null = null
  private readonly emaAlpha = 0.35

  get hasCalibration(): boolean {
    return this.calibration !== null
  }

  get calibrationQuality(): number | null {
    return this.calibration ? this.calibration.rmsError : null
  }

  /** Load WASM + model. Safe to call once; subsequent calls are no-ops. */
  async init(): Promise<void> {
    if (this.landmarker) return
    suppressMediapipeInfoLogs()
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: '/mediapipe/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })
    this.calibration = loadCalibration()
  }

  /** Feed one video frame. `timestampMs` must be monotonically increasing. */
  process(video: HTMLVideoElement, timestampMs: number): FrameResult | null {
    if (!this.landmarker) return null
    if (video.readyState < 2 || video.videoWidth === 0) return null

    let result: FaceLandmarkerResult
    try {
      result = this.landmarker.detectForVideo(video, timestampMs)
    } catch {
      return null
    }

    const landmarks = result.faceLandmarks?.[0]
    if (!landmarks) {
      return {
        facePresent: false,
        gazePoint: { x: this.emaX ?? 0, y: this.emaY ?? 0 },
        feature: this.lastFeature ?? { gx: 0, gy: 0, headX: 0, headY: 0 },
        blinkScore: 0,
        eyesClosed: false,
        confidence: 0,
      }
    }

    const feature = this.extractFeature(landmarks, result)
    this.lastFeature = feature

    const width = window.innerWidth
    const height = window.innerHeight
    const raw = this.calibration
      ? predictGaze(this.calibration, feature)
      : defaultGaze(feature, width, height)

    // Clamp to viewport, then smooth.
    const clampedX = Math.max(0, Math.min(width, raw.x))
    const clampedY = Math.max(0, Math.min(height, raw.y))
    this.emaX = this.emaX === null ? clampedX : this.emaX + this.emaAlpha * (clampedX - this.emaX)
    this.emaY = this.emaY === null ? clampedY : this.emaY + this.emaAlpha * (clampedY - this.emaY)

    const blinkScore = this.extractBlink(result)
    const eyesClosed = blinkScore > 0.5

    // Confidence drops while blinking and when uncalibrated.
    const base = this.calibration ? 0.95 : 0.6
    const confidence = Math.max(0, base * (1 - blinkScore))

    return {
      facePresent: true,
      gazePoint: { x: this.emaX, y: this.emaY },
      feature,
      blinkScore,
      eyesClosed,
      confidence,
    }
  }

  private extractFeature(
    landmarks: Point3[],
    result: FaceLandmarkerResult,
  ): RawGazeFeature {
    const eyeFeature = (
      inner: number,
      outer: number,
      top: number,
      bottom: number,
      iris: number,
    ) => {
      const li = landmarks[inner]
      const lo = landmarks[outer]
      const center = { x: (li.x + lo.x) / 2, y: (li.y + lo.y) / 2, z: 0 }
      const eyeWidth = dist2d(li, lo) || 1e-4
      const irisPt = landmarks[iris]
      return {
        gx: (irisPt.x - center.x) / eyeWidth,
        gy: (irisPt.y - center.y) / eyeWidth,
        // Openness kept available for future use; not part of the feature.
        openness: dist2d(landmarks[top], landmarks[bottom]) / eyeWidth,
      }
    }

    const right = eyeFeature(
      RIGHT_EYE_INNER,
      RIGHT_EYE_OUTER,
      RIGHT_EYE_TOP,
      RIGHT_EYE_BOTTOM,
      RIGHT_IRIS_CENTER,
    )
    const left = eyeFeature(
      LEFT_EYE_INNER,
      LEFT_EYE_OUTER,
      LEFT_EYE_TOP,
      LEFT_EYE_BOTTOM,
      LEFT_IRIS_CENTER,
    )

    // Head forward vector from the facial transformation matrix (column-major).
    // Column 2 is the local +Z axis in world space -> where the face points.
    let headX = 0
    let headY = 0
    const matrix = result.facialTransformationMatrixes?.[0]?.data
    if (matrix && matrix.length >= 11) {
      headX = matrix[8]
      headY = matrix[9]
    }

    return {
      gx: (right.gx + left.gx) / 2,
      gy: (right.gy + left.gy) / 2,
      headX,
      headY,
    }
  }

  private extractBlink(result: FaceLandmarkerResult): number {
    const categories = result.faceBlendshapes?.[0]?.categories
    if (!categories) return 0
    let left = 0
    let right = 0
    for (const c of categories) {
      if (c.categoryName === 'eyeBlinkLeft') left = c.score
      else if (c.categoryName === 'eyeBlinkRight') right = c.score
    }
    return (left + right) / 2
  }

  // --- Calibration -------------------------------------------------------

  /** Snapshot the current raw feature paired with a known screen target. */
  makeSample(screenX: number, screenY: number): CalibrationSample | null {
    if (!this.lastFeature) return null
    return { feature: { ...this.lastFeature }, screenX, screenY }
  }

  /** Fit and persist a model from collected samples. Returns quality (RMS px). */
  calibrate(samples: CalibrationSample[]): number | null {
    const model = fitCalibration(samples, window.innerWidth, window.innerHeight)
    if (!model) return null
    this.calibration = model
    saveCalibration(model)
    return model.rmsError
  }

  resetCalibration(): void {
    this.calibration = null
    clearCalibration()
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
  }
}
