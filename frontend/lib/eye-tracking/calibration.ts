import type { GazeFeature } from './features'
import { FEATURE_KEYS } from './features'
import {
  fitTwoAxisModel,
  noveltyScore,
  predictTwoAxis,
  type TwoAxisModel,
  type ValidationStats,
} from './regression'
import type { BoardRect } from './board-mapping'

/**
 * Personalised gaze calibration.
 *
 * Nobody's eyes map to a screen the same way — it depends on their face
 * geometry, where the camera sits, how far back they lean and how the board is
 * laid out. So we collect (feature -> known target) pairs while the user looks
 * at a grid of dots over the chessboard, fit a regularised model to *them*, and
 * store it. Everything downstream consumes the fitted prediction; the raw iris
 * offset never reaches the board.
 */

export interface CalibrationSample {
  feature: GazeFeature
  /** Target position in viewport pixels. */
  screenX: number
  screenY: number
  /** Which calibration dot this sample belongs to — the CV grouping key. */
  pointIndex: number
}

export interface CalibrationQuality {
  /** Held-out median error in CSS pixels. */
  medianErrorPx: number
  p90ErrorPx: number
  medianErrorXPx: number
  medianErrorYPx: number
  /** Held-out median error expressed in board squares — the number that matters. */
  medianErrorSquares: number
  /** Square size the error was expressed against. */
  squareSizePx: number
  sampleCount: number
  pointCount: number
}

export interface CalibrationModel {
  version: 4
  model: TwoAxisModel
  quality: CalibrationQuality
  /** Board rect at calibration time, so predictions can follow board resizes. */
  board: BoardRect | null
  viewport: { width: number; height: number }
  createdAt: number
}

// v4: 11-dim descriptor + standardised ridge + residual anchors. Models stored
// by earlier versions describe different features entirely, so they are dropped
// and the user recalibrates once.
const STORAGE_KEY = 'eye-gaze-chess.calibration.v4'

/**
 * Polynomial basis over the descriptor.
 *
 * Linear terms carry most of the signal; the squared terms let the mapping bend
 * near the screen edges (where the eye/screen relationship is least linear), and
 * the interaction terms are what let head pose *correct* the eye signal instead
 * of merely being added to it — looking at the same square with the head turned
 * 10 degrees produces a different iris offset, and `ex * yaw` is the term that
 * knows it.
 */
export function basisFromFeature(f: GazeFeature): number[] {
  const { ex, ey, eyLid, vergence, aperture, yaw, pitch, roll, headX, headY, headScale } = f
  return [
    // Linear
    ex,
    ey,
    eyLid,
    vergence,
    aperture,
    yaw,
    pitch,
    roll,
    headX,
    headY,
    headScale,
    // Curvature
    ex * ex,
    ey * ey,
    eyLid * eyLid,
    // Eye-eye interaction (the mapping is not separable across axes)
    ex * ey,
    ex * eyLid,
    // Head compensation
    ex * yaw,
    ey * pitch,
    eyLid * pitch,
    yaw * pitch,
    ex * headX,
    ey * headY,
    ex * headScale,
    ey * headScale,
  ]
}

export const N_BASIS_TERMS = basisFromFeature({
  ex: 0,
  ey: 0,
  eyLid: 0,
  vergence: 0,
  aperture: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  headX: 0,
  headY: 0,
  headScale: 0,
}).length

/** Minimum samples for a fit that can also be honestly validated. */
export const MIN_CALIBRATION_SAMPLES = N_BASIS_TERMS + 4

export interface FitOptions {
  viewportWidth: number
  viewportHeight: number
  board: BoardRect | null
  squareSizePx: number
}

