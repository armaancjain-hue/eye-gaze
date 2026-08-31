'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  buildCalibrationModel,
  CALIBRATION_TARGETS,
  createCalibrationSample,
  LOW_QUALITY_ERROR_SQUARES,
  robustPoint,
  targetToViewport,
  VALIDATION_TARGETS_ON_BOARD,
  type CalibrationModel,
  type CalibrationPhase,
  type CalibrationSample,
  type CalibrationTarget,
} from '@/lib/eye-tracking/calibration-model'
import { getBoardGeometry, invalidateBoardGeometry, toBoardRect } from '@/lib/eye-tracking/board-mapping'
import type { GazePoint } from '@/lib/eye-tracking/types'

const SETTLE_MS = 350
const SAMPLE_MS = 850
const SAMPLE_EVERY_MS = 45
const MIN_SAMPLES_PER_TARGET = 8
/** A click still collects for this long, so a target is never fitted to one frame. */
const CLICK_BURST_MS = 220
const CLICK_MIN_SAMPLES = 2

interface CalibrationOverlayProps {
  /** Live raw WebEyeTrack viewport point, read without causing React renders. */
  rawGazePointRef: React.RefObject<GazePoint>
  /** Calibration model built from the collected board-specific samples. */
  onComplete: (model: CalibrationModel) => void
  /** Progress for the status panel. */
  onProgress?: (completed: number, total: number, phase: CalibrationPhase) => void
  /** Bail out without finishing. */
  onCancel: () => void
}

function resolve(target: CalibrationTarget): { x: number; y: number } {
  const geom = getBoardGeometry()
  if (geom) return targetToViewport(target, toBoardRect(geom))
  const side = Math.min(window.innerWidth, window.innerHeight) * 0.8
  const originX = (window.innerWidth - side) / 2
  const originY = (window.innerHeight - side) / 2
  return { x: originX + target.fx * side, y: originY + target.fy * side }
}

function rectForCurrentBoard() {
  const geom = getBoardGeometry()
  return geom ? toBoardRect(geom) : null
}

