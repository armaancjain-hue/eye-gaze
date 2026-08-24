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
// Gaze is the iris position relative to the eye corners, averaged over both
// eyes; the raw signal is then smoothed at the source to tame iris jitter.
const RIGHT_EYE_INNER = 133
const RIGHT_EYE_OUTER = 33
const RIGHT_IRIS_CENTER = 468

const LEFT_EYE_INNER = 362
const LEFT_EYE_OUTER = 263
const LEFT_IRIS_CENTER = 473

// Radial deadband on the final cursor, as a fraction of the screen diagonal. The
// cursor holds its position while the gaze estimate stays within this radius, so
// fixation micro-jitter and landmark noise don't twitch it; once the gaze truly
// shifts past the radius it moves (almost) fully, so there's no lag on real
// look-shifts. Small enough (~0.6% ≈ 13px on 1080p) not to hurt square targeting.
const OUTPUT_DEADBAND_FRACTION = 0.006

// A frame only feeds calibration if the eyes are open past this blink score. Iris
// landmarks are unreliable while the lids are closing, so sampling through a
// blink would poison the fit — we drop those frames instead.
const RELIABLE_BLINK_MAX = 0.35

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

/**
 * One-Euro filter: an adaptive low-pass that suppresses jitter hard while the
 * signal is nearly still, then relaxes as the signal speeds up so it doesn't
 * lag. For a gaze cursor this is the right trade — it must sit rock-steady
 * during a fixation (so a dwell can land on one square) yet keep up with fast
 * saccades. A fixed EMA can only pick one of those two behaviours.
 */
class OneEuroFilter {
  private prev: number | null = null
  private prevDeriv = 0
  private prevT: number | null = null

  constructor(
    private minCutoff: number,
    private beta: number,
    private readonly dCutoff = 1,
  ) {}

