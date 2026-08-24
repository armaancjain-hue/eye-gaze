'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GazeTracker } from './gaze-tracker'
import type { CalibrationQuality, CalibrationSample } from './calibration'
import type { EyeTrackingState, TrackingStatus } from './types'

/** A deliberate blink is eyes closed for at least this long (ms)... */
const BLINK_MIN_MS = 120
/** ...but not longer than this (avoids treating resting-closed eyes as a blink). */
const BLINK_MAX_MS = 900
/** Minimum gap between accepted blinks (ms), to debounce confirm actions. */
const BLINK_REFRACTORY_MS = 700
/** No face for this long (ms) flips status to "lost". */
const FACE_LOST_MS = 1000
/**
 * How long the descriptor must sit outside its calibrated range before we tell
 * the player. Leaning briefly or glancing away is normal and self-corrects; a
 * sustained drift means selection has quietly stopped working and they deserve
 * to know why rather than wondering why nothing responds.
 */
const DRIFT_WARN_MS = 1200
const DRIFT_THRESHOLD = 0.5
/**
 * Board-size change past which the calibration should be redone. Below this the
 * affine re-anchoring holds up; above it, play-time gaze angles fall outside the
 * range the model was fitted over and accuracy degrades sharply.
 */
const BOARD_RESIZE_TOLERANCE = 0.15

export interface UseGazeTracking {
  /** Attach to the <video> element that shows the webcam feed. */
  videoRef: React.RefObject<HTMLVideoElement | null>
  state: EyeTrackingState
  /** True once WASM + model are loaded and the camera is streaming. */
  isReady: boolean
  error: string | null
  hasCalibration: boolean
  /** Cross-validated accuracy of the active calibration, if any. */
  calibrationQuality: CalibrationQuality | null
  /** 0..1 summary of that accuracy, in "can it pick a square" terms. */
  calibrationScore: number
  /** True while the player has drifted out of the pose they calibrated at. */
  driftWarning: boolean
  /** True when the board has been resized enough to warrant recalibrating. */
  boardResized: boolean
  /** What the camera actually delivered, which may be less than was requested. */
  cameraResolution: { width: number; height: number } | null
  /**
   * Detection throughput. Higher capture resolution costs CPU per frame, and if
   * this drops far below the display rate the voting window simply holds fewer
   * samples — worth being able to see rather than guess at.
   */
  fps: number
  /** Request camera + start the detection loop. Idempotent. */
  start: () => Promise<void>
  /** Snapshot the current descriptor against a known target. */
  makeSample: (screenX: number, screenY: number, pointIndex: number) => CalibrationSample | null
  /** Fit + persist a calibration model. Returns its held-out quality, or null. */
  calibrate: (samples: CalibrationSample[]) => CalibrationQuality | null
  resetCalibration: () => void
  /** Subscribe to deliberate-blink events. Returns an unsubscribe fn. */
  onBlink: (cb: () => void) => () => void
  /** Set cursor smoothing strength, 0 (responsive) .. 1 (very steady). */
  setSmoothing: (strength: number) => void
}