export function fitCalibration(
  samples: CalibrationSample[],
  opts: FitOptions,
): CalibrationModel | null {
  if (samples.length < MIN_CALIBRATION_SAMPLES) return null

  const rows = samples.map((s) => basisFromFeature(s.feature))
  const targetsX = samples.map((s) => s.screenX)
  const targetsY = samples.map((s) => s.screenY)
  const groups = samples.map((s) => s.pointIndex)

  const fit = fitTwoAxisModel(rows, targetsX, targetsY, groups)
  if (!fit) return null

  const squareSizePx = opts.squareSizePx > 0 ? opts.squareSizePx : 1
  return {
    version: 4,
    model: fit.model,
    quality: toQuality(fit.stats, squareSizePx, samples),
    board: opts.board,
    viewport: { width: opts.viewportWidth, height: opts.viewportHeight },
    createdAt: Date.now(),
  }
}

function toQuality(
  stats: ValidationStats,
  squareSizePx: number,
  samples: CalibrationSample[],
): CalibrationQuality {
  return {
    medianErrorPx: stats.medianErrorPx,
    p90ErrorPx: stats.p90ErrorPx,
    medianErrorXPx: stats.medianErrorXPx,
    medianErrorYPx: stats.medianErrorYPx,
    medianErrorSquares: stats.medianErrorPx / squareSizePx,
    squareSizePx,
    sampleCount: samples.length,
    pointCount: new Set(samples.map((s) => s.pointIndex)).size,
  }
}

/** Map a descriptor to a viewport point using a fitted model. */
export function predictGaze(
  model: CalibrationModel,
  feature: GazeFeature,
): { x: number; y: number } {
  return predictTwoAxis(model.model, basisFromFeature(feature))
}

/**
 * 0..1 measure of how far the current descriptor sits outside the range the
 * model was calibrated over — the player has leaned in, turned, or is sitting
 * differently than they were. The prediction is extrapolation at that point, so
 * this is folded into the reported confidence rather than hidden.
 */
export function gazeNovelty(model: CalibrationModel, feature: GazeFeature): number {
  return noveltyScore(model.model.x, basisFromFeature(feature))
}

/**
 * A 0..1 read on how much the *square classification* can be trusted given the
 * calibration alone: error well under half a square is excellent, error of a
 * full square means the model cannot tell neighbours apart.
 */
export function qualityScore(quality: CalibrationQuality): number {
  const e = quality.medianErrorSquares
  if (!Number.isFinite(e)) return 0
  return Math.max(0, Math.min(1, 1 - (e - 0.25) / 0.85))
}

export function saveCalibration(model: CalibrationModel): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model))
  } catch {
    /* Private mode / quota: calibration simply stays session-only. */
  }
}

export function loadCalibration(): CalibrationModel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CalibrationModel
    if (parsed?.version !== 4) return null
    const m = parsed.model
    if (!m?.x?.weights || !m?.y?.weights) return null
    if (m.x.weights.length !== N_BASIS_TERMS + 1) return null
    if (m.x.mean?.length !== N_BASIS_TERMS) return null
    if (m.x.active?.length !== N_BASIS_TERMS) return null
    if (m.x.noveltyStd?.length !== N_BASIS_TERMS) return null
    return parsed
  } catch {
    return null
  }
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Pre-calibration fallback, used *only* to draw the on-screen cursor so the user
 * can see that tracking is alive and frame themselves in the camera. It is a
 * crude fixed gain over the raw descriptor with no personalisation, and is
 * deliberately never routed to square selection — that is exactly the raw-iris
 * mapping this pipeline replaces.
 */
export function previewGaze(
  feature: GazeFeature,
  screenWidth: number,
  screenHeight: number,
): { x: number; y: number } {
  const x = screenWidth * (0.5 + feature.ex * 4 + feature.yaw * 0.9)
  const y = screenHeight * (0.5 + feature.ey * 6 + feature.eyLid * 1.2 + feature.pitch * 0.9)
  return { x, y }
}

/** Debug helper: flat descriptor readout, handy when tuning in the console. */
export function describeFeature(f: GazeFeature): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of FEATURE_KEYS) out[k] = Number(f[k].toFixed(4))
  return out
}
