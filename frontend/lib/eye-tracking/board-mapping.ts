import { BOARD_SIZE, COLUMN_LABELS } from '@/lib/chess/constants'
import type { BoardPosition } from '@/lib/chess/types'

/**
 * Chessboard <-> gaze coordinate mapping.
 *
 * The board is not a fixed rectangle: it resizes with the viewport and grows
 * when the side panels collapse. So rather than hit-testing the DOM with
 * `elementFromPoint` (which returns whatever happens to be painted on top, and
 * gives no notion of "how close to the middle of the square"), we read the
 * board's live bounding rectangle and do the arithmetic ourselves. That gives us
 * the sub-square offset the confidence estimate needs, and it keeps working when
 * an overlay sits above the board.
 */

export interface BoardGeometry {
  /** Viewport-space rect of the 8x8 playing area (labels excluded). */
  left: number
  top: number
  width: number
  height: number
  /** Edge length of one square in CSS pixels. */
  squareSize: number
}

/** Serialisable rect stored alongside a calibration model. */
export interface BoardRect {
  left: number
  top: number
  width: number
  height: number
}

const CORNER_START = '[data-square="0-0"]'
const CORNER_END = `[data-square="${BOARD_SIZE - 1}-${BOARD_SIZE - 1}"]`

/**
 * Measure the playing area from its two corner squares. Deriving it from the
 * squares themselves (rather than a wrapper element) means the rect excludes the
 * rank/file label gutters automatically, whatever the surrounding layout does.
 */
export function readBoardGeometry(): BoardGeometry | null {
  if (typeof document === 'undefined') return null
  const first = document.querySelector(CORNER_START)
  const last = document.querySelector(CORNER_END)
  if (!first || !last) return null

  const a = first.getBoundingClientRect()
  const b = last.getBoundingClientRect()
  const left = a.left
  const top = a.top
  const width = b.right - a.left
  const height = b.bottom - a.top
  if (!(width > 0) || !(height > 0)) return null

  return { left, top, width, height, squareSize: width / BOARD_SIZE }
}

let cached: BoardGeometry | null = null
let cachedAt = 0
const GEOMETRY_TTL_MS = 250

/**
 * Board geometry with a short TTL. The detection loop runs at frame rate and
 * `getBoundingClientRect` forces layout, so re-measuring every frame would cost
 * more than the board can possibly move in 250ms.
 */
export function getBoardGeometry(now = performance.now()): BoardGeometry | null {
  if (cached && now - cachedAt < GEOMETRY_TTL_MS) return cached
  cached = readBoardGeometry()
  cachedAt = now
  return cached
}

/** Force the next read to re-measure (call after a layout change). */
export function invalidateBoardGeometry(): void {
  cached = null
  cachedAt = 0
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', invalidateBoardGeometry)
}

export function toBoardRect(geom: BoardGeometry): BoardRect {
  return { left: geom.left, top: geom.top, width: geom.width, height: geom.height }
}

/** Centre of a square in viewport pixels. */
export function squareCenter(geom: BoardGeometry, row: number, col: number): { x: number; y: number } {
  return {
    x: geom.left + (col + 0.5) * (geom.width / BOARD_SIZE),
    y: geom.top + (row + 0.5) * (geom.height / BOARD_SIZE),
  }
}

/** Map a fraction of the board rect (0..1 on each axis) to viewport pixels. */
export function boardFractionToViewport(
  geom: BoardGeometry,
  fx: number,
  fy: number,
): { x: number; y: number } {
  return { x: geom.left + fx * geom.width, y: geom.top + fy * geom.height }
}

export interface SquareHit {
  square: BoardPosition
  /** Distance from the square's centre, in units of one square edge. */
  centerDistance: number
  /** Board-relative coordinates, 0..8 along each axis (may fall outside). */
  fileCoord: number
  rankCoord: number
}

/**
 * Resolve a viewport point to a square.
 *
 * `tolerance` is how far outside the board (in squares) a point may fall and
 * still be clamped onto the edge square. A small tolerance is what keeps the
 * a-file and the back rank usable: gaze error is roughly constant in pixels, so
 * edge squares would otherwise be systematically under-selected.
 */
export function pointToSquare(
  x: number,
  y: number,
  geom: BoardGeometry,
  tolerance = 0.5,
): SquareHit | null {
  const fileCoord = ((x - geom.left) / geom.width) * BOARD_SIZE
  const rankCoord = ((y - geom.top) / geom.height) * BOARD_SIZE

  if (
    fileCoord < -tolerance ||
    fileCoord > BOARD_SIZE + tolerance ||
    rankCoord < -tolerance ||
    rankCoord > BOARD_SIZE + tolerance
  ) {
    return null
  }

  const col = Math.min(BOARD_SIZE - 1, Math.max(0, Math.floor(fileCoord)))
  const row = Math.min(BOARD_SIZE - 1, Math.max(0, Math.floor(rankCoord)))
  const centerDistance = Math.hypot(fileCoord - (col + 0.5), rankCoord - (row + 0.5))

  return { square: { row, col }, centerDistance, fileCoord, rankCoord }
}

/** `{row: 0, col: 0}` is a8 — row 0 is the top rank as rendered. */
export function toAlgebraic(pos: BoardPosition): string {
  const file = COLUMN_LABELS[pos.col] ?? '?'
  return `${file}${BOARD_SIZE - pos.row}`
}

export function sameSquare(a: BoardPosition | null, b: BoardPosition | null): boolean {
  return !!a && !!b && a.row === b.row && a.col === b.col
}

/**
 * How much larger (or smaller) the board is now than when it was calibrated.
 * Returns 1 when they match, or null when either rect is unknown.
 *
 * `remapForBoard` keeps a modest layout shift honest, but it cannot rescue a
 * large one: play-time gaze angles then fall outside the range the model was
 * ever shown, and the prediction becomes extrapolation. Past roughly 15% the
 * only real fix is to calibrate again at the size being played on.
 */
export function boardScaleRatio(from: BoardRect | null, to: BoardGeometry | null): number | null {
  if (!from || !to || !(from.width > 0) || !(to.width > 0)) return null
  return to.width / from.width
}

/**
 * Re-anchor a gaze prediction from the board rect it was calibrated against to
 * the board's current rect. Calibration targets were placed relative to the
 * board, so when the board moves or resizes (a side panel collapses, the window
 * is resized) the whole mapping should follow it instead of forcing the user to
 * recalibrate. Falls back to the identity when either rect is unusable.
 */
export function remapForBoard(
  point: { x: number; y: number },
  from: BoardRect | null,
  to: BoardGeometry | null,
): { x: number; y: number } {
  if (!from || !to) return point
  if (!(from.width > 0) || !(from.height > 0)) return point

  const sx = to.width / from.width
  const sy = to.height / from.height
  // Ignore imperceptible differences so a 1px layout shimmer can't add noise.
  if (
    Math.abs(sx - 1) < 0.005 &&
    Math.abs(sy - 1) < 0.005 &&
    Math.abs(to.left - from.left) < 2 &&
    Math.abs(to.top - from.top) < 2
  ) {
    return point
  }

  return {
    x: to.left + (point.x - from.left) * sx,
    y: to.top + (point.y - from.top) * sy,
  }
}
