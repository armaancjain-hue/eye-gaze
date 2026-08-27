import type { BoardPosition } from '@/lib/chess/types'
import {
  pointToSquare,
  sameSquare,
  type BoardGeometry,
} from './board-mapping'

/**
 * Turns a noisy stream of gaze points into a stable square decision.
 *
 * Even a well-calibrated gaze estimate wanders by a fraction of a square from
 * frame to frame, and the eye itself makes involuntary micro-saccades during a
 * fixation. Classifying each frame independently would therefore flicker between
 * neighbouring squares many times a second. Three stages fix that:
 *
 *   1. temporal smoothing — a median over a short window of board coordinates,
 *      which rejects outlier frames outright rather than averaging them in;
 *   2. majority voting — the winning square must own a clear majority of the
 *      confidence-weighted votes in the window, otherwise no square is reported;
 *   3. dwell — the winner must hold for the full dwell period before it commits,
 *      with a short grace period so a blink doesn't restart the countdown.
 */

export interface StabilizerOptions {
  /** How long the winning square must hold before it commits (ms). */
  dwellMs: number
  /** Length of the voting window (ms). */
  voteWindowMs: number
  /** Fraction of weighted votes the winner needs to count as stable. */
  minVoteFraction: number
  /** Extra evidence needed before switching away from the current dwell target. */
  switchVoteFraction: number
  /** Confidence a square must reach for its dwell to be allowed to commit. */
  minCommitConfidence: number
  /** How far outside the board a point may stray, in squares. */
  edgeTolerance: number
  /** 0..1 quality of the active calibration; scales the reported confidence. */
  calibrationScore: number
}

export const DEFAULT_STABILIZER_OPTIONS: StabilizerOptions = {
  dwellMs: 700,
  // ~300ms holds roughly 10 frames at 30fps: long enough for a majority to be
  // meaningful, short enough that switching squares still feels immediate.
  voteWindowMs: 300,
  minVoteFraction: 0.6,
  switchVoteFraction: 0.72,
  minCommitConfidence: 0.45,
  edgeTolerance: 0.45,
  calibrationScore: 0.6,
}

/** A square that has already been voted stable, with its supporting evidence. */
export interface StabilizerResult {
  /** The stable square, or null when the vote is inconclusive / off-board. */
  square: BoardPosition | null
  /** 0..1 overall trust in this square. */
  confidence: number
  /** 0..1 progress toward committing the current square. */
  dwellProgress: number
  /** Set for exactly one update when a dwell completes. */
  committed: BoardPosition | null
  /** Share of weighted votes held by the winner, 0..1. */
  voteFraction: number
  /** True while the smoothed gaze is over the board at all. */
  onBoard: boolean
}

const EMPTY_RESULT: StabilizerResult = {
  square: null,
  confidence: 0,
  dwellProgress: 0,
  committed: null,
  voteFraction: 0,
  onBoard: false,
}

interface VoteEntry {
  t: number
  file: number
  rank: number
  square: BoardPosition | null
  /**
   * Where that square was drawn. The smoothed gaze coordinates live in drawing
   * space, so the sub-square offset has to be measured against the drawn cell —
   * comparing it to the logical square works only while the board happens to be
   * white-at-the-bottom, and silently collapses the confidence score when the
   * board is flipped.
   */
  cell: BoardPosition | null
  weight: number
}

/**
 * The stable square may briefly go unresolved (a blink, a fast look-away and
 * back). Dropping the dwell instantly on the first such frame makes selection
 * feel like it keeps "losing its place", so we hold the target this long.
 */
const DWELL_GRACE_MS = 220

