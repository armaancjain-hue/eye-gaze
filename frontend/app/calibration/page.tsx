'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { CheckCircle2, ArrowLeft, Video, Eye, Loader2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { useGazeTracking } from '@/lib/eye-tracking/useGazeTracking'
import type { CalibrationQuality, CalibrationSample } from '@/lib/eye-tracking/calibration'
import {
  boardFractionToViewport,
  invalidateBoardGeometry,
  readBoardGeometry,
  type BoardGeometry,
} from '@/lib/eye-tracking/board-mapping'
import { BOARD_SIZE } from '@/lib/chess/constants'

/**
 * Calibration is run *over the chessboard itself*, not over the bare viewport.
 * The board is where every selection will happen, so spending all the targets on
 * it puts the model's accuracy exactly where it is needed, and every board square
 * ends up inside the convex hull of the calibration points (interpolation)
 * instead of beyond it (extrapolation, which is where polynomial fits go wrong).
 */

type PointCount = 9 | 16

const POINT_COUNT_OPTIONS: { count: PointCount; label: string; blurb: string }[] = [
  { count: 9, label: 'Quick — 9 points', blurb: 'About 20 seconds. Good enough to play.' },
  { count: 16, label: 'Full — 16 points', blurb: 'About 35 seconds. Noticeably steadier squares.' },
]

/**
 * The grid is pushed slightly *past* the board's edges so that the outermost
 * ranks and files are interior to the calibration hull rather than sitting on
 * its boundary — that is where edge squares stop being systematically missed.
 */
const OVERSCAN = 0.06
/** Keep targets from landing under the browser chrome or off-screen. */
const VIEWPORT_MARGIN_PX = 28

const SETTLE_MS = 700 // let the eye land on the dot before sampling
// Keep sampling a point until this many *valid* (eyes-open, face-present) frames
// land, or the attempt cap is hit — so a blink mid-point costs a few extra
// frames instead of injecting garbage into the fit.
const VALID_SAMPLES_PER_POINT = 10
const MAX_ATTEMPTS_PER_POINT = 32
const SAMPLE_INTERVAL_MS = 45

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Target {
  x: number
  y: number
}

/**
 * Lay out the targets as an n x n grid over the overscanned board rect, walked
 * in serpentine order so consecutive dots are neighbours — shorter saccades mean
 * the eye settles faster and the whole sequence stays under a minute.
 */
function buildTargets(geom: BoardGeometry, count: PointCount): Target[] {
  const n = Math.round(Math.sqrt(count))
  const rows: Target[][] = []

  for (let r = 0; r < n; r++) {
    const row: Target[] = []
    for (let c = 0; c < n; c++) {
      const fx = -OVERSCAN + (c / (n - 1)) * (1 + 2 * OVERSCAN)
      const fy = -OVERSCAN + (r / (n - 1)) * (1 + 2 * OVERSCAN)
      const p = boardFractionToViewport(geom, fx, fy)
      row.push({
        x: Math.max(VIEWPORT_MARGIN_PX, Math.min(window.innerWidth - VIEWPORT_MARGIN_PX, p.x)),
        y: Math.max(VIEWPORT_MARGIN_PX, Math.min(window.innerHeight - VIEWPORT_MARGIN_PX, p.y)),
      })
    }
    rows.push(r % 2 === 1 ? row.reverse() : row)
  }

  return rows.flat()
}

/** Plain-language verdict on a fitted model, in units the player cares about. */
function describeQuality(q: CalibrationQuality): { label: string; tone: string; advice: string } {
  const e = q.medianErrorSquares
  if (e <= 0.45) {
    return {
      label: 'Excellent',
      tone: 'text-green-400',
      advice: 'Squares should land where you look. You’re ready to play.',
    }
  }
  if (e <= 0.8) {
    return {
      label: 'Good',
      tone: 'text-primary',
      advice: 'Neighbouring squares may occasionally compete — dwell a moment longer on them.',
    }
  }
  if (e <= 1.2) {
    return {
      label: 'Usable',
      tone: 'text-yellow-400',
      advice: 'Try again with more light on your face and your head held still.',
    }
  }
  return {
    label: 'Poor',
    tone: 'text-red-400',
    advice: 'Recalibrate: sit square to the camera, brighten the room, and avoid moving your head.',
  }
}

