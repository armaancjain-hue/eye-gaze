import { Chess } from 'chess.js'
import { advance, toAlgebraic, toPosition } from './engine'
import type { GameState } from './types'

/**
 * Apply a UCI move from the engine, e.g. "e2e4", "e7e8q", "e1g1".
 *
 * This used to replay the move by hand precisely because the frontend's rules
 * did not understand castling or en passant — it had to special-case rook
 * relocation and the vanishing en-passant pawn itself. chess.js knows all of
 * that, so the move is simply played, and validated on the way through: a
 * garbled or out-of-date engine reply now fails cleanly instead of silently
 * corrupting the position.
 */
export function applyUciMove(gameState: GameState, uci: string): GameState | null {
  if (!uci || uci.length < 4) return null

  let chess: Chess
  try {
    chess = new Chess(gameState.fen)
  } catch {
    return null
  }

  try {
    const applied = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      // UCI spells promotion as a trailing piece letter; absent means no promotion.
      promotion: uci.length >= 5 ? uci[4].toLowerCase() : undefined,
    })
    if (!applied) return null
    return advance(gameState, chess, applied)
  } catch {
    return null
  }
}

export { toAlgebraic as coordsToSquare, toPosition as squareToCoords }
