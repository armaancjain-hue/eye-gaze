import { toAlgebraic, toPosition } from './engine'
import type { GameState } from './types'

/**
 * FEN access.
 *
 * This module used to *construct* a FEN by walking the board grid and guessing
 * at the fields the grid cannot represent — castling rights inferred from where
 * pieces happened to be standing, an en-passant target reconstructed from the
 * last move, and a halfmove clock hardcoded to zero so the fifty-move rule could
 * never trigger. The position now carries its own FEN, so there is nothing to
 * infer and nothing to get wrong.
 */
export function boardToFen(gameState: GameState): string {
  return gameState.fen
}

export const coordsToSquare = toAlgebraic
export const squareToCoords = toPosition
export type { BoardPosition } from './types'
