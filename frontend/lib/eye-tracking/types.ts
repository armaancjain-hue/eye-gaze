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
  dwellTime: number // milliseconds
  blinkSensitivity: 'low' | 'medium' | 'high'
  highContrast: boolean
  largeCursor: boolean
  reducedMotion: boolean
  voiceFeedback: boolean
}
