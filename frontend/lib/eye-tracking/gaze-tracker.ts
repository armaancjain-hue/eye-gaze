import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision'
import {
  extractBlinkScore,
  extractGazeFeature,
  FeatureSmoother,
  type GazeFeature,
} from './features'
import {
  clearCalibration,
  fitCalibration,
  gazeNovelty,
  loadCalibration,
  predictGaze,
  previewGaze,
  qualityScore,
  saveCalibration,
  type CalibrationModel,
  type CalibrationQuality,
  type CalibrationSample,
} from './calibration'
import {
  boardScaleRatio,
  getBoardGeometry,
  remapForBoard,
  toBoardRect,
} from './board-mapping'

/**
 * The client-side gaze pipeline, end to end:
 *
 *   webcam frame
 *     -> MediaPipe Face Landmarker (478 points + blendshapes + head transform)
 *     -> normalised eye/head descriptor            (features.ts)
 *     -> per-channel smoothing
 *     -> personalised regression model             (calibration.ts / regression.ts)
 *     -> re-anchor onto the board's live rect      (board-mapping.ts)
 *     -> adaptive output filtering + deadband
 *     -> gaze point + confidence
 *
 * Square classification happens a layer up, in the stabilizer. Everything here
 * runs in the browser: the WASM runtime and the model file are served from
 * /public/mediapipe, and no frame or landmark ever leaves the device.
 */

/** Frames only feed calibration when the eyes are open at least this much. */
const RELIABLE_BLINK_MAX = 0.35

/**
 * Radial deadband on the drawn cursor, as a fraction of the screen diagonal. The
 * cursor holds still while the estimate stays inside this radius, so fixation
 * micro-jitter doesn't twitch it; past the radius it moves by the overshoot, so
 * genuine look-shifts are not delayed.
 */
const OUTPUT_DEADBAND_FRACTION = 0.006

export interface FrameResult {
  facePresent: boolean
  /** Smoothed, calibrated gaze point in viewport CSS pixels. */
  gazePoint: { x: number; y: number }
  /** The smoothed descriptor this frame produced. */
  feature: GazeFeature | null
  /** 0 (open) .. 1 (closed). */
  blinkScore: number
  eyesClosed: boolean
  /** 0..1 belief in this frame's gaze estimate. */
  confidence: number
  /** False before calibration — square selection stays disabled until then. */
  calibrated: boolean
  /** 0..1 how far outside the calibrated range this frame's descriptor sits. */
  novelty: number
  /** Board size now vs. at calibration time; 1 means unchanged, null if unknown. */
  boardScale: number | null
}

