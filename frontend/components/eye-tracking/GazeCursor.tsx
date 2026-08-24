'use client'

import { GazePoint } from '@/lib/eye-tracking/types'

interface GazeCursorProps {
  /** Screen-space gaze point in CSS pixels (viewport coordinates). */
  gazePoint: GazePoint
  /** Only render while tracking is live. */
  active: boolean
  /** 0..1 progress of the current dwell, drawn as a filling ring. */
  dwellProgress?: number
  /** True while a board square is the committed dwell target. */
  dwelling?: boolean
  /** Accessibility: bigger cursor for low-vision users. */
  largeCursor?: boolean
  /** Accessibility: drop the smoothing transition. */
  reducedMotion?: boolean
}

/**
 * A viewport-wide cursor that shows exactly where the tracker thinks the user is
 * looking, plus a ring that fills as a dwell completes. Without this, gaze
 * feedback only lived inside the tiny webcam preview, so the board felt
 * unresponsive and users had no way to see (or correct) where their gaze landed.
 *
 * It is purely presentational and `pointer-events-none`, so it never intercepts
 * clicks — the mouse fallback keeps working underneath it.
 */
export default function GazeCursor({
  gazePoint,
  active,
  dwellProgress = 0,
  dwelling = false,
  largeCursor = false,
  reducedMotion = false,
}: GazeCursorProps) {
  if (!active) return null

  // The gaze point is already smoothed upstream; a short transition just softens
  // the last pixel of jitter without adding meaningful lag. Disabled for reduced
  // motion so the cursor tracks 1:1.
  const size = largeCursor ? 72 : 48
  const half = size / 2
  const stroke = largeCursor ? 5 : 4
  const r = half - stroke
  const circumference = 2 * Math.PI * r
  const confidence = Math.max(0, Math.min(1, gazePoint.confidence))
  // Fade the whole cursor toward transparent when the estimate is weak (blinking,
  // face partly lost) so a low-confidence guess doesn't read as a confident one.
  const opacity = 0.35 + confidence * 0.65

  return (
    <div
      aria-hidden
      className="fixed left-0 top-0 z-[60] pointer-events-none"
      style={{
        transform: `translate(${gazePoint.x}px, ${gazePoint.y}px)`,
        transition: reducedMotion ? 'none' : 'transform 90ms linear',
        willChange: 'transform',
      }}
    >
      <div
        className="absolute"
        style={{
          left: -half,
          top: -half,
          width: size,
          height: size,
          opacity,
        }}
      >
        {/* Progress + halo ring */}
        <svg width={size} height={size} className="absolute inset-0">
          {/* Track */}
          <circle
            cx={half}
            cy={half}
            r={r}
            fill="none"
            stroke="rgba(168,85,247,0.28)"
            strokeWidth={stroke}
          />
          {/* Dwell progress arc, starting at 12 o'clock */}
          {dwellProgress > 0 && (
            <circle
              cx={half}
              cy={half}
              r={r}
              fill="none"
              stroke="rgb(168,85,247)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - dwellProgress)}
              transform={`rotate(-90 ${half} ${half})`}
              style={{ transition: reducedMotion ? 'none' : 'stroke-dashoffset 60ms linear' }}
            />
          )}
        </svg>

        {/* Confidence glow, brighter while locked onto a square */}
        <div
          className="absolute rounded-full"
          style={{
            inset: stroke,
            boxShadow: `0 0 ${dwelling ? 22 : 14}px ${dwelling ? 6 : 3}px rgba(168,85,247,${
              0.25 + confidence * 0.4
            })`,
          }}
        />

        {/* Center dot */}
        <div
          className="absolute rounded-full bg-accent"
          style={{
            width: largeCursor ? 10 : 7,
            height: largeCursor ? 10 : 7,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
      </div>
    </div>
  )
}
