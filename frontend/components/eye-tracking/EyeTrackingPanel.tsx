'use client'

import { RefObject } from 'react'
import { motion } from 'framer-motion'
import { Eye, AlertCircle, CheckCircle2, Video } from 'lucide-react'
import { EyeTrackingState } from '@/lib/eye-tracking/types'
import type { CalibrationQuality } from '@/lib/eye-tracking/calibration'
import GazeRing from './GazeRing'
import WebcamPreview from './WebcamPreview'

interface EyeTrackingPanelProps {
  eyeTrackingState: EyeTrackingState
  onCalibrationClick: () => void
  videoRef: RefObject<HTMLVideoElement | null>
  isReady: boolean
  error: string | null
  onEnableCamera: () => void
  /** Held-out accuracy of the active calibration, or null if uncalibrated. */
  calibrationQuality?: CalibrationQuality | null
  /** The square the gaze currently resolves to, in algebraic notation. */
  targetSquare?: string | null
  /** 0..1 confidence in that square. */
  targetConfidence?: number
  /** True while the player has drifted out of the pose they calibrated at. */
  driftWarning?: boolean
  /** True when the board has been resized enough that the fit no longer holds. */
  boardResized?: boolean
  /** Resolution the webcam actually negotiated. */
  cameraResolution?: { width: number; height: number } | null
  /** Detection throughput, frames per second. */
  fps?: number
}

