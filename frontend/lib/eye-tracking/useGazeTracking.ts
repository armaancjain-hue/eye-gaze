'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { WebEyeTrackSource } from './webeyetrack-source'
import type { EyeTrackingState, GazePoint, TrackingStatus } from './types'

/** No gaze result for this long (ms) flips status to "lost". */
const FACE_LOST_MS = 1000

/**
 * Calibration samples (look-aligned clicks fed to WebEyeTrack) needed before gaze
 * selection is trusted. The dedicated overlay collects a grid of these; anything
 * fewer cannot personalise the model enough to tell neighbouring squares apart, so
 * squares stay mouse-only until then rather than selecting the wrong piece.
 */
const MIN_CALIBRATION_SAMPLES = 9

export interface UseGazeTracking {
  /** Attach to the hidden <video id="webcam"> WebEyeTrack drives. */
  videoRef: React.RefObject<HTMLVideoElement | null>
  state: EyeTrackingState
  /** True once the worker + models are up and gaze results are flowing. */
  isReady: boolean
  error: string | null
  /** True once enough look-aligned calibration clicks have been collected. */
  hasCalibration: boolean
  /** How many calibration samples have been collected this session. */
  calibrationSampleCount: number
  /** What the camera actually delivered, once known. */
  cameraResolution: { width: number; height: number } | null
  /** Detection throughput (gaze results per second). */
  fps: number
  /** Request camera + start WebEyeTrack. Idempotent. */
  start: () => Promise<void>
  /** Record one collected calibration sample (a look-aligned click). */
  noteCalibrationSample: () => void
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

  const blinkSubscribers = useRef<Set<() => void>>(new Set())

  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calibrationSampleCount, setCalibrationSampleCount] = useState(0)
  const [cameraResolution, setCameraResolution] = useState<{
    width: number
    height: number
  } | null>(null)
  const [fps, setFps] = useState(0)
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

  const noteCalibrationSample = useCallback(() => {
    setCalibrationSampleCount((n) => n + 1)
  }, [])

  const resetCalibration = useCallback(() => {
    setCalibrationSampleCount(0)
  }, [])

  const setSmoothing = useCallback((strength: number) => {
    sourceRef.current?.setSmoothing(strength)
  }, [])

  const start = useCallback(async () => {
    if (startedRef.current) return
    const video = videoRef.current
    if (!video) return
    startedRef.current = true
    setError(null)

    const source = new WebEyeTrackSource(video, {
      onPoint: (point: GazePoint) => {
        setState((prev) => ({
          ...prev,
          gazePoint: point,
          blinkDetected: point.confidence < 0.5,
        }))
      },
      onBlink: () => {
        setState((prev) => ({ ...prev, blinkDetected: true }))
        blinkSubscribers.current.forEach((cb) => cb())
      },
      onReady: () => {
        setIsReady(true)
        setState((prev) => ({ ...prev, status: 'active', cameraPermission: 'granted' }))
      },
      onError: (message: string) => {
        startedRef.current = false
        const denied = /denied/i.test(message)
        setError(message)
        setState((prev) => ({
          ...prev,
          status: 'inactive',
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
      const lost = source.msSinceLastResult() > FACE_LOST_MS
      setState((prev) => {
        const status: TrackingStatus = lost ? 'lost' : 'active'
        return prev.status === status ? prev : { ...prev, status }
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
    hasCalibration: calibrationSampleCount >= MIN_CALIBRATION_SAMPLES,
    calibrationSampleCount,
    cameraResolution,
    fps,
    start,
    noteCalibrationSample,
    resetCalibration,
    onBlink,
    setSmoothing,
  }
}
