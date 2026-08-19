/**
 * Gaze calibration model.
 *
 * We can't map raw eye geometry to screen coordinates without knowing how a
 * particular person, sitting at a particular distance, maps iris position to
 * where they're actually looking. So we collect (rawFeature -> knownScreenPoint)
 * samples during calibration and fit two ridge-regularised least-squares models
 * (one for X, one for Y) over a small polynomial expansion of the raw feature.
 */

/** The raw, per-frame signal extracted from the face mesh (see gaze-tracker). */
export interface RawGazeFeature {
  /** Iris horizontal offset (mirror-corrected), averaged over both eyes, smoothed. */
  gx: number
  /** Iris vertical offset, averaged over both eyes, smoothed. */
  gy: number
  /** Head forward-vector X component (yaw proxy) from the transform matrix. */
  headX: number
  /** Head forward-vector Y component (pitch proxy) from the transform matrix. */
  headY: number
}

export interface CalibrationModel {
  /** Weights mapping the expanded feature to screen X (in CSS pixels). */
  wx: number[]
  /** Weights mapping the expanded feature to screen Y (in CSS pixels). */
  wy: number[]
  /** Screen size the model was fitted against, used to detect resizes. */
  screenWidth: number
  screenHeight: number
  /** Mean residual error in pixels over the training samples. */
  rmsError: number
}

export interface CalibrationSample {
  feature: RawGazeFeature
  screenX: number
  screenY: number
}

// v3: gaze uses source-smoothed, mirror-corrected iris offset. Earlier models
// were fitted against different feature semantics, so they're ignored and the
// user recalibrates once.
const STORAGE_KEY = 'eye-gaze-chess.calibration.v3'

/**
 * Expand the 4-dim raw feature into an 8-dim basis with quadratic + interaction
 * terms. The quadratic terms let the model bend near the screen edges, where the
 * iris/screen relationship is most non-linear.
 */
export function expandFeature(f: RawGazeFeature): number[] {
  return [
    1,
    f.gx,
    f.gy,
    f.gx * f.gy,
    f.gx * f.gx,
    f.gy * f.gy,
    f.headX,
    f.headY,
  ]
}

const N_TERMS = 8

/**
 * Solve the square linear system A·x = b in place using Gaussian elimination
 * with partial pivoting. Returns null if the matrix is singular.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length
  // Work on copies so callers keep their inputs.
  const m = A.map((row) => row.slice())
  const y = b.slice()

  for (let col = 0; col < n; col++) {
    // Partial pivot: find the row with the largest magnitude in this column.
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    if (pivot !== col) {
      ;[m[col], m[pivot]] = [m[pivot], m[col]]
      ;[y[col], y[pivot]] = [y[pivot], y[col]]
    }

    // Eliminate below.
    for (let row = col + 1; row < n; row++) {
      const factor = m[row][col] / m[col][col]
      if (factor === 0) continue
      for (let k = col; k < n; k++) m[row][k] -= factor * m[col][k]
      y[row] -= factor * y[col]
    }
  }

  // Back-substitution.
  const x = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = y[row]
    for (let k = row + 1; k < n; k++) sum -= m[row][k] * x[k]
    x[row] = sum / m[row][row]
  }
  return x
}

/**
 * Fit weights for a single output (X or Y) via ridge regression:
 *   w = (FᵀF + λI)⁻¹ Fᵀ s
 * The ridge term λ keeps the fit stable when calibration points are few or
 * nearly collinear (e.g. the user barely moved their eyes).
 */
function fitAxis(design: number[][], targets: number[], lambda: number): number[] | null {
  const A: number[][] = Array.from({ length: N_TERMS }, () => new Array(N_TERMS).fill(0))
  const b: number[] = new Array(N_TERMS).fill(0)

  for (let s = 0; s < design.length; s++) {
    const row = design[s]
    const t = targets[s]
    for (let i = 0; i < N_TERMS; i++) {
      b[i] += row[i] * t
      for (let j = 0; j < N_TERMS; j++) A[i][j] += row[i] * row[j]
    }
  }
  // Ridge: add λ to the diagonal (but not the bias term, index 0).
  for (let i = 1; i < N_TERMS; i++) A[i][i] += lambda

  return solveLinearSystem(A, b)
}

export function fitCalibration(
  samples: CalibrationSample[],
  screenWidth: number,
  screenHeight: number,
  lambda = 1e-3,
): CalibrationModel | null {
  if (samples.length < N_TERMS) return null

  const design = samples.map((s) => expandFeature(s.feature))
  const targetsX = samples.map((s) => s.screenX)
  const targetsY = samples.map((s) => s.screenY)

  const wx = fitAxis(design, targetsX, lambda)
  const wy = fitAxis(design, targetsY, lambda)
  if (!wx || !wy) return null

  // Compute RMS error over the training set for a quality readout.
  let sqErr = 0
  for (let s = 0; s < samples.length; s++) {
    const row = design[s]
    let px = 0
    let py = 0
    for (let i = 0; i < N_TERMS; i++) {
      px += row[i] * wx[i]
      py += row[i] * wy[i]
    }
    sqErr += (px - targetsX[s]) ** 2 + (py - targetsY[s]) ** 2
  }
  const rmsError = Math.sqrt(sqErr / samples.length)

  return { wx, wy, screenWidth, screenHeight, rmsError }
}

/** Map a raw feature to a screen point using a fitted model. */
export function predictGaze(
  model: CalibrationModel,
  feature: RawGazeFeature,
): { x: number; y: number } {
  const row = expandFeature(feature)
  let x = 0
  let y = 0
  for (let i = 0; i < N_TERMS; i++) {
    x += row[i] * model.wx[i]
    y += row[i] * model.wy[i]
  }
  return { x, y }
}

export function saveCalibration(model: CalibrationModel): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model))
  } catch {
    /* localStorage may be unavailable (private mode); calibration is per-session then. */
  }
}

export function loadCalibration(): CalibrationModel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CalibrationModel
    if (!Array.isArray(parsed.wx) || parsed.wx.length !== N_TERMS) return null
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
 * Rough uncalibrated mapping so the gaze ring still moves before calibration.
 * The gains are deliberately conservative; calibration replaces this entirely.
 * gx is already mirror-corrected upstream, so moving the head toward the
 * screen's right increases it. Both the eye-midpoint offset (gx/gy) and the head
 * forward vector (headX/headY) push the cursor the same way.
 */
export function defaultGaze(
  feature: RawGazeFeature,
  screenWidth: number,
  screenHeight: number,
): { x: number; y: number } {
  const x = screenWidth * (0.5 + feature.gx * 4 + feature.headX * 1.0)
  const y = screenHeight * (0.5 + feature.gy * 6 + feature.headY * 1.0)
  return { x, y }
}