export default function EyeTrackingPanel({
  eyeTrackingState,
  onCalibrationClick,
  videoRef,
  isReady,
  error,
  onEnableCamera,
  calibrationQuality = null,
  targetSquare = null,
  targetConfidence = 0,
  driftWarning = false,
  boardResized = false,
  cameraResolution = null,
  fps = 0,
}: EyeTrackingPanelProps) {
  // Iris-landmark precision is bounded by how many pixels land on the eye, so a
  // camera that quietly capped below 720p puts a floor under achievable accuracy
  // that no amount of recalibration can lift.
  const lowResolution = !!cameraResolution && cameraResolution.width < 1280
  const isActive = eyeTrackingState.status === 'active'
  const statusColor = isActive ? 'text-green-400' : 'text-yellow-400'
  const statusBgColor = isActive ? 'bg-green-400/10' : 'bg-yellow-400/10'

  const statusText =
    eyeTrackingState.status === 'inactive'
      ? 'Inactive'
      : eyeTrackingState.status === 'calibrating'
        ? 'Calibrating'
        : eyeTrackingState.status === 'lost'
          ? 'Signal Lost'
          : 'Tracking Active'

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="h-full flex flex-col gap-4 p-6 bg-card border-l border-border rounded-lg"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Eye className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-foreground">Eye Tracking</h3>
      </div>

      {/* Webcam Preview */}
      <div className="relative rounded-lg overflow-hidden border border-border bg-background">
        <WebcamPreview ref={videoRef} active={isReady} />
        {isReady && <GazeRing gazePoint={eyeTrackingState.gazePoint} />}
      </div>

      {/* Enable camera / error */}
      {!isReady && (
        <motion.button
          onClick={onEnableCamera}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-accent text-primary-foreground text-sm font-medium transition-colors"
        >
          <Video className="w-4 h-4" />
          Enable Camera
        </motion.button>
      )}
      {error && (
        <p className="text-xs text-red-400 flex items-start gap-1">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {/* Status Badge */}
      <motion.div
        animate={{ opacity: [1, 0.8, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg ${statusBgColor} text-sm`}
      >
        {isActive ? (
          <CheckCircle2 className={`w-4 h-4 ${statusColor}`} />
        ) : (
          <AlertCircle className={`w-4 h-4 ${statusColor}`} />
        )}
        <span className={statusColor}>{statusText}</span>
      </motion.div>

      {/* Confidence Meter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase">
            Confidence
          </p>
          <motion.p
            key={eyeTrackingState.gazePoint.confidence}
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            className="text-sm font-bold text-primary"
          >
            {Math.round(eyeTrackingState.gazePoint.confidence * 100)}%
          </motion.p>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <motion.div
            initial={false}
            animate={{ width: `${eyeTrackingState.gazePoint.confidence * 100}%` }}
            transition={{ duration: 0.3 }}
            className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
          />
        </div>
      </div>

      {/* Target square — the actual output of the pipeline, shown so the player
          can see which square is being voted for before it commits. */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          Target square
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xl font-bold font-mono text-foreground tabular-nums">
            {targetSquare ?? '—'}
          </span>
          <span className="text-sm font-semibold text-primary">
            {targetSquare ? `${Math.round(targetConfidence * 100)}%` : ''}
          </span>
        </div>
      </div>

      {/* Calibration state. The error is reported in board squares because that
          is the unit that decides whether a square can be picked at all. */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          Calibration
        </p>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            initial={false}
            animate={{ width: `${eyeTrackingState.calibrationProgress}%` }}
            transition={{ duration: 0.5 }}
            className="h-full bg-accent rounded-full"
          />
        </div>
        {boardResized && (
          <p className="text-xs text-yellow-400 flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              The board is a different size than when you calibrated. Recalibrate
              to get the accuracy back.
            </span>
          </p>
        )}
        {calibrationQuality && !calibrationQuality.headCompensation && (
          <p className="text-xs text-yellow-400 flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              No head compensation — tracking will drift if you move. Recalibrate
              and shift a little when prompted.
            </span>
          </p>
        )}
        {driftWarning && (
          <p className="text-xs text-yellow-400 flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              You’ve moved since calibrating — sit back the way you were, or
              recalibrate.
            </span>
          </p>
        )}
        {calibrationQuality ? (
          <p className="text-xs text-muted-foreground">
            Typical error{' '}
            <span className="font-semibold text-foreground">
              {calibrationQuality.medianErrorSquares.toFixed(2)} squares
            </span>{' '}
            · {calibrationQuality.pointCount} points
          </p>
        ) : (
          <p className="text-xs text-yellow-400">
            Not calibrated — gaze selection is off until you calibrate.
          </p>
        )}
      </div>

      {/* Blink Indicator */}
      <motion.div
        animate={{
          backgroundColor: eyeTrackingState.blinkDetected
            ? 'rgba(168, 85, 247, 0.1)'
            : 'transparent',
        }}
        transition={{ duration: 0.2 }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
      >
        <motion.div
          animate={{
            scale: eyeTrackingState.blinkDetected ? 1.2 : 1,
            backgroundColor: eyeTrackingState.blinkDetected
              ? 'rgb(168, 85, 247)'
              : 'rgb(100, 116, 139)',
          }}
          className="w-2 h-2 rounded-full"
        />
        <span className="text-muted-foreground">
          {eyeTrackingState.blinkDetected ? 'Blink detected' : 'Ready'}
        </span>
      </motion.div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Camera Permission */}
      <div className="text-xs text-muted-foreground space-y-2">
        {cameraResolution && (
          <p>
            Capture:{' '}
            <span className={lowResolution ? 'text-yellow-400' : 'text-foreground'}>
              {cameraResolution.width}×{cameraResolution.height}
            </span>
            {fps > 0 && <span> · {fps} fps</span>}
          </p>
        )}
        {lowResolution && (
          <p className="text-yellow-400">
            This webcam capped below 720p, which limits how precisely the iris can
            be located.
          </p>
        )}
        <p>
          Camera:{' '}
          <span
            className={
              eyeTrackingState.cameraPermission === 'granted'
                ? 'text-green-400'
                : 'text-yellow-400'
            }
          >
            {eyeTrackingState.cameraPermission}
          </span>
        </p>
      </div>

      {/* Recalibrate Button */}
      <motion.button
        onClick={onCalibrationClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium transition-colors"
      >
        Recalibrate
      </motion.button>
    </motion.div>
  )
}
