export interface GazePoint {
  x: number
  y: number
  confidence: number
}

export type TrackingStatus = 'inactive' | 'calibrating' | 'active' | 'lost'
export type TrackingIssue =
  | 'camera-denied'
  | 'camera-unavailable'
  | 'model-loading'
  | 'webeyetrack-not-initialized'
  | 'no-face'
  | 'calibration-incomplete'
  | 'low-confidence'
  | 'board-too-small'

export interface EyeTrackingState {
  status: TrackingStatus
  /** Raw WebEyeTrack point converted from normPog to viewport CSS pixels. */
  rawGazePoint: GazePoint
  /** Personalized board-corrected point in viewport CSS pixels. */
  correctedGazePoint: GazePoint
  /** Backward-compatible alias for the corrected point used by the UI cursor. */
  gazePoint: GazePoint
  blinkDetected: boolean
  calibrationProgress: number
  isCalibrated: boolean
  calibrationQuality: number
  calibrationErrorSquares: number | null
  trackingIssue: TrackingIssue | null
  cameraPermission: 'granted' | 'denied' | 'prompt'
}

export interface AccessibilitySettings {
  /** How long the gaze must hold a square before it selects, 500..800ms. */
  dwellTime: number
  /** Cursor smoothing/stability, 0 (responsive) .. 100 (very steady). */
  smoothing: number
  blinkSensitivity: 'low' | 'medium' | 'high'
  highContrast: boolean
  largeCursor: boolean
  reducedMotion: boolean
  voiceFeedback: boolean
}
