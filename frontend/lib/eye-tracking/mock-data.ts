import { EyeTrackingState, AccessibilitySettings } from './types'

export const createInitialEyeTrackingState = (): EyeTrackingState => {
  return {
    status: 'active',
    gazePoint: {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      confidence: 0.95,
    },
    blinkDetected: false,
    calibrationProgress: 100,
    cameraPermission: 'granted',
  }
}

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  // 550ms is a calmer default: long enough that a stray glance across a square
  // doesn't select it, short enough to stay responsive. Tunable in settings.
  dwellTime: 550,
  blinkSensitivity: 'medium',
  highContrast: false,
  largeCursor: false,
  reducedMotion: false,
  voiceFeedback: false,
}

// Simulate gaze movement around the screen
export const generateMockGazeTrajectory = (
  centerX: number = window.innerWidth / 2,
  centerY: number = window.innerHeight / 2,
  radius: number = 300
) => {
  const points = []
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2
    const x = centerX + Math.cos(angle) * radius
    const y = centerY + Math.sin(angle) * radius
    const confidence = 0.8 + Math.random() * 0.2
    points.push({ x: Math.max(0, Math.min(window.innerWidth, x)), y: Math.max(0, Math.min(window.innerHeight, y)), confidence })
  }
  return points
}