/** Frames with worse signal than this are not worth voting with at all. */
const MIN_FRAME_CONFIDENCE = 0.15

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export class SquareStabilizer {
  private votes: VoteEntry[] = []
  private options: StabilizerOptions
  /** The square the dwell timer is currently counting against. */
  private target: BoardPosition | null = null
  private dwellStart = 0
  private lastStableAt = 0
  /** Committed square, held until the gaze leaves it, so it can't re-fire. */
  private latched: BoardPosition | null = null

  constructor(options: Partial<StabilizerOptions> = {}) {
    this.options = { ...DEFAULT_STABILIZER_OPTIONS, ...options }
  }

  configure(options: Partial<StabilizerOptions>): void {
    this.options = { ...this.options, ...options }
  }

  reset(): void {
    this.votes = []
    this.target = null
    this.dwellStart = 0
    this.lastStableAt = 0
    this.latched = null
  }

  /**
   * Feed one gaze sample. `frameConfidence` is the tracker's own 0..1 belief in
   * this frame (it collapses during blinks and face loss), and is used as the
   * vote weight so unreliable frames influence the outcome proportionally less.
   */
  update(
    now: number,
    gaze: { x: number; y: number },
    geometry: BoardGeometry | null,
    frameConfidence: number,
  ): StabilizerResult {
    if (!geometry) {
      this.reset()
      return EMPTY_RESULT
    }

    const hit = pointToSquare(gaze.x, gaze.y, geometry, this.options.edgeTolerance)
    const weight = Math.max(0, frameConfidence)
    if (weight >= MIN_FRAME_CONFIDENCE) {
      this.votes.push({
        t: now,
        file: hit?.fileCoord ?? Number.NaN,
        rank: hit?.rankCoord ?? Number.NaN,
        square: hit?.square ?? null,
        cell: hit?.cell ?? null,
        weight,
      })
    }

    // Evict everything outside the voting window.
    const cutoff = now - this.options.voteWindowMs
    while (this.votes.length && this.votes[0].t < cutoff) this.votes.shift()

    if (this.votes.length === 0) {
      return this.decayed(now)
    }

    // --- Stage 1: temporal smoothing of the board coordinate -----------------
    // A median (not a mean) so one frame thrown across the board by a blink or a
    // momentary landmark failure cannot drag the estimate with it.
    const onBoardVotes = this.votes.filter((v) => Number.isFinite(v.file))
    const smoothedFile = onBoardVotes.length ? median(onBoardVotes.map((v) => v.file)) : Number.NaN
    const smoothedRank = onBoardVotes.length ? median(onBoardVotes.map((v) => v.rank)) : Number.NaN

    // --- Stage 2: confidence-weighted majority vote --------------------------
    const tally = new Map<
      string,
      { square: BoardPosition; cell: BoardPosition | null; weight: number }
    >()
    let totalWeight = 0
    let offBoardWeight = 0
    for (const v of this.votes) {
      totalWeight += v.weight
      if (!v.square) {
        offBoardWeight += v.weight
        continue
      }
      const key = `${v.square.row}-${v.square.col}`
      const entry = tally.get(key)
      if (entry) entry.weight += v.weight
      else tally.set(key, { square: v.square, cell: v.cell, weight: v.weight })
    }

    let winner: BoardPosition | null = null
    let winnerCell: BoardPosition | null = null
    let winnerWeight = 0
    let targetWeight = 0
    tally.forEach((entry) => {
      if (entry.weight > winnerWeight) {
        winnerWeight = entry.weight
        winner = entry.square
        winnerCell = entry.cell
      }
      if (sameSquare(this.target, entry.square)) targetWeight = entry.weight
    })

    let voteFraction = totalWeight > 0 ? winnerWeight / totalWeight : 0
    const targetVoteFraction = totalWeight > 0 ? targetWeight / totalWeight : 0
    const onBoard = totalWeight > 0 && offBoardWeight < totalWeight / 2

    // Hysteresis: when the gaze hovers on a boundary, the current dwell target
    // keeps ownership until the new square has a stronger-than-normal majority.
    if (
      this.target &&
      winner &&
      !sameSquare(this.target, winner) &&
      targetVoteFraction >= 0.34 &&
      voteFraction < this.options.switchVoteFraction
    ) {
      const targetEntry = Array.from(tally.values()).find((entry) =>
        sameSquare(entry.square, this.target),
      )
      if (targetEntry) {
        winner = targetEntry.square
        winnerCell = targetEntry.cell
        winnerWeight = targetEntry.weight
        voteFraction = targetVoteFraction
      }
    }

    const stable = winner !== null && voteFraction >= this.options.minVoteFraction

    // --- Confidence ----------------------------------------------------------
    const confidence = stable
      ? this.scoreConfidence(winnerCell, voteFraction, smoothedFile, smoothedRank, totalWeight)
      : 0

    // --- Stage 3: dwell ------------------------------------------------------
    if (!stable) {
      return this.decayed(now, { voteFraction, onBoard })
    }

    this.lastStableAt = now

    // The gaze left the committed square: allow it to be selected again later.
    if (this.latched && !sameSquare(this.latched, winner)) this.latched = null

    if (!sameSquare(this.target, winner)) {
      this.target = winner
      this.dwellStart = now
    }

    if (sameSquare(this.latched, winner)) {
      return { square: winner, confidence, dwellProgress: 1, committed: null, voteFraction, onBoard }
    }

    const progress = clamp01((now - this.dwellStart) / Math.max(1, this.options.dwellMs))
    let committed: BoardPosition | null = null
    if (progress >= 1 && confidence >= this.options.minCommitConfidence) {
      committed = winner
      this.latched = winner
    }

    return { square: winner, confidence, dwellProgress: progress, committed, voteFraction, onBoard }
  }

  /**
   * No stable winner this update. Keep the existing dwell alive briefly so a
   * blink or a single bad frame doesn't reset it, then let it lapse.
   */
  private decayed(
    now: number,
    extra: { voteFraction?: number; onBoard?: boolean } = {},
  ): StabilizerResult {
    const withinGrace = this.target !== null && now - this.lastStableAt <= DWELL_GRACE_MS
    if (!withinGrace) {
      this.target = null
      this.dwellStart = 0
      return { ...EMPTY_RESULT, ...extra }
    }
    const progress = clamp01((now - this.dwellStart) / Math.max(1, this.options.dwellMs))
    return {
      square: this.target,
      // Held on grace, not on evidence — report it as a weak reading so the UI
      // (and the commit threshold) treat it as the guess it is.
      confidence: 0.25,
      dwellProgress: progress,
      committed: null,
      voteFraction: extra.voteFraction ?? 0,
      onBoard: extra.onBoard ?? false,
    }
  }

  /**
   * Combine the independent things that can each undermine a square decision:
   * how united the vote was, how centred the gaze sits within the square, how
   * good the raw signal is, and how accurate the calibration measured itself to
   * be. A weighted geometric mean means any one of them being bad drags the
   * result down — which is the honest behaviour, since they are not substitutes
   * for each other.
   */
  private scoreConfidence(
    /** The winning square's *drawn* cell — same space as the smoothed gaze. */
    winnerCell: BoardPosition | null,
    voteFraction: number,
    smoothedFile: number,
    smoothedRank: number,
    totalWeight: number,
  ): number {
    const vote = clamp01(voteFraction)

    // Distance from the cell's centre, in squares. 0 at the centre, ~0.71 at
    // a corner — near a boundary the neighbour is a live possibility.
    let spatial = 0.5
    if (winnerCell && Number.isFinite(smoothedFile) && Number.isFinite(smoothedRank)) {
      const dx = smoothedFile - (winnerCell.col + 0.5)
      const dy = smoothedRank - (winnerCell.row + 0.5)
      spatial = clamp01(1 - Math.hypot(dx, dy) / 0.75)
    }

    const signal = clamp01(totalWeight / Math.max(1, this.votes.length))
    const calibration = clamp01(this.options.calibrationScore)

    const terms: [number, number][] = [
      [vote, 0.35],
      [spatial, 0.25],
      [signal, 0.2],
      [calibration, 0.2],
    ]
    let logSum = 0
    for (const [value, w] of terms) logSum += w * Math.log(Math.max(value, 1e-3))
    return clamp01(Math.exp(logSum))
  }
}