export default function CalibrationPage() {
  const gaze = useGazeTracking()
  const [pointCount, setPointCount] = useState<PointCount>(16)
  const [started, setStarted] = useState(false)
  const [targets, setTargets] = useState<Target[]>([])
  const [currentPoint, setCurrentPoint] = useState(-1)
  const [quality, setQuality] = useState<CalibrationQuality | null>(null)
  const [isComplete, setIsComplete] = useState(false)
  const [fitFailed, setFitFailed] = useState(false)
  // Set true if the camera doesn't come up within a grace period after Start, so
  // the user gets an actionable message instead of a blank waiting screen.
  const [startTimedOut, setStartTimedOut] = useState(false)

  const startedRef = useRef(false)
  const mountedRef = useRef(true)

  // Keep mountedRef correct across Strict Mode's mount -> cleanup -> mount.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Kick off the camera from an explicit user gesture (browsers require one for
  // getUserMedia — auto-starting on mount can silently hang). Also arm a timeout
  // so a camera that never comes up surfaces a retry instead of hanging.
  const handleStart = () => {
    setStartTimedOut(false)
    setStarted(true)
    gaze.start()
  }

  useEffect(() => {
    if (!started || gaze.isReady || gaze.error) return
    const t = setTimeout(() => {
      if (mountedRef.current && !gaze.isReady) setStartTimedOut(true)
    }, 12000)
    return () => clearTimeout(t)
  }, [started, gaze.isReady, gaze.error])

  const measureBoard = useCallback((): BoardGeometry | null => {
    invalidateBoardGeometry()
    return readBoardGeometry()
  }, [])

  // Run the calibration sequence once the tracker is live and the board is laid out.
  useEffect(() => {
    if (!gaze.isReady || startedRef.current) return
    startedRef.current = true

    const run = async () => {
      // The reference board is rendered with this screen; give layout a frame to
      // settle before measuring it, or the targets land against a stale rect.
      await sleep(120)
      const geom = measureBoard()
      if (!geom || !mountedRef.current) {
        setFitFailed(true)
        setIsComplete(true)
        return
      }

      const points = buildTargets(geom, pointCount)
      setTargets(points)
      await sleep(60)

      const samples: CalibrationSample[] = []
      for (let i = 0; i < points.length; i++) {
        if (!mountedRef.current) return
        setCurrentPoint(i)
        await sleep(SETTLE_MS)

        // Gather valid frames, tolerating blinks: makeSample returns null while
        // the eyes are closed or the face is lost, so we just keep trying. The
        // point index tags every sample so the fit can hold whole points out.
        let collected = 0
        let attempts = 0
        while (collected < VALID_SAMPLES_PER_POINT && attempts < MAX_ATTEMPTS_PER_POINT) {
          if (!mountedRef.current) return
          attempts++
          const sample = gaze.makeSample(points[i].x, points[i].y, i)
          if (sample) {
            samples.push(sample)
            collected++
          }
          await sleep(SAMPLE_INTERVAL_MS)
        }
      }

      if (!mountedRef.current) return
      const fitted = gaze.calibrate(samples)
      setQuality(fitted)
      setFitFailed(fitted === null)
      setIsComplete(true)
    }

    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaze.isReady, pointCount, measureBoard])

  const handleRetry = () => {
    startedRef.current = false
    setIsComplete(false)
    setFitFailed(false)
    setQuality(null)
    setCurrentPoint(-1)
    setTargets([])
    // Re-run the sequence; the tracker and camera are already live.
    requestAnimationFrame(() => {
      if (!mountedRef.current) return
      startedRef.current = true
      window.location.reload()
    })
  }

  const cameraBlocked = gaze.error !== null && !gaze.isReady
  const showTrouble = cameraBlocked || startTimedOut
  const troubleMsg = cameraBlocked
    ? gaze.error
    : 'The camera didn’t start. Make sure no other tab or app is using it, then try again.'

  const isCalibrating = started && gaze.isReady && !isComplete && !showTrouble
  // The reference board must be mounted whenever we measure against it — during
  // the sequence, and at the moment the model is fitted (which records the rect).
  const showBoard = isCalibrating || (isComplete && !fitFailed)
  const verdict = quality ? describeQuality(quality) : null

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Corner webcam preview so the player can align their face. */}
      <div className="fixed bottom-4 right-4 z-30 w-40 rounded-lg overflow-hidden border border-border bg-background shadow-lg">
        <video
          ref={gaze.videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-28 object-cover -scale-x-100"
        />
        <div className="px-2 py-1 text-[10px] text-muted-foreground">
          {gaze.isReady ? 'Tracking' : started ? 'Starting camera…' : 'Camera off'}
        </div>
      </div>

      <Link href="/game" className="fixed top-4 left-4 z-30">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Game
        </motion.button>
      </Link>

      {/* Reference board. It carries the same `data-square` markers the real
          board does, so the geometry helpers measure it identically and the
          fitted model records the rect its targets were placed against. */}
      {showBoard && <ReferenceBoard dimmed={isComplete} />}

      {showTrouble ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center gap-4">
          <Video className="w-12 h-12 text-yellow-400" />
          <h1 className="text-2xl font-bold text-foreground">Camera needed</h1>
          <p className="text-muted-foreground max-w-sm">{troubleMsg}</p>
          <Button
            onClick={startTimedOut ? () => window.location.reload() : gaze.start}
            className="bg-primary hover:bg-accent"
          >
            Try Again
          </Button>
        </div>
      ) : isComplete ? (
        <div className="relative z-20 min-h-screen flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6 text-center max-w-lg w-full rounded-xl border border-border bg-card/95 backdrop-blur p-8 shadow-2xl"
          >
            {fitFailed || !quality || !verdict ? (
              <>
                <div className="flex justify-center">
                  <AlertTriangle className="w-16 h-16 text-yellow-400" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl font-bold text-foreground">Calibration didn’t take</h1>
                  <p className="text-muted-foreground">
                    Too few usable frames to fit a model — usually low light, a
                    face partly out of frame, or the camera being blocked. Gaze
                    control stays off until a calibration succeeds.
                  </p>
                </div>
                <Button onClick={handleRetry} className="w-full bg-primary hover:bg-accent">
                  Try again
                </Button>
              </>
            ) : (
              <>
                <div className="flex justify-center">
                  <CheckCircle2 className="w-16 h-16 text-green-400" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-foreground">Calibration complete</h1>
                  <p className="text-muted-foreground">{verdict.advice}</p>
                </div>

                {/* Held-out accuracy, not training error: every number here comes
                    from points the model was not fitted on. */}
                <div className="space-y-3 rounded-lg bg-background/60 border border-border p-4 text-left">
                  <Row label="Accuracy" value={verdict.label} valueClass={verdict.tone} />
                  <Row
                    label="Typical error"
                    value={`${quality.medianErrorSquares.toFixed(2)} squares (${Math.round(quality.medianErrorPx)}px)`}
                  />
                  <Row
                    label="Worst case (90th pct)"
                    value={`${(quality.p90ErrorPx / quality.squareSizePx).toFixed(2)} squares`}
                  />
                  <Row
                    label="Fitted on"
                    value={`${quality.sampleCount} samples · ${quality.pointCount} points`}
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleRetry}
                    variant="outline"
                    className="flex-1"
                  >
                    Redo
                  </Button>
                  <Link href="/game" className="flex-1">
                    <Button size="lg" className="w-full bg-primary hover:bg-accent">
                      Start playing
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </motion.div>
        </div>
      ) : !started ? (
        <div className="min-h-screen flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-6 text-center max-w-lg w-full"
          >
            <div className="flex justify-center">
              <Eye className="w-16 h-16 text-primary" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-foreground">Calibrate eye tracking</h1>
              <p className="text-muted-foreground">
                Dots will appear across the chessboard. Look straight at each one
                and keep your head still — the model is fitted to your eyes, your
                seating position and this screen.
              </p>
            </div>

            <div className="space-y-2 text-left">
              {POINT_COUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.count}
                  onClick={() => setPointCount(opt.count)}
                  className={`w-full rounded-lg border p-3 transition-colors ${
                    pointCount === opt.count
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-card'
                  }`}
                >
                  <span className="block text-sm font-semibold text-foreground">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.blurb}</span>
                </button>
              ))}
            </div>

            <Button size="lg" onClick={handleStart} className="w-full bg-primary hover:bg-accent">
              Start calibration
            </Button>
            <p className="text-xs text-muted-foreground">
              Your camera turns on when you press start. Video never leaves this device.
            </p>
          </motion.div>
        </div>
      ) : !gaze.isReady ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center gap-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
          <h1 className="text-2xl font-bold text-foreground">Starting camera…</h1>
          <p className="text-muted-foreground max-w-sm">
            Allow camera access if your browser asks.
          </p>
        </div>
      ) : (
        <>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-20 text-center space-y-1">
            <h1 className="text-xl font-bold text-foreground">Follow the dot</h1>
            <p className="text-sm text-muted-foreground">
              {`Point ${Math.max(currentPoint + 1, 1)} of ${targets.length || pointCount} — keep your head still`}
            </p>
            <div className="mx-auto h-1 w-48 rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                initial={false}
                animate={{
                  width: `${targets.length ? ((currentPoint + 1) / targets.length) * 100 : 0}%`,
                }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>

          {currentPoint >= 0 && targets[currentPoint] && (
            <motion.div
              key={currentPoint}
              className="fixed z-20"
              style={{
                left: targets[currentPoint].x,
                top: targets[currentPoint].y,
                transform: 'translate(-50%, -50%)',
              }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
            >
              <motion.div
                animate={{ scale: [1, 1.6], opacity: [0.8, 0] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full border-2 border-primary"
              />
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/50" />
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  valueClass = 'text-foreground',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${valueClass}`}>{value}</span>
    </div>
  )
}

/**
 * A stand-in for the game board, sized by the same rule, so calibration targets
 * are placed over board-shaped geometry. Predictions are re-anchored to the live
 * board rect at play time, so this doesn't have to match the game layout to the
 * pixel — but matching its shape keeps the remapping close to the identity.
 */
function ReferenceBoard({ dimmed }: { dimmed: boolean }) {
  return (
    <div className="fixed inset-0 z-0 flex items-center justify-center p-3 pointer-events-none">
      <div
        className={`rounded-lg overflow-hidden border-2 border-primary/20 transition-opacity duration-300 ${
          dimmed ? 'opacity-20' : 'opacity-60'
        }`}
        style={{ width: 'min(100%, calc(100vh - 150px), 1180px)' }}
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}>
          {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
            const row = Math.floor(i / BOARD_SIZE)
            const col = i % BOARD_SIZE
            return (
              <div
                key={i}
                data-square={`${row}-${col}`}
                className={`w-full aspect-square ${
                  (row + col) % 2 === 0 ? 'bg-card' : 'bg-muted'
                }`}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
