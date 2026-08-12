import { GameState, Move, Piece, PieceType } from './types'
import { squareToCoords, coordsToSquare } from './fen'
import { getPieceNotation } from './engine'

/**
 * Apply a UCI move (e.g. "e2e4", "e7e8q", "e1g1", "e5d6") from the engine to
 * the board grid. Unlike `makeMove`, this does NOT re-validate legality — the
 * backend engine is the source of truth, and the frontend's simplified rules
 * don't understand castling/en passant. Returns a new GameState, or null if the
 * move can't be parsed / has no piece at the origin.
 */
export function applyUciMove(gameState: GameState, uci: string): GameState | null {
  if (!uci || uci.length < 4) return null

  const from = squareToCoords(uci.slice(0, 2))
  const to = squareToCoords(uci.slice(2, 4))
  const promo = uci.length >= 5 ? (uci[4].toUpperCase() as PieceType) : null

  const piece = gameState.board[from.row]?.[from.col]
  if (!piece) return null

  const newBoard = gameState.board.map((row) => [...row])
  let captured: Piece | null = newBoard[to.row][to.col]

  // Move the piece.
  newBoard[to.row][to.col] = piece
  newBoard[from.row][from.col] = null

  // En passant: a pawn moving diagonally onto an empty square captures the
  // pawn sitting beside the origin square (same rank as `from`).
  if (piece.type === 'P' && from.col !== to.col && captured === null) {
    const epCaptured = newBoard[from.row][to.col]
    if (epCaptured) {
      captured = epCaptured
      newBoard[from.row][to.col] = null
    }
  }

  // Promotion (default to queen if the engine omitted the suffix).
  if (piece.type === 'P' && (to.row === 0 || to.row === 7)) {
    newBoard[to.row][to.col] = { ...piece, type: promo ?? 'Q' }
  }

  // Castling: the king moves two files; bring the rook alongside it.
  if (piece.type === 'K' && Math.abs(to.col - from.col) === 2) {
    if (to.col === 6) {
      // Kingside: rook h-file -> f-file.
      newBoard[from.row][5] = newBoard[from.row][7]
      newBoard[from.row][7] = null
    } else if (to.col === 2) {
      // Queenside: rook a-file -> d-file.
      newBoard[from.row][3] = newBoard[from.row][0]
      newBoard[from.row][0] = null
    }
  }

  const isCapture = captured !== null
  let notation = getPieceNotation(piece, from, to, isCapture)
  if (piece.type === 'K' && Math.abs(to.col - from.col) === 2) {
    notation = to.col === 6 ? 'O-O' : 'O-O-O'
  } else if (promo) {
    notation += `=${promo}`
  }

  const move: Move = { from, to, notation, timestamp: Date.now() }

  const capturedPieces = {
    white: [...gameState.capturedPieces.white],
    black: [...gameState.capturedPieces.black],
  }
  if (captured) capturedPieces[captured.color].push(captured.type)

  return {
    board: newBoard,
    whiteToMove: !gameState.whiteToMove,
    moves: [...gameState.moves, move],
    status: 'playing',
    selectedSquare: null,
    lastMove: move,
    capturedPieces,
  }
}

/** Re-export for callers that need square helpers alongside move application. */
export { coordsToSquare }
