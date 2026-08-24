'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { CheckCircle2, ArrowLeft, Video, Eye, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useGazeTracking } from '@/lib/eye-tracking/useGazeTracking'
import type { CalibrationSample } from '@/lib/eye-tracking/calibration'

// Thirteen fixation targets spread across the viewport (fractions of w/h): a
// 3×3 grid plus the four edge midpoints. More points better constrain the
// quadratic gaze model (8 basis terms), so it interpolates the screen instead of
// overfitting to nine noisy anchors.
const CALIBRATION_POINTS: { fx: number; fy: number }[] = [
  { fx: 0.12, fy: 0.15 },
  { fx: 0.5, fy: 0.15 },
  { fx: 0.88, fy: 0.15 },
  { fx: 0.12, fy: 0.5 },
  { fx: 0.5, fy: 0.5 },
  { fx: 0.88, fy: 0.5 },
  { fx: 0.12, fy: 0.85 },
  { fx: 0.5, fy: 0.85 },
  { fx: 0.88, fy: 0.85 },
  // Edge midpoints — extra support where the iris/screen mapping bends most.
  { fx: 0.5, fy: 0.32 },
  { fx: 0.5, fy: 0.68 },
  { fx: 0.3, fy: 0.5 },
  { fx: 0.7, fy: 0.5 },
]

const SETTLE_MS = 800 // let the eye land on the dot before sampling
// We keep sampling a point until this many *valid* (eyes-open, face-present)
// frames land, or we hit the attempt cap — so a blink mid-point just costs a few
// extra frames instead of injecting garbage into the fit.
const VALID_SAMPLES_PER_POINT = 10
const MAX_ATTEMPTS_PER_POINT = 32
const SAMPLE_INTERVAL_MS = 45

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function CalibrationPage() {
  const gaze = useGazeTracking()
  const [started, setStarted] = useState(false)
  const [currentPoint, setCurrentPoint] = useState(-1)
  const [isComplete, setIsComplete] = useState(false)
  const [accuracy, setAccuracy] = useState(0)
  // Set true if the camera doesn't come up within a grace period after Start,
  // so the user gets an actionable message instead of a blank waiting screen.
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

  // Kick off the camera from an explicit user gesture (required by browsers for
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

  // Run the calibration sequence once the tracker is live.
  useEffect(() => {
    if (!gaze.isReady || startedRef.current) return
    startedRef.current = true

    const run = async () => {
      const samples: CalibrationSample[] = []

      for (let i = 0; i < CALIBRATION_POINTS.length; i++) {
        if (!mountedRef.current) return
        setCurrentPoint(i)
        await sleep(SETTLE_MS)

        const p = CALIBRATION_POINTS[i]
        const targetX = p.fx * window.innerWidth
        const targetY = p.fy * window.innerHeight

        // Gather valid frames, tolerating blinks: makeSample returns null while
        // the eyes are closed or the face is lost, so we just keep trying.
        let collected = 0
        let attempts = 0
        while (
          collected < VALID_SAMPLES_PER_POINT &&
          attempts < MAX_ATTEMPTS_PER_POINT
        ) {
          if (!mountedRef.current) return
          attempts++
          const sample = gaze.makeSample(targetX, targetY)
          if (sample) {
            samples.push(sample)
            collected++
          }
          await sleep(SAMPLE_INTERVAL_MS)
        }
      }

      if (!mountedRef.current) return
      const rms = gaze.calibrate(samples)
      const diag = Math.hypot(window.innerWidth, window.innerHeight)
      const acc =
        rms === null ? 0 : Math.max(40, Math.min(99, Math.round(100 - (rms / diag) * 400)))
      setAccuracy(acc)
      setIsComplete(true)
    }

    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaze.isReady])

  const getPointStyle = (index: number) => ({
    left: `${CALIBRATION_POINTS[index].fx * 100}%`,
    top: `${CALIBRATION_POINTS[index].fy * 100}%`,
  })

  const cameraBlocked = gaze.error !== null && !gaze.isReady
  const showTrouble = cameraBlocked || startTimedOut
  const troubleMsg = cameraBlocked
    ? gaze.error
    : 'The camera didn’t start. Make sure no other tab or app is using it, then try again.'

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Corner webcam preview so the player can align their face. */}
      <div className="fixed bottom-4 right-4 z-20 w-40 rounded-lg overflow-hidden border border-border bg-background shadow-lg">
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

      {/* Back button */}
      <Link href="/game" className="fixed top-4 left-4 z-20">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Game
        </motion.button>
      </Link>

      {showTrouble ? (
        // Camera permission / error / timeout state
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
        // Completion screen
        <div className="min-h-screen flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6 text-center max-w-lg w-full"
          >
            <div className="flex justify-center">
              <div className="relative">
                <CheckCircle2 className="w-20 h-20 text-green-400" />
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-0 border-2 border-transparent border-t-primary rounded-full"
                />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-foreground">Calibration Complete!</h1>
              <p className="text-lg text-muted-foreground">
                Your eye tracking is now ready to use
              </p>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-card border border-border">
              <span className="text-muted-foreground">Estimated accuracy</span>
              <span className="text-2xl font-bold text-primary">{accuracy}%</span>
            </div>

            <Link href="/game" className="block w-full">
              <Button size="lg" className="w-full bg-primary hover:bg-accent">
                Start Playing
              </Button>
            </Link>
          </motion.div>
        </div>
      ) : !started ? (
        // Intro — the Start button gives the user gesture browsers need to
        // grant the camera, and avoids sitting on a blank auto-start screen.
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
                We’ll show a series of dots around the screen. Look at each one
                and keep your head still. Takes about 20 seconds.
              </p>
            </div>
            <Button
              size="lg"
              onClick={handleStart}
              className="w-full bg-primary hover:bg-accent"
            >
              Start calibration
            </Button>
            <p className="text-xs text-muted-foreground">
              Your camera turns on when you press start.
            </p>
          </motion.div>
        </div>
      ) : !gaze.isReady ? (
        // Camera starting — explicit, so it never looks like a frozen screen.
        <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center gap-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
          <h1 className="text-2xl font-bold text-foreground">Starting camera…</h1>
          <p className="text-muted-foreground max-w-sm">
            Allow camera access if your browser asks.
          </p>
        </div>
      ) : (
        // Active calibration overlay
        <>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-20 text-center space-y-1">
            <h1 className="text-xl font-bold text-foreground">Follow the dot</h1>
            <p className="text-sm text-muted-foreground">
              {`Point ${Math.max(currentPoint + 1, 1)} of ${CALIBRATION_POINTS.length} — keep your head still`}
            </p>
          </div>

          {currentPoint >= 0 && (
            <motion.div
              key={currentPoint}
              className="fixed z-10"
              style={{ ...getPointStyle(currentPoint), transform: 'translate(-50%, -50%)' }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
            >
              {/* Pulsing outer ring */}
              <motion.div
                animate={{ scale: [1, 1.6], opacity: [0.8, 0] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full border-2 border-primary"
              />
              {/* Core dot */}
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/50" />
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}
