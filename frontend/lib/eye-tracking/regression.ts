/**
 * A tiny, dependency-free regression toolkit for gaze calibration.
 *
 * The model is deliberately small enough to fit and evaluate in a few
 * milliseconds in the browser, on the ~150 samples a calibration sequence
 * produces, while still being a real (regularised, cross-validated) fit rather
 * than a hand-tuned linear gain:
 *
 *   1. standardise every basis column (so ridge penalises comparable scales),
 *   2. ridge regression per axis, with lambda chosen by grouped k-fold CV,
 *   3. an RBF residual correction anchored at the calibration points, which
 *      soaks up the smooth person-specific distortion the global fit misses.
 *
 * Step 3 is only kept when leave-one-point-out validation says it helps, so a
 * noisy calibration can never make the model worse than the plain ridge fit.
 */

export interface RidgeModel {
  /** Column means of the training design matrix. */
  mean: number[]
  /** Column standard deviations (>= epsilon). */
  std: number[]
  /**
   * Which columns actually varied during calibration. A column that did not is
   * dropped: dividing its deviation by a near-zero standard deviation would turn
   * any later change in it into an enormous standardised value, so a term the fit
   * could never have learned would end up dominating every prediction.
   */
  active: boolean[]
  /**
   * Per-column yardstick for judging how unusual a later value is. It differs
   * from `std` because a column that barely moved during calibration still needs
   * a *meaningful* scale to be measured against: a feature that was frozen while
   * calibrating and then moves is the strongest out-of-distribution signal there
   * is, and dividing by its (near-zero) standard deviation would either explode
   * or, if skipped, hide it entirely.
   */
  noveltyStd: number[]
  /** Weights over [bias, standardised columns...]; length = mean.length + 1. */
  weights: number[]
}

/** One calibration point's mean residual, in standardised feature space. */
export interface ResidualAnchor {
  z: number[]
  dx: number
  dy: number
}

export interface TwoAxisModel {
  x: RidgeModel
  y: RidgeModel
  anchors: ResidualAnchor[]
  /** RBF bandwidth in standardised-feature units. */
  bandwidth: number
  /** 0 disables the residual correction entirely. */
  residualGain: number
}

export interface ValidationStats {
  medianErrorPx: number
  p90ErrorPx: number
  medianErrorXPx: number
  medianErrorYPx: number
}

const LAMBDA_GRID = [1e-4, 1e-3, 1e-2, 3e-2, 1e-1, 3e-1, 1, 3, 10]
const RESIDUAL_GAINS = [0, 0.35, 0.7, 1]

// --- Linear algebra -------------------------------------------------------

/** Solve A·x = b by Gaussian elimination with partial pivoting; null if singular. */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = A.map((row) => row.slice())
  const y = b.slice()

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    if (pivot !== col) {
      ;[m[col], m[pivot]] = [m[pivot], m[col]]
      ;[y[col], y[pivot]] = [y[pivot], y[col]]
    }
    for (let row = col + 1; row < n; row++) {
      const factor = m[row][col] / m[col][col]
      if (factor === 0) continue
      for (let k = col; k < n; k++) m[row][k] -= factor * m[col][k]
      y[row] -= factor * y[col]
    }
  }

  const x = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = y[row]
    for (let k = row + 1; k < n; k++) sum -= m[row][k] * x[k]
    x[row] = sum / m[row][row]
  }
  return x.every(Number.isFinite) ? x : null
}

// --- Standardisation ------------------------------------------------------

interface Standardiser {
  mean: number[]
  std: number[]
  active: boolean[]
  noveltyStd: number[]
}

/**
 * Standardised values are clamped to this many deviations. Training data never
 * reaches it, so the fit is untouched; at prediction time it bounds how far the
 * model will extrapolate when the user has moved outside the pose and distance
 * they calibrated at. Without it a single drifting feature can throw the
 * prediction clean off the screen.
 */
const Z_CLAMP = 4

