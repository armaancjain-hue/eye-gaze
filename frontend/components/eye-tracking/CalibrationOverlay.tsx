'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getBoardGeometry, invalidateBoardGeometry } from '@/lib/eye-tracking/board-mapping'

/**
 * Fullscreen click-to-calibrate overlay for WebEyeTrack.
 *
 * WebEyeTrack personalises its gaze model from *clicks*: it listens for clicks on
 * the window and treats each one as "the user was looking here", adapting the
 * BlazeGaze network on-device to that (look, click-target) pair. So calibration is
 * simply: show a dot over the board, have the player look at it and click it, and
 * let that click reach the window. We just guide the sequence, count the samples,
 * and — crucially — keep dots at least ~1.1s apart, because the worker debounces
 * clicks landing within a second of the last (they'd be dropped).
 *
 * Dot positions are stored as fractions of the board rect and resolved to pixels
 * against the *live* rect every tick, so they follow the board as it settles to
 * its full fullscreen size instead of freezing at a stale early measurement.
 *
 * This runs on the game page (not a separate route) on purpose: the adaptation
 * lives inside WebEyeTrack's worker and does not survive a navigation, so it must
 * be collected in the same session it is used.
 */

/** Grid density over the board. 4x4 gives good coverage in ~25s. */
const GRID = 4
/** Gap after each accepted click before the next dot — clears the worker's ~1s
 *  click debounce and gives the model a moment to adapt. */
const AFTER_CLICK_MS = 1150
/** Push dots slightly inside the board edges so edge squares stay interpolated. */
const INSET = 0.08

interface CalibrationOverlayProps {
  /** Record one collected sample (drives the readiness gate + progress). */
  onNoteSample: () => void
  /** All dots done. */
  onComplete: () => void
  /** Bail out without finishing. */
  onCancel: () => void
}

/** The n*n grid as board-relative fractions, in row order. */
function buildFractions(): { fx: number; fy: number }[] {
  const out: { fx: number; fy: number }[] = []
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      out.push({
        fx: INSET + (c / (GRID - 1)) * (1 - 2 * INSET),
        fy: INSET + (r / (GRID - 1)) * (1 - 2 * INSET),
      })
    }
  }
  return out
}

/** Resolve a board fraction to viewport pixels against the current rect. */
function resolve(fx: number, fy: number): { x: number; y: number } {
  const geom = getBoardGeometry()
  if (geom) return { x: geom.left + fx * geom.width, y: geom.top + fy * geom.height }
  // No board yet: a centred square region of the viewport.
  const side = Math.min(window.innerWidth, window.innerHeight) * 0.8
  const originX = (window.innerWidth - side) / 2
  const originY = (window.innerHeight - side) / 2
  return { x: originX + fx * side, y: originY + fy * side }
}

export default function CalibrationOverlay({
  onNoteSample,
  onComplete,
  onCancel,
}: CalibrationOverlayProps) {
  const fractionsRef = useRef(buildFractions())
  const fractions = fractionsRef.current
  const [index, setIndex] = useState(0)
  const [waiting, setWaiting] = useState(false)
  // Bumped on a short interval so the current dot re-resolves against the live
  // board rect while fullscreen layout settles.
  const [, setTick] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      invalidateBoardGeometry()
      setTick((t) => t + 1)
    }, 200)
    return () => clearInterval(id)
  }, [])

  const handleDotClick = useCallback(() => {
    // Do NOT stop propagation: the click must reach the window so WebEyeTrack's
    // listener adapts to it. We only advance the guided sequence here.
    if (waiting) return
    onNoteSample()
    const next = index + 1
    if (next >= fractions.length) {
      onComplete()
      return
    }
    setWaiting(true)
    timerRef.current = setTimeout(() => {
      setWaiting(false)
      setIndex(next)
    }, AFTER_CLICK_MS)
  }, [waiting, index, fractions.length, onNoteSample, onComplete])

  // Esc bails out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const frac = fractions[index]
  const dot = frac ? resolve(frac.fx, frac.fy) : null
  const total = fractions.length
  const progress = total ? (index / total) * 100 : 0

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Backdrop as a sibling of the dot (not an ancestor): a miss-click here is
          swallowed so it can't feed WebEyeTrack a mis-aligned sample, while a real
          dot click bubbles straight to the window listener. */}
      <div
        className="absolute inset-0 bg-background/85 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Instructions + progress. pointer-events-none so text clicks never calibrate. */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 text-center space-y-2 px-4 pointer-events-none">
        <h2 className="text-2xl font-bold text-foreground">Look at the dot, then click it</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Keep your eyes on each dot as you click it — that is what teaches the
          tracker where you are looking. It gets steadier the more you do.
        </p>
        <p className="text-xs text-muted-foreground/70">
          {waiting ? 'Nice — next one…' : `Point ${Math.min(index + 1, total)} of ${total}`}
        </p>
        <div className="mx-auto h-1 w-56 rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* The current dot. */}
      <AnimatePresence mode="wait">
        {dot && !waiting && (
          <motion.button
            key={index}
            type="button"
            onClick={handleDotClick}
            aria-label={`Calibration point ${index + 1}`}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2 outline-none"
            style={{ left: dot.x, top: dot.y }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <span className="relative flex items-center justify-center">
              <motion.span
                animate={{ scale: [1, 1.7], opacity: [0.8, 0] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="absolute w-12 h-12 rounded-full border-2 border-primary"
              />
              <span className="block w-6 h-6 rounded-full bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/50" />
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Cancel — pointer-events re-enabled just for this control. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onCancel()
        }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 text-xs text-muted-foreground hover:text-foreground underline"
      >
        Skip calibration (Esc)
      </button>
    </div>
  )
}
