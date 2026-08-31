'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { WebEyeTrackSource } from './webeyetrack-source'
import type { EyeTrackingState, GazePoint, TrackingStatus } from './types'
import {
  applyCalibrationModel,
  isLowQualityModel,
  clearCalibrationModel,
  loadCalibrationModel,
  saveCalibrationModel,
  type CalibrationModel,
} from './calibration-model'
import { getBoardGeometry, remapForBoard } from './board-mapping'

/** No gaze result for this long (ms) flips status to "lost". */
const FACE_LOST_MS = 1000

/**
 * Board-specific gaze samples needed before square selection is trusted. Fewer
 * points cannot fit a stable chessboard correction over all 64 squares.
 */
const MIN_CALIBRATION_SAMPLES = 16
const STATE_COMMIT_MS = 50

export interface UseGazeTracking {
  /** Attach to the hidden <video id="webcam"> WebEyeTrack drives. */
  videoRef: React.RefObject<HTMLVideoElement | null>
  state: EyeTrackingState
  /** True once the worker + models are up and gaze results are flowing. */
  isReady: boolean
  error: string | null
  /** True once a persisted or newly collected board calibration model exists. */
  hasCalibration: boolean
  calibrationModel: CalibrationModel | null
  /** How many calibration samples have been collected this session. */
  calibrationSampleCount: number
  rawGazePointRef: React.RefObject<GazePoint>
  /** What the camera actually delivered, once known. */
  cameraResolution: { width: number; height: number } | null
  /** Detection throughput (gaze results per second). */
  fps: number
  /** Request camera + start WebEyeTrack. Idempotent. */
  start: () => Promise<void>
  /** Record one collected calibration sample for progress-only callers. */
  noteCalibrationSample: () => void
  /** Persist a completed chessboard calibration correction model. */
  setCalibrationModel: (model: CalibrationModel) => void
  /** Forget this session's collected samples (the UI's calibration gate). */
  resetCalibration: () => void
  /** Subscribe to deliberate-blink events. Returns an unsubscribe fn. */
  onBlink: (cb: () => void) => () => void
  /** Set cursor smoothing strength, 0 (responsive) .. 1 (very steady). */
  setSmoothing: (strength: number) => void
}

