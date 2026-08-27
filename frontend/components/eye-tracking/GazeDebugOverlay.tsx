'use client'

import type { BoardPosition } from '@/lib/chess/types'
import { toAlgebraic } from '@/lib/eye-tracking/board-mapping'
import type { EyeTrackingState } from '@/lib/eye-tracking/types'

interface GazeDebugOverlayProps {
  active: boolean
  state: EyeTrackingState
  rawSquare: BoardPosition | null
  stableSquare: BoardPosition | null
  confidence: number
  fixationProgress: number
  onBoard: boolean
}

function pct(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

export default function GazeDebugOverlay({
  active,
  state,
  rawSquare,
  stableSquare,
  confidence,
  fixationProgress,
  onBoard,
}: GazeDebugOverlayProps) {
  if (!active) return null

  return (
    <>
      <div
        aria-hidden
        className="fixed z-[61] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-red-200 bg-red-500/80 pointer-events-none"
        style={{
          left: state.rawGazePoint.x,
          top: state.rawGazePoint.y,
          boxShadow: '0 0 0 5px rgba(239,68,68,0.18)',
        }}
      />
      <div
        aria-hidden
        className="fixed z-[61] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100 bg-cyan-400/90 pointer-events-none"
        style={{
          left: state.correctedGazePoint.x,
          top: state.correctedGazePoint.y,
          boxShadow: '0 0 0 5px rgba(34,211,238,0.18)',
        }}
      />
      <div className="fixed left-3 top-3 z-[66] w-72 rounded-md border border-border bg-card/95 p-3 text-xs text-foreground shadow-lg backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-semibold">Gaze Debug</span>
          <span className={onBoard ? 'text-green-400' : 'text-yellow-400'}>
            {onBoard ? 'on board' : 'off board'}
          </span>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 font-mono">
          <span className="text-muted-foreground">raw</span>
          <span>
            {Math.round(state.rawGazePoint.x)}, {Math.round(state.rawGazePoint.y)}
          </span>
          <span className="text-muted-foreground">corrected</span>
          <span>
            {Math.round(state.correctedGazePoint.x)}, {Math.round(state.correctedGazePoint.y)}
          </span>
          <span className="text-muted-foreground">raw square</span>
          <span>{rawSquare ? toAlgebraic(rawSquare) : '-'}</span>
          <span className="text-muted-foreground">stable</span>
          <span>{stableSquare ? toAlgebraic(stableSquare) : '-'}</span>
          <span className="text-muted-foreground">confidence</span>
          <span>{pct(confidence)}</span>
          <span className="text-muted-foreground">fixation</span>
          <span>{pct(fixationProgress)}</span>
          <span className="text-muted-foreground">calibration</span>
          <span>
            {state.isCalibrated ? pct(state.calibrationQuality) : 'missing'}
            {state.calibrationErrorSquares !== null
              ? ` / ${state.calibrationErrorSquares.toFixed(2)} sq`
              : ''}
          </span>
          <span className="text-muted-foreground">issue</span>
          <span>{state.trackingIssue ?? '-'}</span>
        </div>
        <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            raw
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            corrected
          </span>
        </div>
      </div>
    </>
  )
}