function fitStandardiser(rows: number[][]): Standardiser {
  const d = rows[0].length
  const mean = new Array<number>(d).fill(0)
  const std = new Array<number>(d).fill(0)
  const scale = new Array<number>(d).fill(0)

  for (const row of rows) {
    for (let i = 0; i < d; i++) {
      mean[i] += row[i]
      scale[i] += Math.abs(row[i])
    }
  }
  for (let i = 0; i < d; i++) {
    mean[i] /= rows.length
    scale[i] /= rows.length
  }

  for (const row of rows) {
    for (let i = 0; i < d; i++) {
      const dev = row[i] - mean[i]
      std[i] += dev * dev
    }
  }

  const active = new Array<boolean>(d).fill(true)
  const noveltyStd = new Array<number>(d).fill(1)
  for (let i = 0; i < d; i++) {
    const sd = Math.sqrt(std[i] / rows.length)
    // "Did not vary" is relative to the column's own magnitude — the features
    // live on wildly different scales, so a single absolute threshold would
    // wrongly drop small-valued but perfectly informative columns.
    active[i] = sd > 1e-9 + 1e-3 * scale[i]
    std[i] = active[i] ? sd : 1
    // A movement of 5% of the column's own magnitude counts as a real change
    // even when the observed spread was smaller than that.
    noveltyStd[i] = Math.max(sd, 0.05 * scale[i], 1e-9)
  }

  return { mean, std, active, noveltyStd }
}

export function standardise(row: number[], s: Standardiser): number[] {
  const z = new Array<number>(row.length)
  for (let i = 0; i < row.length; i++) {
    if (s.active && !s.active[i]) {
      z[i] = 0
      continue
    }
    const raw = (row[i] - s.mean[i]) / s.std[i]
    z[i] = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, raw))
  }
  return z
}

/**
 * How far outside the calibrated distribution a descriptor sits, 0..1.
 *
 * The model only knows the range of poses and distances it was calibrated over.
 * When the player leans in, turns, or sits differently than they did during
 * calibration, the prediction is extrapolation and deserves to be trusted less —
 * this is what lets the pipeline *say so* instead of quietly reporting a wrong
 * square with full confidence.
 */
export function noveltyScore(model: RidgeModel, row: number[]): number {
  const yardstick = model.noveltyStd
  if (!yardstick) return 0
  // The *worst* column decides, not the average: one feature far outside its
  // calibrated range is enough to invalidate the prediction, and averaging it
  // against a dozen well-behaved columns would dilute it into invisibility.
  let worst = 0
  for (let i = 0; i < row.length; i++) {
    const z = Math.abs(row[i] - model.mean[i]) / yardstick[i]
    if (z > worst) worst = z
  }
  // Calibration data sits within a couple of deviations by construction.
  return Math.max(0, Math.min(1, (worst - 3) / 4))
}

// --- Ridge regression -----------------------------------------------------

/**
 * Fit w minimising ||Zw - y||² + λ||w_{1..d}||², where Z is the standardised
 * design matrix with a leading bias column. The bias is left unpenalised so the
 * fit is free to centre itself on the screen.
 */
function fitRidgeStandardised(
  Z: number[][],
  y: number[],
  s: Standardiser,
  lambda: number,
): RidgeModel | null {
  const d = Z[0].length
  const n = d + 1 // + bias
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const b = new Array<number>(n).fill(0)

  for (let r = 0; r < Z.length; r++) {
    const row = Z[r]
    const t = y[r]
    // Index 0 is the implicit bias term (value 1).
    b[0] += t
    A[0][0] += 1
    for (let i = 0; i < d; i++) {
      A[0][i + 1] += row[i]
      A[i + 1][0] += row[i]
      b[i + 1] += row[i] * t
      for (let j = 0; j < d; j++) A[i + 1][j + 1] += row[i] * row[j]
    }
  }
  for (let i = 1; i < n; i++) A[i][i] += lambda

  const weights = solveLinearSystem(A, b)
  if (!weights) return null
  return { mean: s.mean, std: s.std, active: s.active, noveltyStd: s.noveltyStd, weights }
}

export function predictRidge(model: RidgeModel, row: number[]): number {
  const z = standardise(row, model)
  let sum = model.weights[0]
  for (let i = 0; i < z.length; i++) sum += model.weights[i + 1] * z[i]
  return sum
}

