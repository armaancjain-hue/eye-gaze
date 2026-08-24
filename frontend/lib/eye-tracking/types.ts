export interface GazePoint {
  x: number
  y: number
  confidence: number
}

export type TrackingStatus = 'inactive' | 'calibrating' | 'active' | 'lost'

export interface EyeTrackingState {
  status: TrackingStatus
  gazePoint: GazePoint
  blinkDetected: boolean
  calibrationProgress: number
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
