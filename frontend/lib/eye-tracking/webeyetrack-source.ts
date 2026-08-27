import type { GazePoint, TrackingIssue } from './types'

/**
 * Thin wrapper around the WebEyeTrack package (`webeyetrack`), which replaces the
 * old MediaPipe + ridge-regression pipeline as the raw gaze source.
 *
 * WebEyeTrack runs its own MediaPipe FaceLandmarker + BlazeGaze CNN inside a Web
 * Worker (bundled as an inline blob, so no separate worker file is served). The
 * proxy owns the camera: constructing it starts the worker, and once the worker
 * signals ready the proxy calls `WebcamClient.startWebcam` itself and begins
 * emitting gaze results. It also attaches a *global* click listener — every click
 * is a few-shot calibration sample (click position = where you're looking) that
 * the worker adapts to on-device. That in-worker calibration is why the whole
 * source is created once and kept alive for the page session rather than being
 * torn down and rebuilt (which would orphan a worker and its click listener, and
 * throw away the personalisation).
 *
 * What this wrapper adds on top of the raw stream:
 *   - normalised point-of-gaze (`normPog`, centred [-0.5..0.5]) -> viewport pixels
 *   - deliberate-blink detection from the `gazeState` open/closed stream, reusing
 *     the same timing the old pipeline used
 *   - fps + camera resolution for the status panel
 *
 * Frames never leave the device; only the model files are fetched (the BlazeGaze
 * weights from our own `/web`, MediaPipe wasm + face model from CDN on first load).
 */

/** A deliberate blink is eyes closed for at least this long (ms)... */
const BLINK_MIN_MS = 120
/** ...but not longer than this (avoids treating resting-closed eyes as a blink). */
const BLINK_MAX_MS = 900
/** Minimum gap between accepted blinks (ms), to debounce confirm actions. */
const BLINK_REFRACTORY_MS = 700

/** Only the fields of WebEyeTrack's GazeResult we actually consume. */
interface GazeResultLike {
  normPog: number[]
  gazeState: 'open' | 'closed'
  facialLandmarks?: unknown[]
  timestamp: number
}

export interface GazeSourceCallbacks {
  /** A new, smoothed gaze point in viewport CSS pixels. */
  onPoint: (point: GazePoint) => void
  /** A deliberate blink was detected. */
  onBlink: () => void
  /** First gaze result landed — worker + models are up and frames are flowing. */
  onReady: () => void
  /** Fatal error bringing the source up (camera denied, model load failed). */
  onError: (message: string) => void
}

export class WebEyeTrackSource {
  private proxy: { onGazeResults: (r: GazeResultLike) => void } | null = null
  private webcamClient: { stopWebcam?: () => void } | null = null
  private readonly video: HTMLVideoElement
  private readonly cb: GazeSourceCallbacks
  private started = false

  // Blink detection over the gazeState stream.
  private closedSince: number | null = null
  private lastBlinkAt = 0

  // Throughput + framing, surfaced to the status panel.
  private readonly frameTimes: number[] = []
  fps = 0
  cameraResolution: { width: number; height: number } | null = null
  /** performance.now() of the most recent gaze result; 0 before the first. */
  lastResultAt = 0
  /** performance.now() of the most recent open-eye, face-present result. */
  lastUsableResultAt = 0
  trackingIssue: TrackingIssue | null = 'model-loading'

  constructor(video: HTMLVideoElement, callbacks: GazeSourceCallbacks) {
    this.video = video
    this.cb = callbacks
  }

  /** Kept for API compatibility; smoothing happens after board correction now. */
  setSmoothing(strength: number): void {
    void strength
  }

