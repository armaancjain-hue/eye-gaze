import { GameState, BoardPosition, PieceType } from './types'
import { COLUMN_LABELS } from './constants'

/**
 * FEN (Forsyth–Edwards Notation) serialization for the board grid, so the
 * position can be sent to a Stockfish/python-chess backend.
 *
 * Grid convention (see mock-data): row 0 = rank 8 (black back rank),
 * row 7 = rank 1; col 0 = file a, col 7 = file h.
 */

/** FEN piece letter: uppercase for white, lowercase for black. */
function pieceToFenChar(type: PieceType, isWhite: boolean): string {
  return isWhite ? type.toUpperCase() : type.toLowerCase()
}

/** Convert a grid position to algebraic square notation, e.g. {6,4} -> "e2". */
export function coordsToSquare(pos: BoardPosition): string {
  const file = COLUMN_LABELS[pos.col]
  const rank = 8 - pos.row
  return `${file}${rank}`
}

/** Convert an algebraic square to a grid position, e.g. "e2" -> {row:6,col:4}. */
export function squareToCoords(square: string): BoardPosition {
  const col = square.charCodeAt(0) - 'a'.charCodeAt(0)
  const rank = parseInt(square[1], 10)
  return { row: 8 - rank, col }
}

/**
 * Infer castling availability from piece positions. The simplified frontend
 * engine can't castle and never moves the king/rooks off their home squares
 * without it being a real move, so "king + rook both home" is a safe proxy.
 */
function inferCastling(board: GameState['board']): string {
  let rights = ''
  const isPiece = (r: number, c: number, type: PieceType, white: boolean) => {
    const p = board[r][c]
    return !!p && p.type === type && p.color === (white ? 'white' : 'black')
  }

  const whiteKingHome = isPiece(7, 4, 'K', true)
  const blackKingHome = isPiece(0, 4, 'K', false)

  if (whiteKingHome && isPiece(7, 7, 'R', true)) rights += 'K'
  if (whiteKingHome && isPiece(7, 0, 'R', true)) rights += 'Q'
  if (blackKingHome && isPiece(0, 7, 'R', false)) rights += 'k'
  if (blackKingHome && isPiece(0, 0, 'R', false)) rights += 'q'

  return rights || '-'
}

/**
 * Derive the en-passant target square from the last move, if it was a pawn
 * double-step. The target is the square the pawn skipped over.
 */
function inferEnPassant(gameState: GameState): string {
  const last = gameState.lastMove
  if (!last) return '-'
  const movedPiece = gameState.board[last.to.row][last.to.col]
  if (!movedPiece || movedPiece.type !== 'P') return '-'
  if (Math.abs(last.from.row - last.to.row) !== 2) return '-'
  const midRow = (last.from.row + last.to.row) / 2
  return coordsToSquare({ row: midRow, col: last.to.col })
}

export function boardToFen(gameState: GameState): string {
  // 1. Piece placement, rank 8 (row 0) down to rank 1 (row 7).
  const rankStrings: string[] = []
  for (let row = 0; row < 8; row++) {
    let rankStr = ''
    let empty = 0
    for (let col = 0; col < 8; col++) {
      const piece = gameState.board[row][col]
      if (!piece) {
        empty++
      } else {
        if (empty > 0) {
          rankStr += empty
          empty = 0
        }
        rankStr += pieceToFenChar(piece.type, piece.color === 'white')
      }
    }
    if (empty > 0) rankStr += empty
    rankStrings.push(rankStr)
  }
  const placement = rankStrings.join('/')

  // 2. Active color.
  const activeColor = gameState.whiteToMove ? 'w' : 'b'

  // 3. Castling, 4. en passant.
  const castling = inferCastling(gameState.board)
  const enPassant = inferEnPassant(gameState)

  // 5. Halfmove clock (not tracked -> 0), 6. fullmove number.
  const halfmove = 0
  const fullmove = Math.floor(gameState.moves.length / 2) + 1

  return `${placement} ${activeColor} ${castling} ${enPassant} ${halfmove} ${fullmove}`
}
