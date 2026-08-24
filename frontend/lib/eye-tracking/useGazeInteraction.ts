'use client'

import { useEffect, useRef, useState } from 'react'
import type { BoardPosition } from '@/lib/chess/types'
import { getBoardGeometry, invalidateBoardGeometry } from './board-mapping'
import { SquareStabilizer } from './square-stabilizer'
import type { GazePoint } from './types'

interface UseGazeInteractionOptions {
  /** Gate the whole thing — pass false when it isn't the player's turn. */
  enabled: boolean
  gazePoint: GazePoint
  /** How long (ms) the gaze must hold a square before it activates. */
  dwellTime: number
  /** 0..1 accuracy of the active calibration; feeds the confidence estimate. */
  calibrationScore: number
  /** Subscribe to deliberate-blink events; must return an unsubscribe fn. */
  registerBlink: (cb: () => void) => () => void
  /** Fired when a square is activated by dwell (select / deselect). */
  onDwell: (pos: BoardPosition) => void
  /** Fired on a deliberate blink, with the stable square (if any). */
  onBlinkConfirm: (pos: BoardPosition | null) => void
}

export interface GazeInteraction {
  /** The stable square the gaze is resolved to, or null. */
  dwellSquare: BoardPosition | null
  /** 0..1 progress toward activating it. */
  dwellProgress: number
  /** 0..1 confidence in that square. */
  confidence: number
  /** True while the smoothed gaze is over the board at all. */
  onBoard: boolean
}

/**
 * Board interaction driven by the calibrated gaze estimate: the stabilizer
 * resolves the gaze stream to one stable square with a confidence, a dwell on it
 * selects, and a deliberate blink confirms the move.
 *
 * The update cadence (~33ms) is decoupled from the tracker's frame rate on
 * purpose: it keeps the voting window a fixed length in *time* rather than in
 * frames, so a slow device votes with fewer, equally-weighted samples instead of
 * silently stretching the dwell.
 */
const UPDATE_INTERVAL_MS = 33

export function useGazeInteraction({
  enabled,
  gazePoint,
  dwellTime,
  calibrationScore,
  registerBlink,
  onDwell,
  onBlinkConfirm,
}: UseGazeInteractionOptions): GazeInteraction {
  const [dwellSquare, setDwellSquare] = useState<BoardPosition | null>(null)
  const [dwellProgress, setDwellProgress] = useState(0)
  const [confidence, setConfidence] = useState(0)
  const [onBoard, setOnBoard] = useState(false)

  const stabilizerRef = useRef<SquareStabilizer | null>(null)
  if (!stabilizerRef.current) stabilizerRef.current = new SquareStabilizer()

  // Latest values, read inside the loop / blink handler without re-subscribing.
  const gazeRef = useRef(gazePoint)
  gazeRef.current = gazePoint
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const onDwellRef = useRef(onDwell)
  onDwellRef.current = onDwell
  const onBlinkRef = useRef(onBlinkConfirm)
  onBlinkRef.current = onBlinkConfirm
  /** The stable square, kept in a ref so the blink handler sees it instantly. */
  const stableSquareRef = useRef<BoardPosition | null>(null)

  // Push tuning into the stabilizer as the user changes it (or as calibration
  // quality changes), without rebuilding it and losing the in-flight vote window.
  useEffect(() => {
    stabilizerRef.current?.configure({ dwellMs: dwellTime, calibrationScore })
  }, [dwellTime, calibrationScore])

  // Blink -> confirm the move to the stable square. We deliberately use the
  // voted square rather than the instantaneous one: as the lids close the gaze
  // estimate lurches, so the settled square is the safer read of the intent.
  useEffect(() => {
    const unsub = registerBlink(() => {
      if (!enabledRef.current) return
      onBlinkRef.current(stableSquareRef.current)
    })
    return unsub
  }, [registerBlink])

  useEffect(() => {
    const stabilizer = stabilizerRef.current
    if (!stabilizer) return

    if (!enabled) {
      stabilizer.reset()
      stableSquareRef.current = null
      setDwellSquare(null)
      setDwellProgress(0)
      setConfidence(0)
      setOnBoard(false)
      return
    }

    // The board resizes when a side panel collapses, and the cached geometry
    // would otherwise stay stale for up to its TTL.
    invalidateBoardGeometry()

    const interval = setInterval(() => {
      const now = performance.now()
      const gaze = gazeRef.current
      const geometry = getBoardGeometry(now)
      const result = stabilizer.update(now, gaze, geometry, gaze.confidence)

      stableSquareRef.current = result.square
      setDwellSquare(result.square)
      setDwellProgress(result.dwellProgress)
      setConfidence(result.confidence)
      setOnBoard(result.onBoard)

      if (result.committed) onDwellRef.current(result.committed)
    }, UPDATE_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [enabled])

  return { dwellSquare, dwellProgress, confidence, onBoard }
}
