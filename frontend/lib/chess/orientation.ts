import { BOARD_SIZE } from './constants'
import type { BoardPosition } from './types'

/**
 * Which way round the board is drawn.
 *
 * The game model never changes: row 0 is always rank 8, col 0 is always the
 * a-file. Orientation affects *only* where a square is painted, so flipping the
 * board cannot alter the position, the move list, or an existing calibration —
 * gaze is calibrated to screen coordinates, and the board's rectangle on screen
 * is identical either way.
 */
export type BoardOrientation = 'white-bottom' | 'white-top'

export const DEFAULT_ORIENTATION: BoardOrientation = 'white-top'

/**
 * Visual cell -> logical square, and its own inverse.
 *
 * A flip is a true 180° rotation, so both axes invert together: files run h..a
 * across the top as well as ranks running 1..8 down. Mirroring only the ranks
 * would leave a board that no chess player recognises, with the white king to
 * the left of his queen.
 */
export function flip(pos: BoardPosition, orientation: BoardOrientation): BoardPosition {
  if (orientation === 'white-bottom') return pos
  return { row: BOARD_SIZE - 1 - pos.row, col: BOARD_SIZE - 1 - pos.col }
}

/** Logical square -> the cell index it is drawn at. */
export const toVisual = flip
/** Drawn cell -> the logical square it represents. */
export const toLogical = flip

export function isOrientation(value: unknown): value is BoardOrientation {
  return value === 'white-bottom' || value === 'white-top'
}