// --- Residual correction --------------------------------------------------

/**
 * Group the training residuals by calibration point and keep one anchor per
 * point. Sixteen anchors is enough to describe the smooth, person-specific
 * warp the global polynomial can't express, and cheap enough to evaluate every
 * frame.
 */
function buildAnchors(
  Z: number[][],
  groups: number[],
  residX: number[],
  residY: number[],
): ResidualAnchor[] {
  const byGroup = new Map<number, { z: number[]; dx: number; dy: number; n: number }>()
  for (let i = 0; i < Z.length; i++) {
    const g = groups[i]
    let acc = byGroup.get(g)
    if (!acc) {
      acc = { z: new Array<number>(Z[i].length).fill(0), dx: 0, dy: 0, n: 0 }
      byGroup.set(g, acc)
    }
    for (let k = 0; k < Z[i].length; k++) acc.z[k] += Z[i][k]
    acc.dx += residX[i]
    acc.dy += residY[i]
    acc.n += 1
  }

  const anchors: ResidualAnchor[] = []
  byGroup.forEach((acc) => {
    anchors.push({
      z: acc.z.map((v) => v / acc.n),
      dx: acc.dx / acc.n,
      dy: acc.dy / acc.n,
    })
  })
  return anchors
}

/** Median nearest-neighbour spacing: a scale-free default RBF bandwidth. */
function anchorBandwidth(anchors: ResidualAnchor[]): number {
  if (anchors.length < 2) return 1
  const nearest: number[] = []
  for (let i = 0; i < anchors.length; i++) {
    let best = Infinity
    for (let j = 0; j < anchors.length; j++) {
      if (i === j) continue
      best = Math.min(best, distance(anchors[i].z, anchors[j].z))
    }
    if (Number.isFinite(best)) nearest.push(best)
  }
  return Math.max(median(nearest), 1e-3)
}

function distance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

/** Gaussian-weighted mean of the anchor residuals near a standardised point. */
export function residualCorrection(
  anchors: ResidualAnchor[],
  bandwidth: number,
  z: number[],
): { dx: number; dy: number } {
  if (anchors.length === 0) return { dx: 0, dy: 0 }
  const denomScale = 2 * bandwidth * bandwidth
  let wSum = 0
  let dx = 0
  let dy = 0
  for (const a of anchors) {
    const d = distance(a.z, z)
    const w = Math.exp(-(d * d) / denomScale)
    wSum += w
    dx += w * a.dx
    dy += w * a.dy
  }
  // The +1 keeps the correction from being extrapolated at full strength far
  // from every anchor: out there the weights are tiny and the correction fades
  // to zero, leaving the plain ridge prediction.
  const denom = wSum + 1e-3
  const fade = wSum / (wSum + 1)
  return { dx: (dx / denom) * fade, dy: (dy / denom) * fade }
}

// --- Fitting + validation -------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const midIdx = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[midIdx] : (sorted[midIdx - 1] + sorted[midIdx]) / 2
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[idx]
}

interface FittedCore {
  x: RidgeModel
  y: RidgeModel
  anchors: ResidualAnchor[]
  bandwidth: number
}

function fitCore(
  rows: number[][],
  targetsX: number[],
  targetsY: number[],
  groups: number[],
  lambda: number,
): FittedCore | null {
  const s = fitStandardiser(rows)
  const Z = rows.map((r) => standardise(r, s))
  const mx = fitRidgeStandardised(Z, targetsX, s, lambda)
  const my = fitRidgeStandardised(Z, targetsY, s, lambda)
  if (!mx || !my) return null

  const residX: number[] = []
  const residY: number[] = []
  for (let i = 0; i < rows.length; i++) {
    residX.push(targetsX[i] - predictRidge(mx, rows[i]))
    residY.push(targetsY[i] - predictRidge(my, rows[i]))
  }
  const anchors = buildAnchors(Z, groups, residX, residY)
  return { x: mx, y: my, anchors, bandwidth: anchorBandwidth(anchors) }
}

