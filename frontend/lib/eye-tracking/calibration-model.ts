import type { BoardRect } from './board-mapping'

export const GAZE_CALIBRATION_STORAGE_KEY = 'armaan.chess.gazeCalibration.v2'

export type CalibrationPhase = 'idle' | 'collecting' | 'validating' | 'complete' | 'low-quality'

export interface CalibrationTarget {
  id: string
  fx: number
  fy: number
  label: string
}

export interface CalibrationSample {
  target: CalibrationTarget
  raw: { x: number; y: number }
  expected: { x: number; y: number }
  collectedAt: number
}

export interface CalibrationModel {
  version: 2
  kind: 'affine' | 'quadratic'
  coefficientsX: number[]
  coefficientsY: number[]
  boardRect: BoardRect
  sampleCount: number
  validationErrorPx: number
  validationErrorSquares: number
  qualityScore: number
  createdAt: number
}

export interface CalibrationQuality {
  validationErrorPx: number
  validationErrorSquares: number
  qualityScore: number
  lowQuality: boolean
}

const BOARD_SIZE = 8

/**
 * Validation error (in board squares) above which a calibration is rejected.
 *
 * This is deliberately about one square. A webcam appearance-based gaze model
 * lands within roughly 2-3cm of the true point of regard on a laptop at arm's
 * length, and a fullscreen board square is ~1.5-2.5cm across, so ~1 square of
 * residual error *is* a working calibration for dwell selection: the stabiliser
 * votes over a 300ms window and the dwell needs a majority, both of which absorb
 * sub-square jitter. The previous 0.55 threshold demanded ~40px accuracy, which
 * no consumer webcam pipeline reaches — every calibration was rejected as
 * "low quality" no matter how carefully the user held their gaze.
 */
export const LOW_QUALITY_ERROR_SQUARES = 1.25

const FIT_TARGETS: Array<[number, number]> = [
  [0.5, 0.5],
  [2.5, 0.5],
  [5.5, 0.5],
  [7.5, 0.5],
  [1.5, 2.5],
  [3.5, 2.5],
  [4.5, 2.5],
  [6.5, 2.5],
  [0.5, 5.5],
  [2.5, 5.5],
  [5.5, 5.5],
  [7.5, 5.5],
  [1.5, 7.5],
  [3.5, 7.5],
  [4.5, 7.5],
  [6.5, 7.5],
]

const VALIDATION_TARGETS: Array<[number, number]> = [
  [1.5, 1.5],
  [6.5, 1.5],
  [3.5, 3.5],
  [5.5, 4.5],
  [1.5, 6.5],
]

export const CALIBRATION_TARGETS: CalibrationTarget[] = FIT_TARGETS.map(([file, rank], i) => ({
  id: `fit-${i + 1}`,
  fx: file / BOARD_SIZE,
  fy: rank / BOARD_SIZE,
  label: `${i + 1}/${FIT_TARGETS.length}`,
}))

export const VALIDATION_TARGETS_ON_BOARD: CalibrationTarget[] = VALIDATION_TARGETS.map(
  ([file, rank], i) => ({
    id: `validation-${i + 1}`,
    fx: file / BOARD_SIZE,
    fy: rank / BOARD_SIZE,
    label: `${i + 1}/${VALIDATION_TARGETS.length}`,
  }),
)

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/**
 * Feature vector for one raw gaze point, in *board-normalised* coordinates
 * (0 at the board centre, +/-0.5 at its edges).
 *
 * Normalising matters: fitted on raw viewport pixels the quadratic design matrix
 * carries terms up to x^2 ~ 1e6, so X'X spans ~1e13 and the Gaussian elimination
 * below returns numerical noise while still looking solvable. It also makes the
 * ridge term mean the same thing for every screen size. `rect` is stored on the
 * model, so fit and apply always normalise against the same frame.
 */