export function useGazeTracking(): UseGazeTracking {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const trackerRef = useRef<GazeTracker | null>(null)
  const rafRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startedRef = useRef(false)
  /**
   * Bumped on unmount. `start` awaits the model load and then the camera, and
   * the component can go away in between (React's dev double-mount always
   * does), so an in-flight start compares generations to tell whether it is
   * still the current one — and releases what it acquired if it isn't.
   */
  const generationRef = useRef(0)

  const blinkSubscribers = useRef<Set<() => void>>(new Set())
  const closedSinceRef = useRef<number | null>(null)
  const lastBlinkAtRef = useRef(0)
  const lastFaceAtRef = useRef(0)
  const driftSinceRef = useRef<number | null>(null)

  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasCalibration, setHasCalibration] = useState(false)
  const [calibrationQuality, setCalibrationQuality] = useState<CalibrationQuality | null>(null)
  const [calibrationScore, setCalibrationScore] = useState(0)
  const [driftWarning, setDriftWarning] = useState(false)
  const [boardResized, setBoardResized] = useState(false)
  const [cameraResolution, setCameraResolution] = useState<{
    width: number
    height: number
  } | null>(null)
  const [fps, setFps] = useState(0)
  const frameTimesRef = useRef<number[]>([])
  const [state, setState] = useState<EyeTrackingState>({
    status: 'inactive',
    gazePoint: { x: 0, y: 0, confidence: 0 },
    blinkDetected: false,
    calibrationProgress: 0,
    cameraPermission: 'prompt',
  })

  const onBlink = useCallback((cb: () => void) => {
    blinkSubscribers.current.add(cb)
    return () => {
      blinkSubscribers.current.delete(cb)
    }
  }, [])

  const syncCalibration = useCallback((tracker: GazeTracker) => {
    setHasCalibration(tracker.hasCalibration)
    setCalibrationQuality(tracker.calibrationQuality)
    setCalibrationScore(tracker.calibrationScore)
  }, [])

  const loop = useCallback(() => {
    const tracker = trackerRef.current
    const video = videoRef.current
    if (!tracker || !video) {
      rafRef.current = requestAnimationFrame(loop)
      return
    }

    const now = performance.now()
    const frame = tracker.process(video, now)

    if (frame) {
      // Rolling frame rate over a one-second window.
      const times = frameTimesRef.current
      times.push(now)
      while (times.length > 0 && now - times[0] > 1000) times.shift()
      if (times.length > 1) setFps(times.length)

      // Deliberate-blink detection via a closed -> open transition.
      if (frame.eyesClosed) {
        if (closedSinceRef.current === null) closedSinceRef.current = now
      } else if (closedSinceRef.current !== null) {
        const closedFor = now - closedSinceRef.current
        closedSinceRef.current = null
        if (
          closedFor >= BLINK_MIN_MS &&
          closedFor <= BLINK_MAX_MS &&
          now - lastBlinkAtRef.current >= BLINK_REFRACTORY_MS
        ) {
          lastBlinkAtRef.current = now
          blinkSubscribers.current.forEach((cb) => cb())
        }
      }

      // Sustained out-of-distribution drift, debounced in both directions.
      if (frame.calibrated && frame.facePresent && frame.novelty > DRIFT_THRESHOLD) {
        if (driftSinceRef.current === null) driftSinceRef.current = now
        else if (now - driftSinceRef.current > DRIFT_WARN_MS) setDriftWarning(true)
      } else {
        driftSinceRef.current = null
        setDriftWarning((prev) => (prev ? false : prev))
      }

      const scale = frame.boardScale
      const resized = scale !== null && Math.abs(scale - 1) > BOARD_RESIZE_TOLERANCE
      setBoardResized((prev) => (prev === resized ? prev : resized))

      if (frame.facePresent) lastFaceAtRef.current = now
      const faceLost = now - lastFaceAtRef.current > FACE_LOST_MS
      const status: TrackingStatus = faceLost ? 'lost' : 'active'
      const blinkPulse = now - lastBlinkAtRef.current < 200

      setState((prev) => ({
        ...prev,
        status,
        gazePoint: {
          x: frame.gazePoint.x,
          y: frame.gazePoint.y,
          confidence: frame.confidence,
        },
        blinkDetected: blinkPulse,
      }))
    }

    rafRef.current = requestAnimationFrame(loop)
  }, [])

  const start = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    setError(null)

    const generation = generationRef.current
    const isStale = () => generation !== generationRef.current

    try {
      let tracker = trackerRef.current
      if (!tracker) {
        tracker = new GazeTracker()
        trackerRef.current = tracker
        await tracker.init()
        if (isStale()) {
          // Unmounted mid-load: this tracker is orphaned (the unmount ran
          // before init finished, so its cleanup close() was a no-op).
          tracker.close()
          return
        }
        syncCalibration(tracker)
      }

      // 720p rather than the 480p this used to request. Iris-landmark precision
      // is bounded by how many pixels actually land on the eye: at 640x480 a
      // typical seated user's eye region is around 60x40px, which is *below* the
      // refinement model's own input size, so it is upsampling guesswork. At
      // 720p the same region is roughly double that in each axis, and landmark
      // noise is the floor of the whole gaze pipeline. `ideal` (not `exact`)
      // means a webcam that cannot manage it simply returns what it has.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      })
      if (isStale()) {
        // Release the camera; nobody is left to stop these tracks otherwise.
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      setState((prev) => ({ ...prev, cameraPermission: 'granted' }))

      // Report what the camera actually gave us. `ideal` constraints are a
      // request, not a guarantee, and a webcam quietly capped at 480p is worth
      // knowing about — it puts a floor under the achievable accuracy that no
      // amount of calibration can lift.
      const settings = stream.getVideoTracks()[0]?.getSettings()
      if (settings?.width && settings?.height) {
        setCameraResolution({ width: settings.width, height: settings.height })
      }

      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => {})
      }
      if (isStale()) return

      setIsReady(true)
      setState((prev) => ({ ...prev, status: 'active' }))
      lastFaceAtRef.current = performance.now()
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      if (isStale()) return
      startedRef.current = false
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState((prev) => ({ ...prev, cameraPermission: 'denied', status: 'inactive' }))
        setError('Camera permission was denied. Enable it to use gaze control.')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to start eye tracking.')
        setState((prev) => ({ ...prev, status: 'inactive' }))
      }
    }
  }, [loop, syncCalibration])

  const makeSample = useCallback(
    (screenX: number, screenY: number, pointIndex: number) =>
      trackerRef.current?.makeSample(screenX, screenY, pointIndex) ?? null,
    [],
  )

  const calibrate = useCallback(
    (samples: CalibrationSample[]) => {
      const tracker = trackerRef.current
      if (!tracker) return null
      const quality = tracker.calibrate(samples)
      syncCalibration(tracker)
      return quality
    },
    [syncCalibration],
  )

  const resetCalibration = useCallback(() => {
    const tracker = trackerRef.current
    if (!tracker) return
    tracker.resetCalibration()
    syncCalibration(tracker)
  }, [syncCalibration])

  const setSmoothing = useCallback((strength: number) => {
    trackerRef.current?.setSmoothing(strength)
  }, [])

  // Tear down camera + loop on unmount.
  useEffect(() => {
    return () => {
      generationRef.current++
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      trackerRef.current?.close()
      trackerRef.current = null
      startedRef.current = false
    }
  }, [])

  return {
    videoRef,
    state,
    isReady,
    error,
    hasCalibration,
    calibrationQuality,
    calibrationScore,
    driftWarning,
    boardResized,
    cameraResolution,
    fps,
    start,
    makeSample,
    calibrate,
    resetCalibration,
    onBlink,
    setSmoothing,
  }
}