export function useGazeTracking(): UseGazeTracking {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sourceRef = useRef<WebEyeTrackSource | null>(null)
  const startedRef = useRef(false)
  const calibrationModelRef = useRef<CalibrationModel | null>(null)
  const calibrationSampleCountRef = useRef(0)
  const smoothingStrengthRef = useRef(0.7)
  const rawGazePointRef = useRef<GazePoint>({ x: 0, y: 0, confidence: 0 })
  const correctedGazePointRef = useRef<GazePoint>({ x: 0, y: 0, confidence: 0 })
  const smoothedPointRef = useRef<{ x: number; y: number } | null>(null)
  const lastStateCommitAtRef = useRef(0)

  const blinkSubscribers = useRef<Set<() => void>>(new Set())

  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calibrationModel, setCalibrationModelState] = useState<CalibrationModel | null>(null)
  const [calibrationSampleCount, setCalibrationSampleCount] = useState(0)
  const [cameraResolution, setCameraResolution] = useState<{
    width: number
    height: number
  } | null>(null)
  const [fps, setFps] = useState(0)
  const [state, setState] = useState<EyeTrackingState>({
    status: 'inactive',
    rawGazePoint: rawGazePointRef.current,
    correctedGazePoint: correctedGazePointRef.current,
    gazePoint: { x: 0, y: 0, confidence: 0 },
    blinkDetected: false,
    calibrationProgress: 0,
    isCalibrated: false,
    calibrationQuality: 0,
    calibrationErrorSquares: null,
    trackingIssue: 'webeyetrack-not-initialized',
    cameraPermission: 'prompt',
  })

  useEffect(() => {
    const stored = loadCalibrationModel()
    if (!stored) return
    calibrationModelRef.current = stored
    calibrationSampleCountRef.current = stored.sampleCount
    setCalibrationModelState(stored)
    setCalibrationSampleCount(stored.sampleCount)
    setState((prev) => ({
      ...prev,
      isCalibrated: true,
      calibrationProgress: 100,
      calibrationQuality: stored.qualityScore,
      calibrationErrorSquares: stored.validationErrorSquares,
      trackingIssue: isLowQualityModel(stored) ? 'low-confidence' : prev.trackingIssue,
    }))
  }, [])

  const onBlink = useCallback((cb: () => void) => {
    blinkSubscribers.current.add(cb)
    return () => {
      blinkSubscribers.current.delete(cb)
    }
  }, [])

  const noteCalibrationSample = useCallback(() => {
    setCalibrationSampleCount((n) => {
      const next = n + 1
      calibrationSampleCountRef.current = next
      return next
    })
  }, [])

  const setCalibrationModel = useCallback((model: CalibrationModel) => {
    calibrationModelRef.current = model
    calibrationSampleCountRef.current = model.sampleCount
    smoothedPointRef.current = null
    saveCalibrationModel(model)
    setCalibrationModelState(model)
    setCalibrationSampleCount(model.sampleCount)
    setState((prev) => ({
      ...prev,
      isCalibrated: true,
      calibrationProgress: 100,
      calibrationQuality: model.qualityScore,
      calibrationErrorSquares: model.validationErrorSquares,
      // Only a calibration past the module's own reject line is a warning; a
      // pass-but-not-perfect fit is the normal case for a webcam tracker.
      trackingIssue: isLowQualityModel(model) ? 'low-confidence' : null,
    }))
  }, [])

  const resetCalibration = useCallback(() => {
    clearCalibrationModel()
    calibrationModelRef.current = null
    calibrationSampleCountRef.current = 0
    smoothedPointRef.current = null
    setCalibrationModelState(null)
    setCalibrationSampleCount(0)
    setState((prev) => ({
      ...prev,
      isCalibrated: false,
      calibrationProgress: 0,
      calibrationQuality: 0,
      calibrationErrorSquares: null,
      trackingIssue: 'calibration-incomplete',
    }))
  }, [])

  const setSmoothing = useCallback((strength: number) => {
    smoothingStrengthRef.current = Math.max(0, Math.min(1, strength))
    sourceRef.current?.setSmoothing(strength)
  }, [])

  const start = useCallback(async () => {
    if (startedRef.current) return
    const video = videoRef.current
    if (!video) return
    startedRef.current = true
    setError(null)
    setState((prev) => ({
      ...prev,
      status: 'inactive',
      trackingIssue: 'model-loading',
    }))

    const source = new WebEyeTrackSource(video, {
      onPoint: (point: GazePoint) => {
        const now = performance.now()
        rawGazePointRef.current = point

        const model = calibrationModelRef.current
        const geometry = getBoardGeometry(now)
        const modelCorrected = applyCalibrationModel(model, point)
        const boardCorrected = remapForBoard(modelCorrected, model?.boardRect ?? null, geometry)
        const strength = smoothingStrengthRef.current
        const alpha = 0.62 - 0.5 * strength
        const last = smoothedPointRef.current
        const smoothed = last
          ? {
              x: last.x + alpha * (boardCorrected.x - last.x),
              y: last.y + alpha * (boardCorrected.y - last.y),
            }
          : boardCorrected
        smoothedPointRef.current = smoothed

        const corrected: GazePoint = {
          ...smoothed,
          // The stabiliser already scores calibration quality as its own term, so
          // only take a light haircut here — multiplying the per-frame confidence
          // by the raw quality score counted it twice and left an honest ~1-square
          // calibration unable to reach the dwell commit threshold.
          confidence: point.confidence * (model ? Math.max(0.45, model.qualityScore) : 0.3),
        }
        correctedGazePointRef.current = corrected

        if (now - lastStateCommitAtRef.current >= STATE_COMMIT_MS) {
          lastStateCommitAtRef.current = now
          setState((prev) => ({
            ...prev,
            rawGazePoint: point,
            correctedGazePoint: corrected,
            gazePoint: corrected,
            blinkDetected: point.confidence < 0.5,
            isCalibrated: !!model,
            calibrationProgress: model
              ? 100
              : Math.min(99, (calibrationSampleCountRef.current / MIN_CALIBRATION_SAMPLES) * 100),
            calibrationQuality: model?.qualityScore ?? 0,
            calibrationErrorSquares: model?.validationErrorSquares ?? null,
            trackingIssue:
              point.confidence < 0.4
                ? 'low-confidence'
                : model
                  ? null
                  : 'calibration-incomplete',
          }))
        }
      },
      onBlink: () => {
        setState((prev) => ({ ...prev, blinkDetected: true }))
        blinkSubscribers.current.forEach((cb) => cb())
      },
      onReady: () => {
        setIsReady(true)
        setState((prev) => ({
          ...prev,
          status: 'active',
          cameraPermission: 'granted',
          trackingIssue: calibrationModelRef.current ? null : 'calibration-incomplete',
        }))
      },
      onError: (message: string) => {
        startedRef.current = false
        const denied = /denied/i.test(message)
        setError(message)
        setState((prev) => ({
          ...prev,
          status: 'inactive',
          trackingIssue: denied ? 'camera-denied' : 'camera-unavailable',
          cameraPermission: denied ? 'denied' : prev.cameraPermission,
        }))
      },
    })
    sourceRef.current = source
    await source.start()
  }, [])

  // Poll the source for throughput, framing and a lost-signal flip. Kept off the
  // per-frame path so it never adds render pressure to the gaze stream itself.
  useEffect(() => {
    if (!isReady) return
    const id = setInterval(() => {
      const source = sourceRef.current
      if (!source) return
      setFps(source.fps)
      if (source.cameraResolution) setCameraResolution(source.cameraResolution)
      const lost = source.msSinceLastUsableResult() > FACE_LOST_MS
      setState((prev) => {
        const status: TrackingStatus = lost ? 'lost' : 'active'
        const trackingIssue = lost
          ? source.trackingIssue ?? 'no-face'
          : source.trackingIssue ?? (calibrationModelRef.current ? null : 'calibration-incomplete')
        return prev.status === status && prev.trackingIssue === trackingIssue
          ? prev
          : { ...prev, status, trackingIssue }
      })
    }, 250)
    return () => clearInterval(id)
  }, [isReady])

  // The tracker lives for the whole page session (WebEyeTrack calibrates in-worker
  // and cannot be cheaply rebuilt); tear it down only when the page unmounts.
  useEffect(() => {
    return () => {
      sourceRef.current?.stop()
      sourceRef.current = null
      startedRef.current = false
    }
  }, [])

  return {
    videoRef,
    state,
    isReady,
    error,
    hasCalibration: calibrationModel !== null,
    calibrationModel,
    calibrationSampleCount,
    rawGazePointRef,
    cameraResolution,
    fps,
    start,
    noteCalibrationSample,
    setCalibrationModel,
    resetCalibration,
    onBlink,
    setSmoothing,
  }
}