function predictCore(
  core: FittedCore,
  row: number[],
  residualGain: number,
): { x: number; y: number } {
  const x = predictRidge(core.x, row)
  const y = predictRidge(core.y, row)
  if (residualGain === 0) return { x, y }
  const z = standardise(row, core.x)
  const corr = residualCorrection(core.anchors, core.bandwidth, z)
  return { x: x + residualGain * corr.dx, y: y + residualGain * corr.dy }
}

/**
 * Leave-one-calibration-point-out validation. Holding out whole *points* (not
 * random samples) is the only honest measure here: samples from the same point
 * are near-duplicates, so a random split would report an accuracy the user will
 * never see when they look somewhere new.
 */
function validate(
  rows: number[][],
  targetsX: number[],
  targetsY: number[],
  groups: number[],
  lambda: number,
  residualGain: number,
): ValidationStats | null {
  const uniqueGroups = Array.from(new Set(groups))
  if (uniqueGroups.length < 3) return null

  const errors: number[] = []
  const errX: number[] = []
  const errY: number[] = []

  for (const held of uniqueGroups) {
    const trIdx: number[] = []
    const teIdx: number[] = []
    for (let i = 0; i < groups.length; i++) {
      if (groups[i] === held) teIdx.push(i)
      else trIdx.push(i)
    }
    if (trIdx.length < rows[0].length + 2) return null

    const core = fitCore(
      trIdx.map((i) => rows[i]),
      trIdx.map((i) => targetsX[i]),
      trIdx.map((i) => targetsY[i]),
      trIdx.map((i) => groups[i]),
      lambda,
    )
    if (!core) return null

    for (const i of teIdx) {
      const p = predictCore(core, rows[i], residualGain)
      const dx = p.x - targetsX[i]
      const dy = p.y - targetsY[i]
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
      errors.push(Math.hypot(dx, dy))
      errX.push(Math.abs(dx))
      errY.push(Math.abs(dy))
    }
  }

  return {
    medianErrorPx: median(errors),
    p90ErrorPx: quantile(errors, 0.9),
    medianErrorXPx: median(errX),
    medianErrorYPx: median(errY),
  }
}

export interface FitResult {
  model: TwoAxisModel
  stats: ValidationStats
  lambda: number
}

/**
 * Fit the two-axis gaze model, selecting the ridge strength and whether to keep
 * the residual correction by cross-validation over the calibration points.
 */
export function fitTwoAxisModel(
  rows: number[][],
  targetsX: number[],
  targetsY: number[],
  groups: number[],
): FitResult | null {
  if (rows.length === 0) return null
  const d = rows[0].length
  // Ridge tolerates n < d, but with fewer samples than terms the validation
  // below has nothing left to hold out, so we'd be reporting fiction.
  if (rows.length < d + 4) return null

  let best: { lambda: number; gain: number; stats: ValidationStats } | null = null
  for (const lambda of LAMBDA_GRID) {
    for (const gain of RESIDUAL_GAINS) {
      const stats = validate(rows, targetsX, targetsY, groups, lambda, gain)
      if (!stats) continue
      if (!best || stats.medianErrorPx < best.stats.medianErrorPx) {
        best = { lambda, gain, stats }
      }
    }
  }
  if (!best) return null

  const core = fitCore(rows, targetsX, targetsY, groups, best.lambda)
  if (!core) return null

  return {
    model: {
      x: core.x,
      y: core.y,
      anchors: core.anchors,
      bandwidth: core.bandwidth,
      residualGain: best.gain,
    },
    stats: best.stats,
    lambda: best.lambda,
  }
}

/** Apply a fitted two-axis model to one basis row. */
export function predictTwoAxis(model: TwoAxisModel, row: number[]): { x: number; y: number } {
  const x = predictRidge(model.x, row)
  const y = predictRidge(model.y, row)
  if (!model.residualGain || model.anchors.length === 0) return { x, y }
  const z = standardise(row, model.x)
  const corr = residualCorrection(model.anchors, model.bandwidth, z)
  return { x: x + model.residualGain * corr.dx, y: y + model.residualGain * corr.dy }
}