function features(
  point: { x: number; y: number },
  kind: CalibrationModel['kind'],
  rect: BoardRect,
): number[] {
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const x = (point.x - (rect.left + width / 2)) / width
  const y = (point.y - (rect.top + height / 2)) / height
  if (kind === 'affine') return [x, y, 1]
  return [x, y, x * y, x * x, y * y, 1]
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, vector[i]])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]]

    const divisor = a[col][col]
    for (let j = col; j <= n; j++) a[col][j] /= divisor

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = a[row][col]
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j]
    }
  }

  return a.map((row) => row[n])
}

function fitAxis(
  rows: number[][],
  values: number[],
  ridge = 1e-4,
): number[] | null {
  const cols = rows[0]?.length ?? 0
  if (!cols || rows.length < cols) return null

  const xtx = Array.from({ length: cols }, () => Array.from({ length: cols }, () => 0))
  const xty = Array.from({ length: cols }, () => 0)

  rows.forEach((row, i) => {
    for (let a = 0; a < cols; a++) {
      xty[a] += row[a] * values[i]
      for (let b = 0; b < cols; b++) xtx[a][b] += row[a] * row[b]
    }
  })

  for (let i = 0; i < cols; i++) xtx[i][i] += ridge
  return solveLinearSystem(xtx, xty)
}

function fitModel(
  samples: CalibrationSample[],
  kind: CalibrationModel['kind'],
  boardRect: BoardRect,
  validation: CalibrationQuality,
): CalibrationModel | null {
  const rows = samples.map((sample) => features(sample.raw, kind, boardRect))
  const coefficientsX = fitAxis(
    rows,
    samples.map((sample) => sample.expected.x),
  )
  const coefficientsY = fitAxis(
    rows,
    samples.map((sample) => sample.expected.y),
  )
  if (!coefficientsX || !coefficientsY) return null

  return {
    version: 2,
    kind,
    coefficientsX,
    coefficientsY,
    boardRect,
    sampleCount: samples.length,
    validationErrorPx: validation.validationErrorPx,
    validationErrorSquares: validation.validationErrorSquares,
    qualityScore: validation.qualityScore,
    createdAt: Date.now(),
  }
}

function applyCoefficients(coefficients: number[], row: number[]): number {
  return row.reduce((sum, value, i) => sum + value * (coefficients[i] ?? 0), 0)
}

function scoreSamples(
  samples: CalibrationSample[],
  kind: CalibrationModel['kind'],
  coefficientsX: number[],
  coefficientsY: number[],
  boardRect: BoardRect,
): CalibrationQuality {
  if (!samples.length) {
    return {
      validationErrorPx: Number.POSITIVE_INFINITY,
      validationErrorSquares: Number.POSITIVE_INFINITY,
      qualityScore: 0,
      lowQuality: true,
    }
  }

  const errors = samples.map((sample) => {
    const row = features(sample.raw, kind, boardRect)
    const x = applyCoefficients(coefficientsX, row)
    const y = applyCoefficients(coefficientsY, row)
    return Math.hypot(x - sample.expected.x, y - sample.expected.y)
  })
  errors.sort((a, b) => a - b)
  const median = errors[Math.floor(errors.length / 2)] ?? 0
  const p75 = errors[Math.floor(errors.length * 0.75)] ?? median
  const errorPx = median * 0.65 + p75 * 0.35
  const squareEdge = Math.max(1, Math.min(boardRect.width, boardRect.height) / BOARD_SIZE)
  const errorSquares = errorPx / squareEdge
  const qualityScore = clamp01(1 - errorSquares / LOW_QUALITY_ERROR_SQUARES)

  return {
    validationErrorPx: errorPx,
    validationErrorSquares: errorSquares,
    qualityScore,
    lowQuality: errorSquares > LOW_QUALITY_ERROR_SQUARES,
  }
}

/** True when a fitted model missed by more than the reject line allows. */
export function isLowQualityModel(model: CalibrationModel | null): boolean {
  return !model || !(model.validationErrorSquares <= LOW_QUALITY_ERROR_SQUARES)
}

export function targetToViewport(target: CalibrationTarget, rect: BoardRect): { x: number; y: number } {
  return {
    x: rect.left + target.fx * rect.width,
    y: rect.top + target.fy * rect.height,
  }
}