  /**
   * Bring the source up. Idempotent. Pre-flights camera permission so a denial is
   * reported cleanly (WebEyeTrack's own getUserMedia happens deep inside the
   * worker's ready handler, where a rejection would otherwise be swallowed).
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    // WebcamClient addresses the video element by id.
    if (!this.video.id) this.video.id = 'webeyetrack-webcam'

    // Pre-flight the camera: surfaces NotAllowedError as a real error, and pre-
    // grants permission so WebcamClient's own getUserMedia resolves immediately.
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      probe.getTracks().forEach((t) => t.stop())
    } catch (err) {
      this.started = false
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.cb.onError('Camera permission was denied. Enable it to use gaze control.')
      } else {
        this.cb.onError(err instanceof Error ? err.message : 'Failed to access the camera.')
      }
      return
    }

    try {
      // Client-only: the package pulls in TF.js and a Web Worker, so it must never
      // be evaluated during SSR. Dynamic import keeps it out of the server bundle.
      const mod = await import('webeyetrack')
      const { WebcamClient, WebEyeTrackProxy } = mod
      this.webcamClient = new WebcamClient(this.video.id) as { stopWebcam?: () => void }
      const proxy = new WebEyeTrackProxy(
        this.webcamClient as unknown as ConstructorParameters<typeof WebEyeTrackProxy>[0],
      )
      proxy.onGazeResults = (r: GazeResultLike) => this.handle(r)
      this.proxy = proxy as unknown as { onGazeResults: (r: GazeResultLike) => void }
    } catch (err) {
      this.started = false
      this.cb.onError(err instanceof Error ? err.message : 'Failed to start eye tracking.')
    }
  }

  private handle(r: GazeResultLike): void {
    const now = performance.now()
    const first = this.lastResultAt === 0
    this.lastResultAt = now
    if (first) this.cb.onReady()

    // Rolling one-second frame rate.
    this.frameTimes.push(now)
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift()
    if (this.frameTimes.length > 1) this.fps = this.frameTimes.length

    if (!this.cameraResolution && this.video.videoWidth) {
      this.cameraResolution = { width: this.video.videoWidth, height: this.video.videoHeight }
    }

    // Deliberate-blink detection: a closed stretch of the right length, debounced.
    const hasFace = !Array.isArray(r.facialLandmarks) || r.facialLandmarks.length > 0
    const closed = r.gazeState === 'closed' || !hasFace
    if (closed) {
      if (this.closedSince === null) this.closedSince = now
      this.trackingIssue = hasFace ? 'low-confidence' : 'no-face'
    } else if (this.closedSince !== null) {
      const closedFor = now - this.closedSince
      this.closedSince = null
      this.trackingIssue = null
      if (
        closedFor >= BLINK_MIN_MS &&
        closedFor <= BLINK_MAX_MS &&
        now - this.lastBlinkAt >= BLINK_REFRACTORY_MS
      ) {
        this.lastBlinkAt = now
        this.cb.onBlink()
      }
    }

    // Point mapping. The iris is occluded through a blink, so its estimate is
    // guesswork — hold the cursor still rather than letting it lurch.
    if (!closed && Array.isArray(r.normPog) && r.normPog.length >= 2) {
      this.lastUsableResultAt = now
      const px = (r.normPog[0] + 0.5) * window.innerWidth
      const py = (r.normPog[1] + 0.5) * window.innerHeight
      // WebEyeTrack exposes no per-frame confidence; report a steady high value,
      // dipping briefly right after a blink when the estimate is least trustworthy.
      const confidence = now - this.lastBlinkAt < 200 ? 0.45 : 0.9
      this.cb.onPoint({ x: px, y: py, confidence })
    }
  }

  /** How long since the last gaze result; used to flag a lost signal. */
  msSinceLastResult(now = performance.now()): number {
    return this.lastResultAt === 0 ? Number.POSITIVE_INFINITY : now - this.lastResultAt
  }

  /** How long since the last face-present, open-eye gaze result. */
  msSinceLastUsableResult(now = performance.now()): number {
    return this.lastUsableResultAt === 0 ? Number.POSITIVE_INFINITY : now - this.lastUsableResultAt
  }

  /** Full teardown — call on page unmount only (see class note on lifetime). */
  stop(): void {
    if (this.proxy) this.proxy.onGazeResults = () => {}
    try {
      this.webcamClient?.stopWebcam?.()
    } catch {
      // Best-effort; the stream stops when its tracks are GC'd regardless.
    }
    this.proxy = null
    this.webcamClient = null
    this.started = false
    this.lastResultAt = 0
    this.lastUsableResultAt = 0
    this.trackingIssue = 'model-loading'
    this.closedSince = null
  }
}
