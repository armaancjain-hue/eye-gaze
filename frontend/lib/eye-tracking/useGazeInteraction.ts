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

/** Resolve a viewport point to a board square via the DOM, or null. */
function squareAtPoint(x: number, y: number): BoardPosition | null {
  const el = document.elementFromPoint(x, y)
  const squareEl = el?.closest('[data-square]')
  const attr = squareEl?.getAttribute('data-square')
  if (!attr) return null
  const [row, col] = attr.split('-').map(Number)
  if (Number.isNaN(row) || Number.isNaN(col)) return null
  return { row, col }
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

  // The square the gaze is currently over — shared with the blink handler.
  const hoveredRef = useRef<BoardPosition | null>(null)
  // Dwell accumulation state.
  const targetRef = useRef<BoardPosition | null>(null)
  const dwellStartRef = useRef(0)
  // Square already activated this dwell; require leaving before re-firing.
  const activatedRef = useRef<BoardPosition | null>(null)

  const same = (a: BoardPosition | null, b: BoardPosition | null) =>
    !!a && !!b && a.row === b.row && a.col === b.col

  // Blink -> confirm move to the currently hovered square.
  useEffect(() => {
    const unsub = registerBlink(() => {
      if (!enabledRef.current) return
      onBlinkRef.current(hoveredRef.current)
    })
    return unsub
  }, [registerBlink])

  // Dwell loop.
  useEffect(() => {
    if (!enabled) {
      setDwellSquare(null)
      setDwellProgress(0)
      targetRef.current = null
      activatedRef.current = null
      hoveredRef.current = null
      return
    }

    const interval = setInterval(() => {
      const g = gazeRef.current
      const hovered = squareAtPoint(g.x, g.y)
      hoveredRef.current = hovered

      // Gaze left the board (or moved to a new square): reset accumulation.
      if (!same(hovered, targetRef.current)) {
        targetRef.current = hovered
        dwellStartRef.current = performance.now()
        // Allow re-activation once the gaze has moved off the activated square.
        if (!same(hovered, activatedRef.current)) activatedRef.current = null
        setDwellSquare(hovered)
        setDwellProgress(0)
        return
      }

      if (!hovered) {
        setDwellProgress(0)
        return
      }

      // Already activated this square; wait for the user to look away.
      if (same(hovered, activatedRef.current)) {
        setDwellProgress(1)
        return
      }

      const elapsed = performance.now() - dwellStartRef.current
      const progress = Math.min(1, elapsed / dwellTimeRef.current)
      setDwellProgress(progress)

      if (progress >= 1) {
        activatedRef.current = hovered
        onDwellRef.current(hovered)
      }
    }, 40)

    return () => clearInterval(interval)
  }, [enabled])

  return { dwellSquare, dwellProgress }
}