/**
 * One-Euro filter: an adaptive low-pass that suppresses jitter hard while the
 * signal is nearly still, then relaxes as it speeds up so it doesn't lag. For a
 * gaze cursor that is exactly the trade needed — rock-steady through a fixation
 * so a dwell can land, yet still able to follow a saccade. A fixed EMA can only
 * ever pick one of those two behaviours.
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
  private readonly smoother = new FeatureSmoother(0.12)

  // Adaptive output smoothing, one filter per axis. minCutoff sets the floor of
  // stillness-smoothing (lower = calmer at rest); beta sets how fast it opens up
  // as the gaze moves (lower = calmer, slightly more lag on fast moves).
  private readonly filterX = new OneEuroFilter(0.35, 0.006)
  private readonly filterY = new OneEuroFilter(0.35, 0.006)
  private deadbandFraction = OUTPUT_DEADBAND_FRACTION
  private lastX = 0
  private lastY = 0

  /** Whether the latest frame is clean enough to calibrate against. */
  private lastReliable = false
  /** Most recent board-size ratio vs. calibration, for the UI to warn on. */
  private lastBoardScale: number | null = null

  get hasCalibration(): boolean {
    return this.calibration !== null
  }

  get calibrationQuality(): CalibrationQuality | null {
    return this.calibration?.quality ?? null
  }

  /** 0..1 summary of calibration accuracy, in units of "can it pick a square". */
  get calibrationScore(): number {
    return this.calibration ? qualityScore(this.calibration.quality) : 0
  }

  /**
   * One knob for overall steadiness, 0 (responsive) .. 1 (very steady). It drives
   * all three smoothing stages together — the descriptor EMA, the One-Euro output
   * filter and the deadband — so "more smoothing" always means calmer, at the cost
   * of a little lag, and users can tune to their own camera and lighting.
   */
  setSmoothing(strength: number): void {
    const s = Math.max(0, Math.min(1, strength))
    const lerp = (a: number, b: number) => a + (b - a) * s
    this.smoother.configure(lerp(0.22, 0.06))
    this.filterX.configure(lerp(0.9, 0.15), lerp(0.02, 0.004))
    this.filterY.configure(lerp(0.9, 0.15), lerp(0.02, 0.004))
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
    const raw = landmarks ? extractGazeFeature(landmarks, result) : null
    if (!raw) {
      this.lastReliable = false
      return {
        facePresent: false,
        gazePoint: { x: this.lastX, y: this.lastY },
        feature: this.smoother.current,
        blinkScore: 0,
        eyesClosed: false,
        confidence: 0,
        calibrated: this.hasCalibration,
        novelty: 0,
        boardScale: this.lastBoardScale,
      }
    }

    const feature = this.smoother.push(raw)

    const width = window.innerWidth
    const height = window.innerHeight

    // Calibrated prediction, then re-anchored onto wherever the board is *now*:
    // the targets were placed relative to the board, so if it has since resized
    // (a side panel collapsed, the window changed) the mapping follows it rather
    // than silently drifting off by the difference.
    let point: { x: number; y: number }
    let novelty = 0
    if (this.calibration) {
      const geometry = getBoardGeometry(timestampMs)
      point = predictGaze(this.calibration, feature)
      point = remapForBoard(point, this.calibration.board, geometry)
      novelty = gazeNovelty(this.calibration, feature)
      this.lastBoardScale = boardScaleRatio(this.calibration.board, geometry)
    } else {
      point = previewGaze(feature, width, height)
      this.lastBoardScale = null
    }

    const clampedX = Math.max(0, Math.min(width, point.x))
    const clampedY = Math.max(0, Math.min(height, point.y))
    const fx = this.filterX.filter(clampedX, timestampMs)
    const fy = this.filterY.filter(clampedY, timestampMs)

    // Radial deadband on the drawn position.
    const deadband = this.deadbandFraction * Math.hypot(width, height)
    const dx = fx - this.lastX
    const dy = fy - this.lastY
    const dist = Math.hypot(dx, dy)
    if (dist > deadband) {
      const k = (dist - deadband) / dist
      this.lastX += dx * k
      this.lastY += dy * k
    }

    const blinkScore = extractBlinkScore(result)
    const eyesClosed = blinkScore > 0.5
    this.lastReliable = blinkScore < RELIABLE_BLINK_MAX

    // Confidence collapses through a blink (the iris is occluded, so the estimate
    // is guesswork), is capped low without calibration, and falls away as the
    // descriptor drifts outside the range calibration covered — sitting or
    // turning differently than you did then makes the prediction a guess, and the
    // pipeline should say so rather than commit a square anyway.
    const base = this.calibration ? 0.6 + 0.4 * this.calibrationScore : 0.35
    const confidence = Math.max(0, base * (1 - blinkScore) * (1 - 0.85 * novelty))

    return {
      facePresent: true,
      gazePoint: { x: this.lastX, y: this.lastY },
      feature,
      blinkScore,
      eyesClosed,
      confidence,
      calibrated: this.hasCalibration,
      novelty,
      boardScale: this.lastBoardScale,
    }
  }

  // --- Calibration -------------------------------------------------------

  /**
   * Snapshot the current descriptor against a known target. Returns null when
   * the latest frame is unreliable (mid-blink, face lost), so the caller can
   * simply retry — bad frames never reach the fit.
   */
  makeSample(screenX: number, screenY: number, pointIndex: number): CalibrationSample | null {
    const feature = this.smoother.current
    if (!feature || !this.lastReliable) return null
    return { feature: { ...feature }, screenX, screenY, pointIndex }
  }

  /**
   * Fit and persist a model from collected samples. Returns its cross-validated
   * quality, or null if the samples were too few or too degenerate to fit.
   */
  calibrate(samples: CalibrationSample[]): CalibrationQuality | null {
    const geometry = getBoardGeometry()
    const model = fitCalibration(samples, {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      board: geometry ? toBoardRect(geometry) : null,
      squareSizePx: geometry?.squareSize ?? window.innerWidth / 16,
    })
    if (!model) return null

    this.calibration = model
    saveCalibration(model)
    // The mapping just changed; drop filter history so the cursor snaps to the
    // new estimate instead of easing in from the old one.
    this.filterX.reset()
    this.filterY.reset()
    return model.quality
  }

  resetCalibration(): void {
    this.calibration = null
    clearCalibration()
    this.filterX.reset()
    this.filterY.reset()
    this.smoother.reset()
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
  }
}