export function createCalibrationSample(
  target: CalibrationTarget,
  raw: { x: number; y: number },
  boardRect: BoardRect,
): CalibrationSample {
  return {
    target,
    raw,
    expected: targetToViewport(target, boardRect),
    collectedAt: Date.now(),
  }
}

export function robustPoint(samples: Array<{ x: number; y: number }>): { x: number; y: number } | null {
  if (!samples.length) return null
  const median = (values: number[]) => {
    const sorted = values.slice().sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  const mx = median(samples.map((sample) => sample.x))
  const my = median(samples.map((sample) => sample.y))
  const ranked = samples
    .map((sample) => ({ sample, d: Math.hypot(sample.x - mx, sample.y - my) }))
    .sort((a, b) => a.d - b.d)
  const keep = ranked.slice(0, Math.max(3, Math.ceil(ranked.length * 0.7))).map((entry) => entry.sample)
  return {
    x: median(keep.map((sample) => sample.x)),
    y: median(keep.map((sample) => sample.y)),
  }
}

export function applyCalibrationModel(
  model: CalibrationModel | null,
  point: { x: number; y: number },
): { x: number; y: number } {
  if (!model) return point
  const row = features(point, model.kind, model.boardRect)
  return {
    x: applyCoefficients(model.coefficientsX, row),
    y: applyCoefficients(model.coefficientsY, row),
  }
}

export function buildCalibrationModel(
  fitSamples: CalibrationSample[],
  validationSamples: CalibrationSample[],
  boardRect: BoardRect,
): CalibrationModel | null {
  const affineRows = fitSamples.map((sample) => features(sample.raw, 'affine', boardRect))
  const affineX = fitAxis(
    affineRows,
    fitSamples.map((sample) => sample.expected.x),
  )
  const affineY = fitAxis(
    affineRows,
    fitSamples.map((sample) => sample.expected.y),
  )
  if (!affineX || !affineY) return null

  const validationSet = validationSamples.length ? validationSamples : fitSamples
  const affineQuality = scoreSamples(validationSet, 'affine', affineX, affineY, boardRect)
  let chosenKind: CalibrationModel['kind'] = 'affine'
  let chosenQuality = affineQuality

  if (fitSamples.length >= 12) {
    const quadraticRows = fitSamples.map((sample) => features(sample.raw, 'quadratic', boardRect))
    // Six features from sixteen noisy points: ridge harder than the affine fit so
    // the curvature terms cannot chase individual samples.
    const quadraticX = fitAxis(
      quadraticRows,
      fitSamples.map((sample) => sample.expected.x),
      1e-2,
    )
    const quadraticY = fitAxis(
      quadraticRows,
      fitSamples.map((sample) => sample.expected.y),
      1e-2,
    )

    if (quadraticX && quadraticY) {
      const quadraticQuality = scoreSamples(
        validationSet,
        'quadratic',
        quadraticX,
        quadraticY,
        boardRect,
      )
      if (
        Number.isFinite(quadraticQuality.validationErrorSquares) &&
        quadraticQuality.validationErrorSquares < affineQuality.validationErrorSquares * 0.82
      ) {
        chosenKind = 'quadratic'
        chosenQuality = quadraticQuality
      }
    }
  }

  return fitModel(fitSamples, chosenKind, boardRect, chosenQuality)
}

export function saveCalibrationModel(model: CalibrationModel): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(GAZE_CALIBRATION_STORAGE_KEY, JSON.stringify(model))
}

export function loadCalibrationModel(): CalibrationModel | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(GAZE_CALIBRATION_STORAGE_KEY)
    if (!raw) return null
    const model = JSON.parse(raw) as CalibrationModel
    if (
      model?.version !== 2 ||
      !Array.isArray(model.coefficientsX) ||
      !Array.isArray(model.coefficientsY) ||
      !model.boardRect
    ) {
      return null
    }
    return model
  } catch {
    return null
  }
}

export function clearCalibrationModel(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(GAZE_CALIBRATION_STORAGE_KEY)
}