  /** Retune the filter live (e.g. from a user smoothing control). */
  configure(minCutoff: number, beta: number): void {
    this.minCutoff = minCutoff
    this.beta = beta
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  reset(): void {
    this.prev = null
    this.prevDeriv = 0
    this.prevT = null
  }

  filter(value: number, tMs: number): number {
    if (this.prev === null || this.prevT === null) {
      this.prev = value
      this.prevT = tMs
      return value
    }
    let dt = (tMs - this.prevT) / 1000
    if (!(dt > 0)) dt = 1 / 60 // guard against non-monotonic timestamps
    this.prevT = tMs

    const deriv = (value - this.prev) / dt
    const edValue =
      this.prevDeriv + this.alpha(this.dCutoff, dt) * (deriv - this.prevDeriv)
    this.prevDeriv = edValue

    const cutoff = this.minCutoff + this.beta * Math.abs(edValue)
    const filtered = this.prev + this.alpha(cutoff, dt) * (value - this.prev)
    this.prev = filtered
    return filtered
  }
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

  // Adaptive output smoothing, one filter per axis. minCutoff sets the floor of
  // stillness-smoothing (lower = calmer at rest); beta sets how quickly it opens
  // up as the gaze moves (lower = calmer, slightly more lag on fast moves). Tuned
  // toward calm because the on-screen cursor makes any residual jitter visible;
  // both are retunable at runtime via setSmoothing().
  private readonly filterX = new OneEuroFilter(0.35, 0.006)
  private readonly filterY = new OneEuroFilter(0.35, 0.006)
  // Radial deadband as a fraction of the screen diagonal; retunable at runtime.
  private deadbandFraction = OUTPUT_DEADBAND_FRACTION
  // Displayed cursor position after the deadband step below.
  private lastX = 0
  private lastY = 0

  // Source-level smoothing of the raw iris offset, applied before calibration
  // so the model's squared/interaction terms can't amplify iris jitter (a jitter
  // the output filter alone can't fully undo). This is the main stability fix.
  // Lower alpha = heavier smoothing (more lag); this is the main knob to tune.
  private smGx: number | null = null
  private smGy: number | null = null
  // Source-smoothing strength (lower = heavier smoothing); retunable at runtime.
  private featureAlpha = 0.08

  // Whether the most recent processed frame is trustworthy enough to calibrate
  // against (face present, eyes open). Gates makeSample so blinks/face-loss during
  // the calibration sequence can't corrupt the model.
  private lastReliable = false

  get hasCalibration(): boolean {
    return this.calibration !== null
  }

  get calibrationQuality(): number | null {
    return this.calibration ? this.calibration.rmsError : null
  }

  /**
   * Set overall cursor smoothing from a single 0..1 strength (0 = responsive,
   * 1 = very smooth/steady). One knob drives all three stages together — source
   * EMA, output One-Euro, and the deadband — so "more smoothing" always means
   * calmer, at the cost of a little lag. Lets the user tune jitter to their own
   * camera/lighting without touching code.
   */
  setSmoothing(strength: number): void {
    const s = Math.max(0, Math.min(1, strength))
    const lerp = (a: number, b: number) => a + (b - a) * s
    this.featureAlpha = lerp(0.16, 0.045) // higher = follows raw faster
    const minCutoff = lerp(0.9, 0.15) // lower = calmer at rest
    const beta = lerp(0.02, 0.004) // lower = calmer while moving
    this.filterX.configure(minCutoff, beta)
    this.filterY.configure(minCutoff, beta)
    this.deadbandFraction = lerp(0.0015, 0.012)
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
      this.lastReliable = false
      return {
        facePresent: false,
        gazePoint: { x: this.lastX, y: this.lastY },
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

    // Clamp to viewport, then smooth with the adaptive filter.
    const clampedX = Math.max(0, Math.min(width, raw.x))
    const clampedY = Math.max(0, Math.min(height, raw.y))
    const fx = this.filterX.filter(clampedX, timestampMs)
    const fy = this.filterY.filter(clampedY, timestampMs)

    // Radial deadband: hold the displayed cursor still until the smoothed gaze
    // moves past a small radius, then move by the overshoot. This is what makes
    // the cursor sit calm during a fixation instead of shimmering in place, with
    // no added lag once the gaze genuinely travels.
    const deadband = this.deadbandFraction * Math.hypot(width, height)
    const dx = fx - this.lastX
    const dy = fy - this.lastY
    const dist = Math.hypot(dx, dy)
    if (dist > deadband) {
      const k = (dist - deadband) / dist
      this.lastX += dx * k
      this.lastY += dy * k
    }

    const blinkScore = this.extractBlink(result)
    const eyesClosed = blinkScore > 0.5
    // Reliable for calibration only while the eyes are clearly open.
    this.lastReliable = blinkScore < RELIABLE_BLINK_MAX

    // Confidence drops while blinking and when uncalibrated.
    const base = this.calibration ? 0.95 : 0.6
    const confidence = Math.max(0, base * (1 - blinkScore))

    return {
      facePresent: true,
      gazePoint: { x: this.lastX, y: this.lastY },
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
    // Iris offset relative to the eye's corners, normalised by eye width so it's
    // roughly distance-invariant. This is the actual gaze-direction signal — it
    // moves as the eye moves.
    const eyeOffset = (innerI: number, outerI: number, irisI: number) => {
      const inner = landmarks[innerI]
      const outer = landmarks[outerI]
      const iris = landmarks[irisI]
      const cx = (inner.x + outer.x) / 2
      const cy = (inner.y + outer.y) / 2
      const eyeWidth = Math.hypot(inner.x - outer.x, inner.y - outer.y) || 1e-4
      return { gx: (iris.x - cx) / eyeWidth, gy: (iris.y - cy) / eyeWidth }
    }

    const right = eyeOffset(RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_IRIS_CENTER)
    const left = eyeOffset(LEFT_EYE_INNER, LEFT_EYE_OUTER, LEFT_IRIS_CENTER)

    // Average the two eyes (halves the per-eye noise) and mirror X, since the
    // webcam feed is mirrored — looking screen-right moves the iris toward the
    // image's left. Then smooth at the source to kill the residual jitter.
    const rawGx = -((right.gx + left.gx) / 2)
    const rawGy = (right.gy + left.gy) / 2
    // Steady heavy smoothing of the raw iris offset. A fixed low alpha crushes
    // the per-frame landmark jitter before it reaches the calibration model's
    // squared/interaction terms (which would otherwise amplify it). Deliberately
    // NOT adaptive: opening the filter up on movement also lets noise through,
    // which read as the cursor being twitchy.
    this.smGx = this.smGx === null ? rawGx : this.smGx + this.featureAlpha * (rawGx - this.smGx)
    this.smGy = this.smGy === null ? rawGy : this.smGy + this.featureAlpha * (rawGy - this.smGy)

    // Head forward vector from the facial transformation matrix (column-major).
    // Column 2 is the local +Z axis in world space -> where the face points.
    // It lets the model lean on head pose too, so small head turns help aim.
    let headX = 0
    let headY = 0
    const matrix = result.facialTransformationMatrixes?.[0]?.data
    if (matrix && matrix.length >= 11) {
      headX = matrix[8]
      headY = matrix[9]
    }

    return { gx: this.smGx, gy: this.smGy, headX, headY }
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

  /**
   * Snapshot the current raw feature paired with a known screen target.
   * Returns null when the latest frame is unreliable (mid-blink or no face) so
   * the caller can simply skip and retry — bad frames never reach the fit.
   */
  makeSample(screenX: number, screenY: number): CalibrationSample | null {
    if (!this.lastFeature || !this.lastReliable) return null
    return { feature: { ...this.lastFeature }, screenX, screenY }
  }

  /** Fit and persist a model from collected samples. Returns quality (RMS px). */
  calibrate(samples: CalibrationSample[]): number | null {
    const model = fitCalibration(samples, window.innerWidth, window.innerHeight)
    if (!model) return null
    this.calibration = model
    saveCalibration(model)
    // The mapping just changed; drop filter history so the cursor snaps to the
    // new estimate instead of easing in from the old one.
    this.filterX.reset()
    this.filterY.reset()
    return model.rmsError
  }

  resetCalibration(): void {
    this.calibration = null
    clearCalibration()
    this.filterX.reset()
    this.filterY.reset()
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
  }
}
