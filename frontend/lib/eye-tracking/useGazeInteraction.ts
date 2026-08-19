'use client'

import { useEffect, useRef, useState } from 'react'
import type { BoardPosition } from '@/lib/chess/types'
import type { GazePoint } from './types'

interface UseGazeInteractionOptions {
  enabled: boolean
  gazePoint: GazePoint
  /** How long (ms) to hold gaze on a square before it activates. */
  dwellTime: number
  /** Subscribe to deliberate-blink events; must return an unsubscribe fn. */
  registerBlink: (cb: () => void) => () => void
  /** Fired when a square is activated by dwell (select / deselect). */
  onDwell: (pos: BoardPosition) => void
  /** Fired on a deliberate blink, with whatever square the gaze is over. */
  onBlinkConfirm: (pos: BoardPosition | null) => void
}

/** How persistently the gaze must sit on a new square before the dwell target
 *  switches to it. At the 40ms loop cadence, 2 frames ≈ 80ms of stability,
 *  enough to reject single-frame jitter across a square boundary without any
 *  perceptible lag when the user genuinely looks elsewhere. */
const SWITCH_STABILITY_FRAMES = 2

/** How far outside a square's centre the gaze may fall and still resolve to it,
 *  as a fraction of the square's size. Snapping to the nearest centre keeps the
 *  dwell from dropping out when the gaze lands on the thin gap between squares
 *  or just past a centre; beyond this radius the gaze is treated as off-board. */
const SNAP_RADIUS_FRACTION = 0.75

function parseSquare(el: Element | null): BoardPosition | null {
  const attr = el?.getAttribute('data-square')
  if (!attr) return null
  const [row, col] = attr.split('-').map(Number)
  if (Number.isNaN(row) || Number.isNaN(col)) return null
  return { row, col }
}

/**
 * Resolve a viewport point to a board square. A direct hit wins immediately;
 * otherwise we snap to the nearest square centre within a tolerance, so noisy
 * gaze that lands on a border or just off a centre still tracks the square the
 * user is looking at rather than flickering to null.
 */
function squareAtPoint(x: number, y: number): BoardPosition | null {
  const direct = parseSquare(document.elementFromPoint(x, y)?.closest('[data-square]') ?? null)
  if (direct) return direct

  const squares = document.querySelectorAll('[data-square]')
  let best: BoardPosition | null = null
  let bestDist = Infinity
  let squareSize = 0
  squares.forEach((sq) => {
    const r = sq.getBoundingClientRect()
    squareSize = r.width
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const d = Math.hypot(x - cx, y - cy)
    if (d < bestDist) {
      bestDist = d
      best = parseSquare(sq)
    }
  })

  if (best && bestDist <= squareSize * SNAP_RADIUS_FRACTION) return best
  return null
}

/**
 * Drives gaze-based board interaction: dwell on a square to activate it, and
 * blink to confirm a move to the square you're currently looking at. Returns
 * the square being dwelled on and progress toward activation, for UI feedback.
 */
export function useGazeInteraction({
  enabled,
  gazePoint,
  dwellTime,
  registerBlink,
  onDwell,
  onBlinkConfirm,
}: UseGazeInteractionOptions) {
  const [dwellSquare, setDwellSquare] = useState<BoardPosition | null>(null)
  const [dwellProgress, setDwellProgress] = useState(0)

  // Latest values read inside the loop / blink handler without re-subscribing.
  const gazeRef = useRef(gazePoint)
  gazeRef.current = gazePoint
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const dwellTimeRef = useRef(dwellTime)
  dwellTimeRef.current = dwellTime
  const onDwellRef = useRef(onDwell)
  onDwellRef.current = onDwell
  const onBlinkRef = useRef(onBlinkConfirm)
  onBlinkRef.current = onBlinkConfirm

  // The raw square the gaze is over this frame (pre-hysteresis).
  const hoveredRef = useRef<BoardPosition | null>(null)
  // The committed dwell target: the square progress is accumulating against.
  const targetRef = useRef<BoardPosition | null>(null)
  const dwellStartRef = useRef(0)
  // A candidate square competing to become the target, and how long it has held.
  const pendingRef = useRef<BoardPosition | null>(null)
  const pendingCountRef = useRef(0)
  // Square already activated this dwell; require leaving before re-firing.
  const activatedRef = useRef<BoardPosition | null>(null)

  const same = (a: BoardPosition | null, b: BoardPosition | null) =>
    !!a && !!b && a.row === b.row && a.col === b.col

  // Blink -> confirm move to the committed dwell target. We use the stable
  // target, not the instantaneous hovered square: as the eyes close the gaze
  // estimate briefly jumps, so the last settled square is the safer intent.
  useEffect(() => {
    const unsub = registerBlink(() => {
      if (!enabledRef.current) return
      onBlinkRef.current(targetRef.current ?? hoveredRef.current)
    })
    return unsub
  }, [registerBlink])

  // Dwell loop.
  useEffect(() => {
    if (!enabled) {
      setDwellSquare(null)
      setDwellProgress(0)
      targetRef.current = null
      pendingRef.current = null
      pendingCountRef.current = 0
      activatedRef.current = null
      hoveredRef.current = null
      return
    }

    const interval = setInterval(() => {
      const g = gazeRef.current
      const now = performance.now()
      const hovered = squareAtPoint(g.x, g.y)
      hoveredRef.current = hovered

      // Decide whether to switch the committed target, applying hysteresis so a
      // lone jittery frame across a boundary can't reset an in-progress dwell.
      if (same(hovered, targetRef.current)) {
        pendingRef.current = null
        pendingCountRef.current = 0
      } else {
        if (same(hovered, pendingRef.current)) {
          pendingCountRef.current += 1
        } else {
          pendingRef.current = hovered
          pendingCountRef.current = 1
        }
        if (pendingCountRef.current >= SWITCH_STABILITY_FRAMES) {
          // The new square has held long enough: commit to it.
          targetRef.current = hovered
          dwellStartRef.current = now
          pendingRef.current = null
          pendingCountRef.current = 0
          // Allow re-activation once the gaze has left the activated square.
          if (!same(hovered, activatedRef.current)) activatedRef.current = null
          setDwellSquare(hovered)
          setDwellProgress(0)
        }
        // Until committed, keep accumulating on the existing target below.
      }

      const target = targetRef.current
      if (!target) {
        setDwellProgress(0)
        return
      }

      // Already activated this square; wait for the user to look away.
      if (same(target, activatedRef.current)) {
        setDwellProgress(1)
        return
      }

      const elapsed = now - dwellStartRef.current
      const progress = Math.min(1, elapsed / dwellTimeRef.current)
      setDwellProgress(progress)

      if (progress >= 1) {
        activatedRef.current = target
        onDwellRef.current(target)
      }
    }, 40)

    return () => clearInterval(interval)
  }, [enabled])

  return { dwellSquare, dwellProgress }
}