export default function CalibrationOverlay({
  rawGazePointRef,
  onComplete,
  onProgress,
  onCancel,
}: CalibrationOverlayProps) {
  const fitSamplesRef = useRef<CalibrationSample[]>([])
  const validationSamplesRef = useRef<CalibrationSample[]>([])
  /**
   * The parent re-renders ~20x/second while the tracker streams gaze results, so
   * its inline handlers get a fresh identity every frame. Holding them in refs
   * keeps them out of the sampling effect's dependencies — otherwise that effect
   * tore itself down and restarted before its 350ms settle timer could ever fire,
   * and the target dot pulsed forever without collecting anything.
   */
  const onProgressRef = useRef(onProgress)
  const onCompleteRef = useRef(onComplete)
  const onCancelRef = useRef(onCancel)
  const [phase, setPhase] = useState<CalibrationPhase>('collecting')
  const [index, setIndex] = useState(0)
  const [retryKey, setRetryKey] = useState(0)
  const [sampling, setSampling] = useState(false)
  const [message, setMessage] = useState('Look at the target')
  const [layoutTick, setLayoutTick] = useState(0)
  /** True once at least one usable gaze point has been read from the tracker. */
  const [hasSignal, setHasSignal] = useState(false)
  /** The rejected model, kept so "use it anyway" does not require a redo. */
  const [rejectedModel, setRejectedModel] = useState<CalibrationModel | null>(null)
  /** Set while a target is live: captures it immediately (click / Space). */
  const finishRef = useRef<(() => void) | null>(null)

  const targets = phase === 'validating' ? VALIDATION_TARGETS_ON_BOARD : CALIBRATION_TARGETS
  const total = CALIBRATION_TARGETS.length + VALIDATION_TARGETS_ON_BOARD.length
  const completed =
    fitSamplesRef.current.length +
    validationSamplesRef.current.length +
    (sampling ? 0.5 : 0)
  const displayTarget = targets[index]
  const dot = useMemo(
    () => (displayTarget ? resolve(displayTarget) : null),
    [displayTarget, index, layoutTick, phase],
  )

  onProgressRef.current = onProgress
  onCompleteRef.current = onComplete
  onCancelRef.current = onCancel

  useEffect(() => {
    onProgressRef.current?.(Math.floor(completed), total, phase)
  }, [completed, phase, total])

  useEffect(() => {
    const id = setInterval(() => {
      invalidateBoardGeometry()
      setLayoutTick((tick) => tick + 1)
      // Surfaced in the header so a dead tracker reads as "waiting", not "broken".
      const point = rawGazePointRef.current
      setHasSignal(point.confidence >= 0.35 && Number.isFinite(point.x))
    }, 200)
    return () => clearInterval(id)
  }, [rawGazePointRef])

  const restart = useCallback(() => {
    fitSamplesRef.current = []
    validationSamplesRef.current = []
    setRejectedModel(null)
    setSampling(false)
    setIndex(0)
    setPhase('collecting')
    setMessage('Look at the target')
  }, [])

  const acceptRejected = useCallback(() => {
    if (rejectedModel) onCompleteRef.current(rejectedModel)
  }, [rejectedModel])

  /** Latest action handlers for the window-level click interceptor below. */
  const actionsRef = useRef({ restart, acceptRejected })
  actionsRef.current = { restart, acceptRejected }

  /**
   * Swallow every click while calibrating, at the capture phase, before it can
   * reach the window.
   *
   * WebEyeTrack's proxy installs its own bubble-phase window click listener and
   * adapts the on-device model on each click, treating the *cursor* as ground
   * truth for where the user is looking. During calibration the cursor sits
   * wherever the mouse was left while the eyes are on the dot, so those clicks
   * teach the tracker a mapping toward the mouse and shift the raw stream from
   * one target to the next — the fit is then chasing a moving source and the
   * validation error stays stuck above the reject line however carefully the
   * user holds their gaze. Capturing here (and driving our own buttons from the
   * same handler, since nothing downstream sees the event) keeps the raw stream
   * stationary for the length of the calibration.
   */
  useEffect(() => {
    const onWindowClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const el = e.target instanceof Element ? e.target.closest('[data-calibration-action]') : null
      switch (el?.getAttribute('data-calibration-action')) {
        case 'cancel':
          onCancelRef.current()
          break
        case 'restart':
          actionsRef.current.restart()
          break
        case 'accept':
          actionsRef.current.acceptRejected()
          break
        default:
          finishRef.current?.()
      }
    }
    window.addEventListener('click', onWindowClick, true)
    return () => window.removeEventListener('click', onWindowClick, true)
  }, [])

  const storeTarget = useCallback(
    (target: CalibrationTarget, raw: { x: number; y: number }) => {
      const boardRect = rectForCurrentBoard()
      if (!boardRect) {
        setMessage('Board is not measurable yet')
        return false
      }

      const sample = createCalibrationSample(target, raw, boardRect)
      if (phase === 'validating') validationSamplesRef.current.push(sample)
      else fitSamplesRef.current.push(sample)
      return true
    },
    [phase],
  )

  useEffect(() => {
    if (!displayTarget || phase === 'complete' || phase === 'low-quality') return

    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let finishTimer: ReturnType<typeof setTimeout> | null = null
    const points: Array<{ x: number; y: number }> = []

    setSampling(false)
    setMessage(phase === 'validating' ? 'Validation target' : 'Look at the target')

    const retry = (delay: number) => {
      setTimeout(() => {
        if (!cancelled) setRetryKey((value) => value + 1)
      }, delay)
    }

    const collect = () => {
      const point = rawGazePointRef.current
      if (point.confidence >= 0.35 && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        points.push({ x: point.x, y: point.y })
        setHasSignal(true)
      }
    }

    /**
     * Commit this target. `minSamples` is relaxed for a click-confirmed capture:
     * the user is telling us they are on the dot right now, so a short burst is
     * enough — waiting out the full hold would just discard their input.
     */
    const commit = (minSamples: number) => {
      if (cancelled) return
      if (interval) clearInterval(interval)
      if (settleTimer) clearTimeout(settleTimer)
      if (finishTimer) clearTimeout(finishTimer)
      finishRef.current = null
      setSampling(false)

      const raw = points.length >= minSamples ? robustPoint(points) : null
      if (!raw) {
        setMessage(
          points.length === 0
            ? 'No gaze signal yet — make sure your face is lit and in frame.'
            : 'Tracking was unstable. Trying this target again.',
        )
        retry(450)
        return
      }

      const stored = storeTarget(displayTarget, raw)
      // Board unmeasurable (mid-layout): retry instead of stalling here forever.
      if (!stored) {
        retry(450)
        return
      }

      const next = index + 1
      if (next < targets.length) {
        setIndex(next)
        return
      }

      if (phase === 'collecting') {
        setPhase('validating')
        setIndex(0)
        return
      }

      const boardRect = rectForCurrentBoard()
      const model =
        boardRect &&
        buildCalibrationModel(
          fitSamplesRef.current,
          validationSamplesRef.current,
          boardRect,
        )

      if (!model) {
        setRejectedModel(null)
        setPhase('low-quality')
        setMessage('Calibration failed — no usable fit from these samples.')
        return
      }

      // One source of truth for "too inaccurate to use": the model's own reject
      // line. The overlay used to apply a second, stricter cut of its own.
      if (model.validationErrorSquares > LOW_QUALITY_ERROR_SQUARES) {
        setRejectedModel(model)
        setPhase('low-quality')
        setMessage(
          `Accuracy came out at about ${model.validationErrorSquares.toFixed(1)} squares — ` +
            'more than a square off. Better light on your face, a steadier head and holding ' +
            'each dot a beat longer usually fixes it.',
        )
        return
      }

      setPhase('complete')
      setMessage(
        model.validationErrorSquares > LOW_QUALITY_ERROR_SQUARES * 0.7
          ? 'Calibration saved with low accuracy'
          : 'Calibration complete',
      )
      onCompleteRef.current(model)
    }

    settleTimer = setTimeout(() => {
      if (cancelled) return
      setSampling(true)
      setMessage('Hold your gaze (or click / press Space)')
      interval = setInterval(collect, SAMPLE_EVERY_MS)
      finishTimer = setTimeout(() => commit(MIN_SAMPLES_PER_TARGET), SAMPLE_MS)
    }, SETTLE_MS)

    /**
     * Manual capture: a click (or Space) grabs the point being looked at now.
     * It still runs a short burst rather than committing the single frame under
     * the cursor — one sample of a noisy stream per target is what produced
     * unusable fits, and 220ms costs the user nothing.
     */
    finishRef.current = () => {
      if (cancelled) return
      finishRef.current = null
      if (settleTimer) clearTimeout(settleTimer)
      if (finishTimer) clearTimeout(finishTimer)
      if (!interval) {
        setSampling(true)
        interval = setInterval(collect, SAMPLE_EVERY_MS)
      }
      collect()
      finishTimer = setTimeout(() => commit(CLICK_MIN_SAMPLES), CLICK_BURST_MS)
    }

    return () => {
      cancelled = true
      finishRef.current = null
      if (settleTimer) clearTimeout(settleTimer)
      if (finishTimer) clearTimeout(finishTimer)
      if (interval) clearInterval(interval)
    }
  }, [displayTarget, index, phase, rawGazePointRef, retryKey, storeTarget, targets.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current()
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (phase === 'low-quality') restart()
        else finishRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, restart])

  const progress = total ? (completed / total) * 100 : 0
  const phaseLabel = phase === 'validating' ? 'Validation' : 'Calibration'
  const currentNumber =
    phase === 'validating'
      ? CALIBRATION_TARGETS.length + index + 1
      : index + 1

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-background/85 backdrop-blur-sm" />

      <div className="absolute top-6 left-1/2 z-10 w-[min(92vw,28rem)] -translate-x-1/2 text-center space-y-3 px-4 pointer-events-none">
        <h2 className="text-2xl font-bold text-foreground">{phaseLabel}</h2>
        <p className="text-sm text-muted-foreground">
          {message}
        </p>
        {phase !== 'low-quality' && (
          <>
            <p className="text-xs text-muted-foreground/80">
              {phaseLabel} {Math.min(currentNumber, total)}/{total}
            </p>
            <p className={`text-xs ${hasSignal ? 'text-muted-foreground/70' : 'text-yellow-400'}`}>
              {hasSignal
                ? 'Tracking live — look at the dot, or click it to capture now'
                : 'Waiting for the eye tracker… (camera on? face in frame?)'}
            </p>
            <div className="mx-auto h-1 w-full rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
          </>
        )}
      </div>

      <AnimatePresence mode="wait">
        {dot && phase !== 'complete' && phase !== 'low-quality' && (
          <motion.div
            key={`${phase}-${index}`}
            aria-hidden
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: dot.x, top: dot.y }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <span className="relative flex items-center justify-center">
              <motion.span
                animate={{ scale: sampling ? [1, 1.35] : [1, 1.7], opacity: [0.8, 0] }}
                transition={{ duration: sampling ? 0.55 : 1.2, repeat: Infinity }}
                className="absolute w-14 h-14 rounded-full border-2 border-primary"
              />
              <span className="block w-7 h-7 rounded-full bg-primary shadow-lg shadow-primary/50" />
              <span className="absolute block w-2 h-2 rounded-full bg-primary-foreground" />
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* A rejected calibration is a fork in the road, not a dead end: redo it,
          or play with what we have (the board still stabilises and dwells). */}
      {phase === 'low-quality' && (
        <div className="absolute top-1/2 left-1/2 z-10 flex w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
          <button
            type="button"
            data-calibration-action="restart"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
          {rejectedModel && (
            <button
              type="button"
              data-calibration-action="accept"
              className="w-full rounded-md border border-border bg-card/90 px-4 py-2 text-sm text-foreground"
            >
              Use it anyway
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        data-calibration-action="cancel"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel calibration
      </button>
    </div>
  )
}
