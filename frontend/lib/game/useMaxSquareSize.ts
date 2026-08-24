'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { invalidateBoardGeometry } from '@/lib/eye-tracking/board-mapping'

/**
 * Measure the largest square that fits inside an element.
 *
 * The board used to be sized by `calc(100vh - 150px)` — a guess at how much
 * vertical chrome sat above and below it. Any change to the header, the labels
 * or the status line silently made that guess wrong, and the board was sized to
 * the guess rather than to the space actually available. Measuring the container
 * means the board is exactly as large as it can be, whatever the layout does
 * around it.
 *
 * The measured element must not be sized by its own content, or the board would
 * feed back into the thing measuring it. The caller guarantees that by taking
 * the board out of flow (see Chessboard).
 */

/**
 * Delays, in ms, at which the size is re-checked after anything that could move
 * the layout.
 *
 * Timers rather than animation frames, and several rather than one, on purpose.
 * A single measurement taken during hydration lands before the ancestors have
 * definite heights; web fonts reflow the chrome later still; and neither
 * `requestAnimationFrame` nor `ResizeObserver` can be relied on to rescue it,
 * because embedded viewers throttle or suppress the rendering pipeline that
 * drives both — a board stuck at the wrong size for a whole session is a far
 * worse outcome than a handful of extra layout reads at startup.
 */
const SETTLE_DELAYS_MS = [0, 50, 150, 350, 800]

export function useMaxSquareSize(
  cap = Number.POSITIVE_INFINITY,
  /** Change this whenever the surrounding layout changes, to force a re-check. */
  layoutKey: string | number = '',
): {
  ref: (node: HTMLElement | null) => void
  size: number
  /** Re-check now; for layout changes the hook cannot know about. */
  remeasure: () => void
} {
  const [size, setSize] = useState(0)
  const nodeRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const measure = useCallback(() => {
    const node = nodeRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const next = Math.max(0, Math.min(rect.width, rect.height, cap))
    setSize((prev) => {
      // Sub-pixel churn would re-render on every frame of a resize without
      // changing anything a player could see.
      if (Math.abs(prev - next) < 0.5) return prev
      // The board's on-screen rect is what gaze coordinates are resolved
      // against, so a stale cached rect would misclassify squares until it
      // expired on its own.
      invalidateBoardGeometry()
      return next
    })
  }, [cap])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])

  /** Measure now, then again as the layout settles. */
  const settle = useCallback(() => {
    clearTimers()
    measure()
    timersRef.current = SETTLE_DELAYS_MS.map((ms) => setTimeout(measure, ms))
  }, [clearTimers, measure])

  const ref = useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect()
      nodeRef.current = node
      if (!node) return

      settle()
      // Still worth attaching where it works — it catches resizes nothing else
      // reports, such as a scrollbar appearing.
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        observerRef.current = observer
      }
    },
    [measure, settle],
  )

  // Re-measure whenever the caller says the layout moved.
  useEffect(() => {
    settle()
  }, [layoutKey, settle])

  useEffect(() => {
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', settle)
    // Web fonts change the height of the chrome around the board when they land.
    document.fonts?.ready.then(settle).catch(() => {})

    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', settle)
      clearTimers()
      observerRef.current?.disconnect()
    }
  }, [measure, settle, clearTimers])

  return { ref, size, remeasure: settle }
}
